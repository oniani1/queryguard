# Vitest automatic setup

Date: 2026-08-31
Issue: [#9](https://github.com/oniani1/queryguard/issues/9)

## Goal

Allow a Vitest suite to enforce qguard for every test from one configuration entry:

```ts
import { qguardSetup } from 'qguard/vitest'

export default defineConfig({
  test: {
    setupFiles: [qguardSetup],
  },
})
```

The existing `qguard/vitest` assertion helpers remain explicit and side-effect free. Importing
`qguardSetup` loads the `qguard/vitest/setup` entry point, which installs the database hooks once,
opens an isolated tracking context for each test, dispatches configured notifications, and fails
the affected test with `QueryGuardError` when the context contains an N+1 detection.

## Plan

- [x] Add a runner-level failing test proving setup-file enforcement and clean-test behavior.
- [x] Implement the Vitest lifecycle adapter with per-test `AsyncLocalStorage` isolation.
- [x] Publish the `qguard/vitest/setup` package export and verify the packed artifact.
- [x] Document automatic setup, configuration, opt-out, and interaction with explicit assertions.
- [x] Run formatting, type checking, linting, unit tests, build, and relevant integration tests.

## Non-goals

- Baseline or acknowledgement files.
- Jest, Mocha, or other runner adapters.
- Changes to the N+1 detection algorithm.
