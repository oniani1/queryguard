export interface TransactionState {
  depth: number
  savepointNames: string[]
}

export function createTransactionState(): TransactionState {
  return { depth: 0, savepointNames: [] }
}

export function processTransactionCommand(sql: string, state: TransactionState): TransactionState {
  const trimmed = sql.trimStart()
  const upper = trimmed.toUpperCase()

  if (upper.startsWith('START TRANSACTION')) {
    return { depth: state.depth + 1, savepointNames: [...state.savepointNames] }
  }

  if (upper.startsWith('BEGIN')) {
    return { depth: state.depth + 1, savepointNames: [...state.savepointNames] }
  }

  if (upper.startsWith('COMMIT') || upper.startsWith('END')) {
    return { depth: Math.max(0, state.depth - 1), savepointNames: [...state.savepointNames] }
  }

  const rollbackToMatch = upper.match(/^ROLLBACK\s+TO\s+(?:SAVEPOINT\s+)?(\S+)/)
  if (rollbackToMatch) {
    const name = trimmed.match(/^(?:ROLLBACK\s+TO\s+(?:SAVEPOINT\s+)?)(\S+)/i)?.[1] ?? ''
    const idx = state.savepointNames.indexOf(name)
    if (idx === -1) {
      return { depth: state.depth, savepointNames: [...state.savepointNames] }
    }
    const kept = state.savepointNames.slice(0, idx + 1)
    const removed = state.savepointNames.length - kept.length
    return { depth: Math.max(0, state.depth - removed), savepointNames: kept }
  }

  if (upper.startsWith('ROLLBACK')) {
    return { depth: Math.max(0, state.depth - 1), savepointNames: [...state.savepointNames] }
  }

  const releaseSavepointMatch = upper.match(/^RELEASE\s+SAVEPOINT\s+(\S+)/)
  if (releaseSavepointMatch) {
    const name = trimmed.match(/^RELEASE\s+SAVEPOINT\s+(\S+)/i)?.[1] ?? ''
    const idx = state.savepointNames.indexOf(name)
    if (idx === -1) {
      return { depth: state.depth, savepointNames: [...state.savepointNames] }
    }
    const kept = state.savepointNames.slice(0, idx)
    const removed = state.savepointNames.length - kept.length
    return { depth: Math.max(0, state.depth - removed), savepointNames: kept }
  }

  const savepointMatch = upper.match(/^SAVEPOINT\s+(\S+)/)
  if (savepointMatch) {
    const name = trimmed.match(/^SAVEPOINT\s+(\S+)/i)?.[1] ?? ''
    return { depth: state.depth + 1, savepointNames: [...state.savepointNames, name] }
  }

  return { depth: state.depth, savepointNames: [...state.savepointNames] }
}

export function isInTransaction(state: TransactionState): boolean {
  return state.depth > 0
}
