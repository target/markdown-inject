import shellQuote from 'shell-quote'
import injectMarkdown from '../md-inject'

const baseProcess = process

jest.mock('../md-inject')
jest.spyOn(console, 'error')
jest.spyOn(process.stdout, 'write')

describe('CLI', () => {
  beforeEach(async () => {
    /* eslint-disable-next-line */
    /* @ts-ignore */
    process.exit = jest.fn()
  })

  afterEach(() => {
    process = baseProcess
  })

  it('returns help text when no glob pattern is passed', async () => {
    await invokeCli('markdown-inject')

    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringMatching('Usage: markdown-inject')
    )
    expect(injectMarkdown).not.toHaveBeenCalled()
    expect(process.exit).toHaveBeenCalledWith(0)
  })

  it('passes ./**/*.md when -a parameter is supplied', async () => {
    await invokeCli('markdown-inject -a')

    expect(injectMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({
        globPattern: './**/*.md',
      })
    )
  })

  it.each([[`'./**/CHANGELOG.md' -a`], [`-a './**/CHANGELOG.md'`]])(
    'throws when -a and a globPattern are provided',
    async (mdiArgs) => {
      console.error = jest.fn()

      await invokeCli(`markdown-inject ${mdiArgs}`)

      expect(injectMarkdown).not.toHaveBeenCalled()
      expect(console.error).toHaveBeenCalledWith(
        "Options -a / --all and a globPattern ('./**/CHANGELOG.md') can not be provided together. Please select one or the other."
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    }
  )

  it('-a does not write the help text', async () => {
    await invokeCli('markdown-inject -a')

    expect(process.stdout.write).not.toHaveBeenCalledWith(
      expect.stringMatching('Usage: markdown-inject')
    )
  })
})

const invokeCli = async (args: string) => {
  const [node] = process.argv
  process.argv = [node, ...(shellQuote.parse(args) as string[])]

  jest.isolateModules(() => {
    require('../index')
  })
}
