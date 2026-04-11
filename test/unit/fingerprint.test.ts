import { describe, it, expect } from 'vitest'
import { normalize, fingerprint, fingerprintNormalized } from '../../src/core/fingerprint'

describe('normalize', () => {
  it('replaces $N params with ?', () => {
    expect(normalize('SELECT * FROM users WHERE id = $1 AND name = $2'))
      .toBe('select * from users where id = ? and name = ?')
  })

  it('replaces numeric literals with ?', () => {
    expect(normalize('SELECT * FROM users WHERE age = 42 AND score = 3.14'))
      .toBe('select * from users where age = ? and score = ?')
  })

  it('replaces single-quoted strings with ?', () => {
    expect(normalize("SELECT * FROM users WHERE name = 'alice'"))
      .toBe('select * from users where name = ?')
  })

  it('handles escaped single quotes', () => {
    expect(normalize("SELECT * FROM users WHERE name = 'it''s'"))
      .toBe('select * from users where name = ?')
  })

  it('preserves double-quoted identifiers', () => {
    expect(normalize('SELECT "userId", "Post" FROM "Users"'))
      .toBe('select "userId", "Post" from "Users"')
  })

  it('collapses whitespace', () => {
    expect(normalize('SELECT  *  FROM\n  users\t WHERE  id = $1'))
      .toBe('select * from users where id = ?')
  })

  it('replaces :name params with ?', () => {
    expect(normalize('SELECT * FROM users WHERE id = :id AND name = :name'))
      .toBe('select * from users where id = ? and name = ?')
  })

  it('replaces @p0 params with ?', () => {
    expect(normalize('SELECT * FROM users WHERE id = @p0 AND name = @p1'))
      .toBe('select * from users where id = ? and name = ?')
  })

  it('does not replace ? that is already a placeholder', () => {
    expect(normalize('SELECT * FROM users WHERE id = ? AND name = ?'))
      .toBe('select * from users where id = ? and name = ?')
  })
})

describe('fingerprint', () => {
  it('produces the same hash for same template with different params', () => {
    const a = fingerprint("SELECT * FROM users WHERE id = $1 AND name = 'alice'")
    const b = fingerprint("SELECT * FROM users WHERE id = $2 AND name = 'bob'")
    expect(a).toBe(b)
  })

  it('produces different hashes for different templates', () => {
    const a = fingerprint('SELECT * FROM users WHERE id = $1')
    const b = fingerprint('SELECT * FROM posts WHERE id = $1')
    expect(a).not.toBe(b)
  })

  it('returns a 16-char hex string', () => {
    const hash = fingerprint('SELECT * FROM users WHERE id = $1')
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('fingerprintNormalized produces the same result as fingerprint for same SQL', () => {
    const sql = "SELECT * FROM users WHERE id = $1 AND name = 'alice'"
    const normalized = normalize(sql)
    expect(fingerprintNormalized(normalized)).toBe(fingerprint(sql))
  })

  it('fingerprintNormalized skips normalization', () => {
    const alreadyNormalized = 'select * from users where id = ?'
    expect(fingerprintNormalized(alreadyNormalized)).toBe(fingerprint('SELECT * FROM users WHERE id = $1'))
  })
})
