const {CramFile, IndexedCramFile} = require('./src/index')
const CraiIndex = require('./src/craiIndex')


const cramUrl =
  'https://s3.amazonaws.com/igv.org.test/data/cram/heart_slc25a3.cram'
const indexUrl =
  'https://s3.amazonaws.com/igv.org.test/data/cram/heart_slc25a3.cram.crai'


const indexedFile = new IndexedCramFile({
  cramUrl,

  index: new CraiIndex({
    url: indexUrl,
  }),

  seqFetch: (seqId, start, end) => {
    let fakeSeq = ''
    for (let i = start; i <= end; i += 1) {
      fakeSeq += 'A'
    }
    return Promise.resolve(fakeSeq)
  },

  checkSequenceMD5: false,
})

indexedFile.cram.getSamHeader()
  .then(function (header) {
    console.log(header)
  })
  .catch(function (error) {
    console.error(error)
  })

//98,981,215-99,001,966
indexedFile
  .getRecordsForRange(0, 98981215, 99001966)

  .then(records => {
    let output = ''

    records.forEach(record => {
      console.log('got a record named: ' + record.readName)
      console.log('alignment start: ' + record.alignmentStart)
      console.log('length on ref: ' + record.lengthOnRef)
      console.log('read bases: ' + record.getReadBases())
      console.log('quality scores: ' +
        record.isPreservingQualityScores()
        ? record.qualityScores.join(',')
        : 'none'
      )
      console.log('read features:')

      if (record.readFeatures) {
        record.readFeatures.forEach(({code, data, pos, refPos, ref, sub}) => {
          console.log('code: ' + code)

          switch (code) {
            case 'X':
              console.log('base substitution of ' + ref + '->' + sub + ' at ' + refPos)
              break
            case 'D':
              console.log('deletion of ' + data + ' bases at ' + refPos)
              break
            default:
            // Do nothing
          }
        })
      } else {
        console.log('no read features')
      }
    })


  })
