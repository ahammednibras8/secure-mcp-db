import { Pool } from "https://deno.land/x/postgres@v0.19.5/mod.ts";
import { computeDynamicRowLimit } from "./safety.ts";

const pool = new Pool(
  {
    database: Deno.env.get("DB_NAME"),
    hostname: Deno.env.get("DB_HOST"),
    port: 5432,

    user: Deno.env.get("DB_USER") ?? "mcp_agent",
    password: Deno.env.get("DB_PASSWORD"),

    tls: { enabled: false },
  },
  10,
);

export async function runDbQuery(sql: string) {
  const client = await pool.connect();
  try {
    const result = await client.queryObject(sql);
    const rows = result.rows as Array<Record<string, any>>;

    if (rows.length === 0) return { rows: 0, data: [0] };

    const sampleRow = rows[0];
    const dynamicLimit = computeDynamicRowLimit(sampleRow);

    if (rows.length > dynamicLimit) {
      return {
        error: "Result exceeds token-safe row limit",
        rows_returned: rows.length,
        allowed_rows: dynamicLimit,
        hint: "Add a tighter LIMIT clause to your SQL query.",
      };
    }

    return rows;
  } finally {
    client.release();
  }
}

export default pool;
