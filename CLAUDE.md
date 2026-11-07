# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This is a new project for a simple CLI anime recommender. So far `src/main.ts` only prints a placeholder message, and `src/anilist.ts` is not wired into it yet. Update this file as the architecture takes shape, and keep `README.md` in sync whenever a change affects what it describes, such as features, setup, scripts or code rules.

## Commands

- Type-check, lint and bundle: `npm run build` (runs `tsc --noEmit && oxlint && tsdown`, output goes to `dist/main.mjs`)
- Build and run: `npm start` (runs `npm run build && node dist/main.mjs`)
- Lint only: `npm run lint`
- Run all tests: `npm test` (runs `vitest run`)
- Run a single test file: `npx vitest run src/path/to/file.test.ts`
- Run tests matching a name: `npx vitest run -t "test name"`
- Regenerate AniList types: `npm run codegen` (the only command that contacts AniList)

## AniList service

`src/anilist.ts` has `QueryBuilder` and `VariablesBuilder`, which each produce a string, and `execute(query, variables)`, which sends them.

- `src/generated/` is codegen output, committed and never hand-edited. `scripts/anilist-field-meta.mjs` is a custom codegen plugin that adds `FieldArgs` (field to args type) and `FIELD_META` (the runtime map used to derive variable declarations).
- Call them `variables`, matching AniList's API, not configuration.
- Query arguments always bind to variable names, never literals, because enums and strings can't be told apart at runtime.
- `execute` enforces a sliding-window rate limit, set by `DEFAULT_RATE_LIMIT` or `configureRateLimit`. Over the limit it throws `AniListError` with `retryAfter` in seconds instead of waiting. The count is in memory, per process, so tests reset it in `beforeEach`.

## Testing

- Tests live in `src/tests/`, are written first (TDD), and are unit tests only. They must not call the real AniList API: stub `fetch`, and validate queries against `src/generated/schema.graphql`.
- Vitest doesn't type-check, so `expectTypeOf` and `@ts-expect-error` tests are only enforced by `tsc`. Run `npm run build` as well as `npm test`.

## Git

Do not create feature branches unless expressly told to. Do all work and make all commits on the branch that is current at the time of the request, including when that branch is `main`.

## Conventions

- The package uses ES modules (`"type": "module"`), so use `import`/`export` rather than `require`.
- All `*.ts` files live under `src/`, except `tsdown.config.ts` and `vitest.config.ts`, which stay in the project root.
- Write source code in TypeScript. The type `any` is not allowed: `tsc` rejects implicit `any` and oxlint rejects explicit `any`, but neither catches JSDoc such as `@type {any}` in JavaScript files.
- `tsc` only checks files under `src/`, including JavaScript files (`checkJs`), and the two root config files.
