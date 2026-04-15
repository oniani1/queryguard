import { describe, it, expect, beforeEach } from 'vitest'
import { resetConfig } from '../../src/core/config.js'
import { recordQuery } from '../../src/core/tracker.js'
import { runAssertScaling, ScalingError } from '../../src/integrations/shared.js'

beforeEach(() => {
  resetConfig()
})

function tick(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve))
}

// Simulates an N+1 pattern: one "parent" query + N "child" queries
function simulateNPlusOne(n: number): void {
  recordQuery('SELECT * FROM "posts" LIMIT 10', 1)
  for (let i = 0; i < n; i++) {
    recordQuery(`SELECT * FROM "comments" WHERE "post_id" = ${i + 1}`, 1)
  }
}

// Simulates constant queries regardless of data size
function simulateConstant(_n: number): void {
  recordQuery('SELECT * FROM "posts" LIMIT 10', 1)
  recordQuery('SELECT COUNT(*) FROM "comments"', 1)
}

describe('runAssertScaling', () => {
  it('detects scaling queries', async () => {
    let dataSize = 0

    await expect(
      runAssertScaling({
        setup: async (n) => { dataSize = n },
        run: async () => {
          simulateNPlusOne(dataSize)
          await tick()
        },
      }),
    ).rejects.toThrow(ScalingError)
  })

  it('passes when queries are constant', async () => {
    let dataSize = 0

    await runAssertScaling({
      setup: async (n) => { dataSize = n },
      run: async () => {
        simulateConstant(dataSize)
      },
    })
  })

  it('error contains scaling report', async () => {
    let dataSize = 0

    try {
      await runAssertScaling({
        setup: async (n) => { dataSize = n },
        run: async () => {
          simulateNPlusOne(dataSize)
          await tick()
        },
      })
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ScalingError)
      const scalingErr = err as ScalingError
      expect(scalingErr.scalingReport.scalingDetections.length).toBeGreaterThan(0)
      expect(scalingErr.scalingReport.factors).toEqual([2, 3])

      const detection = scalingErr.scalingReport.scalingDetections[0]
      expect(detection.countsPerFactor.get(2)).toBe(2)
      expect(detection.countsPerFactor.get(3)).toBe(3)
    }
  })

  it('error message shows per-fingerprint counts', async () => {
    let dataSize = 0

    try {
      await runAssertScaling({
        setup: async (n) => { dataSize = n },
        run: async () => {
          simulateNPlusOne(dataSize)
          await tick()
        },
      })
      expect.fail('should have thrown')
    } catch (err) {
      const message = (err as Error).message
      expect(message).toContain('not constant across data sizes')
      expect(message).toContain('N=2')
      expect(message).toContain('N=3')
    }
  })

  it('uses custom factors', async () => {
    let dataSize = 0

    try {
      await runAssertScaling({
        setup: async (n) => { dataSize = n },
        run: async () => {
          simulateNPlusOne(dataSize)
          await tick()
        },
        factors: [1, 4],
      })
      expect.fail('should have thrown')
    } catch (err) {
      const scalingErr = err as ScalingError
      expect(scalingErr.scalingReport.factors).toEqual([1, 4])
      const detection = scalingErr.scalingReport.scalingDetections[0]
      expect(detection.countsPerFactor.get(1)).toBe(1)
      expect(detection.countsPerFactor.get(4)).toBe(4)
    }
  })

  it('calls teardown between runs', async () => {
    const calls: string[] = []
    let dataSize = 0

    await runAssertScaling({
      setup: async (n) => {
        calls.push(`setup(${n})`)
        dataSize = n
      },
      teardown: async () => {
        calls.push('teardown')
      },
      run: async () => {
        calls.push(`run(${dataSize})`)
        simulateConstant(dataSize)
      },
    })

    // warmup: setup(2), run(2)
    // measured run 1: teardown, setup(2), run(2) (teardown cleans up warmup)
    // measured run 2: teardown, setup(3), run(3)
    // final teardown
    expect(calls).toEqual([
      'setup(2)', 'run(2)',
      'teardown', 'setup(2)', 'run(2)',
      'teardown', 'setup(3)', 'run(3)',
      'teardown',
    ])
  })

  it('warmup prevents false positives from connection init', async () => {
    let dataSize = 0
    let firstRun = true

    await runAssertScaling({
      setup: async (n) => { dataSize = n },
      run: async () => {
        if (firstRun) {
          // Simulate connection warmup queries on first run
          recordQuery('SET client_encoding TO utf8', 0)
          recordQuery('SELECT typname FROM pg_type', 0)
          firstRun = false
        }
        simulateConstant(dataSize)
      },
    })

    // Should pass because warmup absorbs the init queries
  })

  it('warmup false skips warmup run', async () => {
    const calls: string[] = []
    let dataSize = 0

    await runAssertScaling({
      setup: async (n) => {
        calls.push(`setup(${n})`)
        dataSize = n
      },
      run: async () => {
        calls.push(`run(${dataSize})`)
        simulateConstant(dataSize)
      },
      warmup: false,
    })

    // No warmup: just setup(2), run(2), setup(3), run(3)
    expect(calls).toEqual([
      'setup(2)', 'run(2)',
      'setup(3)', 'run(3)',
    ])
  })

  it('throws when fewer than 2 factors provided', async () => {
    await expect(
      runAssertScaling({
        setup: async () => {},
        run: async () => {},
        factors: [2],
      }),
    ).rejects.toThrow('at least 2 scale factors')
  })

  it('throws when duplicate factors provided', async () => {
    await expect(
      runAssertScaling({
        setup: async () => {},
        run: async () => {},
        factors: [3, 3],
      }),
    ).rejects.toThrow('at least 2 distinct scale factors')
  })

  it('calls teardown on setup error', async () => {
    const calls: string[] = []

    await expect(
      runAssertScaling({
        setup: async (n) => {
          calls.push(`setup(${n})`)
          if (n === 3) throw new Error('setup failed')
        },
        teardown: async () => { calls.push('teardown') },
        run: async () => { calls.push('run') },
      }),
    ).rejects.toThrow('setup failed')

    expect(calls).toContain('teardown')
    expect(calls[calls.length - 1]).toBe('teardown')
  })

  it('detects conditional N+1 (query appears only at higher N)', async () => {
    let dataSize = 0

    try {
      await runAssertScaling({
        setup: async (n) => { dataSize = n },
        run: async () => {
          recordQuery('SELECT * FROM "posts"', 1)
          // Only fire child queries when there are 3+ records
          if (dataSize >= 3) {
            for (let i = 0; i < dataSize; i++) {
              recordQuery(`SELECT * FROM "tags" WHERE "post_id" = ${i}`, 1)
            }
          }
          await tick()
        },
        factors: [2, 5],
      })
      expect.fail('should have thrown')
    } catch (err) {
      const scalingErr = err as ScalingError
      const detection = scalingErr.scalingReport.scalingDetections[0]
      expect(detection.countsPerFactor.get(2)).toBe(0)
      expect(detection.countsPerFactor.get(5)).toBe(5)
    }
  })

  it('reports constant fingerprint count in report', async () => {
    let dataSize = 0

    try {
      await runAssertScaling({
        setup: async (n) => { dataSize = n },
        run: async () => {
          // One constant query + N scaling queries
          recordQuery('SELECT COUNT(*) FROM "posts"', 1)
          for (let i = 0; i < dataSize; i++) {
            recordQuery(`SELECT * FROM "comments" WHERE "post_id" = ${i}`, 1)
          }
          await tick()
        },
      })
      expect.fail('should have thrown')
    } catch (err) {
      const scalingErr = err as ScalingError
      expect(scalingErr.scalingReport.constantFingerprints).toBe(1)
      expect(scalingErr.scalingReport.scalingDetections.length).toBe(1)
    }
  })
})
