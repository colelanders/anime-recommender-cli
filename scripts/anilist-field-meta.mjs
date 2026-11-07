// Codegen plugin that adds what the stock TypeScript output lacks: a lookup
// from a parent type and field to its args type, and a runtime map used by the
// query builder to derive variable declarations.
import { getNamedType, isLeafType, isObjectType } from "graphql";

const capitalize = (name) => name.charAt(0).toUpperCase() + name.slice(1);

export const plugin = (schema) => {
  const fieldArgs = [];
  const fieldMeta = {};

  const objectTypes = Object.values(schema.getTypeMap())
    .filter((type) => isObjectType(type) && !type.name.startsWith("__"))
    .toSorted((a, b) => a.name.localeCompare(b.name));

  for (const type of objectTypes) {
    const fields = Object.values(type.getFields()).filter(
      (field) => !isLeafType(getNamedType(field.type)),
    );
    if (fields.length === 0) continue;

    const argsEntries = fields
      .filter((field) => field.args.length > 0)
      .map(
        (field) =>
          `    ${field.name}: ${type.name}${capitalize(field.name)}Args;`,
      );
    if (argsEntries.length > 0) {
      fieldArgs.push(`  ${type.name}: {\n${argsEntries.join("\n")}\n  };`);
    }

    fieldMeta[type.name] = Object.fromEntries(
      fields.map((field) => [
        field.name,
        {
          type: getNamedType(field.type).name,
          args: Object.fromEntries(
            field.args.map((arg) => [arg.name, String(arg.type)]),
          ),
        },
      ]),
    );
  }

  return [
    `export type FieldArgs = {\n${fieldArgs.join("\n")}\n};`,
    `export const FIELD_META: Record<string, Record<string, { type: string; args: Record<string, string> }>> = ${JSON.stringify(fieldMeta, null, 2)};`,
  ].join("\n\n");
};
