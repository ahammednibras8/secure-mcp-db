import { parse } from "pgsql-ast-parser";
import { DB } from "https://deno.land/x/sqlite/mod.ts";
import { filterRows, identifySchema, loadConfig } from "./safety.ts";

const config = await loadConfig();

const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "TRUNCATE",
  "ATTACH",
  "COPY",
  "VACUUM",
  "ANALYZE",
  "GRANT",
  "REINDEX",
];

// 1. SQL VALIDATION (AST + rule engine)
export async function validatedSQL(sql: string): Promise<{
  ok: boolean;
  error?: string;
  hint?: string;
}> {
  for (const word of FORBIDDEN_KEYWORDS) {
    if (sql.toUpperCase().includes(word)) {
      return {
        ok: false,
        error: `Forbidden SQL keyword detected: ${word}`,
        hint: "Only SELECT queries are allowed",
      };
    }
  }

  let ast;
  try {
    ast = parse(sql);
  } catch (e) {
    return {
      ok: false,
      error: "Invalid SQL syntax",
      hint: String(e),
    };
  }

  if (ast.length !== 1 || ast[0].type !== "select") {
    return {
      ok: false,
      error: "Only a single SELECT query is allowed",
      hint: "Split your logic into multiple queries",
    };
  }

  const stmt = ast[0] as any;

  const fromTable = (stmt.from?.[0] as any)?.name?.name;
  if (fromTable !== "artifact") {
    return {
      ok: false,
      error: "Query must reference only the 'artifact' table",
      hint: "Remove references to other tables",
    };
  }

  const isAggregate =
    stmt.columns?.some((col: any) => col.expr?.type === "call") ??
      false;

  if (!isAggregate && !stmt.limit) {
    return {
      ok: false,
      error: "Query must include a LIMIT clause",
      hint: "Add LIMIT 100 or similar",
    };
  }

  if (stmt.from && stmt.from.length > 1) {
    return {
      ok: false,
      error: "Implicit JOINs are not allowed",
      hint: "Use explicit JOIN ... ON syntax",
    };
  }

  if ((stmt.from?.[0] as any)?.joins) {
    for (const j of (stmt.from?.[0] as any).joins) {
      if (!j.on) {
        return {
          ok: false,
          error: "JOIN without ON clause",
          hint: "Add ON to all JOIN statements",
        };
      }
    }
  }

  return { ok: true };
}

// 2. TOKEN-AWARE SAFETY (dynamic row limit)
function estimateTokensForRow(row: Record<string, any>): number {
  let total = 0;

  for (const value of Object.values(row)) {
    if (value === null || value === undefined) continue;
    const text = String(value);
    total += Math.ceil(text.length / 4);
  }
  return total;
}

function computeDynamicRowLimit(
  sampleRow: Record<string, any>,
  modelTokenLimit = 128_000,
): number {
  const tokensPerRow = estimateTokensForRow(sampleRow);
  const reserved = Math.floor(modelTokenLimit * 0.20);
  const available = modelTokenLimit - reserved;
  const maxRows = Math.floor(available / tokensPerRow);
  return Math.max(1, maxRows);
}

// 3. CSV into SQLite Loader
function loadCsvIntoSQLite(filePath: string): DB {
  const csv = Deno.readTextFileSync(filePath).trim();
  const [headerLine, ...lines] = csv.split("\n");
  const columns = headerLine.split(",");

  const db = new DB();
  db.execute(
    `CREATE TABLE artifact (${columns.map((c) => `"${c}" TEXT`).join(",")});`,
  );

  const insert = db.prepareQuery(
    `INSERT INTO artifact VALUES (${columns.map(() => "?").join(",")})`,
  );

  for (const line of lines) {
    insert.execute(line.split(","));
  }

  insert.finalize();
  return db;
}

// 4. Execute Validate SQL (Artifacts Only)
export async function executeAnalysisQuery(params: {
  file_id: string;
  sql_query: string;
}) {
  const { file_id, sql_query } = params;

  const filePath = `/tmp/artifacts/${file_id}`;

  try {
    await Deno.stat(filePath);
  } catch {
    return {
      error: "Artifact not found",
      hint: "Invalid file_id",
    };
  }

  const db = loadCsvIntoSQLite(filePath);

  const rows = db.queryEntries(sql_query);

  // 1. get headers (prefer runtime row, fallback to CSV header)
  let headers: string[] = [];
  if (rows.length > 0) {
    headers = Object.keys(rows[0]);
  } else {
    const csv = Deno.readTextFileSync(filePath).trim();
    const [headerLine] = csv.split("\n");
    headers = headerLine.split(",");
  }

  // 2. normalize headers
  headers = headers.map((h) => h.trim().toLowerCase());

  // 3. run schema fingerprint
  const matchedTable = identifySchema(headers, config);

  if (!matchedTable) {
    return {
      error:
        "Schema identification failed: uploaded file headers do not strictly match any allowlist table.",
      hint:
        "Ensure the CSV headers are an exact subset of a configured table's safe_columns.",
    };
  }

  // 4. pick the allowlist for that table
  let allowedColumns: Record<string, { description: string }> | null = null;
  for (const schemaObj of Object.values(config)) {
    if (schemaObj[matchedTable]) {
      allowedColumns = schemaObj[matchedTable].safe_columns;
      break;
    }
  }
  if (!allowedColumns) {
    return {
      error: "Internal error: matched table found but allowlist lookup failed.",
    };
  }

  // 5. filter rows using the allowlist
  const cleaned = filterRows(rows, config.app_data.users.safe_columns);

  return {
    rows: cleaned.length,
    data: cleaned,
  };
}
