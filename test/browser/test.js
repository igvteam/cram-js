const IndexedCramFile = gmodCRAM.IndexedCramFile;
const CraiIndex = gmodCRAM.CraiIndex;
const CramFile = gmodCRAM.CramFile;

const cramUrl = '../data/grc37-1%23HG03297.mapped.ILLUMINA.bwa.ESN.low_coverage.20130415.bam.cram';
const indexUrl = '../data/grc37-1%23HG03297.mapped.ILLUMINA.bwa.ESN.low_coverage.20130415.bam.cram.crai';
//const cramUrl = '../data/ce%235.tmp.cram';
//cons indexUrl = '../data/ce%235.tmp.cram.crai';

const indexedFile = new IndexedCramFile({

  cramUrl: cramUrl,

  index: new CraiIndex({
    url: indexUrl
  }),

  seqFetch: (seqId, start, end) => {
    let fakeSeq = ''
    for (let i = start; i <= end; i += 1) {
      fakeSeq += 'A'
    }
    return Promise.resolve(fakeSeq);
  },

  checkSequenceMD5: false,
})

// example of fetching records from an indexed CRAM file.
// NOTE: only numeric IDs for the reference sequence are accepted
indexedFile.getRecordsForRange(0, 1, 20000)

  .then(function (records) {

    let output = "";

    records.forEach(record => {

      output += '<p/><b>got a record named: ' + record.readName + '</b><br/>';
      output += 'alignment start: ' + record.alignmentStart + '<br/>';
      output += 'length on ref: ' + record.lengthOnRef + '<br/>';
      output += 'read bases: ' + record.getReadBases() + '<br/>';
      output += 'quality scores: ' + (record.isPreservingQualityScores() ? record.qualityScores.join(',') : 'none') + '<br/>';
      output += 'read features:' + '<br/>';

      if(record.readFeatures) {
        record.readFeatures.forEach(({code, data, pos, refPos, ref, sub}) => {

          output += 'code: ' + code + ' ';

          switch (code) {
            case 'X':
              output += 'base substitution of ' + ref + '->' + sub + ' at ' + refPos + '<br/>';
              break;
            case 'D':
              output += 'deletion of ' + data + ' bases at ' + refPos + '<br/>';
              break;
          }
        })
      }
      else {
        output += 'no read features <br/>';
      }
    })

    document.getElementById('output').innerHTML = output;

  })


const cramFile = new CramFile({url: cramUrl});
//const cramFile = new CramFile({url: '../data/ce%235.tmp.cram'});

cramFile.getSamHeader()
  .then(function (header) {
    // Find the SQ lines

    let sqtext = ''
    for(let line of header) {

      if('SQ' === line.tag) {
        sqtext += line.data[0].value;
        sqtext += ", "
      }
    }

    document.getElementById('header').innerHTML = sqtext;
  });


