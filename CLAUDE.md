# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This is a new project for a simple CLI anime recommender. So far `src/main.ts` only prints a placeholder message, and there are no tests. Update this file as the architecture takes shape, and keep `README.md` in sync whenever a change affects what it describes, such as features, setup, scripts or code rules.

## Commands

- Type-check, lint and bundle: `npm run build` (runs `tsc --noEmit && oxlint && tsdown`, output goes to `dist/main.mjs`)
- Lint only: `npm run lint`
- Run all tests: `npm test` (runs `vitest run`)
- Run a single test file: `npx vitest run src/path/to/file.test.ts`
- Run tests matching a name: `npx vitest run -t "test name"`

## Git

Do not create feature branches unless expressly told to. Do all work and make all commits on the branch that is current at the time of the request, including when that branch is `main`.

## Conventions

- The package uses ES modules (`"type": "module"`), so use `import`/`export` rather than `require`.
- All `*.ts` files live under `src/`, except `tsdown.config.ts` and `vitest.config.ts`, which stay in the project root.
- Write source code in TypeScript. The type `any` is not allowed: `tsc` rejects implicit `any` and oxlint rejects explicit `any`, but neither catches JSDoc such as `@type {any}` in JavaScript files.
- `tsc` only checks files under `src/`, including JavaScript files (`checkJs`), and the two root config files.
- `vitest.config.ts` sets `passWithNoTests`, so `npm test` passes when no test files match.
