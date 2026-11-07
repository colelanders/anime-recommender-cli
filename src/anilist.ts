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
