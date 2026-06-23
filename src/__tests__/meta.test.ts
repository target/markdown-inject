import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

describe('package-lock.json', () => {
  it('does not contain private registry references', () => {
    const lockFile = fs.readFileSync(
      path.join(process.cwd(), 'package-lock.json'),
      { encoding: 'utf-8' }
    )
    assert.equal(lockFile.indexOf('artifactory'), -1)
  })
})
