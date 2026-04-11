import { describe, it, expect } from 'vitest'
import {
  createTransactionState,
  processTransactionCommand,
  isInTransaction,
} from '../../src/core/transaction'

describe('processTransactionCommand', () => {
  it('BEGIN increments depth to 1', () => {
    const state = createTransactionState()
    const next = processTransactionCommand('BEGIN', state)
    expect(next.depth).toBe(1)
  })

  it('COMMIT decrements depth to 0', () => {
    const state = { depth: 1, savepointNames: [] }
    const next = processTransactionCommand('COMMIT', state)
    expect(next.depth).toBe(0)
  })

  it('ROLLBACK decrements depth to 0', () => {
    const state = { depth: 1, savepointNames: [] }
    const next = processTransactionCommand('ROLLBACK', state)
    expect(next.depth).toBe(0)
  })

  it('nested BEGIN/COMMIT: depth goes 0 -> 1 -> 2 -> 1 -> 0', () => {
    let state = createTransactionState()
    state = processTransactionCommand('BEGIN', state)
    expect(state.depth).toBe(1)
    state = processTransactionCommand('BEGIN', state)
    expect(state.depth).toBe(2)
    state = processTransactionCommand('COMMIT', state)
    expect(state.depth).toBe(1)
    state = processTransactionCommand('COMMIT', state)
    expect(state.depth).toBe(0)
  })

  it('SAVEPOINT pushes name and increments depth', () => {
    const state = { depth: 1, savepointNames: [] }
    const next = processTransactionCommand('SAVEPOINT sp1', state)
    expect(next.depth).toBe(2)
    expect(next.savepointNames).toEqual(['sp1'])
  })

  it('RELEASE SAVEPOINT pops name and decrements depth', () => {
    const state = { depth: 2, savepointNames: ['sp1'] }
    const next = processTransactionCommand('RELEASE SAVEPOINT sp1', state)
    expect(next.depth).toBe(1)
    expect(next.savepointNames).toEqual([])
  })

  it('ROLLBACK TO SAVEPOINT rolls back to named savepoint', () => {
    const state = { depth: 3, savepointNames: ['sp1', 'sp2'] }
    const next = processTransactionCommand('ROLLBACK TO SAVEPOINT sp1', state)
    expect(next.depth).toBe(2)
    expect(next.savepointNames).toEqual(['sp1'])
  })

  it('ROLLBACK TO (without SAVEPOINT keyword) rolls back to named savepoint', () => {
    const state = { depth: 3, savepointNames: ['sp1', 'sp2'] }
    const next = processTransactionCommand('ROLLBACK TO sp1', state)
    expect(next.depth).toBe(2)
    expect(next.savepointNames).toEqual(['sp1'])
  })

  it('START TRANSACTION works like BEGIN', () => {
    const state = createTransactionState()
    const next = processTransactionCommand('START TRANSACTION', state)
    expect(next.depth).toBe(1)
  })

  it('non-transaction SQL returns state unchanged', () => {
    const state = createTransactionState()
    const next = processTransactionCommand('SELECT * FROM users', state)
    expect(next.depth).toBe(0)
    expect(next.savepointNames).toEqual([])
    expect(next).not.toBe(state)
  })

  it('depth never goes below 0 (COMMIT when depth=0 stays 0)', () => {
    const state = createTransactionState()
    const next = processTransactionCommand('COMMIT', state)
    expect(next.depth).toBe(0)
  })

  it('depth never goes below 0 (ROLLBACK when depth=0 stays 0)', () => {
    const state = createTransactionState()
    const next = processTransactionCommand('ROLLBACK', state)
    expect(next.depth).toBe(0)
  })

  it('is case insensitive (begin, BEGIN, Begin all work)', () => {
    const state = createTransactionState()
    expect(processTransactionCommand('begin', state).depth).toBe(1)
    expect(processTransactionCommand('BEGIN', state).depth).toBe(1)
    expect(processTransactionCommand('Begin', state).depth).toBe(1)
  })

  it('END works like COMMIT', () => {
    const state = { depth: 1, savepointNames: [] }
    const next = processTransactionCommand('END', state)
    expect(next.depth).toBe(0)
  })

  it('returns a new object (immutable)', () => {
    const state = createTransactionState()
    const next = processTransactionCommand('BEGIN', state)
    expect(next).not.toBe(state)
    expect(state.depth).toBe(0)
  })
})

describe('isInTransaction', () => {
  it('returns false when depth=0', () => {
    expect(isInTransaction(createTransactionState())).toBe(false)
  })

  it('returns true when depth>0', () => {
    expect(isInTransaction({ depth: 1, savepointNames: [] })).toBe(true)
    expect(isInTransaction({ depth: 3, savepointNames: ['sp1'] })).toBe(true)
  })
})
