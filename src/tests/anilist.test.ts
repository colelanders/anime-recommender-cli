import { describe, expect, test } from "vitest";
import { VariablesBuilder } from "../anilist.js";

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
