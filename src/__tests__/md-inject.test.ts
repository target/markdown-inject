import { describe, it, mock, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertCalledWith,
  assertNotCalled,
  assertCalled,
  assertCalledTimes,
  stringContaining,
  stringMatching,
  objectContaining,
  anything,
} from './helpers.ts'

// ---------------------------------------------------------------------------
// Module mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

const execMock = mock.fn()
await mock.module('child_process', {
  namedExports: { exec: execMock },
})

const envCiMock = mock.fn()
await mock.module('env-ci', {
  defaultExport: envCiMock,
})

// Logger mock — returns a plain object of jest.fn()-style mocks
const logger = {
  warn: mock.fn(),
  error: mock.fn(),
  log: mock.fn(),
  group: mock.fn(),
  groupEnd: mock.fn(),
  info: mock.fn(),
  debug: mock.fn(),
}
await mock.module('../Logger.ts', {
  defaultExport: class {
    constructor() {
      return logger
    }
  },
})

// fs/promises mock
const globMock = mock.fn()
const readFileMock = mock.fn()
const writeFileMock = mock.fn()
await mock.module('node:fs/promises', {
  namedExports: {
    glob: globMock,
    readFile: readFileMock,
    writeFile: writeFileMock,
  },
})

// Import the module under test AFTER all mocks are registered
const { default: injectMarkdown } = await import('../md-inject.ts')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make glob return an async iterable over the given file list */
function mockGlob(files: string[]): void {
  globMock.mock.mockImplementation(() =>
    (async function* () {
      yield* files
    })()
  )
}

function resetAllMocks(): void {
  execMock.mock.resetCalls()
  envCiMock.mock.resetCalls()
  globMock.mock.resetCalls()
  readFileMock.mock.resetCalls()
  writeFileMock.mock.resetCalls()
  Object.values(logger).forEach((fn) => fn.mock.resetCalls())
}

const originalProcessEnv = process.env

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Markdown injection', () => {
  after(() => {
    process.exitCode = undefined as unknown as number
  })
  beforeEach(() => {
    resetAllMocks()

    execMock.mock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: null, stdout: string) => void
      cb(null, '')
    })

    envCiMock.mock.mockImplementation(() => ({ isCi: false, isPr: false }))

    // Default: glob yields nothing; readFile rejects (simulates no .gitignore)
    mockGlob([])
    readFileMock.mock.mockImplementation(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    process.env = originalProcessEnv
    process.exitCode = undefined as unknown as number
  })

  it('warns and exits with no action on pull request', async () => {
    envCiMock.mock.mockImplementation(() => ({ isCi: true, isPr: true }))

    await injectMarkdown()

    assertCalledWith(logger.warn, stringContaining('not run during pull'))
    assert.ok([null, undefined, 0].includes(process.exitCode as any))
    assertNotCalled(globMock)
  })

  it('does not warn / exit early in CI on non-PR builds', async () => {
    envCiMock.mock.mockImplementation(() => ({ isCi: true, isPr: false }))

    await injectMarkdown()

    const warnCallsAboutPR = logger.warn.mock.calls.filter((c) =>
      typeof c.arguments[0] === 'string' &&
      c.arguments[0].includes('not run during pull')
    )
    assert.equal(warnCallsAboutPR.length, 0)
    assertCalled(globMock)
  })

  it('collects all in-repo markdown files', async () => {
    await injectMarkdown()

    assertCalledWith(globMock, '**/*.md', objectContaining({ followSymlinks: true }))
  })

  it('throws gracefully when an error occurs while reading the file', async () => {
    readFileMock.mock.mockImplementation(async () => { throw 'some error' })
    mockGlob(['foo.md'])

    await injectMarkdown()

    assertCalledWith(logger.error, 'foo.md: Error reading file')
    assertCalledWith(logger.error, 'some error')
    assert.equal(process.exitCode, 1)
  })

  it('does nothing', async () => {
    mockGlob(['foo.md'])
    readFileMock.mock.mockImplementation(async () => '# Foo')

    await injectMarkdown()

    assertNotCalled(writeFileMock)
  })

  it('reads all files', async () => {
    mockGlob(['foo.md', 'bar.md', 'baz.md', 'qux.md'])
    readFileMock.mock.mockImplementation(async () => '# Foo')

    await injectMarkdown()

    assertCalledWith(readFileMock, 'foo.md', { encoding: 'utf-8' })
    assertCalledWith(readFileMock, 'bar.md', { encoding: 'utf-8' })
    assertCalledWith(readFileMock, 'baz.md', { encoding: 'utf-8' })
    assertCalledWith(readFileMock, 'qux.md', { encoding: 'utf-8' })
  })

  it('throws gracefully when the config is malformed', async () => {
    mockGlob(['foo.md'])
    readFileMock.mock.mockImplementation(async () =>
      '<!-- CODEBLOCK_START {foo: bar} --><!-- CODEBLOCK_END -->'
    )

    await injectMarkdown()

    assertCalledWith(logger.error, 'Error parsing config:\n{foo: bar}')
    assertCalledWith(
      logger.error,
      objectContaining({ message: stringMatching(/Unexpected token|Expected property name/) })
    )
    assert.equal(process.exitCode, 1)
  })

  it('throws if an invalid block type is passed', async () => {
    setupMock({ config: { type: 'git' } })

    await injectMarkdown()

    assertCalledWith(
      logger.error,
      objectContaining({ message: 'Unexpected "type" of "git". Valid types are "command", "file"' })
    )
    assert.equal(process.exitCode, 1)
  })

  it('runs an arbitrary command', async () => {
    setupMock({ config: { type: 'command', value: 'some arbitrary command' } })

    await injectMarkdown()

    assertCalledWith(execMock, 'some arbitrary command', anything(), anything())
  })

  it('imports a file', async () => {
    setupMock({ mockFileName: 'foo.md', config: { type: 'file', value: 'bar.js' } })

    await injectMarkdown()

    assertCalledWith(readFileMock, 'foo.md', { encoding: 'utf-8' })
    assertCalledWith(readFileMock, stringContaining('bar.js'), { encoding: 'utf-8' })
  })

  it('defaults to file import type', async () => {
    setupMock({ mockFileName: 'foo.md', config: { value: 'bar.js' } })

    await injectMarkdown()

    assertCalledWith(readFileMock, 'foo.md', { encoding: 'utf-8' })
    assertCalledWith(readFileMock, stringContaining('bar.js'), { encoding: 'utf-8' })
  })

  const wonkyFormatCases: string[] = [
    `<!-- CODEBLOCK_START {"type": "command", "value": "some arbitrary command"} --><!-- CODEBLOCK_END -->`,
    `<!-- CODEBLOCK_START {"type":"command","value":"some arbitrary command"} --><!-- CODEBLOCK_END -->`,
    `
<!--
  CODEBLOCK_START
  {
    "type": "command",
    "value": "some arbitrary command"
  }
-->

<!--
  CODEBLOCK_END
-->
`,
    `<!--CODEBLOCK_START {"type": "command", "value": "some arbitrary command"}--><!--CODEBLOCK_END-->`,
    `<!--CODEBLOCK_START {"type": "command", "value": "some arbitrary command"} --><!--CODEBLOCK_END -->`,
    `<!-- CODEBLOCK_START {"type": "command", "value": "some arbitrary command"}--><!-- CODEBLOCK_END-->`,
    `<!-- CODEBLOCK_START {"type": "command", "value": "some arbitrary command"} --> <!-- CODEBLOCK_END -->`,
    `<!-- CODEBLOCK_START {"type": "command", "value": "some arbitrary command"} -->Foo<!-- CODEBLOCK_END -->`,
    `<!-- CODEBLOCK_START {"type": "command", "value": "some arbitrary command"} --> Foo <!-- CODEBLOCK_END -->`,
    `<!-- CODEBLOCK_START {"type": "command", "value": "some arbitrary command"} -->
<!-- CODEBLOCK_END -->`,
    `<!-- CODEBLOCK_START {"type": "command", "value": "some arbitrary command"} -->
Foo<!-- CODEBLOCK_END -->`,
    `<!-- CODEBLOCK_START {"type": "command", "value": "some arbitrary command"} -->
Foo
<!-- CODEBLOCK_END -->`,
    `<!-- CODEBLOCK_START {"type": "command", "value": "some arbitrary command"} -->
    Foo
  <!-- CODEBLOCK_END -->`,
    `{/* CODEBLOCK_START {"type": "command", "value": "some arbitrary command"} */} Foo {/* CODEBLOCK_END */}`,
  ]

  for (const markdownContent of wonkyFormatCases) {
    it('handles wonky formatting', async () => {
      mockGlob(['foo.md'])
      readFileMock.mock.mockImplementation(async () => markdownContent)
      execMock.mock.resetCalls()

      await injectMarkdown()

      assertCalledTimes(execMock, 1)
      assertCalledWith(execMock, 'some arbitrary command', anything(), anything())
    })
  }

  it('writes to the markdown document (command)', async () => {
    setupMock({
      config: { type: 'command', value: 'some arbitrary command' },
      mockResponse: 'The output of some arbitrary command',
    })

    await injectMarkdown()

    const outFile = `
<!-- CODEBLOCK_START {"type":"command","value":"some arbitrary command"} -->
<!-- prettier-ignore -->
~~~~~~~~~~bash
$ some arbitrary command

The output of some arbitrary command
~~~~~~~~~~

<!-- CODEBLOCK_END -->`
    assertCalledWith(writeFileMock, 'foo.md', outFile)
  })

  it('writes to the markdown document (command) with mdx syntax', async () => {
    setupMock({
      mockFileName: 'foo.mdx',
      config: { type: 'command', value: 'some arbitrary command' },
      mockResponse: 'The output of some arbitrary command',
    })

    await injectMarkdown()

    const outFile = `
{/* CODEBLOCK_START {"type":"command","value":"some arbitrary command"} */}
{/* prettier-ignore */}
~~~~~~~~~~bash
$ some arbitrary command

The output of some arbitrary command
~~~~~~~~~~

{/* CODEBLOCK_END */}`
    assertCalledWith(writeFileMock, 'foo.mdx', outFile)
  })

  it('fails to write to the markdown document (command) with mixed syntax', async () => {
    const inFile = `
{/* CODEBLOCK_START {"type":"command","value":"some arbitrary command"} */}

{/* CODEBLOCK_END */}`

    const inFileName = `<!-- prettier-ignore -->
~~~~~~~~~~bash
$ some arbitrary command

The output of some arbitrary command
~~~~~~~~~~`

    mockGlob([inFileName])
    readFileMock.mock.mockImplementation(async (fileName: string) => {
      if (fileName === inFileName) return inFile
      throw new Error('Unexpected file name passed')
    })

    await injectMarkdown()

    assertCalledWith(readFileMock, inFileName, { encoding: 'utf-8' })
    assertNotCalled(writeFileMock)
  })

  it('does not write to the markdown document (command) because of bad syntax', async () => {
    const inFile = `
<!-- CODEBLOCK_START {"type":"command","value":"some arbitrary command"} */}

<!-- CODEBLOCK_END */}`

    const inFileName = `<!-- prettier-ignore -->
~~~~~~~~~~bash
$ some arbitrary command

The output of some arbitrary command
~~~~~~~~~~`

    mockGlob([inFileName])
    readFileMock.mock.mockImplementation(async (fileName: string) => {
      if (fileName === inFileName) return inFile
      throw new Error('Unexpected file name passed')
    })

    await injectMarkdown()

    assertCalledWith(readFileMock, inFileName, { encoding: 'utf-8' })
    assertNotCalled(writeFileMock)
  })

  it('writes to the markdown document (file)', async () => {
    setupMock({
      config: { type: 'file', value: 'bar.js' },
      mockResponse: `console.log('baz')`,
    })

    await injectMarkdown()

    const outFile = `
<!-- CODEBLOCK_START {"type":"file","value":"bar.js"} -->
<!-- prettier-ignore -->
~~~~~~~~~~js
File: bar.js

console.log('baz')
~~~~~~~~~~

<!-- CODEBLOCK_END -->`
    assertCalledWith(writeFileMock, 'foo.md', outFile)
  })

  it('trims whitespace (command)', async () => {
    setupMock({
      config: { type: 'command', value: 'some arbitrary command' },
      mockResponse: `\n\n\nThe output of some arbitrary command\n\n\n`,
    })

    await injectMarkdown()

    const written = writeFileMock.mock.calls[0].arguments[1] as string
    assert.match(written as string, /[^\n]\n{2}The output of some arbitrary command\n[^\n]/)
  })

  it('trims whitespace (file)', async () => {
    setupMock({
      config: { value: 'bar.js' },
      mockResponse: `\n\n\n\nconsole.log('baz')\n\n\n\n\n`,
    })

    await injectMarkdown()

    const written = writeFileMock.mock.calls[0].arguments[1] as string
    assert.match(written as string, /[^\n]\n{2}console\.log\('baz'\)\n{1}[^\n]/)
  })

  it('can retain whitespace (command)', async () => {
    setupMock({
      config: { type: 'command', value: 'some arbitrary command', trim: false },
      mockResponse: `\n\n\nThe output of some arbitrary command\n\n`,
    })

    await injectMarkdown()

    const written = writeFileMock.mock.calls[0].arguments[1] as string
    assert.match(written as string, /\n{3,}The output of some arbitrary command\n{2,}/)
  })

  it('can retain whitespace (file)', async () => {
    setupMock({
      config: { value: 'bar.js', trim: false },
      mockResponse: `\n\n\n\nconsole.log('baz')\n\n\n\n\n`,
    })

    await injectMarkdown()

    const written = writeFileMock.mock.calls[0].arguments[1] as string
    assert.match(written as string, /\n{4,}console\.log\('baz'\)\n{6,}/)
  })

  it('displays the input command', async () => {
    setupMock({
      config: { type: 'command', value: 'some arbitrary command' },
      mockResponse: 'some arbitrary stdout',
    })

    await injectMarkdown()

    const written = writeFileMock.mock.calls[0].arguments[1] as string
    assert.ok((written as string).includes('$ some arbitrary command'))
  })

  it('displays the input file', async () => {
    setupMock({
      config: { value: 'bar.js' },
      mockResponse: 'Weight lifting. Lawyer regulatory board. Pole vaulter\u2019s nemesis',
    })

    await injectMarkdown()

    const written = writeFileMock.mock.calls[0].arguments[1] as string
    assert.ok((written as string).includes('File: bar.js'))
  })

  it('can hide the input command', async () => {
    setupMock({
      config: { type: 'command', value: 'some arbitrary command', hideValue: true },
      mockResponse: 'some arbitrary stdout',
    })

    await injectMarkdown()

    const written = writeFileMock.mock.calls[0].arguments[1] as string
    assert.ok(!(written as string).includes('$ some arbitrary command'))
  })

  it('can hide the input file', async () => {
    setupMock({
      config: { value: 'bar.js', hideValue: true },
      mockResponse: 'Speakeasies',
    })

    await injectMarkdown()

    const written = writeFileMock.mock.calls[0].arguments[1] as string
    assert.ok(!(written as string).includes('File: bar.js'))
  })

  it('can select a language (file)', async () => {
    setupMock({
      config: { value: 'bar.js', language: 'coffeescript' },
      mockResponse: 'Coffee bar?',
    })

    await injectMarkdown()

    const written = writeFileMock.mock.calls[0].arguments[1] as string
    assert.match(written as string, /^~{10}coffeescript$/m)
  })

  it('can select a language (command)', async () => {
    setupMock({
      config: { type: 'command', value: 'npm view react-scripts --json', language: 'json' },
      mockResponse: '{ "version": "17.x" }',
    })

    await injectMarkdown()

    const written = writeFileMock.mock.calls[0].arguments[1] as string
    assert.match(written as string, /^~{10}json$/m)
  })

  it('language is inferred from file extension', async () => {
    setupMock({ config: { value: 'bar.sh' }, mockResponse: 'echo "bar"' })

    await injectMarkdown()

    const written = writeFileMock.mock.calls[0].arguments[1] as string
    assert.match(written as string, /^~{10}sh$/m)
  })

  it('language defaults to bash when unspecified', async () => {
    setupMock({
      config: { type: 'command', value: 'some arbitrary command' },
      mockResponse: 'some arbitrary stdout',
    })

    await injectMarkdown()

    const written = writeFileMock.mock.calls[0].arguments[1] as string
    assert.match(written as string, /^~{10}bash$/m)
  })

  it('language defaults to bash when it can not be inferred', async () => {
    setupMock({ config: { value: 'shell-scripts/foo' }, mockResponse: 'something' })

    await injectMarkdown()

    const written = writeFileMock.mock.calls[0].arguments[1] as string
    assert.match(written as string, /^~{10}bash$/m)
  })

  it('writes over content that already exists', async () => {
    setupMock({
      config: { value: 'shell-scripts/foo' },
      blockContents: `~~~~~~~~~~bash\nFile: shell-scripts/foo\n\necho "Hello America"\n~~~~~~~~~~\n`,
      mockResponse: 'echo "Hello World"',
    })

    await injectMarkdown()

    const written = writeFileMock.mock.calls[0].arguments[1] as string
    assert.ok((written as string).includes('Hello World'))
  })

  it('does not perform a write if no change was made', async () => {
    setupMock({
      config: { value: 'shell-scripts/foo' },
      blockContents: `~~~~~~~~~~bash\nFile: shell-scripts/foo\n\necho "Hello World"\n~~~~~~~~~~\n`,
      mockResponse: 'echo "Hello World"',
    })

    await injectMarkdown()

    assertNotCalled(writeFileMock)
  })

  it('prevents prettier auto-formatting of code block and interior syntax', async () => {
    setupMock({
      config: { value: 'bar.js' },
      mockResponse: 'module.exports = () => console.log("5:00")',
    })

    await injectMarkdown()

    const written = writeFileMock.mock.calls[0].arguments[1] as string
    assert.match(written as string, /<!-- prettier-ignore -->\n~{10}/)
  })

  it('can ignore a block', async () => {
    setupMock({ name: '_IGNORE', config: { value: 'bar.js', ignore: true } })

    await injectMarkdown()

    assertNotCalled(writeFileMock)
  })

  it('ignores nested blocks', async () => {
    setupMock({
      name: '_IGNORE',
      config: { value: 'bar.js', ignore: true },
      blockContents: `~~~\n      <!-- CODEBLOCK_START {"value": ".nvmrc"} -->\n\n      <!-- CODEBLOCK_END -->\n      ~~~`,
    })

    await injectMarkdown()

    assertNotCalled(writeFileMock)
  })

  it('supports block naming', async () => {
    setupMock({
      name: '_NAMED',
      config: { value: 'bar.js' },
      blockContents: `\n      <!-- CODEBLOCK_END -->\n      {/* CODEBLOCK_END */}\n      <!-- CODEBLOCK_END -->\n      <!-- CODEBLOCK_END -->\n`,
      mockResponse: 'console.log("👋")',
    })

    await injectMarkdown()

    assertCalledWith(
      writeFileMock,
      'foo.md',
      `
<!-- CODEBLOCK_START_NAMED {"value":"bar.js"} -->
<!-- prettier-ignore -->
~~~~~~~~~~js
File: bar.js

console.log("👋")
~~~~~~~~~~

<!-- CODEBLOCK_END_NAMED -->`
    )
  })

  it('performs surgical replacement', async () => {
    mockGlob(['foo.md'])

    readFileMock.mock.mockImplementation(async (fileName: string) => {
      if (fileName === 'foo.md') {
        return `
<!-- CODEBLOCK_START_META {"ignore": true} -->
~~~
<!-- CODEBLOCK_START {"value": "bar.js"} -->
<!-- CODEBLOCK_END -->
~~~
<!-- CODEBLOCK_END_META -->

<!-- CODEBLOCK_START {"value": "bar.js"} -->
<!-- CODEBLOCK_END -->

<!-- CODEBLOCK_START_META_2 {"ignore": true} -->
~~~
<!-- CODEBLOCK_START {"value": "bar.js"} -->
<!-- CODEBLOCK_END -->
~~~
<!-- CODEBLOCK_END_META_2 -->

`
      }
      if (fileName.includes('bar.js')) return "console.log('Hello World')"
      throw new Error('Unexpected file name passed')
    })

    await injectMarkdown()

    assertCalledWith(
      writeFileMock,
      'foo.md',
      `
<!-- CODEBLOCK_START_META {"ignore": true} -->
~~~
<!-- CODEBLOCK_START {"value": "bar.js"} -->
<!-- CODEBLOCK_END -->
~~~
<!-- CODEBLOCK_END_META -->

<!-- CODEBLOCK_START {"value": "bar.js"} -->
<!-- prettier-ignore -->
~~~~~~~~~~js
File: bar.js

console.log('Hello World')
~~~~~~~~~~

<!-- CODEBLOCK_END -->

<!-- CODEBLOCK_START_META_2 {"ignore": true} -->
~~~
<!-- CODEBLOCK_START {"value": "bar.js"} -->
<!-- CODEBLOCK_END -->
~~~
<!-- CODEBLOCK_END_META_2 -->

`
    )
  })

  it('handles multiple blocks in one file', async () => {
    mockGlob(['foo.md'])
    readFileMock.mock.mockImplementation(async () => `
# Foo Package

<!--
  CODEBLOCK_START
  {
    "type": "command",
    "value": "npm view foo"
  }
-->
<!-- CODEBLOCK_END -->

{/*
  CODEBLOCK_START
  {
    "type": "command",
    "value": "npm view foo"
  }
*/}
{/* CODEBLOCK_END */}

# Bar Package

<!--
  CODEBLOCK_START
  {
    "type": "command",
    "value": "npm view bar"
  }
-->
<!-- CODEBLOCK_END -->`)

    execMock.mock.mockImplementation((cmd: string, _env: unknown, cb: (e: null, out: string) => void) => {
      cb(null, `OUT: ${cmd}`)
    })

    await injectMarkdown()

    const written = writeFileMock.mock.calls[0].arguments[1] as string
    assert.match(written as string, /OUT: npm view foo(.|\n)*OUT: npm view bar/)
  })

  it('removes color from commands', async () => {
    setupMock({ config: { type: 'command', value: 'npm view react-scripts' } })

    await injectMarkdown()

    const execConfig = execMock.mock.calls[0].arguments[1] as { env: Record<string, string> }
    assert.equal(execConfig.env.FORCE_COLOR, '0')
  })

  it('passes configured environment to commands', async () => {
    setupMock({
      config: {
        type: 'command',
        value: 'npm view react-scripts',
        environment: { FOO_ENV: 'bar val' },
      },
    })

    await injectMarkdown()

    const execConfig = execMock.mock.calls[0].arguments[1] as { env: Record<string, string> }
    assert.equal(execConfig.env.FOO_ENV, 'bar val')
  })

  it('passes system environment to commands', async () => {
    process.env.MY_SYS_ENV = 'a test'

    setupMock({ config: { type: 'command', value: 'npm view react-scripts' } })

    await injectMarkdown()

    const execConfig = execMock.mock.calls[0].arguments[1] as { env: Record<string, string> }
    assertCalledTimes(execMock, 1)
    assert.equal(execConfig.env.MY_SYS_ENV, 'a test')
  })

  it('can prevent system environment from being passed', async () => {
    process.env.MY_SYS_ENV = 'b test'

    setupMock({ config: { type: 'command', value: 'npm view react-scripts' } })

    await injectMarkdown({
      blockPrefix: 'CODEBLOCK',
      followSymlinks: true,
      globPattern: '**/*.md',
      quiet: false,
      useSystemEnvironment: false,
    })

    const execConfig = execMock.mock.calls[0].arguments[1] as { env: Record<string, string> }
    assertCalledTimes(execMock, 1)
    assert.equal(execConfig.env.MY_SYS_ENV, undefined)
  })

  it('can overwrite FORCE_COLOR', async () => {
    setupMock({
      config: {
        type: 'command',
        value: 'npm view react-scripts',
        environment: { FORCE_COLOR: 'true' },
      },
    })

    await injectMarkdown()

    const execConfig = execMock.mock.calls[0].arguments[1] as { env: Record<string, string> }
    assert.equal(execConfig.env.FORCE_COLOR, 'true')
  })

  it('substitutes passed environment variables from system environment variables', async () => {
    process.env.MY_SYS_ENV = 'c test'
    setupMock({
      config: {
        type: 'command',
        value: 'npm view react-scripts',
        environment: { MY_PASSED_ENV: '$MY_SYS_ENV' },
      },
    })

    await injectMarkdown()

    const execConfig = execMock.mock.calls[0].arguments[1] as { env: Record<string, string> }
    assert.equal(execConfig.env.MY_PASSED_ENV, 'c test')
  })

  it('overwrites system environment', async () => {
    process.env.MY_SYS_ENV = 'd test'
    setupMock({
      config: {
        type: 'command',
        value: 'npm view react-scripts',
        environment: { MY_SYS_ENV: 'e test' },
      },
    })

    await injectMarkdown()

    const execConfig = execMock.mock.calls[0].arguments[1] as { env: Record<string, string> }
    assert.equal(execConfig.env.MY_SYS_ENV, 'e test')
  })

  it('throws if a file is empty (after trimming)', async () => {
    setupMock({
      config: { value: 'foo.md' },
      mockResponse: `\n      \n      \n  `,
    })

    await injectMarkdown()

    assertCalledWith(
      logger.error,
      objectContaining({ message: stringContaining('No content was returned') })
    )
    assert.equal(process.exitCode, 1)
  })

  it('throws if a command returns no output (after trimming)', async () => {
    setupMock({
      config: { type: 'command', value: `echo ''` },
      mockResponse: `\n`,
    })

    await injectMarkdown()

    assertCalledWith(
      logger.error,
      objectContaining({ message: stringContaining('No content was returned') })
    )
    assert.equal(process.exitCode, 1)
  })
})

// ---------------------------------------------------------------------------
// Test fixture helper
// ---------------------------------------------------------------------------

function setupMock({
  name = '',
  mockFileName = 'foo.md',
  config,
  includePrettierIgnore = true,
  blockContents = '',
  mockResponse = '',
}: {
  name?: string
  mockFileName?: string
  config: Record<string, unknown>
  includePrettierIgnore?: boolean
  blockContents?: string
  mockResponse?: string
}): void {
  mockGlob([mockFileName])

  readFileMock.mock.mockImplementation(async (fileName: string) => {
    if (fileName === mockFileName) {
      return fileName.includes('mdx')
        ? `\n{/* CODEBLOCK_START${name} ${JSON.stringify(config)} */}\n${includePrettierIgnore ? '{/* prettier-ignore */}\n' : ''}${blockContents}\n{/* CODEBLOCK_END${name} */}`
        : `\n<!-- CODEBLOCK_START${name} ${JSON.stringify(config)} -->\n${includePrettierIgnore ? '<!-- prettier-ignore -->\n' : ''}${blockContents}\n<!-- CODEBLOCK_END${name} -->`
    }
    if (config.type !== 'command' && typeof config.value === 'string' && fileName.includes(config.value)) {
      return mockResponse
    }
    throw new Error('Unexpected file name passed')
  })

  if (config.type === 'command') {
    execMock.mock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: null, stdout: string) => void
      cb(null, mockResponse)
    })
  }
}
