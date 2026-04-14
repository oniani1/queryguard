import { describe, it, expect } from 'vitest'
import { parseStack, cleanseStack, formatFrame, type StackFrame } from '../../src/core/stack'

describe('parseStack', () => {
  it('parses standard V8 stack frame', () => {
    const stack = '    at functionName (/home/user/app/src/index.ts:10:5)'
    const frames = parseStack(stack)
    expect(frames).toEqual([
      {
        file: '/home/user/app/src/index.ts',
        line: 10,
        column: 5,
        fn: 'functionName',
        raw: stack.trim(),
      },
    ])
  })

  it('parses anonymous frame without function name', () => {
    const stack = '    at /home/user/app/src/index.ts:20:3'
    const frames = parseStack(stack)
    expect(frames).toEqual([
      {
        file: '/home/user/app/src/index.ts',
        line: 20,
        column: 3,
        fn: undefined,
        raw: stack.trim(),
      },
    ])
  })

  it('handles async frames', () => {
    const stack = '    at async loadData (/home/user/app/src/data.ts:5:12)'
    const frames = parseStack(stack)
    expect(frames).toEqual([
      {
        file: '/home/user/app/src/data.ts',
        line: 5,
        column: 12,
        fn: 'loadData',
        raw: stack.trim(),
      },
    ])
  })

  it('returns empty array for empty string', () => {
    expect(parseStack('')).toEqual([])
  })

  it('returns empty array for undefined input', () => {
    expect(parseStack(undefined as unknown as string)).toEqual([])
  })
})

describe('cleanseStack', () => {
  const userFrame: StackFrame = {
    file: '/home/user/app/src/service.ts',
    line: 42,
    column: 7,
    fn: 'getUser',
    raw: 'at getUser (/home/user/app/src/service.ts:42:7)',
  }

  it('strips node_modules/pg frames', () => {
    const pgFrame: StackFrame = {
      file: '/home/user/app/node_modules/pg/lib/client.js',
      line: 1,
      column: 1,
      fn: 'query',
      raw: 'at query (/home/user/app/node_modules/pg/lib/client.js:1:1)',
    }
    expect(cleanseStack([pgFrame, userFrame])).toEqual([userFrame])
  })

  it('strips node_modules/mysql2 frames', () => {
    const frame: StackFrame = {
      file: '/app/node_modules/mysql2/lib/connection.js',
      line: 1,
      column: 1,
      fn: 'query',
      raw: 'at query (/app/node_modules/mysql2/lib/connection.js:1:1)',
    }
    expect(cleanseStack([frame, userFrame])).toEqual([userFrame])
  })

  it('strips node_modules/@prisma frames', () => {
    const frame: StackFrame = {
      file: '/app/node_modules/@prisma/client/runtime/library.js',
      line: 10,
      column: 1,
      fn: undefined,
      raw: 'at /app/node_modules/@prisma/client/runtime/library.js:10:1',
    }
    expect(cleanseStack([frame, userFrame])).toEqual([userFrame])
  })

  it('strips node_modules/drizzle-orm frames', () => {
    const frame: StackFrame = {
      file: '/app/node_modules/drizzle-orm/pg-core/query.js',
      line: 5,
      column: 1,
      fn: 'execute',
      raw: 'at execute (/app/node_modules/drizzle-orm/pg-core/query.js:5:1)',
    }
    expect(cleanseStack([frame, userFrame])).toEqual([userFrame])
  })

  it('strips node_modules/kysely frames', () => {
    const frame: StackFrame = {
      file: '/app/node_modules/kysely/dist/query.js',
      line: 3,
      column: 1,
      fn: 'run',
      raw: 'at run (/app/node_modules/kysely/dist/query.js:3:1)',
    }
    expect(cleanseStack([frame, userFrame])).toEqual([userFrame])
  })

  it('strips node_modules/typeorm frames', () => {
    const frame: StackFrame = {
      file: '/app/node_modules/typeorm/query-runner.js',
      line: 8,
      column: 2,
      fn: 'query',
      raw: 'at query (/app/node_modules/typeorm/query-runner.js:8:2)',
    }
    expect(cleanseStack([frame, userFrame])).toEqual([userFrame])
  })

  it('strips node_modules/sequelize frames', () => {
    const frame: StackFrame = {
      file: '/app/node_modules/sequelize/lib/model.js',
      line: 15,
      column: 4,
      fn: 'findAll',
      raw: 'at findAll (/app/node_modules/sequelize/lib/model.js:15:4)',
    }
    expect(cleanseStack([frame, userFrame])).toEqual([userFrame])
  })

  it('strips node_modules/queryguard frames', () => {
    const frame: StackFrame = {
      file: '/app/node_modules/queryguard/dist/core/stack.js',
      line: 1,
      column: 1,
      fn: 'captureCallerFrame',
      raw: 'at captureCallerFrame (/app/node_modules/queryguard/dist/core/stack.js:1:1)',
    }
    expect(cleanseStack([frame, userFrame])).toEqual([userFrame])
  })

  it('strips node:internal frames', () => {
    const frame: StackFrame = {
      file: 'node:internal/modules/cjs/loader',
      line: 1200,
      column: 14,
      fn: 'Module._compile',
      raw: 'at Module._compile (node:internal/modules/cjs/loader:1200:14)',
    }
    expect(cleanseStack([frame, userFrame])).toEqual([userFrame])
  })

  it('preserves user-code frames', () => {
    const another: StackFrame = {
      file: '/home/user/app/src/routes/users.ts',
      line: 18,
      column: 3,
      fn: 'handleRequest',
      raw: 'at handleRequest (/home/user/app/src/routes/users.ts:18:3)',
    }
    expect(cleanseStack([userFrame, another])).toEqual([userFrame, another])
  })

  it('handles Windows backslash paths', () => {
    const winFrame: StackFrame = {
      file: 'C:\\Users\\dev\\app\\node_modules\\pg\\lib\\client.js',
      line: 1,
      column: 1,
      fn: 'query',
      raw: 'at query (C:\\Users\\dev\\app\\node_modules\\pg\\lib\\client.js:1:1)',
    }
    const winUserFrame: StackFrame = {
      file: 'C:\\Users\\dev\\app\\src\\index.ts',
      line: 5,
      column: 1,
      fn: 'main',
      raw: 'at main (C:\\Users\\dev\\app\\src\\index.ts:5:1)',
    }
    expect(cleanseStack([winFrame, winUserFrame])).toEqual([winUserFrame])
  })
})

describe('formatFrame', () => {
  it('returns function name with file location when function is present', () => {
    const frame: StackFrame = {
      file: '/app/src/index.ts',
      line: 10,
      column: 5,
      fn: 'main',
      raw: 'at main (/app/src/index.ts:10:5)',
    }
    expect(formatFrame(frame)).toBe('main (/app/src/index.ts:10:5)')
  })

  it('returns file location only when function is undefined', () => {
    const frame: StackFrame = {
      file: '/app/src/index.ts',
      line: 20,
      column: 3,
      fn: undefined,
      raw: 'at /app/src/index.ts:20:3',
    }
    expect(formatFrame(frame)).toBe('(/app/src/index.ts:20:3)')
  })
})
