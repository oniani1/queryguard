import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { qguardSetup } from '../../src/integrations/vitest.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const vitestCli = path.join(root, 'node_modules/vitest/vitest.mjs')
const config = path.join(root, 'test/fixtures/vitest-auto-setup/vitest.config.ts')

function runFixture(filename: string) {
  const result = spawnSync(process.execPath, [vitestCli, 'run', '--config', config, filename], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
  })

  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  }
}

describe('qguard/vitest/setup', () => {
  it('exports the built setup-file path for Vitest configuration', () => {
    expect(path.isAbsolute(qguardSetup)).toBe(true)
    expect(qguardSetup).toMatch(/[/\\]integrations[/\\]vitest-setup\.js$/)
  })

  it('fails only the test that produces an N+1 query pattern', () => {
    const result = runFixture('detection.fixture.ts')

    expect(result.status).toBe(1)
    expect(result.output).toContain('1 failed | 1 passed')
    expect(result.output).toContain('QueryGuardError: N+1 query detected')
    expect(result.output).toContain('fails an N+1 without an explicit qguard assertion')
    expect(result.output).toContain(
      '[qguard notification] fails an N+1 without an explicit qguard assertion',
    )
    expect(result.output).toContain('detection.fixture.ts')
  })

  it('isolates concurrent tests from one another', () => {
    const result = runFixture('concurrency.fixture.ts')

    expect(result.status).toBe(0)
    expect(result.output).toContain('2 passed')
  })

  it('tracks queries from user beforeEach and afterEach hooks', () => {
    const result = runFixture('hooks.fixture.ts')

    expect(result.status).toBe(1)
    expect(result.output).toContain('QueryGuardError: N+1 query detected')
    expect(result.output).toContain('Repeated query executed 3 times')
  })
})
