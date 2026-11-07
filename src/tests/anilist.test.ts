import { readFileSync } from "node:fs";
import { buildSchema, parse, validate } from "graphql";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
  vi,
} from "vitest";
import {
  AniListError,
  DEFAULT_RATE_LIMIT,
  QueryBuilder,
  VariablesBuilder,
  configureRateLimit,
  execute,
} from "../anilist.js";
import type { ResultOf } from "../anilist.js";
import type { MediaType } from "../generated/anilist.js";

const schema = buildSchema(
  readFileSync(
    new URL("../generated/schema.graphql", import.meta.url),
    "utf8",
  ),
);

const animeQuery = () =>
  new QueryBuilder("GetAnime")
    .field("Media", { id: "id", type: "type" }, (media) =>
      media
        .select("id", "episodes", "genres", "type")
        .field("title", (title) => title.select("romaji", "english")),
    )
    .build();

const pageQuery = () =>
  new QueryBuilder("Browse")
    .field("Page", { page: "page", perPage: "perPage" }, (page) =>
      page
        .field("pageInfo", (info) => info.select("hasNextPage"))
        .field("media", { search: "search", genre_in: "genres" }, (media) =>
          media.select("id"),
        ),
    )
    .build();

describe("QueryBuilder", () => {
  test("builds selections, nesting and derived variable declarations", () => {
    expect(animeQuery()).toBe(
      "query GetAnime($id: Int, $type: MediaType) { Media(id: $id, type: $type) { id episodes genres type title { romaji english } } }",
    );
  });

  test("builds list fields and collects variables from nested fields", () => {
    expect(pageQuery()).toBe(
      "query Browse($page: Int, $perPage: Int, $search: String, $genres: [String]) { Page(page: $page, perPage: $perPage) { pageInfo { hasNextPage } media(search: $search, genre_in: $genres) { id } } }",
    );
  });

  test("builds root leaf fields with no variables", () => {
    const query = new QueryBuilder("GetGenres")
      .select("GenreCollection")
      .build();

    expect(query).toBe("query GetGenres { GenreCollection }");
  });

  test("keeps required markers in derived variable types", () => {
    const query = new QueryBuilder("Render")
      .field("Markdown", { markdown: "text" }, (markdown) =>
        markdown.select("html"),
      )
      .build();

    expect(query).toBe(
      "query Render($text: String!) { Markdown(markdown: $text) { html } }",
    );
  });

  test("declares a variable once when it is reused with the same type", () => {
    const query = new QueryBuilder("Reuse")
      .field("Media", { id: "id" }, (media) =>
        media
          .select("id")
          .field("characters", { page: "id" }, (characters) =>
            characters.field("nodes", (nodes) => nodes.select("id")),
          ),
      )
      .build();

    expect(query).toBe(
      "query Reuse($id: Int) { Media(id: $id) { id characters(page: $id) { nodes { id } } } }",
    );
  });

  test("throws when a variable is bound to two different types", () => {
    const builder = new QueryBuilder("Conflict").field(
      "Media",
      { id: "value", search: "value" },
      (media) => media.select("id"),
    );

    expect(() => builder.build()).toThrow(/value.*Int.*String/);
  });

  test("throws when a selection is empty", () => {
    const nested = new QueryBuilder("Empty").field("Media", (media) => media);

    expect(() => nested.build()).toThrow(/Media/);
    expect(() => new QueryBuilder("Empty").build()).toThrow(/Query/);
  });

  test("throws on names that are not valid GraphQL names", () => {
    expect(() =>
      new QueryBuilder("Bad } name").select("GenreCollection").build(),
    ).toThrow(/Bad } name/);

    const builder = new QueryBuilder("Q").field(
      "Media",
      { id: "id) { id } #" },
      (media) => media.select("id"),
    );
    expect(() => builder.build()).toThrow(/id\) \{ id \} #/);
  });

  test("produces queries that are valid against the AniList schema", () => {
    const queries = [
      animeQuery(),
      pageQuery(),
      new QueryBuilder("GetGenres").select("GenreCollection").build(),
      new QueryBuilder("Render")
        .field("Markdown", { markdown: "text" }, (markdown) =>
          markdown.select("html"),
        )
        .build(),
    ];

    for (const query of queries) {
      expect(validate(schema, parse(query))).toEqual([]);
    }
  });

  test("types results by what was selected", () => {
    type Result = ResultOf<ReturnType<typeof animeQuery>>;
    type Media = NonNullable<Result["Media"]>;

    expectTypeOf<Media["id"]>().toEqualTypeOf<number>();
    expectTypeOf<Media["episodes"]>().toEqualTypeOf<
      number | null | undefined
    >();
    expectTypeOf<Media["type"]>().toEqualTypeOf<
      MediaType | null | undefined
    >();
    expectTypeOf<Media["genres"]>().toEqualTypeOf<
      (string | null)[] | null | undefined
    >();
    expectTypeOf<NonNullable<Media["title"]>>().toEqualTypeOf<{
      romaji?: string | null;
      english?: string | null;
    }>();
    expectTypeOf<Media>().not.toHaveProperty("bannerImage");

    type Page = NonNullable<ResultOf<ReturnType<typeof pageQuery>>["Page"]>;
    expectTypeOf<NonNullable<Page["media"]>>().toEqualTypeOf<
      ({ id: number } | null)[]
    >();
  });

  test("rejects invalid queries at compile time", () => {
    // Never called: `tsc` checks these in `npm run build`. Each directive below
    // fails the type check if the rule it covers stops being enforced.
    expectTypeOf(() => {
      const root = new QueryBuilder("Q");

      // @ts-expect-error unknown leaf field
      root.select("NotAField");
      // @ts-expect-error object fields need a selection
      root.select("Media");
      // @ts-expect-error unknown object field
      root.field("NotAField", (selection) => selection);
      // @ts-expect-error leaf fields can't take a selection
      root.field("GenreCollection", (selection) => selection);
      // @ts-expect-error unknown argument
      root.field("Media", { notAnArg: "x" }, (media) => media.select("id"));
      // @ts-expect-error argument bindings are variable names, not values
      root.field("Media", { id: 1 }, (media) => media.select("id"));
      // @ts-expect-error required argument is missing
      root.field("Markdown", (markdown) => markdown.select("html"));
      // @ts-expect-error required argument is missing
      root.field("Markdown", {}, (markdown) => markdown.select("html"));
      // @ts-expect-error fields returning a union need fragments
      root.field("Activity", (activity) => activity);
      // @ts-expect-error nested fields are checked too
      root.field("Media", (media) => media.select("notAField"));

      // @ts-expect-error only the root selection can build
      root.field("Media", (media) => (media.build(), media));
    }).toBeFunction();
  });
});

describe("VariablesBuilder", () => {
  test("builds key/value pairs as a JSON string", () => {
    const variables = new VariablesBuilder()
      .set("id", 1)
      .set("type", "ANIME")
      .build();

    expect(variables).toBe('{"id":1,"type":"ANIME"}');
  });

  test("builds an empty JSON object when no values are set", () => {
    expect(new VariablesBuilder().build()).toBe("{}");
  });

  test("uses the latest value when a key is set twice", () => {
    const variables = new VariablesBuilder()
      .set("page", 1)
      .set("page", 2)
      .build();

    expect(variables).toBe('{"page":2}');
  });

  test("escapes strings and supports arrays and null", () => {
    const variables = new VariablesBuilder()
      .set("search", 'Fullmetal "Alchemist"\n')
      .set("genres", ["Action", "Drama"])
      .set("season", null)
      .build();

    expect(JSON.parse(variables)).toEqual({
      search: 'Fullmetal "Alchemist"\n',
      genres: ["Action", "Drama"],
      season: null,
    });
  });
});

const stubFetch = (response: Response | Error) => {
  const fetchStub = vi.fn<typeof fetch>(() =>
    response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve(response),
  );
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
};

const jsonResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) => new Response(JSON.stringify(body), { status, headers });

const stubSuccess = () => {
  const fetchStub = vi.fn<typeof fetch>(() =>
    Promise.resolve(jsonResponse({ data: {} })),
  );
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
};

const rateLimited = (retryAfter: string) =>
  jsonResponse({ errors: [{ message: "Limited" }] }, 429, {
    "Retry-After": retryAfter,
  });

const advanceSeconds = (seconds: number) => {
  vi.setSystemTime(Date.now() + seconds * 1000);
};

describe("execute", () => {
  const query = new QueryBuilder("GetGenres").select("GenreCollection").build();

  const failure = async (variables?: string): Promise<AniListError> => {
    const error: unknown = await execute(query, variables).then(
      () => new Error("Expected execute to reject"),
      (reason: unknown) => reason,
    );
    if (error instanceof AniListError) {
      return error;
    }
    throw error;
  };

  const sendRequests = async (count: number) => {
    for (let sent = 0; sent < count; sent += 1) {
      await execute(query);
    }
  };

  beforeEach(() => {
    configureRateLimit(DEFAULT_RATE_LIMIT);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("posts the query and variables to AniList", async () => {
    const fetchStub = stubFetch(jsonResponse({ data: {} }));

    await execute(query, new VariablesBuilder().set("id", 1).build());

    expect(fetchStub).toHaveBeenCalledOnce();
    const [url, init] = fetchStub.mock.calls[0] ?? [];
    expect(url).toBe("https://graphql.anilist.co");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      query,
      variables: { id: 1 },
    });
  });

  test("sends empty variables by default", async () => {
    const fetchStub = stubFetch(jsonResponse({ data: {} }));

    await execute(query);

    const init = fetchStub.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body)).variables).toEqual({});
  });

  test("returns data typed by the query", async () => {
    stubFetch(jsonResponse({ data: { GenreCollection: ["Action"] } }));

    const result = await execute(query);

    expect(result).toEqual({ GenreCollection: ["Action"] });
    expectTypeOf(result.GenreCollection).toEqualTypeOf<
      (string | null)[] | null | undefined
    >();
  });

  test("throws AniListError for HTTP errors with GraphQL errors", async () => {
    const errors = [{ message: "Not Found.", status: 404 }];
    stubFetch(jsonResponse({ data: null, errors }, 404));

    const error = await failure();

    expect(error.status).toBe(404);
    expect(error.errors).toEqual(errors);
    expect(error.message).toContain("Not Found.");
  });

  test("throws AniListError for GraphQL errors on a 200 response", async () => {
    const errors = [{ message: "Partial failure" }];
    stubFetch(jsonResponse({ data: { GenreCollection: [] }, errors }));

    const error = await failure();

    expect(error.status).toBe(200);
    expect(error.errors).toEqual(errors);
  });

  test("includes Retry-After when rate limited", async () => {
    stubFetch(
      jsonResponse({ errors: [{ message: "Too Many Requests." }] }, 429, {
        "Retry-After": "60",
      }),
    );

    const error = await failure();

    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe(60);
  });

  test("throws AniListError when the response is not JSON", async () => {
    stubFetch(new Response("<html>Bad Gateway</html>", { status: 502 }));

    const error = await failure();

    expect(error.status).toBe(502);
    expect(error.errors).toEqual([]);
  });

  test("throws AniListError when a successful response has no data", async () => {
    stubFetch(jsonResponse({}));

    expect((await failure()).status).toBe(200);
  });

  test("throws AniListError with the cause on network failures", async () => {
    const cause = new TypeError("fetch failed");
    stubFetch(cause);

    const error = await failure();

    expect(error.status).toBeUndefined();
    expect(error.cause).toBe(cause);
  });

  test("throws AniListError without a request for invalid variables", async () => {
    const fetchStub = stubFetch(jsonResponse({ data: {} }));

    const error = await failure("not json");

    expect(error.cause).toBeInstanceOf(SyntaxError);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  describe("rate limiting", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test("defaults to AniList's limit of 30 requests per minute", () => {
      expect(DEFAULT_RATE_LIMIT).toEqual({ maxRequests: 30, windowMs: 60_000 });
    });

    test("rejects requests over the limit without sending them", async () => {
      const fetchStub = stubSuccess();

      await sendRequests(30);
      const error = await failure();

      expect(error.status).toBeUndefined();
      expect(fetchStub).toHaveBeenCalledTimes(30);
    });

    test("reports how long to wait before retrying", async () => {
      stubSuccess();
      await sendRequests(30);
      advanceSeconds(48);

      const error = await failure();

      expect(error.retryAfter).toBe(12);
      expect(error.message).toContain("30 requests per 60 seconds");
      expect(error.message).toContain("Try again in 12 seconds");
    });

    test("rounds the wait up to a whole second", async () => {
      stubSuccess();
      await sendRequests(30);
      vi.setSystemTime(Date.now() + 59_001);

      const error = await failure();

      expect(error.retryAfter).toBe(1);
      expect(error.message).toContain("Try again in 1 second.");
    });

    test("allows requests again once the window has passed", async () => {
      const fetchStub = stubSuccess();
      await sendRequests(30);
      advanceSeconds(60);

      await execute(query);

      expect(fetchStub).toHaveBeenCalledTimes(31);
    });

    test("frees capacity as each request leaves the window", async () => {
      stubSuccess();
      configureRateLimit({ maxRequests: 2 });
      await sendRequests(1);
      advanceSeconds(30);
      await sendRequests(1);
      advanceSeconds(30);

      await sendRequests(1);
      const error = await failure();

      expect(error.retryAfter).toBe(30);
    });

    test("doesn't count rejected requests towards the limit", async () => {
      const fetchStub = stubSuccess();
      configureRateLimit({ maxRequests: 1 });
      await sendRequests(1);
      advanceSeconds(30);
      await failure();
      advanceSeconds(30);

      await sendRequests(1);

      expect(fetchStub).toHaveBeenCalledTimes(2);
    });

    test("doesn't count invalid variables towards the limit", async () => {
      const fetchStub = stubSuccess();
      configureRateLimit({ maxRequests: 1 });
      await failure("not json");

      await sendRequests(1);

      expect(fetchStub).toHaveBeenCalledOnce();
    });

    test("counts requests that fail on the network", async () => {
      stubFetch(new TypeError("fetch failed"));
      configureRateLimit({ maxRequests: 1 });
      await failure();

      const error = await failure();

      expect(error.retryAfter).toBe(60);
    });

    test("enforces the limit on concurrent requests", async () => {
      const fetchStub = stubSuccess();
      configureRateLimit({ maxRequests: 2 });

      const results = await Promise.allSettled([
        execute(query),
        execute(query),
        execute(query),
      ]);

      expect(results.map((result) => result.status)).toEqual([
        "fulfilled",
        "fulfilled",
        "rejected",
      ]);
      expect(fetchStub).toHaveBeenCalledTimes(2);
    });

    test("can be configured", async () => {
      const fetchStub = stubSuccess();
      configureRateLimit({ maxRequests: 2, windowMs: 10_000 });
      await sendRequests(2);

      const error = await failure();

      expect(error.retryAfter).toBe(10);
      expect(error.message).toContain("2 requests per 10 seconds");
      expect(fetchStub).toHaveBeenCalledTimes(2);
    });

    test("keeps the current value of a setting that isn't passed", async () => {
      stubSuccess();
      configureRateLimit({ windowMs: 5000 });
      configureRateLimit({ maxRequests: 1 });
      await sendRequests(1);

      expect((await failure()).retryAfter).toBe(5);
    });

    test.each([
      { maxRequests: 0 },
      { maxRequests: -1 },
      { maxRequests: 1.5 },
      { windowMs: 0 },
      { windowMs: Number.NaN },
    ])("rejects invalid settings: %o", (settings) => {
      expect(() => configureRateLimit(settings)).toThrow(RangeError);
    });

    test("waits out a 429 from AniList before sending more", async () => {
      const fetchStub = vi.fn<typeof fetch>(() =>
        Promise.resolve(
          jsonResponse({ errors: [{ message: "Too Many Requests." }] }, 429, {
            "Retry-After": "90",
          }),
        ),
      );
      vi.stubGlobal("fetch", fetchStub);

      const limited = await failure();
      expect(limited.status).toBe(429);
      expect(limited.message).toContain("Try again in 90 seconds");

      advanceSeconds(30);
      const blocked = await failure();
      expect(blocked.status).toBeUndefined();
      expect(blocked.retryAfter).toBe(60);
      expect(fetchStub).toHaveBeenCalledOnce();

      advanceSeconds(60);
      await failure();
      expect(fetchStub).toHaveBeenCalledTimes(2);
    });

    test("doesn't let a shorter Retry-After reduce a longer wait", async () => {
      const responses: ((response: Response) => void)[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(
          () =>
            new Promise((resolve) => {
              responses.push(resolve);
            }),
        ),
      );
      const first = failure();
      const second = failure();

      responses[0]?.(rateLimited("90"));
      await first;
      advanceSeconds(1);
      responses[1]?.(rateLimited("10"));
      await second;
      advanceSeconds(10);

      expect((await failure()).retryAfter).toBe(79);
    });

    test("reads a Retry-After date as a wait in seconds", async () => {
      const retryAt = new Date(Date.now() + 90_000).toUTCString();
      const fetchStub = stubFetch(rateLimited(retryAt));

      const error = await failure();
      expect(error.retryAfter).toBe(90);

      advanceSeconds(30);
      expect((await failure()).retryAfter).toBe(60);
      expect(fetchStub).toHaveBeenCalledOnce();
    });

    test("treats a Retry-After date in the past as no wait", async () => {
      const retryAt = new Date(Date.now() - 90_000).toUTCString();
      stubFetch(rateLimited(retryAt));

      expect((await failure()).retryAfter).toBe(0);
    });

    test.each(["", "soon", "-5", "1.5"])(
      "ignores an invalid Retry-After: %j",
      async (retryAfter) => {
        stubFetch(jsonResponse({}, 429, { "Retry-After": retryAfter }));

        expect((await failure()).retryAfter).toBeUndefined();
      },
    );
  });

  describe("malformed responses", () => {
    test.each([{ errors: null }, { errors: "boom" }, { errors: { a: 1 } }])(
      "throws AniListError for an HTTP error with %j",
      async (body) => {
        stubFetch(jsonResponse(body, 500));

        const error = await failure();

        expect(error.status).toBe(500);
        expect(error.errors).toEqual([]);
      },
    );

    test("keeps only error entries that have a message", async () => {
      stubFetch(
        jsonResponse(
          { errors: [{ message: "Real" }, { code: 1 }, null, "text"] },
          500,
        ),
      );

      const error = await failure();

      expect(error.errors).toEqual([{ message: "Real" }]);
      expect(error.message).toContain("Real");
    });

    test("returns data when errors is null on a successful response", async () => {
      stubFetch(jsonResponse({ data: { GenreCollection: [] }, errors: null }));

      await expect(execute(query)).resolves.toEqual({ GenreCollection: [] });
    });

    test.each([[1], "text", null])(
      "throws AniListError for a response body of %j",
      async (body) => {
        stubFetch(jsonResponse(body));

        expect((await failure()).status).toBe(200);
      },
    );
  });
});
