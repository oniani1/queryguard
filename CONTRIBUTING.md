# Contributing

Thanks for considering a contribution.

## Setup

```bash
pnpm install
pnpm test      # unit tests (~1s)
pnpm typecheck
pnpm lint
pnpm build
```

## Integration tests

Integration tests talk to a real Postgres and MySQL. Set env vars or rely on the defaults:

```bash
export TEST_PG_URL="postgresql://postgres:test@localhost:5432/test"
export TEST_MYSQL_URL="mysql://root:test@localhost:3306/test"
pnpm test:integration
```

Quick local setup:

```bash
docker run -d --name qg-pg -p 5432:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test postgres:16
docker run -d --name qg-mysql -p 3306:3306 -e MYSQL_ROOT_PASSWORD=test -e MYSQL_DATABASE=test mysql:8
```

The mysql2 integration test creates its own tables (`qguard_user`, `qguard_post`) and cleans up after itself. The pg integration tests expect `"User"` and `"Post"` tables. See `.github/workflows/ci.yml` for the seed SQL.

## Overhead benchmark

```bash
pnpm bench:ci            # compare against stored baseline
pnpm bench:ci --write    # regenerate baseline
```

The CI bench job is warn-only — regressions are reported but do not block merges while we gather confidence in CI hardware stability.

## Coverage

```bash
pnpm test:coverage
```

Thresholds are enforced per-directory in `vitest.config.ts`.

## Releases

Releases are cut by pushing a tag:

```bash
git tag v0.3.1
git push origin v0.3.1
```

This triggers `.github/workflows/publish.yml`, which:

1. Runs typecheck, lint, unit tests, and build.
2. Publishes to npm with `--provenance` (supply-chain attestation tying the package to this repo's CI).

`prepublishOnly` runs the same gates locally if you ever publish manually.

## Conventional Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). Examples:

- `feat(drivers): add stored-procedure detection`
- `fix(fingerprint): handle negative numeric literals`
- `test(integration): seed mysql fixtures in beforeAll`
- `docs(readme): clarify Prisma 7 setup`

## Code style

- Biome formats and lints (`pnpm lint`, `pnpm format`).
- Two-space indent, single quotes, no semicolons.
- TypeScript strict, including `noUncheckedIndexedAccess`.
