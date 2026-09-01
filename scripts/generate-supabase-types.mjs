import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const OUTPUT_PATH = path.join(process.cwd(), "src/lib/supabase/database.types.ts");
const CHECK_MODE = process.argv.includes("--check");

const readLocalEnvironment = () => {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    return {};
  }

  return Object.fromEntries(
    fs
      .readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        const value = line
          .slice(separator + 1)
          .trim()
          .replace(/^(['"])(.*)\1$/, "$2");
        return [key, value];
      })
  );
};

const localEnvironment = readLocalEnvironment();
const requiredEnvironment = (key) => {
  const value = process.env[key]?.trim() || localEnvironment[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required to generate the Supabase database contract.`);
  }
  return value;
};

const schemaType = (schema) => {
  if (!schema || typeof schema !== "object") {
    return "Json";
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  }
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.split("/").at(-1);
    return name
      ? `Database["public"]["Tables"][${JSON.stringify(name)}]["Row"]`
      : "Json";
  }
  if (schema.type === "array") {
    return `${schemaType(schema.items)}[]`;
  }
  if (schema.format === "json" || schema.format === "jsonb") {
    return "Json";
  }
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.type === "string") return "string";
  return "Json";
};

const hasDefault = (schema) => Object.prototype.hasOwnProperty.call(schema, "default");
const isGeneratedIntegerPrimaryKey = (schema) =>
  schema?.type === "integer" && /Primary Key/.test(schema?.description ?? "");

const propertyLines = (definition, mode) => {
  const required = new Set(definition.required ?? []);
  return Object.entries(definition.properties ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, schema]) => {
      const nullable = !required.has(name);
      const optional =
        mode === "Update" ||
        (mode === "Insert" && (nullable || hasDefault(schema) || isGeneratedIntegerPrimaryKey(schema)));
      const type = `${schemaType(schema)}${nullable ? " | null" : ""}`;
      return `          ${JSON.stringify(name)}${optional ? "?" : ""}: ${type}`;
    });
};

const relationshipsFor = (tableName, definition) =>
  Object.entries(definition.properties ?? {})
    .flatMap(([column, schema]) => {
      const description = schema.description ?? "";
      const match = description.match(/Foreign Key to `([^.`]+)\.([^`]+)`/);
      if (!match) return [];

      return [
        {
          columns: [column],
          foreignKeyName: `${tableName}_${column}_fkey`,
          isOneToOne: /Primary Key/.test(description),
          referencedColumns: [match[2]],
          referencedRelation: match[1]
        }
      ];
    })
    .sort((left, right) => left.foreignKeyName.localeCompare(right.foreignKeyName));

const renderRelationships = (relationships) => {
  if (relationships.length === 0) {
    return ["        Relationships: []"];
  }

  return [
    "        Relationships: [",
    ...relationships.flatMap((relationship) => [
      "          {",
      `            foreignKeyName: ${JSON.stringify(relationship.foreignKeyName)}`,
      `            columns: [${relationship.columns.map((value) => JSON.stringify(value)).join(", ")}]`,
      `            isOneToOne: ${relationship.isOneToOne}`,
      `            referencedRelation: ${JSON.stringify(relationship.referencedRelation)}`,
      `            referencedColumns: [${relationship.referencedColumns.map((value) => JSON.stringify(value)).join(", ")}]`,
      "          },"
    ]),
    "        ]"
  ];
};

const rpcBodySchema = (pathDefinition) => {
  const parameters = pathDefinition?.post?.parameters ?? [];
  return parameters.find((parameter) => parameter?.in === "body" && parameter?.name === "args")
    ?.schema ?? { properties: {}, required: [], type: "object" };
};

const rpcReturnSchema = (pathDefinition) =>
  pathDefinition?.post?.responses?.["200"]?.schema ?? {};

const stableContract = (document) => ({
  definitions: Object.fromEntries(
    Object.entries(document.definitions ?? {}).sort(([left], [right]) => left.localeCompare(right))
  ),
  rpcPaths: Object.fromEntries(
    Object.entries(document.paths ?? {})
      .filter(([route]) => route.startsWith("/rpc/"))
      .sort(([left], [right]) => left.localeCompare(right))
  )
});

const renderDatabaseTypes = (document) => {
  const contract = stableContract(document);
  const contractHash = createHash("sha256")
    .update(JSON.stringify(contract))
    .digest("hex");
  const tableEntries = Object.entries(contract.definitions);
  const functionEntries = Object.entries(contract.rpcPaths).map(([route, definition]) => ({
    args: rpcBodySchema(definition),
    name: route.replace("/rpc/", ""),
    returns: rpcReturnSchema(definition)
  }));

  const lines = [
    "// Generated by `npm run db:types` from the deployed Supabase PostgREST contract.",
    "// Do not edit this file manually.",
    `// Contract SHA-256: ${contractHash}`,
    "",
    "export type Json =",
    "  | string",
    "  | number",
    "  | boolean",
    "  | null",
    "  | { [key: string]: Json | undefined }",
    "  | Json[];",
    "",
    "export type Database = {",
    "  public: {",
    "    Tables: {"
  ];

  tableEntries.forEach(([tableName, definition]) => {
    lines.push(`      ${JSON.stringify(tableName)}: {`);
    ["Row", "Insert", "Update"].forEach((mode) => {
      lines.push(`        ${mode}: {`);
      lines.push(...propertyLines(definition, mode));
      lines.push("        }");
    });
    lines.push(...renderRelationships(relationshipsFor(tableName, definition)));
    lines.push("      }");
  });

  lines.push("    }");
  lines.push("    Views: { [_ in never]: never }");
  lines.push("    Functions: {");
  functionEntries.forEach(({ args, name, returns }) => {
    lines.push(`      ${JSON.stringify(name)}: {`);
    lines.push("        Args: {");
    const argsLines = propertyLines(args, "Insert");
    lines.push(...(argsLines.length > 0 ? argsLines : ["          [_ in never]: never"]));
    lines.push("        }");
    lines.push(`        Returns: ${schemaType(returns)}`);
    lines.push("      }");
  });
  lines.push("    }");
  lines.push("    Enums: { [_ in never]: never }");
  lines.push("    CompositeTypes: { [_ in never]: never }");
  lines.push("  }");
  lines.push("};");
  lines.push("");
  lines.push("type PublicSchema = Database[\"public\"];");
  lines.push("");
  lines.push("export type Tables<");
  lines.push("  TableName extends keyof PublicSchema[\"Tables\"]");
  lines.push("> = PublicSchema[\"Tables\"][TableName][\"Row\"];");
  lines.push("");
  lines.push("export type TablesInsert<");
  lines.push("  TableName extends keyof PublicSchema[\"Tables\"]");
  lines.push("> = PublicSchema[\"Tables\"][TableName][\"Insert\"];");
  lines.push("");
  lines.push("export type TablesUpdate<");
  lines.push("  TableName extends keyof PublicSchema[\"Tables\"]");
  lines.push("> = PublicSchema[\"Tables\"][TableName][\"Update\"];");
  lines.push("");
  lines.push("export type FunctionArgs<");
  lines.push("  FunctionName extends keyof PublicSchema[\"Functions\"]");
  lines.push("> = PublicSchema[\"Functions\"][FunctionName][\"Args\"];");
  lines.push("");

  return `${lines.join("\n")}\n`;
};

const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
const response = await fetch(`${supabaseUrl}/rest/v1/`, {
  headers: {
    Accept: "application/openapi+json",
    Authorization: `Bearer ${serviceRoleKey}`,
    apikey: serviceRoleKey
  },
  signal: AbortSignal.timeout(20_000)
});

if (!response.ok) {
  throw new Error(`Supabase schema request failed with HTTP ${response.status}.`);
}

const document = await response.json();
if (!document || typeof document !== "object" || !document.definitions || !document.paths) {
  throw new Error("Supabase returned an invalid PostgREST schema document.");
}

const generated = renderDatabaseTypes(document);
if (CHECK_MODE) {
  const current = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, "utf8") : "";
  if (current !== generated) {
    console.error("Supabase database types are out of date. Run `npm run db:types`.");
    process.exit(1);
  }
  console.log("Supabase database types match the deployed schema.");
} else {
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, generated);
  console.log(`Generated ${path.relative(process.cwd(), OUTPUT_PATH)}.`);
}
