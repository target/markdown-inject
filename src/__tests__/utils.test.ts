import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import * as utils from '../utils.ts'

describe('utils', () => {
  describe('fileLocation({...})', () => {
    it('returns file path only when no line or col is provided', () => {
      const codeLoc = { file: 'example.ts' }

      const result = utils.fileLocation(codeLoc)

      assert.strictEqual(result, 'example.ts')
    })

    it('returns file path and line when line is provided', () => {
      const codeLoc = { file: 'example.ts', line: 10 }

      const result = utils.fileLocation(codeLoc)

      assert.strictEqual(result, 'example.ts:10')
    })

    it('returns file path, line, and col when all are provided', () => {
      const codeLoc = { file: 'example.ts', line: 10, col: 5 }

      const result = utils.fileLocation(codeLoc)

      assert.strictEqual(result, 'example.ts:10:5')
    })
  })
})
