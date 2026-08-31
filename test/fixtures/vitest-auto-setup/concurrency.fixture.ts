import { expect, test } from 'vitest'
import { recordQuery } from '../../../src/core/tracker.js'

async function recordOneQuery(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 5))
  recordQuery('SELECT * FROM users WHERE id = 1', 1)
}

test.concurrent('isolates the first concurrent test', async () => {
  await recordOneQuery()
  expect(true).toBe(true)
})

test.concurrent('isolates the second concurrent test', async () => {
  await recordOneQuery()
  expect(true).toBe(true)
})
