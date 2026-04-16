// Measures absolute time per tracker call. Compares to a stored baseline and
// fails if measured time drifts beyond the allowed ratio.
//
// Baseline file: bench/baselines/overhead.json
//   { "meanNs": <number> }
// Threshold: measured meanNs must not exceed baseline * 1.25 (25% drift).
// Use `pnpm bench:ci --write` to regenerate the baseline.
//
// Rationale for absolute timing (not qguard/baseline ratio): a nanosecond-scale
// baseline is dominated by measurement noise. Absolute tracker time is the
// stable signal we actually want to gate against.

import fs from 'node:fs/promises'
import path from 'node:path'
import { Bench } from 'tinybench'
import { resetConfig } from '../src/core/config.js'
import { createContext, recordQuery, runInContext } from '../src/core/tracker.js'

const BASELINE_PATH = path.join(process.cwd(), 'bench', 'baselines', 'overhead.json')
const ALLOWED_DRIFT = 1.25

const SQL = 'SELECT * FROM "User" WHERE id = $1'

async function run(): Promise<void> {
  const bench = new Bench({ time: 2000, iterations: 100 })

  bench.add('qguard tracker per call', () => {
    resetConfig()
    const ctx = createContext()
    runInContext(ctx, () => {
      recordQuery(SQL, 1)
    })
  })

  await bench.run()

  const task = bench.tasks[0]
  const meanNs = (task?.result?.latency.mean ?? 0) * 1_000_000
  console.log(`qguard tracker: ${meanNs.toFixed(0)} ns/op`)

  // Guard against silent zero — a failed measurement must not pass as "no regression."
  if (meanNs <= 0) {
    console.error('bench produced no measurement (task result missing or zero).')
    process.exit(1)
  }

  if (process.argv.includes('--write')) {
    await fs.mkdir(path.dirname(BASELINE_PATH), { recursive: true })
    await fs.writeFile(BASELINE_PATH, `${JSON.stringify({ meanNs }, null, 2)}\n`)
    console.log(`wrote baseline: ${BASELINE_PATH}`)
    return
  }

  let baseline: { meanNs: number } | undefined
  try {
    const raw = await fs.readFile(BASELINE_PATH, 'utf8')
    baseline = JSON.parse(raw) as { meanNs: number }
  } catch {
    console.log('no baseline; run with --write to record one')
    return
  }

  const max = baseline.meanNs * ALLOWED_DRIFT
  if (meanNs > max) {
    console.error(
      `overhead regression: ${meanNs.toFixed(0)} ns/op exceeds allowed ${max.toFixed(0)} ns (baseline ${baseline.meanNs.toFixed(0)} ns, +${((ALLOWED_DRIFT - 1) * 100).toFixed(0)}% drift allowed)`,
    )
    process.exit(1)
  }
  console.log(`within baseline (max allowed: ${max.toFixed(0)} ns/op)`)
}

run().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
