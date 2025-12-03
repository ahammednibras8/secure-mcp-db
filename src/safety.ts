import * as YAML from "https://deno.land/std@0.224.0/yaml/mod.ts";

export interface ColumnInfo {
  name: string;
  type: string;
  description: string;
}

export interface AllowlistConfig {
  [schema: string]: {
    [table: string]: {
      safe_columns: Record<string, { description: string }>;
    };
  };
}

export function getSafeSchema(
  allowedColumns: Record<string, { description: string }>,
  dbSchema: Array<{ name: string; type: string }>,
): ColumnInfo[] {
  const safeSchema: ColumnInfo[] = [];

  const dbMap = new Map(
    dbSchema.map((col) => [col.name, col.type]),
  );

  for (const [colName, meta] of Object.entries(allowedColumns)) {
    const colType = dbMap.get(colName);

    if (!colType) continue;

    safeSchema.push({
      name: colName,
      type: colType,
      description: meta.description,
    });
  }

  return safeSchema;
}

export async function loadConfig(): Promise<AllowlistConfig> {
  const raw = await Deno.readTextFile("./config.yaml");
  const parsed = YAML.parse(raw) as { allowlist: AllowlistConfig };

  if (!parsed || !parsed.allowlist) {
    throw new Error("Invalid config.yaml: missing 'allowlist' root key.");
  }

  return parsed.allowlist;
}
