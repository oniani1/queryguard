export interface QueryGuardConfig {
  threshold: number
  ignore: ReadonlyArray<string | RegExp>
  mode: 'error' | 'warn'
  detectInsideTransactions: boolean
  concurrentDuplicatesAreNPlusOne: boolean
  verbose: boolean
  enabled: boolean
  shouldIgnore: (sql: string) => boolean
}

type ConfigInput = Partial<Omit<QueryGuardConfig, 'shouldIgnore' | 'enabled'>>

function buildDefaults(): QueryGuardConfig {
  const isProduction = process.env.NODE_ENV === 'production'
  const forced = process.env.QUERYGUARD_FORCE === '1'
  const enabled = isProduction ? forced : true

  return {
    threshold: 2,
    ignore: [],
    mode: 'error',
    detectInsideTransactions: false,
    concurrentDuplicatesAreNPlusOne: false,
    verbose: process.env.QUERYGUARD_VERBOSE === '1',
    enabled,
    shouldIgnore: () => false,
  }
}

function compileShouldIgnore(patterns: ReadonlyArray<string | RegExp>): (sql: string) => boolean {
  if (patterns.length === 0) return () => false

  return (sql: string) =>
    patterns.some((pattern) => {
      if (typeof pattern === 'string') return sql.includes(pattern)
      return pattern.test(sql)
    })
}

let current: QueryGuardConfig = buildDefaults()

export function configure(partial: ConfigInput): void {
  const ignore = partial.ignore ?? current.ignore
  current = {
    ...current,
    ...partial,
    ignore,
    shouldIgnore: compileShouldIgnore(ignore),
  }
}

export function getConfig(): Readonly<QueryGuardConfig> {
  return current
}

export function resetConfig(): void {
  current = buildDefaults()
}
