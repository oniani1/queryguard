import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { configure, getConfig, resetConfig } from '../../src/core/config.js'

describe('config', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.NODE_ENV
    delete process.env.QUERYGUARD_FORCE
    delete process.env.QUERYGUARD_VERBOSE
    resetConfig()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('defaults', () => {
    it('returns default values', () => {
      const config = getConfig()
      expect(config.threshold).toBe(2)
      expect(config.mode).toBe('error')
      expect(config.detectInsideTransactions).toBe(false)
      expect(config.concurrentDuplicatesAreNPlusOne).toBe(false)
      expect(config.ignore).toEqual([])
      expect(config.enabled).toBe(true)
      expect(config.verbose).toBe(false)
    })

    it('sets verbose to true when QUERYGUARD_VERBOSE=1', () => {
      process.env.QUERYGUARD_VERBOSE = '1'
      resetConfig()
      const config = getConfig()
      expect(config.verbose).toBe(true)
    })
  })

  describe('configure', () => {
    it('merges partial config without changing unspecified fields', () => {
      configure({ threshold: 5, mode: 'warn' })
      const config = getConfig()
      expect(config.threshold).toBe(5)
      expect(config.mode).toBe('warn')
      expect(config.detectInsideTransactions).toBe(false)
      expect(config.concurrentDuplicatesAreNPlusOne).toBe(false)
      expect(config.ignore).toEqual([])
    })

    it('merges detectInsideTransactions independently', () => {
      configure({ detectInsideTransactions: true })
      const config = getConfig()
      expect(config.detectInsideTransactions).toBe(true)
      expect(config.threshold).toBe(2)
    })

    it('merges concurrentDuplicatesAreNPlusOne independently', () => {
      configure({ concurrentDuplicatesAreNPlusOne: true })
      const config = getConfig()
      expect(config.concurrentDuplicatesAreNPlusOne).toBe(true)
      expect(config.threshold).toBe(2)
    })
  })

  describe('resetConfig', () => {
    it('resets all fields back to defaults', () => {
      configure({ threshold: 10, mode: 'warn', detectInsideTransactions: true })
      resetConfig()
      const config = getConfig()
      expect(config.threshold).toBe(2)
      expect(config.mode).toBe('error')
      expect(config.detectInsideTransactions).toBe(false)
    })
  })

  describe('shouldIgnore', () => {
    it('matches string patterns as substrings', () => {
      configure({ ignore: ['pg_catalog'] })
      const config = getConfig()
      expect(config.shouldIgnore('SELECT * FROM pg_catalog.pg_tables')).toBe(true)
      expect(config.shouldIgnore('SELECT * FROM users')).toBe(false)
    })

    it('matches regex patterns with .test()', () => {
      configure({ ignore: [/^SELECT\s+1$/] })
      const config = getConfig()
      expect(config.shouldIgnore('SELECT 1')).toBe(true)
      expect(config.shouldIgnore('SELECT * FROM users')).toBe(false)
    })

    it('matches when any pattern in the array matches', () => {
      configure({ ignore: ['pg_catalog', /^EXPLAIN /] })
      const config = getConfig()
      expect(config.shouldIgnore('SELECT * FROM pg_catalog.pg_tables')).toBe(true)
      expect(config.shouldIgnore('EXPLAIN SELECT 1')).toBe(true)
      expect(config.shouldIgnore('SELECT * FROM users')).toBe(false)
    })

    it('returns false when ignore array is empty', () => {
      configure({ ignore: [] })
      const config = getConfig()
      expect(config.shouldIgnore('SELECT * FROM users')).toBe(false)
    })
  })

  describe('production guard', () => {
    it('disables in production by default', () => {
      process.env.NODE_ENV = 'production'
      resetConfig()
      const config = getConfig()
      expect(config.enabled).toBe(false)
    })

    it('enables in production when QUERYGUARD_FORCE=1', () => {
      process.env.NODE_ENV = 'production'
      process.env.QUERYGUARD_FORCE = '1'
      resetConfig()
      const config = getConfig()
      expect(config.enabled).toBe(true)
    })
  })
})
