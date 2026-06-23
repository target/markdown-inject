import { describe, it, mock, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import shellQuote from 'shell-quote'
import { assertCalledWith, assertNotCalled, stringMatching } from './helpers.ts'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const injectMarkdownMock = mock.fn(async () => {})
await mock.module('../md-inject.ts', {
  defaultExport: injectMarkdownMock,
})

// Spy on console.error and process.stdout.write
const consoleErrorMock = mock.method(console, 'error', () => {})
const stdoutWriteMock = mock.method(process.stdout, 'write', () => true)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const originalArgv = process.argv
const originalExit = process.exit

describe('CLI', () => {
  beforeEach(() => {
    injectMarkdownMock.mock.resetCalls()
    consoleErrorMock.mock.resetCalls()
    stdoutWriteMock.mock.resetCalls()
    // Replace process.exit so it doesn't actually exit
    process.exit = mock.fn() as unknown as typeof process.exit
  })

  afterEach(() => {
    process.argv = originalArgv
    process.exit = originalExit
  })

  it('returns help text when no glob pattern is passed', async () => {
    await invokeCli('markdown-inject')

    const wrote = stdoutWriteMock.mock.calls.some(
      (c) => typeof c.arguments[0] === 'string' && c.arguments[0].includes('Usage: markdown-inject')
    )
    assert.ok(wrote, 'Expected stdout.write to include "Usage: markdown-inject"')
    assertNotCalled(injectMarkdownMock)
    assert.ok(
      (process.exit as unknown as ReturnType<typeof mock.fn>).mock.calls.some(
        (c) => c.arguments[0] === 0
      ),
      'Expected process.exit(0) to have been called'
    )
  })

  it('passes ./**/*.md when -a parameter is supplied', async () => {
    await invokeCli('markdown-inject -a')

    assertCalledWith(
      injectMarkdownMock,
      { globPattern: './**/*.md', blockPrefix: 'CODEBLOCK', followSymlinks: true, quiet: false, useSystemEnvironment: true }
    )
  })

  for (const mdiArgs of [`'./**/CHANGELOG.md' -a`, `-a './**/CHANGELOG.md'`]) {
    it(`throws when -a and a globPattern are provided (${mdiArgs})`, async () => {
      consoleErrorMock.mock.resetCalls()

      await invokeCli(`markdown-inject ${mdiArgs}`)

      assertNotCalled(injectMarkdownMock)
      assertCalledWith(
        consoleErrorMock,
        "Options -a / --all and a globPattern ('./**/CHANGELOG.md') can not be provided together. Please select one or the other."
      )
      assert.ok(
        (process.exit as unknown as ReturnType<typeof mock.fn>).mock.calls.some(
          (c) => c.arguments[0] === 1
        ),
        'Expected process.exit(1) to have been called'
      )
    })
  }

  it('-a does not write the help text', async () => {
    await invokeCli('markdown-inject -a')

    const wroteHelp = stdoutWriteMock.mock.calls.some(
      (c) => typeof c.arguments[0] === 'string' && c.arguments[0].includes('Usage: markdown-inject')
    )
    assert.ok(!wroteHelp, 'Expected stdout.write NOT to include "Usage: markdown-inject"')
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simulate the CLI being invoked with the given argument string.
 * Each call re-imports index.ts fresh so Commander re-parses argv.
 */
const invokeCli = async (args: string): Promise<void> => {
  const [node] = process.argv
  process.argv = [node, ...(shellQuote.parse(args) as string[])]

  // ESM has no isolateModules — bust the cache with a unique query string
  await import(`../index.ts?t=${Date.now()}`)
}
