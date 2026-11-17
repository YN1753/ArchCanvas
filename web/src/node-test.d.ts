declare module 'node:assert' {
  function assert(value: unknown, message?: string | Error): asserts value
  namespace assert {
    function ok(value: unknown, message?: string | Error): asserts value
    function equal<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T
    function strictEqual<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T
    function notEqual(actual: unknown, expected: unknown, message?: string | Error): void
    function notStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void
    function deepEqual<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T
    function deepStrictEqual<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T
    function match(value: string, regExp: RegExp, message?: string | Error): void
    function throws(block: () => unknown, error?: RegExp | Error | ((err: unknown) => boolean), message?: string): void
    function rejects(
      asyncFn: (() => Promise<unknown>) | Promise<unknown>,
      error?: RegExp | Error | ((err: unknown) => boolean),
      message?: string,
    ): Promise<void>
  }
  export default assert
}

declare module 'node:assert/strict' {
  function assert(value: unknown, message?: string | Error): asserts value
  namespace assert {
    function ok(value: unknown, message?: string | Error): asserts value
    function equal<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T
    function strictEqual<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T
    function notEqual(actual: unknown, expected: unknown, message?: string | Error): void
    function notStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void
    function deepEqual<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T
    function deepStrictEqual<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T
    function match(value: string, regExp: RegExp, message?: string | Error): void
    function throws(block: () => unknown, error?: RegExp | Error | ((err: unknown) => boolean), message?: string): void
    function rejects(
      asyncFn: (() => Promise<unknown>) | Promise<unknown>,
      error?: RegExp | Error | ((err: unknown) => boolean),
      message?: string,
    ): Promise<void>
  }
  export default assert
}

declare module 'node:test' {
  export interface TestContext {
    name: string
  }
  export type TestFn = (t: TestContext) => void | Promise<void>
  export function describe(name: string, fn: () => void | Promise<void>): Promise<void>
  export function it(name: string, fn: TestFn): Promise<void>
  export function test(name: string, fn: TestFn): Promise<void>
  export function before(fn: () => void | Promise<void>): void
  export function after(fn: () => void | Promise<void>): void
  export function beforeEach(fn: () => void | Promise<void>): void
  export function afterEach(fn: () => void | Promise<void>): void
}
