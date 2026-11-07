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
| `npm test`      | Runs unit tests with `vitest`. They never call the real AniList API   |
| `npm run codegen` | Regenerates `src/generated/` from AniList's live schema             |

## AniList service

`src/anilist.ts` builds queries and sends them to AniList's GraphQL API. Field names and arguments are checked at compile time, and results are typed by what you select.

```ts
import { QueryBuilder, VariablesBuilder, execute } from "./anilist.js";

const query = new QueryBuilder("GetAnime")
  .field("Media", { id: "id", type: "type" }, (media) =>
    media
      .select("id", "episodes")
      .field("title", (title) => title.select("romaji")),
  )
  .build();

const variables = new VariablesBuilder()
  .set("id", 1)
  .set("type", "ANIME")
  .build();

const result = await execute(query, variables);
console.log(result.Media?.title?.romaji);
```

Arguments map to variable names, so `{ id: "id" }` means the `id` argument takes its value from the `id` variable. The variable's declared type comes from the schema. Failed requests throw `AniListError`, which carries the HTTP status, AniList's errors and any `Retry-After` value.

Queries are read-only for now. Mutations, authentication and fields that return a union aren't supported.

## Code rules

All TypeScript files live under `src/`, except `tsdown.config.ts` and `vitest.config.ts`, which stay in the project root.

The type `any` isn't allowed. `tsc` rejects implicit `any` and `oxlint` rejects explicit `any`, and either one fails the build.

## License

[MIT](LICENSE)
