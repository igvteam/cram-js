// @ts-nocheck
import { test, expect } from 'vitest'
import { t2 as testFileList } from './lib/testFileList'
import { testDataFile } from './lib/util'
import { dumpWholeFile } from './lib/dumpFile'
import { CramFile } from '../src/index'
import { FetchableSmallFasta } from './lib/fasta'

testFileList.forEach(filename => {
  test(`can dump the whole ${filename} without error`, async () => {
    let seqFetch
    if (filename.includes('#')) {
      const referenceFileName = filename.replace(/#.+$/, '.fa')
      const fasta = new FetchableSmallFasta(testDataFile(referenceFileName))
      seqFetch = fasta.fetch.bind(fasta)
    }

    const filehandle = testDataFile(filename)
    const file = new CramFile({ filehandle, seqFetch })
    const fileData = await dumpWholeFile(file)
    expect(fileData).toMatchSnapshot()
  }, 10000)
})
