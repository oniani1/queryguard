# Changelog

## 0.3.1

### Fixes

- `fingerprint`: normalize negative numeric literals consistently with positive values. Previously `WHERE id = -1` and `WHERE id = 1` produced different fingerprints, silently missing N+1 patterns with negative values.
- `drivers`: skip re-recording when an outer patched method is already active. mysql2 Pool.query internally delegates to Connection.query; both prototypes are patched, and AsyncLocalStorage propagated through the boundary, causing the same query to be recorded twice.
- `drivers`: mysql2 queries that emit an `error` event without `end` (connection-level failures) now record correctly. Previously the record was lost.

### Features

- New type exports from the package root: `StackFrame`, `QueryGuardError`, `ScalingError`, `ScalingDetection`, `ScalingReport`, `AssertScalingOptions`, `AssertOptions`.

### Internal

- Extract shared driver patching into `src/drivers/shared.ts`. pg and mysql2 now share callback, sync-throw, promise, and event-end handling.
- Enable `noUncheckedIndexedAccess` in tsconfig with guards across detector, stack, report, integrations, and middleware.
- CI: Node 20/22/24 matrix; integration tests against pg16 and mysql8 services; pack size and zero-deps gates; overhead regression bench (warn-only); provenance-signed releases via `pnpm publish --provenance`.
- Tests: 184 → 242 unit tests; property-based fingerprint fuzzing (fast-check); self-dogfood setup that wraps every integration test in an outer tracking context.
- Integration test URLs are env-driven (`TEST_PG_URL`, `TEST_MYSQL_URL`) with conventional defaults.

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
