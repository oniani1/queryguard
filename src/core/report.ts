import { getConfig } from './config.js'
import type { Detection, DetectionReport } from './detector.js'
import { cleanseStack, formatFrame } from './stack.js'

export function formatDetection(detection: Detection): string {
  const config = getConfig()
  const duplicates = detection.occurrences - 1
  const expected = detection.occurrences - duplicates
  const lines: string[] = []

  lines.push('N+1 query detected')
  lines.push('')
  lines.push(`  Repeated query executed ${detection.occurrences} times:`)
  lines.push(`    ${detection.normalizedSql}`)

  if (detection.callerFrame) {
    lines.push('')
    lines.push('  Called from:')
    lines.push(`    ${detection.callerFrame.file}:${detection.callerFrame.line}`)
  }

  lines.push('')
  lines.push(
    `  Total queries: ${detection.occurrences} (${expected} expected + ${duplicates} duplicates)`,
  )
  lines.push(`  Time spent in duplicates: ${detection.totalDurationMs}ms`)

  lines.push('')
  lines.push(`  Fingerprint: ${detection.fingerprintHash.slice(0, 8)}`)

  if (config.verbose && detection.queries.length > 0) {
    const firstWithStack = detection.queries.find((q) => q.fullStack)
    if (firstWithStack?.fullStack) {
      const cleansed = cleanseStack(firstWithStack.fullStack)
      lines.push('  Full stack:')
      for (const frame of cleansed) {
        lines.push(`    at ${formatFrame(frame)}`)
      }
    } else {
      lines.push('  Full stack: no stack captured')
    }
  } else {
    lines.push('  Full stack: run with QUERYGUARD_VERBOSE=1')
  }

  return lines.join('\n')
}

export function formatReport(report: DetectionReport): string {
  if (report.detections.length === 0) return ''

  if (report.detections.length === 1) {
    const only = report.detections[0]
    if (only) return formatDetection(only)
    return ''
  }

  const parts: string[] = []
  for (let i = 0; i < report.detections.length; i++) {
    const d = report.detections[i]
    if (!d) continue
    parts.push(`[${i + 1}/${report.detections.length}] ${formatDetection(d)}`)
  }
  return parts.join('\n\n')
}
