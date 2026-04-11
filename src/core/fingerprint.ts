import { createHash } from 'node:crypto'

export function normalize(sql: string): string {
  const identifiers: string[] = []
  let result = sql
    .replace(/'(?:[^']|'')*'/g, '?')
    .replace(/"[^"]*"/g, (match) => {
      identifiers.push(match)
      return `\x00DQ${identifiers.length - 1}\x00`
    })
    .replace(/\$\d+/g, '?')
    .replace(/@p\d+/g, '?')
    .replace(/:\w+/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  for (let i = 0; i < identifiers.length; i++) {
    result = result.replace(`\x00dq${i}\x00`, identifiers[i])
  }

  return result
}

export function fingerprintNormalized(normalizedSql: string): string {
  return createHash('sha1').update(normalizedSql).digest('hex').slice(0, 16)
}

export function fingerprint(sql: string): string {
  return fingerprintNormalized(normalize(sql))
}
