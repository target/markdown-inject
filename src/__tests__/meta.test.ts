import fs from 'fs'
import path from 'path'

const lockFileNames: string[] = [
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]

describe.each(lockFileNames)('%s', (lockFileName) => {
  it('does not contain private registry references', () => {
    const lockFilePath = path.join(process.cwd(), lockFileName)
    if (!fs.existsSync(lockFilePath)) {
      return
    }
    const lockFileContents = fs.readFileSync(lockFilePath, {
      encoding: 'utf-8',
    })
    expect(lockFileContents.indexOf('artifactory')).toBe(-1)
  })
})
