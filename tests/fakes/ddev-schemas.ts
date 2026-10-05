/**
 * Input schemas of Zoer's DDEV runtime operations, copied from Zoer
 * `backend/src/connectors/ddev.ts` (EXPORT_CREATE_INPUT_SCHEMA, EXPORT_STEP_INPUT_SCHEMA,
 * EXPORT_CHUNK_INPUT_SCHEMA, EXPORT_CANCEL_INPUT_SCHEMA). Zoer checks `runtime.invoke` args
 * against them before the bridge sees anything (`runtime-operations.ts`: "Runtime operation args
 * are invalid: …", code `invalid_request`). Keep in sync when the connector changes.
 */
const EXPORT_ID = "^[a-f0-9]{32}$";
export const EXPORT_CREATE_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["clientId"],
  properties: {
    clientId: { type: "string", pattern: EXPORT_ID },
    sourceUrl: { type: "string", minLength: 8, maxLength: 2048, pattern: "^https?://[^\\s]+$" },
    profile: { type: "object" },
    database: { type: "object" },
  },
};
export const EXPORT_STEP_INPUT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["exportId"],
  properties: { exportId: { type: "string", pattern: EXPORT_ID } },
};
export const EXPORT_CHUNK_INPUT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["exportId", "index", "offset"],
  properties: {
    exportId: { type: "string", pattern: EXPORT_ID },
    index: { type: "integer", minimum: 0, maximum: 100000 },
    offset: { type: "integer", minimum: 0, maximum: 4294967296 },
  },
};
export const EXPORT_CANCEL_INPUT_SCHEMA = EXPORT_STEP_INPUT_SCHEMA;

export const DDEV_OPERATION_SCHEMAS: Record<string, unknown> = {
  "export.create.v1": EXPORT_CREATE_INPUT_SCHEMA,
  "export.step.v1": EXPORT_STEP_INPUT_SCHEMA,
  "export.chunk.v1": EXPORT_CHUNK_INPUT_SCHEMA,
  "export.cancel.v1": EXPORT_CANCEL_INPUT_SCHEMA,
};

const typeOf = (value: unknown) => value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
const matches = (type: string, value: unknown) => type === "number" ? typeof value === "number" : type === "integer" ? Number.isInteger(value) : typeOf(value) === type;

/** The subset of JSON Schema these schemas use; issues read like Zoer's (`/database must be object`). */
export function schemaIssues(schema: any, value: unknown, path = ""): string[] {
  const at = path || "/";
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some((type: string) => matches(type, value))) return [`${at} must be ${[schema.type].flat().join(" or ")}`];
  const issues: string[] = [];
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) issues.push(`${at} must be at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push(`${at} must be at most ${schema.maxLength} characters`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) issues.push(`${at} must match pattern "${schema.pattern}"`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push(`${at} must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) issues.push(`${at} must be <= ${schema.maximum}`);
  }
  if (typeOf(value) === "object") {
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in object)) issues.push(`${at} must have required property '${key}'`);
    for (const [key, child] of Object.entries(object)) {
      const property = schema.properties?.[key];
      if (property) issues.push(...schemaIssues(property, child, `${path}/${key}`));
      else if (schema.additionalProperties === false) issues.push(`${at} must NOT have additional property '${key}'`);
    }
  }
  return issues;
}
