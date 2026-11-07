import { readFileSync } from "node:fs";
import { buildSchema, parse, validate } from "graphql";
import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import {
  AniListError,
  QueryBuilder,
  VariablesBuilder,
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
});
