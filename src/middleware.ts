import { parse } from "pgsql-ast-parser";
import { DB } from "https://deno.land/x/sqlite/mod.ts";
import {
  computeDynamicRowLimit,
  filterRows,
  identifySchema,
  loadConfig,
} from "./safety.ts";
import { runDbQuery } from "./database.ts";
import { parseSql, PgAst } from "./warm_parser.ts";
import { extractAllTableNames } from "./ast_utils.ts";

const config = await loadConfig();

// 1. SQL VALIDATION (AST + rule engine)
export async function validatedSQL(
  sql: string,
  mode: "artifact" | "db",
): Promise<{
  ok: boolean;
  error?: string;
  hint?: string;
}> {
  // 1. Parse AST using Real Postgres
  let ast: PgAst;
  try {
    ast = parseSql(sql);
  } catch (e) {
    return {
      ok: false,
      error: "Invalid SQL syntax",
      hint: String(e),
    };
  }

  // 2. Multi-Statement Injection Check
  if (!ast || !Array.isArray(ast.stmts) || ast.stmts.length !== 1) {
    return {
      ok: false,
      error: "Batch queries are not allowed",
      hint: "Execute one statement at a time",
    };
  }

  const rawStmt = ast.stmts[0].stmt;

  // 3. Strict SELECT-only Enforcement
  // libpg_query wraps everything in an object key like { SelectStmt: ... }
  if (!rawStmt || !rawStmt.SelectStmt) {
    const detectedType = Object.keys(rawStmt)[0];
    return {
      ok: false,
      error: `Forbidden statement type: ${detectedType}`,
      hint: "Only SELECT queries are allowed",
    };
  }

  const selectStmt = rawStmt.SelectStmt;

  // 4. Extract all referenced table names (deep)
  let tables: string[] = [];
  try {
    tables = extractAllTableNames(selectStmt);
  } catch (e) {
    return {
      ok: false,
      error: "Failed to extract table names from AST",
      hint: String(e),
    };
  }

  // ARTIFACT MODE
  if (mode === "artifact") {
    // Traverse fromClause to check table names
    for (const t of tables) {
      if (t !== "artifact") {
        return {
          ok: false,
          error: "Artifact queries must reference only 'artifact'",
          hint: "Remove references to other tables",
        };
      }
    }
  }

  // DB MODE
  if (mode === "db") {
    const allowedTables = Object.keys(config.app_data || {});
    for (const t of tables) {
      if (!allowedTables.includes(t)) {
        return {
          ok: false,
          error: `Table '${t}' is not allowed.`,
          hint: "Query only tables defined in config.yaml allowlist.",
        };
      }
    }
  }

  // 5. Enforce LIMIT unless aggregate-only
  const isAggregate = checkForAggregates(selectStmt);
  const hasLimit = Boolean(selectStmt.limitCount || selectStmt.limitOffset);
  if (!isAggregate && !hasLimit) {
    return {
      ok: false,
      error: "Query must include a LIMIT clause",
      hint: "Add LIMIT 100 or similar",
    };
  }

  return { ok: true };
}

function checkForAggregates(selectStmt: any): boolean {
  const targets = selectStmt.targetList || [];
  for (const t of targets) {
    const val = t.ResTarget?.val;
    if (!val) continue;

    if (val?.FuncCall) return true;

    if (t.ResTarget?.name) {
      const n = String(t.ResTarget.name).toLowerCase();
      if (["count", "sum", "avg", "min", "max"].includes(n)) return true;
    }
  }

  return false;
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

  // 5. Token-aware row safety
  const sampleRow = rows[0];
  const dynamicLimit = computeDynamicRowLimit(sampleRow);

  if (rows.length > dynamicLimit) {
    const slipId = `result_${crypto.randomUUID()}.csv`;
    const slipPath = `/tmp/artifacts/${slipId}`;

    const header = Object.keys(rows[0]).join(",") + "\n";
    const body = rows.map((r) => Object.values(r).join(",")).join("\n");

    await Deno.writeTextFile(slipPath, header + body);

    return {
      delivery_slip: {
        file_id: slipId,
        rows: rows.length,
        allowed_rows: dynamicLimit,
        note:
          "Result too large to send safely. Use analyze_artifact on the slip.",
      },
    };
  }

  // 6. filter rows using the allowlist
  const cleaned = filterRows(rows, allowedColumns);

  return {
    rows: cleaned.length,
    data: cleaned,
  };
}

export async function executeSafeDbQuery(sql_query: string) {
  // 1. Parse AST to extract table name
  let ast: PgAst;
  try {
    ast = parseSql(sql_query);
  } catch (e) {
    return { error: "Invalid SQL syntax", hint: String(e) };
  }

  if (!ast || !Array.isArray(ast.stmts) || ast.stmts.length !== 1) {
    return {
      error: "Batch/multi-statement queries are not allowed",
      hint: "Execute one statement at a time",
    };
  }

  const rawStmt = ast.stmts[0].stmt;
  if (!rawStmt || !rawStmt.SelectStmt) {
    const detectedType = rawStmt ? Object.keys(rawStmt)[0] : "unknown";
    return { error: `Forbidden statement type: ${detectedType}` };
  }

  const selectStmt = rawStmt.SelectStmt;

  // 2. Deeply extract all referenced tables
  let tablesToCheck: string[] = [];
  try {
    tablesToCheck = extractAllTableNames(selectStmt);
  } catch (e) {
    return { error: "Failed to extract table names", hint: String(e) };
  }

  if (tablesToCheck.length === 0) {
    return {
      error: "Unable to determine target table from query",
      hint: "Ensure your query uses a FROM clause.",
    };
  }

  // 3. Merge allowlists from ALL tables
  let allowedColumns: Record<string, { description: string }> = {};
  let foundConfig = false;

  for (const table of tablesToCheck) {
    if (config.app_data && config.app_data[table]) {
      foundConfig = true;
      allowedColumns = {
        ...allowedColumns,
        ...config.app_data[table].safe_columns,
      };
    }
  }

  if (!foundConfig) {
    return {
      error: `No allowlist found for tables: ${tablesToCheck.join(", ")}`,
      hint: "Add these tables to config.yaml under allowlist.app_data.",
    };
  }

  // 4. Run the database query
  const dbResult = await runDbQuery(sql_query);

  if ("error" in dbResult) {
    return dbResult;
  }

  const rows = dbResult.rows;

  if (!Array.isArray(rows) || rows.length === 0) {
    return { rows: 0, data: [] };
  }

  // 5. Token-Aware row safety
  const sampleRow = rows[0];
  const dynamicLimit = computeDynamicRowLimit(sampleRow);

  if (rows.length > dynamicLimit) {
    return {
      error: "Result too large to send safely",
      rows_returned: rows.length,
      allowed_rows: dynamicLimit,
      hint: "Add LIMIT to your SQL query.",
    };
  }

  const cleaned = filterRows(rows, allowedColumns);

  return {
    rows: cleaned.length,
    data: cleaned,
  };
}
