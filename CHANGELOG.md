# Changelog

## 0.3.0

- Add `ignore()` for scoped query suppression within tracking contexts
- Add notification channels: `loggerNotifier`, `slackNotifier`, `sentryNotifier` via `qguard/notifiers`
- Add `assertScaling` for multi-run data-dependent N+1 detection
- Add `onDetection` and `notifyOnce` to global config
- Add `skipGlobalNotifiers` option to middleware
- Add `testNotifiers()` for verifying notification setup
- Add `qguard/notifiers` subpath export

## 0.2.0

- Add mysql2 driver support (Connection and Pool, query and execute)
- Fix backtick-quoted identifiers in SQL fingerprinting
- Add mysql2 to auto-detection in `install()`
- Move mysql2 to peerDependencies

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
