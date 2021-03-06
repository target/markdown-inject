import fs from 'fs'
import path from 'path'

describe('package-lock.json', () => {
  it('does not contain private registry references', () => {
    const lockFile = fs.readFileSync(
      path.join(process.cwd(), 'package-lock.json'),
      {
        encoding: 'utf-8',
      }
    )
    expect(lockFile.indexOf('artifactory')).toBe(-1)
  })
})
