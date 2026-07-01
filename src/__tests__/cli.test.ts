import * as assert from 'node:assert/strict'
import { describe, it, mock, beforeEach, afterEach } from 'node:test'

import shellQuote from 'shell-quote'

import { assertCalledWith, assertNotCalled } from './helpers.ts'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const injectMarkdownMock = mock.fn(async () => {})

await mock.module('../md-inject.ts', {
  defaultExport: injectMarkdownMock,
})

// Spy on console.error (top-level is fine — stderr doesn't affect test runner IPC)
const consoleErrorMock = mock.method(console, 'error', () => {})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const originalArgv = process.argv
const originalExit = process.exit

describe('CLI', () => {
  // stdoutWriteMock must be scoped to each test: mocking process.stdout.write
  // at the module level breaks the node:test runner's stdout-based IPC channel.
  let stdoutWriteMock: ReturnType<typeof mock.fn>

  beforeEach(() => {
    injectMarkdownMock.mock.resetCalls()
    consoleErrorMock.mock.resetCalls()
    stdoutWriteMock = mock.method(process.stdout, 'write', () => true) as ReturnType<typeof mock.fn>
    // Replace process.exit so it doesn't actually exit
    process.exit = mock.fn() as unknown as typeof process.exit
  })

  afterEach(() => {
    process.argv = originalArgv
    process.exit = originalExit
    stdoutWriteMock.mock.restore()
  })

  it('returns help text when no glob pattern is passed', async () => {
    await invokeCli('markdown-inject')

    const wrote = stdoutWriteMock.mock.calls.some(
      (c) =>
        typeof c.arguments[0] === 'string' &&
        c.arguments[0].includes('Usage: markdown-inject'),
    )
    assert.ok(
      wrote,
      'Expected stdout.write to include "Usage: markdown-inject"',
    )
    assertNotCalled(injectMarkdownMock)
    assert.ok(
      (process.exit as unknown as ReturnType<typeof mock.fn>).mock.calls.some(
        (c) => c.arguments[0] === 0,
      ),
      'Expected process.exit(0) to have been called',
    )
  })

  it('passes ./**/*.{md,mdx} when -a parameter is supplied', async () => {
    await invokeCli('markdown-inject -a')

    assertCalledWith(injectMarkdownMock, {
      globPattern: './**/*.{md,mdx}',
      blockPrefix: 'CODEBLOCK',
      quiet: false,
      useSystemEnvironment: true,
    })
  })

  for (const mdiArgs of [`'./**/CHANGELOG.md' -a`, `-a './**/CHANGELOG.md'`]) {
    it(`throws when -a and a globPattern are provided (${mdiArgs})`, async () => {
      consoleErrorMock.mock.resetCalls()

      await invokeCli(`markdown-inject ${mdiArgs}`)

      assertNotCalled(injectMarkdownMock)
      assertCalledWith(
        consoleErrorMock,
        "Options -a / --all and a globPattern ('./**/CHANGELOG.md') can not be provided together. Please select one or the other.",
      )
      assert.ok(
        (process.exit as unknown as ReturnType<typeof mock.fn>).mock.calls.some(
          (c) => c.arguments[0] === 1,
        ),
        'Expected process.exit(1) to have been called',
      )
    })
  }

  it('-a does not write the help text', async () => {
    await invokeCli('markdown-inject -a')

    const wroteHelp = stdoutWriteMock.mock.calls.some(
      (c) =>
        typeof c.arguments[0] === 'string' &&
        c.arguments[0].includes('Usage: markdown-inject'),
    )
    assert.ok(
      !wroteHelp,
      'Expected stdout.write NOT to include "Usage: markdown-inject"',
    )
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
