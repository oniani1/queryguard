import { afterEach, beforeEach, expect, test } from 'vitest'
import { recordQuery } from '../../../src/core/tracker.js'

beforeEach(() => {
  recordQuery('SELECT * FROM users WHERE id = 1', 1)
})

afterEach(() => {
  recordQuery('SELECT * FROM users WHERE id = 3', 1)
})

test('tracks queries across the complete per-test lifecycle', async () => {
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  recordQuery('SELECT * FROM users WHERE id = 2', 1)
  expect(true).toBe(true)
})
