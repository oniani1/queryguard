import { AsyncLocalStorage } from 'node:async_hooks'
import { recordQuery } from '../core/tracker.js'

export type ExtractSql = (args: unknown[]) => string

export type CompleteQuery = (result: unknown, done: () => void) => unknown

// Set by the outermost patched call. A nested call (e.g. mysql2's Pool.query
// delegating to Connection.query — both patched — through a context that
// preserves AsyncLocalStorage) sees this flag and skips re-recording so a
// single user-observable query is counted once.
const insidePatchedCall = new AsyncLocalStorage<boolean>()

export function createPatchedMethod(options: {
  extractSql: ExtractSql
  original: (...args: unknown[]) => unknown
  completeQuery: CompleteQuery
  name?: string
}): (...args: unknown[]) => unknown {
  const { extractSql, original, completeQuery, name } = options

  const patched = function patched(this: unknown, ...args: unknown[]): unknown {
    if (insidePatchedCall.getStore()) {
      return original.apply(this, args)
    }
    return insidePatchedCall.run(true, () => runPatched.call(this, args))
  }

  function runPatched(this: unknown, args: unknown[]): unknown {
    const sql = extractSql(args)
    const startTime = performance.now()
    let recorded = false
    const done = (): void => {
      if (recorded) return
      recorded = true
      recordQuery(sql, performance.now() - startTime)
    }

    const lastArg = args[args.length - 1]
    if (typeof lastArg === 'function') {
      const cb = lastArg as (...cbArgs: unknown[]) => void
      const wrapped = [...args]
      wrapped[wrapped.length - 1] = (...cbArgs: unknown[]): void => {
        done()
        cb(...cbArgs)
      }
      return original.apply(this, wrapped)
    }

    let result: unknown
    try {
      result = original.apply(this, args)
    } catch (err) {
      done()
      throw err
    }
    return completeQuery(result, done)
  }

  if (name) {
    Object.defineProperty(patched, 'name', { value: name })
  }
  return patched
}

export const promiseCompletion: CompleteQuery = (result, done) => {
  if (
    result !== null &&
    typeof result === 'object' &&
    typeof (result as { then?: unknown }).then === 'function'
  ) {
    return (result as Promise<unknown>).then(
      (value) => {
        done()
        return value
      },
      (err: unknown) => {
        done()
        throw err
      },
    )
  }
  done()
  return result
}

export const eventEndCompletion: CompleteQuery = (result, done) => {
  if (
    result !== null &&
    typeof result === 'object' &&
    typeof (result as { once?: unknown }).once === 'function'
  ) {
    const emitter = result as {
      once: (event: string, listener: (...args: unknown[]) => void) => void
    }
    emitter.once('end', done)
    emitter.once('error', done)
    return result
  }
  done()
  return result
}
