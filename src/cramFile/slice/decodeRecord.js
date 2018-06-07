const Long = require('long')
const Constants = require('../constants')

class CramRecord {
  constructor() {
    this.tags = {}
  }
  isDetached() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_DETACHED)
  }

  hasMateDownStream() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_MATE_DOWNSTREAM)
  }

  isSegmentUnmapped() {
    return !!(this.flags & Constants.BAM_FUNMAP)
  }

  isPreservingQualityScores() {
    return !!(this.cramFlags & Constants.CRAM_FLAG_PRESERVE_QUAL_SCORES)
  }
}

/** given a Buffer, read a string up to the first null character */
function readNullTerminatedStringFromBuffer(buffer) {
  const zeroOffset = buffer.indexOf(0)
  if (zeroOffset === -1) return buffer.toString('ascii')
  return buffer.toString('ascii', 0, zeroOffset)
}

/** parse a BAM tag's array value from a binary buffer */
function parseTagValueArray(/* buffer */) {
  throw new Error('parseTagValueArray not yet implemented') // TODO
}

function parseTagData(tagType, buffer) {
  if (tagType === 'Z') return readNullTerminatedStringFromBuffer(buffer)
  else if (tagType === 'A') return String.fromCharCode(buffer[0])
  else if (tagType === 'I') {
    const val = Long.fromBytesLE(buffer)
    if (
      val.greaterThan(Number.MAX_SAFE_INTEGER) ||
      val.lessThan(Number.MIN_SAFE_INTEGER)
    )
      throw new Error('integer overflow')
    return val.toNumber()
  } else if (tagType === 'i') return buffer.readInt32LE()
  else if (tagType === 's') return buffer.readInt16LE()
  else if (tagType === 'S')
    // Convert to unsigned short stored in an int
    return buffer.readInt16LE() & 0xffff
  else if (tagType === 'c') return buffer[0]
  else if (tagType === 'C')
    // Convert to unsigned byte stored in an int
    return buffer[0] & 0xff
  else if (tagType === 'f') return buffer.readFloatLE()
  if (tagType === 'H') {
    const hex = readNullTerminatedStringFromBuffer(buffer)
    return Number.parseInt(hex.replace(/^0x/, ''), 16)
  }
  if (tagType === 'B') return parseTagValueArray(buffer)

  throw new Error(`Unrecognized tag type ${tagType}`)
}

function decodeRecord(
  slice,
  decodeDataSeries,
  compressionScheme,
  sliceHeader,
  coreDataBlock,
  blocksByContentId,
  cursors,
) {
  const cramRecord = new CramRecord()

  cramRecord.flags = decodeDataSeries('BF')
  cramRecord.compressionFlags = decodeDataSeries('CF')
  if (sliceHeader.content.refSeqId === -2)
    cramRecord.sequenceId = decodeDataSeries('RI')
  else cramRecord.sequenceId = sliceHeader.content.refSeqId

  cramRecord.readLength = decodeDataSeries('RL')
  // if APDelta, will calculate the true start in a second pass
  cramRecord.alignmentStart = decodeDataSeries('AP')
  cramRecord.readGroupID = decodeDataSeries('RG')

  if (compressionScheme.readNamesIncluded)
    cramRecord.readName = decodeDataSeries('RN').toString('ascii') // new String(readNameCodec.readData(), charset)

  // mate record
  if (cramRecord.isDetached()) {
    cramRecord.mateFlags = decodeDataSeries('MF')
    cramRecord.mate = {}
    if (!compressionScheme.readNamesIncluded)
      cramRecord.mate.readName = decodeDataSeries('RN') // new String(readNameCodec.readData(), charset)
    cramRecord.mate.sequenceID = decodeDataSeries('NS')
    cramRecord.mate.alignmentStart = decodeDataSeries('NP')
    cramRecord.templateSize = decodeDataSeries('TS')
    // detachedCount++
  } else if (cramRecord.hasMateDownStream()) {
    cramRecord.recordsToNextFragment = decodeDataSeries('NF')
  }

  const TLindex = decodeDataSeries('TL')
  if (TLindex < 0)
    /* TODO: check nTL: TLindex >= compressionHeader.tagEncoding.size */
    throw new Error('invalid TL index')

  // TN = tag names
  const TN = compressionScheme.getTagNames(TLindex)
  const ntags = TN.length

  for (let i = 0; i < ntags; i += 1) {
    const tagId = TN[i]
    const tagName = tagId.substr(0, 2)
    const tagType = tagId.substr(2, 1)

    // if (tagName[0] === 'M' && tagName[1] === 'D') hasMD = true
    // if (tagName[0] === 'N' && tagName[1] === 'M') hasNM = true

    const tagCodec = compressionScheme.getCodecForTag(tagId)
    if (!tagCodec)
      throw new Error(`no codec defined for auxiliary tag ${tagId}`)
    const tagData = tagCodec.decode(
      slice,
      coreDataBlock,
      blocksByContentId,
      cursors,
    )
    cramRecord.tags[tagName] = parseTagData(tagType, tagData)
  }
  // const /* Integer */ tagIdList = tagIdListCodec.readData()
  // const /* byte[][] */ ids = tagIdDictionary[tagIdList]
  // if (ids.length > 0) {
  //   const /* int */ tagCount = ids.length
  //   cramRecord.tags = new ReadTag[tagCount]()
  //   for (let i = 0; i < ids.length; i++) {
  //     const /* int */ id = ReadTag.name3BytesToInt(ids[i])
  //     const /* DataReader<byte[]> */ dataReader = tagValueCodecs.get(id)
  //     const /* ReadTag */ tag = new ReadTag(
  //       id,
  //       dataReader.readData(),
  //       validationStringency,
  //     )
  //     cramRecord.tags[i] = tag
  //   }
  // }

  if (!cramRecord.isSegmentUnmapped()) {
    // reading read features:
    const /* int */ size = decodeDataSeries('FN')
    let /* int */ prevPos = 0
    const /* java.util.List<ReadFeature> */ readFeatures = new Array(
      size,
    ) /* new LinkedList<ReadFeature>(); */
    cramRecord.readFeatures = readFeatures
    for (let i = 0; i < size; i += 1) {
      const /* Byte */ operator = String.fromCharCode(decodeDataSeries('FC'))

      const /* int */ position = prevPos + decodeDataSeries('FP')
      prevPos = position

      const readFeature = { operator, position }
      // map of operator name -> data series name
      const data1DataSeriesName = {
        B: 'BA',
        S: 'SC', // TODO: 'IN' if cram v1
        X: 'BS',
        D: 'DL',
        I: 'IN',
        i: 'BA',
        b: 'BB',
        q: 'QQ',
        Q: 'QS',
        H: 'HC',
        P: 'PD',
        N: 'RS',
      }[operator]

      if (!data1DataSeriesName)
        throw new Error(`invalid read feature operator "${operator}"`)

      readFeature.data1 = decodeDataSeries(data1DataSeriesName)

      // map of operator name -> data
      const data2DataSeriesName = { B: 'QS' }[operator]
      if (data2DataSeriesName)
        readFeature.data2 = decodeDataSeries(data2DataSeriesName)

      readFeatures[i] = readFeature
    }

    // mapping quality:
    cramRecord.mappingQuality = decodeDataSeries('MQ')
    if (cramRecord.isPreservingQualityScores()) {
      cramRecord.qualityScores = new Array(cramRecord.readLength).map(() =>
        decodeDataSeries('QS'),
      )
      // qualityScoresCodec.readDataArray(
      //   cramRecord.readLength,
      // )
    }
  } else if (cramRecord.isUnknownBases()) {
    cramRecord.readBases = null
    cramRecord.qualityScores = null
  } else {
    const /* byte[] */ bases = new Array(
      cramRecord.readLength,
    ) /* new byte[cramRecord.readLength]; */
    for (let i = 0; i < bases.length; i += 1) bases[i] = decodeDataSeries('BA')
    cramRecord.readBases = bases

    if (cramRecord.isPreservingQualityScores()) {
      cramRecord.qualityScores = new Array(cramRecord.readLength).map(() =>
        decodeDataSeries('QS'),
      )
    }
  }

  // recordCounter++

  // prevRecord = cramRecord

  return cramRecord
}

module.exports = decodeRecord