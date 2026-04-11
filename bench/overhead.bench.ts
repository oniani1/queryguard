import { bench, describe } from 'vitest'
import { recordQuery, createContext, runInContext } from '../src/core/tracker.js'
import { resetConfig } from '../src/core/config.js'

describe('tracker overhead', () => {
  bench('recordQuery per call (hot path)', () => {
    resetConfig()
    const ctx = createContext()
    runInContext(ctx, () => {
      recordQuery('SELECT * FROM "User" WHERE id = $1', 1)
    })
  })
})
