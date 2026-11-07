import { FIELD_META } from "./generated/anilist.js";
import type { FieldArgs, Query } from "./generated/anilist.js";

declare const resultType: unique symbol;
declare const selectionType: unique symbol;

/** A GraphQL query string that also carries its result type at compile time. */
export type AniListQuery<R> = string & { readonly [resultType]?: R };

export type ResultOf<Q> = Q extends AniListQuery<infer R> ? R : never;

type Simplify<T> = { [K in keyof T]: T[K] };

type IsUnion<T, U = T> = T extends unknown
  ? [U] extends [T]
    ? false
    : true
  : never;

/** Strips null, undefined and lists from a field's type. */
type Unwrap<F> = unknown extends F
  ? unknown
  : F extends readonly (infer U)[]
    ? Unwrap<U>
    : Exclude<F, null | undefined>;

type IsLeaf<U> = unknown extends U ? true : [U] extends [object] ? false : true;

type LeafKeys<T> = {
  [K in keyof T]-?: K extends "__typename"
    ? never
    : IsLeaf<Unwrap<T[K]>> extends true
      ? K
      : never;
}[keyof T] &
  string;

// Union fields are left out because selecting from them needs fragments.
type ObjectKeys<T> = {
  [K in keyof T]-?: K extends "__typename"
    ? never
    : IsLeaf<Unwrap<T[K]>> extends true
      ? never
      : IsUnion<Unwrap<T[K]>> extends true
        ? never
        : K;
}[keyof T] &
  string;

type NoArgs = Record<never, never>;

type ArgsOf<T, K> = T extends { __typename?: infer N }
  ? NonNullable<N> extends keyof FieldArgs
    ? K extends keyof FieldArgs[NonNullable<N>]
      ? FieldArgs[NonNullable<N>][K]
      : NoArgs
    : NoArgs
  : NoArgs;

type KeysWithoutRequiredArgs<T> = {
  [K in ObjectKeys<T>]: NoArgs extends ArgsOf<T, K> ? K : never;
}[ObjectKeys<T>];

/** Maps each argument to the name of the variable that supplies its value. */
type ArgBindings<A> = [keyof A] extends [never]
  ? Record<string, never>
  : { [P in keyof A]: string };

/** Rebuilds a field's null and list wrappers around its selected shape. */
type Project<F, S> = F extends readonly (infer U)[]
  ? Project<U, S>[]
  : F extends null | undefined
    ? F
    : S;

type FieldResult<T, K extends keyof T, S> = {
  [P in keyof Pick<T, K>]: Project<T[P], Simplify<S>>;
};

type Selector<T, K extends keyof T, S> = (
  selection: SelectionBuilder<Unwrap<T[K]>>,
) => SelectionBuilder<Unwrap<T[K]>, S>;

const GRAPHQL_NAME = /^[_A-Za-z][_0-9A-Za-z]*$/;

const assertName = (name: string): void => {
  if (!GRAPHQL_NAME.test(name)) {
    throw new Error(`Invalid GraphQL name: "${name}"`);
  }
};

type Selection = {
  name: string;
  args: Record<string, string>;
  child?: {
    readonly selections: readonly Selection[];
    render(variables: Map<string, string>): string;
  };
};

const describeArgs = (args: Record<string, string>): string =>
  Object.entries(args)
    .map(([arg, variable]) => `${arg}: $${variable}`)
    .toSorted()
    .join(", ") || "no arguments";

/** Throws if GraphQL couldn't merge duplicate fields in these selections. */
const assertMergeable = (
  path: string,
  selections: readonly Selection[],
): void => {
  const groups = Map.groupBy(selections, (selection) => selection.name);
  for (const [name, group] of groups) {
    const fieldPath = `${path}.${name}`;
    const variants = new Set(group.map(({ args }) => describeArgs(args)));
    if (variants.size > 1) {
      throw new Error(
        `Conflicting arguments for ${fieldPath}: ${[...variants].join(" and ")}`,
      );
    }
    assertMergeable(
      fieldPath,
      group.flatMap(({ child }) => child?.selections ?? []),
    );
  }
};

class SelectionBuilder<T, R = unknown> {
  declare readonly [resultType]?: R;
  // Keeps builders for different types from being assignable to each other.
  declare readonly [selectionType]?: (selected: T) => T;

  readonly #typeName: string;
  readonly #operationName: string | undefined;
  readonly #selections: Selection[] = [];

  constructor(typeName: string, operationName?: string) {
    this.#typeName = typeName;
    this.#operationName = operationName;
  }

  /** Selects leaf fields: scalars, enums and lists of them. */
  select<K extends LeafKeys<T>>(
    ...names: K[]
  ): SelectionBuilder<T, R & Pick<T, K>> {
    for (const name of names) {
      this.#selections.push({ name, args: {} });
    }
    return this as unknown as SelectionBuilder<T, R & Pick<T, K>>;
  }

  /** Selects an object field, with its arguments bound to variable names. */
  field<K extends KeysWithoutRequiredArgs<T> & keyof T, S>(
    name: K,
    selector: Selector<T, K, S>,
  ): SelectionBuilder<T, R & FieldResult<T, K, S>>;
  field<K extends ObjectKeys<T> & keyof T, S>(
    name: K,
    args: ArgBindings<ArgsOf<T, K>>,
    selector: Selector<T, K, S>,
  ): SelectionBuilder<T, R & FieldResult<T, K, S>>;
  field<U>(
    name: string,
    argsOrSelector: Record<string, string> | AnySelector<U>,
    maybeSelector?: AnySelector<U>,
  ): unknown {
    const [args, selector] =
      typeof argsOrSelector === "function"
        ? [{}, argsOrSelector]
        : [argsOrSelector, maybeSelector];
    const meta = FIELD_META[this.#typeName]?.[name];
    if (meta === undefined || selector === undefined) {
      throw new Error(`Unknown field: ${this.#typeName}.${name}`);
    }
    const child = selector(new SelectionBuilder<U>(meta.type));
    this.#selections.push({ name, args, child });
    return this;
  }

  /** Available on the root selection only, which is what `QueryBuilder` is. */
  build(this: SelectionBuilder<Query, R>): AniListQuery<Simplify<R>> {
    const name = this.#operationName ?? "";
    assertName(name);
    const variables = new Map<string, string>();
    const body = this.render(variables);
    assertMergeable(this.#typeName, this.#selections);
    const declarations = [...variables].map(
      ([variable, type]) => `$${variable}: ${type}`,
    );
    const signature =
      declarations.length > 0 ? `(${declarations.join(", ")})` : "";
    return `query ${name}${signature} ${body}`;
  }

  get selections(): readonly Selection[] {
    return this.#selections;
  }

  /** Renders the selection set, recording each variable's GraphQL type. */
  render(variables: Map<string, string>): string {
    if (this.#selections.length === 0) {
      throw new Error(`Empty selection on ${this.#typeName}`);
    }
    const parts = this.#selections.map(({ name, args, child }) => {
      const bindings = Object.entries(args).map(([arg, variable]) => {
        const type = FIELD_META[this.#typeName]?.[name]?.args[arg];
        if (type === undefined) {
          throw new Error(`Unknown argument: ${this.#typeName}.${name}(${arg})`);
        }
        assertName(variable);
        const declared = variables.get(variable);
        if (declared !== undefined && declared !== type) {
          throw new Error(
            `Variable "${variable}" is bound to both ${declared} and ${type}`,
          );
        }
        variables.set(variable, type);
        return `${arg}: $${variable}`;
      });
      const argList = bindings.length > 0 ? `(${bindings.join(", ")})` : "";
      const body = child === undefined ? "" : ` ${child.render(variables)}`;
      return `${name}${argList}${body}`;
    });
    return `{ ${parts.join(" ")} }`;
  }
}

type AnySelector<T> = (
  selection: SelectionBuilder<T>,
) => SelectionBuilder<T, unknown>;

export class QueryBuilder extends SelectionBuilder<Query> {
  constructor(name: string) {
    super("Query", name);
  }
}

type VariableValue =
  | string
  | number
  | boolean
  | null
  | readonly VariableValue[];

export class VariablesBuilder {
  readonly #values = new Map<string, VariableValue>();

  set(key: string, value: VariableValue): this {
    this.#values.set(key, value);
    return this;
  }

  build(): string {
    return JSON.stringify(Object.fromEntries(this.#values));
  }
}

const ANILIST_URL = "https://graphql.anilist.co";

export type AniListErrorDetail = { message: string };

type AniListErrorOptions = {
  status?: number | undefined;
  errors?: readonly AniListErrorDetail[] | undefined;
  retryAfter?: number | undefined;
  cause?: unknown;
};

export class AniListError extends Error {
  readonly status: number | undefined;
  readonly errors: readonly AniListErrorDetail[];
  /** Seconds to wait before retrying, when AniList has rate limited the request. */
  readonly retryAfter: number | undefined;

  constructor(message: string, options: AniListErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "AniListError";
    this.status = options.status;
    this.errors = options.errors ?? [];
    this.retryAfter = options.retryAfter;
  }
}

export type RateLimit = { maxRequests: number; windowMs: number };

/** AniList's current limit. Change it here if AniList changes theirs. */
export const DEFAULT_RATE_LIMIT: Readonly<RateLimit> = {
  maxRequests: 30,
  windowMs: 60_000,
};

const formatSeconds = (seconds: number): string =>
  `${seconds} ${seconds === 1 ? "second" : "seconds"}`;

class RateLimiter {
  readonly #limit: Readonly<RateLimit>;
  #requestTimes: number[] = [];
  #blockedUntil = 0;

  constructor(limit: Readonly<RateLimit>) {
    this.#limit = limit;
  }

  get limit(): Readonly<RateLimit> {
    return this.#limit;
  }

  /** Records a request, or throws if it would go over the limit. */
  acquire(): void {
    const now = Date.now();
    const { maxRequests, windowMs } = this.#limit;
    this.#requestTimes = this.#requestTimes.filter(
      (time) => time > now - windowMs,
    );

    if (this.#blockedUntil > now) {
      throw this.#limitError(
        "AniList rate limit reached",
        this.#blockedUntil - now,
      );
    }
    const [oldest] = this.#requestTimes;
    if (oldest !== undefined && this.#requestTimes.length >= maxRequests) {
      throw this.#limitError(
        `AniList rate limit reached (${maxRequests} requests per ${formatSeconds(windowMs / 1000)})`,
        oldest + windowMs - now,
      );
    }
    this.#requestTimes.push(now);
  }

  /** Holds requests back for as long as AniList has asked us to wait. */
  blockFor(seconds: number): void {
    this.#blockedUntil = Math.max(
      this.#blockedUntil,
      Date.now() + seconds * 1000,
    );
  }

  #limitError(reason: string, waitMs: number): AniListError {
    const retryAfter = Math.ceil(waitMs / 1000);
    return new AniListError(
      `${reason}. Try again in ${formatSeconds(retryAfter)}.`,
      { retryAfter },
    );
  }
}

let rateLimiter = new RateLimiter(DEFAULT_RATE_LIMIT);

/**
 * Changes the request limit for this process. Settings that aren't passed keep
 * their current value, and the count of recent requests starts again.
 */
export const configureRateLimit = (settings: Partial<RateLimit>): void => {
  const limit = { ...rateLimiter.limit, ...settings };
  if (!Number.isInteger(limit.maxRequests) || limit.maxRequests < 1) {
    throw new RangeError("maxRequests must be a positive whole number");
  }
  if (!Number.isFinite(limit.windowMs) || limit.windowMs <= 0) {
    throw new RangeError("windowMs must be a positive number");
  }
  rateLimiter = new RateLimiter(limit);
};

type ResponseBody = { data: unknown; errors: AniListErrorDetail[] };

const isErrorDetail = (value: unknown): value is AniListErrorDetail =>
  typeof value === "object" &&
  value !== null &&
  "message" in value &&
  typeof value.message === "string";

const readBody = async (response: Response): Promise<ResponseBody> => {
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) {
      return { data: undefined, errors: [] };
    }
    return {
      data: "data" in body ? body.data : undefined,
      errors:
        "errors" in body && Array.isArray(body.errors)
          ? body.errors.filter(isErrorDetail)
          : [],
    };
  } catch {
    return { data: undefined, errors: [] };
  }
};

/** Reads a Retry-After header, which is either whole seconds or an HTTP date. */
const parseRetryAfter = (header: string | null): number | undefined => {
  const value = header?.trim() ?? "";
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  const retryAt = /^[A-Za-z]/.test(value) ? Date.parse(value) : Number.NaN;
  return Number.isNaN(retryAt)
    ? undefined
    : Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
};

const parseVariables = (variables: string): unknown => {
  try {
    return JSON.parse(variables);
  } catch (cause) {
    throw new AniListError("Invalid variables: expected a JSON string", {
      cause,
    });
  }
};

const send = async (query: string, variables: unknown): Promise<Response> => {
  try {
    return await fetch(ANILIST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (cause) {
    throw new AniListError("Could not reach AniList", { cause });
  }
};

/** Sends a query to AniList and returns its data, or throws `AniListError`. */
export const execute = async <R>(
  query: AniListQuery<R>,
  variables = "{}",
): Promise<R> => {
  const parsedVariables = parseVariables(variables);
  rateLimiter.acquire();
  const response = await send(query, parsedVariables);
  const { status } = response;
  const { data, errors } = await readBody(response);

  if (!response.ok || errors.length > 0 || data === undefined || data === null) {
    const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
    if (retryAfter !== undefined) {
      rateLimiter.blockFor(retryAfter);
    }
    const details = errors.map((error) => error.message).join("; ");
    const reason = details === "" ? "." : `: ${details}`;
    const hint =
      retryAfter === undefined
        ? ""
        : ` Try again in ${formatSeconds(retryAfter)}.`;
    throw new AniListError(`AniList request failed (${status})${reason}${hint}`, {
      status,
      errors,
      retryAfter,
    });
  }
  return data as R;
};
