# anime-recommender-cli

A simple CLI anime recommender.

This project is in early setup. The recommender isn't built yet, and the program currently only prints `Hello, World!`.

## Getting started

```sh
npm install
npm start
```

## Scripts

| Command         | What it does                                                          |
| --------------- | --------------------------------------------------------------------- |
| `npm run build` | Type-checks with `tsc`, lints with `oxlint`, then bundles with `tsdown` to `dist/main.mjs` |
| `npm start`     | Runs the full build, then runs `dist/main.mjs`                        |
| `npm run lint`  | Lints with `oxlint`                                                   |
| `npm test`      | Runs tests with `vitest` (there are no tests yet)                     |

## Code rules

All TypeScript files live under `src/`, except `tsdown.config.ts` and `vitest.config.ts`, which stay in the project root.

The type `any` isn't allowed. `tsc` rejects implicit `any` and `oxlint` rejects explicit `any`, and either one fails the build.

## License

[MIT](LICENSE)
