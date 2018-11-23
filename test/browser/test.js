const IndexedCramFile = gmodCRAM.IndexedCramFile;
const CraiIndex = gmodCRAM.CraiIndex;
const CramFile = gmodCRAM.CramFile;

const indexedFile2 = new IndexedCramFile({

  cramUrl: '../data/ce_5.tmp.cram',

  index: new CraiIndex({
    url: '../data/ce_5.tmp.cram.crai',
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
indexedFile2.getRecordsForRange(0, 10000, 20000)

  .then(function (records) {

    let output = "";

    records.forEach(record => {

      output += 'got a record named ' + record.readName + '<p/>'

      output += 'read bases: ' + record.getReadBases() + '<br/>';

      output += 'quality scores: ' + (record.isPreservingQualityScores() ? record.qualityScores.join(',') : 'none') + '<br/>';

      output += 'read features:' + '<br/>';

      record.readFeatures.forEach(({code, data, pos, refPos, ref, sub}) => {

        output += 'code: ' + code + ' ';

        switch(code) {
          case 'X':
            output += 'base substitution of ' + ref + '->' + sub + ' at ' + refPos + '<br/>';
            break;
          case 'D':
            output += 'deletion of ' + data + ' bases at '+ refPos + '<br/>';
            break;
        }

      })
    })

    document.getElementById('output').innerHTML = output;

  })


const cramFile = new CramFile({url: '../data/ce_5.tmp.cram'});

cramFile.getSamHeader()
  .then(function (header) {
    // Find the SQ lines

    let sqtext = ''
    for(let line of header) {

      if('SQ' === line.tag) {
        sqtext += line.data[0].value;
        sqtext += "<br/>"
      }
    }

    document.getElementById('header').innerHTML = sqtext;
  });


