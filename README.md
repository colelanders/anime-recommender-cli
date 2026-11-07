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
| `npm run test:coverage` | Runs unit tests and reports coverage, with an HTML report in `coverage/` |
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

### Rate limit

`execute` allows 30 requests per 60 seconds by default, to stay within AniList's limit. To change it, edit `DEFAULT_RATE_LIMIT` in `src/anilist.ts`, or set it when the program runs:

```ts
configureRateLimit({ maxRequests: 90, windowMs: 60_000 });
```

A request over the limit isn't sent. `execute` throws an `AniListError` whose message says how long to wait, and whose `retryAfter` holds the wait in seconds. If AniList itself responds with `Retry-After`, requests are held back for that long too.

The count is kept in memory, so it starts again each time the program runs.

Queries are read-only for now. Mutations, authentication, aliases, fields that return a union and arguments on leaf fields (such as `description(asHtml: true)`) aren't supported. Selecting the same field twice with different arguments throws at `build()`, because it would need aliases.

## Code rules

All TypeScript files live under `src/`, except `tsdown.config.ts` and `vitest.config.ts`, which stay in the project root.

The type `any` isn't allowed. `tsc` rejects implicit `any` and `oxlint` rejects explicit `any`, and either one fails the build.

## License

[MIT](LICENSE)
