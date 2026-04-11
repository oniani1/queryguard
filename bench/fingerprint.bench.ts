import { bench, describe } from 'vitest'
import { fingerprint, normalize } from '../src/core/fingerprint.js'

const sql1kb = 'SELECT ' + '"col"'.repeat(100).split('').join(', ') + ' FROM "Table" WHERE id = $1'

describe('fingerprint', () => {
  bench('normalize 1KB SQL', () => {
    normalize(sql1kb)
  })

  bench('fingerprint 1KB SQL', () => {
    fingerprint(sql1kb)
  })
})
