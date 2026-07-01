import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

describe('pnpm-lock.yaml', () => {
  it('does not contain private registry references', () => {
    const lockFile = fs.readFileSync(
      path.join(process.cwd(), 'pnpm-lock.yaml'),
      { encoding: 'utf-8' },
    )
    assert.equal(lockFile.indexOf('artifactory'), -1)
  })
})
