import { parse } from "pgsql-ast-parser";
import { DB } from "https://deno.land/x/sqlite/mod.ts";
import {
  computeDynamicRowLimit,
  filterRows,
  identifySchema,
  loadConfig,
} from "./safety.ts";

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
export async function validatedSQL(
  sql: string,
  mode: "artifact" | "db",
): Promise<{
  ok: boolean;
  error?: string;
  hint?: string;
}> {
  // 1. Forbidden keywords
  for (const word of FORBIDDEN_KEYWORDS) {
    if (sql.toUpperCase().includes(word)) {
      return {
        ok: false,
        error: `Forbidden SQL keyword detected: ${word}`,
        hint: "Only SELECT queries are allowed",
      };
    }
  }

  // 2. Parse AST
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

  // ARTIFACT MODE RESTRICTIONS
  if (mode === "artifact") {
    const table = stmt.form?.[0]?.name?.name;
    if (table !== "artifact") {
      return {
        ok: false,
        error: "Artifact queries must reference only 'artifact'",
        hint: "Remove references to other tables",
      };
    }
  }

  // DB MODE
  if (mode === "db") {
    if (stmt.from && stmt.from?.[0]?.joins) {
      for (const join of stmt.from[0].joins) {
        if (!join.on) {
          return {
            ok: false,
            error: "JOIN without ON clause",
            hint: "Add an ON condition to every JOIN",
          };
        }
      }
    }
  }

  // Limit rule applies to BOTH modes
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

  return { ok: true };
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
