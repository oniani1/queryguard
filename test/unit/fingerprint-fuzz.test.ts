import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fingerprint, normalize } from '../../src/core/fingerprint.js'

const SEED = 20260416

const tables = ['users', 'posts', 'orders', 'products', 'accounts']
const columns = ['id', 'name', 'email', 'status', 'created_at']

describe('fingerprint (property-based)', () => {
  it('is invariant across numeric literal choice', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...tables),
        fc.constantFrom(...columns),
        fc.integer(),
        fc.integer(),
        (table, col, a, b) => {
          const s1 = `SELECT * FROM ${table} WHERE ${col} = ${a}`
          const s2 = `SELECT * FROM ${table} WHERE ${col} = ${b}`
          return fingerprint(s1) === fingerprint(s2)
        },
      ),
      { numRuns: 500, seed: SEED },
    )
  })

  it('is invariant across single-quoted string literal choice', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...tables),
        fc.constantFrom(...columns),
        fc.string({ maxLength: 20 }).filter((s) => !s.includes("'")),
        fc.string({ maxLength: 20 }).filter((s) => !s.includes("'")),
        (table, col, a, b) => {
          const s1 = `SELECT * FROM ${table} WHERE ${col} = '${a}'`
          const s2 = `SELECT * FROM ${table} WHERE ${col} = '${b}'`
          return fingerprint(s1) === fingerprint(s2)
        },
      ),
      { numRuns: 500, seed: SEED },
    )
  })

  it('is invariant across placeholder style ($N vs :name vs @pN)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...tables),
        fc.constantFrom(...columns),
        (table, col) => {
          const s1 = `SELECT * FROM ${table} WHERE ${col} = $1`
          const s2 = `SELECT * FROM ${table} WHERE ${col} = :value`
          const s3 = `SELECT * FROM ${table} WHERE ${col} = @p0`
          const s4 = `SELECT * FROM ${table} WHERE ${col} = ?`
          const fps = new Set([fingerprint(s1), fingerprint(s2), fingerprint(s3), fingerprint(s4)])
          return fps.size === 1
        },
      ),
      { numRuns: 100, seed: SEED },
    )
  })

  it('is invariant across whitespace', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...tables),
        fc.constantFrom(...columns),
        fc.integer({ min: 1, max: 4 }),
        (table, col, spaces) => {
          const sp = ' '.repeat(spaces)
          const s1 = `SELECT * FROM ${table} WHERE ${col} = $1`
          const s2 = `SELECT${sp}*${sp}FROM${sp}${table}${sp}WHERE${sp}${col}${sp}=${sp}$1`
          return fingerprint(s1) === fingerprint(s2)
        },
      ),
      { numRuns: 100, seed: SEED },
    )
  })

  it('discriminates on table name', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...tables),
        fc.constantFrom(...tables),
        fc.constantFrom(...columns),
        (t1, t2, col) => {
          fc.pre(t1 !== t2)
          const s1 = `SELECT * FROM ${t1} WHERE ${col} = $1`
          const s2 = `SELECT * FROM ${t2} WHERE ${col} = $1`
          return fingerprint(s1) !== fingerprint(s2)
        },
      ),
      { numRuns: 500, seed: SEED },
    )
  })

  it('discriminates on column name in WHERE', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...tables),
        fc.constantFrom(...columns),
        fc.constantFrom(...columns),
        (table, c1, c2) => {
          fc.pre(c1 !== c2)
          const s1 = `SELECT * FROM ${table} WHERE ${c1} = $1`
          const s2 = `SELECT * FROM ${table} WHERE ${c2} = $1`
          return fingerprint(s1) !== fingerprint(s2)
        },
      ),
      { numRuns: 500, seed: SEED },
    )
  })

  it('discriminates on DML verb', () => {
    fc.assert(
      fc.property(fc.constantFrom(...tables), (table) => {
        const sel = `SELECT * FROM ${table} WHERE id = $1`
        const del = `DELETE FROM ${table} WHERE id = $1`
        const upd = `UPDATE ${table} SET name = $1 WHERE id = $2`
        const fps = new Set([fingerprint(sel), fingerprint(del), fingerprint(upd)])
        return fps.size === 3
      }),
      { numRuns: 100, seed: SEED },
    )
  })

  it('treats case-differing keywords as equivalent', () => {
    fc.assert(
      fc.property(fc.constantFrom(...tables), fc.constantFrom(...columns), (table, col) => {
        const s1 = `SELECT * FROM ${table} WHERE ${col} = $1`
        const s2 = `select * from ${table} where ${col} = $1`
        const s3 = `Select * From ${table} Where ${col} = $1`
        const fps = new Set([fingerprint(s1), fingerprint(s2), fingerprint(s3)])
        return fps.size === 1
      }),
      { numRuns: 100, seed: SEED },
    )
  })

  it('handles empty input without throwing', () => {
    expect(() => fingerprint('')).not.toThrow()
    expect(() => normalize('')).not.toThrow()
    expect(fingerprint('')).toBe(fingerprint(''))
  })

  it('treats subtraction expressions as distinct from negative literals', () => {
    // a-1 is subtraction: the trailing 1 normalizes to ?, minus stays.
    // id = -1 is a literal: the whole -1 normalizes to ?.
    // These must NOT collapse to the same fingerprint.
    const subtraction = normalize('SELECT * FROM t WHERE a-1 > 0')
    const negative = normalize('SELECT * FROM t WHERE id = -1')
    expect(subtraction).not.toBe(negative)
  })
})
