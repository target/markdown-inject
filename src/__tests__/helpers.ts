/**
 * Test assertion helpers to replace Jest's expect() matchers
 * using node:assert/strict and node:test mock.fn call inspection.
 */
import assert from 'node:assert/strict'
import { mock } from 'node:test'

type MockFn = ReturnType<typeof mock.fn>

// ---------------------------------------------------------------------------
// Argument matchers (mirror Jest's asymmetric matchers)
// ---------------------------------------------------------------------------

interface Matcher {
  _isMatcher: true
  test(actual: unknown): boolean
  description: string
}

export function stringContaining(expected: string): Matcher {
  return {
    _isMatcher: true,
    test: (actual) => typeof actual === 'string' && actual.includes(expected),
    description: `stringContaining(${JSON.stringify(expected)})`,
  }
}

export function stringMatching(pattern: string | RegExp): Matcher {
  const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern
  return {
    _isMatcher: true,
    test: (actual) => typeof actual === 'string' && re.test(actual),
    description: `stringMatching(${re})`,
  }
}

export function objectContaining(subset: Record<string, unknown>): Matcher {
  return {
    _isMatcher: true,
    test: (actual) => {
      if (typeof actual !== 'object' || actual === null) return false
      return Object.entries(subset).every(([k, v]) =>
        matchArg(v, (actual as Record<string, unknown>)[k]),
      )
    },
    description: `objectContaining(${JSON.stringify(subset)})`,
  }
}

export function anything(): Matcher {
  return {
    _isMatcher: true,
    test: () => true,
    description: 'anything()',
  }
}

function isMatcher(v: unknown): v is Matcher {
  return (
    typeof v === 'object' && v !== null && (v as Matcher)._isMatcher === true
  )
}

function matchArg(expected: unknown, actual: unknown): boolean {
  if (isMatcher(expected)) return expected.test(actual)
  try {
    assert.deepEqual(actual, expected)
    return true
  } catch {
    return false
  }
}

function callMatchesArgs(callArgs: unknown[], expected: unknown[]): boolean {
  if (callArgs.length !== expected.length) return false
  return expected.every((exp, i) => matchArg(exp, callArgs[i]))
}

// ---------------------------------------------------------------------------
// Mock call assertions
// ---------------------------------------------------------------------------

export function assertCalledWith(fn: MockFn, ...expected: unknown[]): void {
  const matched = fn.mock.calls.some((c) =>
    callMatchesArgs(c.arguments, expected),
  )

  assert.ok(
    matched,
    `Expected mock to have been called with ${JSON.stringify(expected)}\n` +
      `Actual calls: ${JSON.stringify(fn.mock.calls.map((c) => c.arguments))}`,
  )
}

export function assertNotCalledWith(fn: MockFn, ...expected: unknown[]): void {
  const matched = fn.mock.calls.some((c) =>
    callMatchesArgs(c.arguments, expected),
  )
  assert.ok(
    !matched,
    `Expected mock NOT to have been called with ${JSON.stringify(expected)}`,
  )
}

export function assertCalled(fn: MockFn): void {
  assert.ok(fn.mock.calls.length > 0, 'Expected mock to have been called')
}

export function assertNotCalled(fn: MockFn): void {
  assert.equal(
    fn.mock.calls.length,
    0,
    `Expected mock NOT to have been called, but was called ${fn.mock.calls.length} times`,
  )
}

export function assertCalledTimes(fn: MockFn, times: number): void {
  assert.equal(
    fn.mock.calls.length,
    times,
    `Expected mock to have been called ${times} times, but was called ${fn.mock.calls.length} times`,
  )
}

// ---------------------------------------------------------------------------
// Value assertions (thin wrappers for readability)
// ---------------------------------------------------------------------------

export function assertStringContains(actual: string, expected: string): void {
  assert.ok(
    actual.includes(expected),
    `Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`,
  )
}

export function assertStringMatches(actual: string, pattern: RegExp): void {
  assert.match(actual, pattern)
}

export function assertStringNotContains(
  actual: string,
  expected: string,
): void {
  assert.ok(
    !actual.includes(expected),
    `Expected ${JSON.stringify(actual)} NOT to contain ${JSON.stringify(expected)}`,
  )
}

export function assertStringNotMatches(actual: string, pattern: RegExp): void {
  assert.doesNotMatch(actual, pattern)
}
