import { AsyncLocalStorage } from 'node:async_hooks'
import { getConfig } from './config.js'
import { fingerprintNormalized, normalize } from './fingerprint.js'
import { captureCallerFrame, captureFullStack } from './stack.js'
import type { StackFrame } from './stack.js'
import {
  createTransactionState,
  isInTransaction,
  processTransactionCommand,
} from './transaction.js'
import type { TransactionState } from './transaction.js'

export interface RecordedQuery {
  sql: string
  normalizedSql: string
  fingerprintHash: string
  timestamp: number
  durationMs: number
  inTransaction: boolean
  callerFrame: StackFrame | undefined
  fullStack: ReadonlyArray<StackFrame> | undefined
  tick: number
}

export interface TrackingContext {
  queries: RecordedQuery[]
  fingerprintCounts: Map<string, number>
  fingerprintFirstIndex: Map<string, number>
  transactionState: TransactionState
  callerStack: ReadonlyArray<StackFrame> | undefined
  startTime: number
  currentTick: number
  tickScheduled: boolean
  ignoring: boolean
}

export const trackingAls = new AsyncLocalStorage<TrackingContext>()

export function createContext(callerStack?: ReadonlyArray<StackFrame>): TrackingContext {
  return {
    queries: [],
    fingerprintCounts: new Map(),
    fingerprintFirstIndex: new Map(),
    transactionState: createTransactionState(),
    callerStack: callerStack ?? undefined,
    startTime: Date.now(),
    currentTick: 0,
    tickScheduled: false,
    ignoring: false,
  }
}

export function getContext(): TrackingContext | undefined {
  return trackingAls.getStore()
}

export function runInContext<T>(ctx: TrackingContext, fn: () => T): T {
  return trackingAls.run(ctx, fn)
}

export function ignore<T>(fn: () => Promise<T>): Promise<T>
export function ignore<T>(fn: () => T): T
export function ignore<T>(fn: () => T | Promise<T>): T | Promise<T> {
  const ctx = trackingAls.getStore()
  if (!ctx) return fn()
  const shadow = { ...ctx, ignoring: true }
  return trackingAls.run(shadow, fn)
}

export function recordQuery(sql: string, durationMs: number): void {
  const ctx = trackingAls.getStore()
  if (!ctx) return
  if (ctx.ignoring) return

  const config = getConfig()
  if (!config.enabled) return

  ctx.transactionState = processTransactionCommand(sql, ctx.transactionState)

  const normalizedSql = normalize(sql)
  if (config.shouldIgnore(sql) || config.shouldIgnore(normalizedSql)) return

  const hash = fingerprintNormalized(normalizedSql)
  const prevCount = ctx.fingerprintCounts.get(hash) ?? 0
  const newCount = prevCount + 1
  ctx.fingerprintCounts.set(hash, newCount)

  let callerFrame: StackFrame | undefined
  let fullStack: ReadonlyArray<StackFrame> | undefined

  if (newCount === 1) {
    callerFrame = captureCallerFrame()
    ctx.fingerprintFirstIndex.set(hash, ctx.queries.length)
  } else if (newCount === 2) {
    fullStack = captureFullStack()
    const firstIdx = ctx.fingerprintFirstIndex.get(hash)
    if (firstIdx !== undefined) {
      const firstQuery = ctx.queries[firstIdx]
      ;(firstQuery as { fullStack: ReadonlyArray<StackFrame> | undefined }).fullStack =
        captureFullStack()
    }
  } else {
    fullStack = captureFullStack()
  }

  const query: RecordedQuery = {
    sql,
    normalizedSql,
    fingerprintHash: hash,
    timestamp: Date.now(),
    durationMs,
    inTransaction: isInTransaction(ctx.transactionState),
    callerFrame,
    fullStack,
    tick: ctx.currentTick,
  }

  ctx.queries.push(query)

  if (!ctx.tickScheduled) {
    ctx.tickScheduled = true
    queueMicrotask(() => {
      ctx.currentTick++
      ctx.tickScheduled = false
    })
  }
}
