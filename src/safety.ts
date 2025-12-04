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

export function filterRows(
  rawRows: Array<Record<string, any>>,
  allowedColumns: Record<string, { description: string }>,
) {
  const cleanRows = [];
  // Allow common aggregate function names
  const SAFE_AGGREGATES = [
    "count",
    "sum",
    "avg",
    "min",
    "max",
    "total",
    "total_revenue",
  ];

  for (const row of rawRows) {
    const clean: Record<string, any> = {};

    for (const colName of Object.keys(row)) {
      // Allow if explicitly in allowlist OR if it's a safe aggregate
      if (colName in allowedColumns || SAFE_AGGREGATES.includes(colName)) {
        clean[colName] = row[colName];
      }
    }

    cleanRows.push(clean);
  }

  return cleanRows;
}

export function identifySchema(
  headers: string[],
  config: AllowlistConfig,
): string | null {
  let bestTable: string | null = null;
  let bestScore = 0;

  for (const [schemaName, tables] of Object.entries(config)) {
    for (const [tableName, tableDef] of Object.entries(tables)) {
      const allowedCols = Object.keys(tableDef.safe_columns);

      const score = headers.filter((h) => allowedCols.includes(h)).length;

      if (score > bestScore) {
        bestScore = score;
        bestTable = tableName;
      }
    }
  }

  if (bestScore === 0) return null;

  return bestTable;
}

// TOKEN-AWARE SAFETY (dynamic row limit)
function estimateTokensForRow(row: Record<string, any>): number {
  let total = 0;

  for (const value of Object.values(row)) {
    if (value === null || value === undefined) continue;
    const text = String(value);
    total += Math.ceil(text.length / 4);
  }
  return total;
}

export function computeDynamicRowLimit(
  sampleRow: Record<string, any>,
  modelTokenLimit = 128_000,
): number {
  const tokensPerRow = estimateTokensForRow(sampleRow);
  const reserved = Math.floor(modelTokenLimit * 0.20);
  const available = modelTokenLimit - reserved;
  const maxRows = Math.floor(available / tokensPerRow);
  return Math.max(1, maxRows);
}
