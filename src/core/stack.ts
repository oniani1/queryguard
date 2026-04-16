export interface StackFrame {
  file: string
  line: number
  column: number
  fn: string | undefined
  raw: string
}

const FRAME_RE = /at (?:(?:async )?(.+?) \()?(.+?):(\d+):(\d+)\)?$/

const STRIP_PATTERNS = [
  'node_modules/pg',
  'node_modules/mysql2',
  'node_modules/@prisma',
  'node_modules/drizzle-orm',
  'node_modules/kysely',
  'node_modules/typeorm',
  'node_modules/sequelize',
  'node_modules/queryguard',
  'node:internal/',
]

export function parseStack(stack: string): StackFrame[] {
  if (!stack) return []

  const frames: StackFrame[] = []
  for (const rawLine of stack.split('\n')) {
    const line = rawLine.trim()
    const match = FRAME_RE.exec(line)
    if (!match) continue
    const file = match[2]
    if (file === undefined) continue
    frames.push({
      file,
      line: Number(match[3]),
      column: Number(match[4]),
      fn: match[1] ?? undefined,
      raw: line,
    })
  }
  return frames
}

function isFilteredFrame(frame: StackFrame): boolean {
  const normalized = frame.file.replace(/\\/g, '/')
  return STRIP_PATTERNS.some((p) => normalized.includes(p))
}

export function cleanseStack(frames: ReadonlyArray<StackFrame>): StackFrame[] {
  return frames.filter((f) => !isFilteredFrame(f))
}

export function captureFullStack(): StackFrame[] {
  const prev = Error.stackTraceLimit
  Error.stackTraceLimit = 30
  const err = new Error()
  Error.stackTraceLimit = prev
  return parseStack(err.stack ?? '')
}

export function captureCallerFrame(): StackFrame | undefined {
  const prev = Error.stackTraceLimit
  Error.stackTraceLimit = 4
  const err = new Error()
  Error.stackTraceLimit = prev
  const frames = cleanseStack(parseStack(err.stack ?? ''))
  return frames[0]
}

export function formatFrame(frame: StackFrame): string {
  if (frame.fn) {
    return `${frame.fn} (${frame.file}:${frame.line}:${frame.column})`
  }
  return `(${frame.file}:${frame.line}:${frame.column})`
}
