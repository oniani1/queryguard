# Changelog

## 0.1.0

Initial release.

- Driver-level N+1 detection for `pg` (Client and Pool)
- Vitest and Jest integrations (`assertNoNPlusOne`, `queryBudget`)
- Express, Next.js, Hono, and Fastify middleware
- SQL fingerprinting with SHA-1 hashing
- Transaction boundary tracking (queries inside transactions excluded)
- AsyncLocalStorage-based per-request/per-test tracking
- Zero runtime dependencies
- Production no-op by default
