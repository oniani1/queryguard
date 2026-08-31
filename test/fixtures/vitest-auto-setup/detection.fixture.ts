import { expect, test } from 'vitest'
import { configure } from '../../../src/core/config.js'
import { recordQuery } from '../../../src/core/tracker.js'

configure({
  onDetection: [
    ({ test: metadata }) => {
      console.log(`[qguard notification] ${metadata?.name} @ ${metadata?.file}`)
    },
  ],
})

test('passes a clean test without an explicit qguard assertion', () => {
  recordQuery('SELECT * FROM users WHERE id = 1', 1)
  expect(true).toBe(true)
})

test('fails an N+1 without an explicit qguard assertion', async () => {
  recordQuery('SELECT * FROM users WHERE id = 1', 1)
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  recordQuery('SELECT * FROM users WHERE id = 2', 1)
  expect(true).toBe(true)
})
