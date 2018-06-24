const zlib = require('zlib')
const crc32 = require('buffer-crc32')

const { CramUnimplementedError, CramMalformedError } = require('../errors')
const rans = require('../rans')
const {
  cramFileDefinition: cramFileDefinitionParser,
  getSectionParsers,
} = require('./sectionParsers')

const CramContainer = require('./container')

const { parseItem } = require('./util')
const { parseHeaderText } = require('../sam')

class CramFile {
  /**
   * @param {object} filehandle - a filehandle that implements the stat() and
   * read() methods of the Node filehandle API https://nodejs.org/api/fs.html#fs_class_filehandle
   */
  constructor(filehandle) {
    this.file = filehandle
    this.validateChecksums = true
  }

  toString() {
    if (this.file.filename) return this.file.filename
    if (this.file.url) return this.file.url

    return '(cram file)'
  }

  // can just read this object like a filehandle
  read(buffer, offset, length, position) {
    return this.file.read(buffer, offset, length, position)
  }

  // can just stat this object like a filehandle
  stat() {
    return this.file.stat()
  }

  // memoize
  async getDefinition() {
    const headbytes = Buffer.allocUnsafe(cramFileDefinitionParser.maxLength)
    await this.file.read(headbytes, 0, cramFileDefinitionParser.maxLength, 0)
    const definition = cramFileDefinitionParser.parser.parse(headbytes).result
    if (definition.majorVersion !== 2 && definition.majorVersion !== 3)
      throw new CramUnimplementedError(
        `CRAM version ${definition.majorVersion} not supported`,
      )
    return definition
  }

  async getSamHeader() {
    const firstContainer = await this.getContainerById(0)
    if (!firstContainer)
      throw new CramMalformedError('file contains no containers')

    const { content } = await firstContainer.getFirstBlock()
    // find the end of the trailing zeros in the header text
    const headerLength = content.readInt32LE()
    const textStart = 4
    // let textEnd = content.length - 1
    // while (textEnd >= textStart && !content[textEnd]) textEnd -= 1
    // trim off the trailing zeros
    const text = content.toString('ascii', textStart, textStart + headerLength)
    return parseHeaderText(text)
  }

  async getSectionParsers() {
    if (!this._sectionParsers) {
      const { majorVersion } = await this.getDefinition()
      this._sectionParsers = getSectionParsers(majorVersion)
    }
    return this._sectionParsers
  }

  async getContainerById(containerNumber) {
    const sectionParsers = await this.getSectionParsers()
    let position = sectionParsers.cramFileDefinition.maxLength
    const { size: fileSize } = await this.file.stat()
    const { cramContainerHeader1 } = sectionParsers

    // skip with a series of reads to the proper container
    let currentContainer
    for (
      let i = 0;
      i <= containerNumber &&
      position + cramContainerHeader1.maxLength + 8 < fileSize;
      i += 1
    ) {
      currentContainer = this.getContainerAtPosition(position)
      const currentHeader = await currentContainer.getHeader()
      if (!currentHeader)
        throw new CramMalformedError(
          `container ${containerNumber} not found in file`,
        )
      // if this is the first container, read all the blocks in the
      // container to determine its length, because we cannot trust
      // the container header's given length due to a bug somewhere
      // in htslib
      if (i === 0) {
        position = currentHeader._endPosition
        for (let j = 0; j < currentHeader.numBlocks; j += 1) {
          const block = await this.readBlock(position)
          position = block._endPosition
        }
      } else {
        // otherwise, just traverse to the next container using the container's length
        position += currentHeader._size + currentHeader.length
      }
    }

    return currentContainer
  }

  async checkCrc32(position, length, recordedCrc32, description) {
    const b = Buffer.allocUnsafe(length)
    await this.file.read(b, 0, length, position)
    const calculatedCrc32 = crc32.unsigned(b)
    if (calculatedCrc32 !== recordedCrc32) {
      throw new CramMalformedError(
        `crc mismatch in ${description}: recorded CRC32 = ${recordedCrc32}, but calculated CRC32 = ${calculatedCrc32}`,
      )
    }
  }

  /**
   * @returns {number} the number of containers in the file
   */
  async containerCount() {
    const sectionParsers = await this.getSectionParsers()
    let position = sectionParsers.cramFileDefinition.maxLength
    const { size: fileSize } = await this.file.stat()
    const { cramContainerHeader1 } = sectionParsers

    let i
    for (
      i = 0;
      position + cramContainerHeader1.maxLength + 8 < fileSize;
      i += 1
    ) {
      const currentHeader = await this.getContainerAtPosition(
        position,
      ).getHeader()
      if (!currentHeader) {
        return i
      }
      // if this is the first container, read all the blocks in the
      // container, because we cannot trust the container
      // header's given length due to a bug somewhere in htslib
      if (i === 0) {
        position = currentHeader._endPosition
        for (let j = 0; j < currentHeader.numBlocks; j += 1) {
          const block = await this.readBlock(position)
          position = block._endPosition
        }
      } else {
        // otherwise, just traverse to the next container using the container's length
        position += currentHeader._size + currentHeader.length
      }
    }

    return i + 1
  }

  getContainerAtPosition(position) {
    return new CramContainer(this, position)
  }

  async readBlockHeader(position) {
    const sectionParsers = await this.getSectionParsers()
    const { cramBlockHeader } = sectionParsers
    const { size: fileSize } = await this.file.stat()

    if (position + cramBlockHeader.maxLength >= fileSize) return undefined

    const buffer = Buffer.allocUnsafe(cramBlockHeader.maxLength)
    await this.file.read(buffer, 0, cramBlockHeader.maxLength, position)
    return parseItem(buffer, cramBlockHeader.parser, 0, position)
  }

  async _parseSection(
    section,
    position,
    size = section.maxLength,
    preReadBuffer,
  ) {
    let buffer
    if (preReadBuffer) {
      buffer = preReadBuffer
    } else {
      const { size: fileSize } = await this.file.stat()
      if (position + size >= fileSize) return undefined
      buffer = Buffer.allocUnsafe(size)
      await this.file.read(buffer, 0, size, position)
    }
    const data = parseItem(buffer, section.parser, 0, position)
    if (data._size !== size)
      throw new CramMalformedError(
        `section read error: requested size ${size} does not equal parsed size ${
          data._size
        }`,
      )
    return data
  }

  _uncompress(compressionMethod, inputBuffer, outputBuffer) {
    if (compressionMethod === 'gzip') {
      const result = zlib.gunzipSync(inputBuffer)
      result.copy(outputBuffer)
    } else if (compressionMethod === 'rans') {
      rans.uncompress(inputBuffer, outputBuffer)
    } else {
      throw new CramUnimplementedError(
        `${compressionMethod} decompression not yet implemented`,
      )
    }
  }

  async readBlock(position) {
    const { majorVersion } = await this.getDefinition()
    const sectionParsers = await this.getSectionParsers()
    const block = await this.readBlockHeader(position)
    const blockContentPosition = block._endPosition
    block.contentPosition = block._endPosition

    const uncompressedData = Buffer.allocUnsafe(block.uncompressedSize)

    if (block.compressionMethod !== 'raw') {
      const compressedData = Buffer.allocUnsafe(block.compressedSize)
      await this.read(
        compressedData,
        0,
        block.compressedSize,
        blockContentPosition,
      )

      this._uncompress(
        block.compressionMethod,
        compressedData,
        uncompressedData,
      )
    } else {
      await this.read(
        uncompressedData,
        0,
        block.uncompressedSize,
        blockContentPosition,
      )
    }

    block.content = uncompressedData

    if (majorVersion >= 3) {
      // parse the crc32
      const crc = await this._parseSection(
        sectionParsers.cramBlockCrc32,
        blockContentPosition + block.compressedSize,
      )
      block.crc32 = crc.crc32

      // check the block data crc32
      if (this.validateChecksums) {
        await this.checkCrc32(
          position,
          block._size + block.compressedSize,
          block.crc32,
          'block data',
        )
      }

      // make the endposition and size reflect the whole block
      block._endPosition = crc._endPosition
      block._size =
        block.compressedSize + sectionParsers.cramBlockCrc32.maxLength
    } else {
      block._endPosition = blockContentPosition + block.compressedSize
      block._size = block.compressedSize
    }

    return block
  }
}

module.exports = CramFile
