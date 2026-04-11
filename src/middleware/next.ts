import { trackQueries } from '../integrations/shared.js'
import { handleReport, isDisabled } from './shared.js'
import type { QueryGuardMiddlewareOptions } from './shared.js'

export type { QueryGuardMiddlewareOptions }

export function withQueryGuard(
  handler: (req: Request) => Promise<Response> | Response,
  options?: QueryGuardMiddlewareOptions,
): (req: Request) => Promise<Response> {
  const mode = options?.mode ?? 'warn'
  const onDetection = options?.onDetection

  return async (req: Request): Promise<Response> => {
    if (isDisabled()) return handler(req)

    const { result, report } = await trackQueries(() => handler(req))
    const body = handleReport(report, mode, req, onDetection)
    if (body) {
      return new Response(body, { status: 500, headers: { 'Content-Type': 'text/plain' } })
    }
    return result
  }
}
