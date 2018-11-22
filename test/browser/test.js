const IndexedCramFile = gmodCRAM.IndexedCramFile;
const CraiIndex = gmodCRAM.CraiIndex;

const indexedFile2 = new IndexedCramFile({

  cramUrl: '../data/ce_5.tmp.cram',

  index: new CraiIndex({
    url: '../data/ce_5.tmp.cram.crai',
  }),

  seqFetch:  (seqId, start, end) => {
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

      output += 'got a record named' + record.readName + '<p/>'

      record.readFeatures.forEach(({code, pos, refPos, ref, sub}) => {

        if (code === 'X') {
          output += record.readName + ' shows a base substitution of ' + ref + '->' + sub + ' at ' + refPos + '<br/>';
        }

      })
    })

    document.getElementById('output').innerHTML = output;

  })
