import { Pool } from "postgres";
import { computeDynamicRowLimit } from "./safety.ts";

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool(
      {
        database: Deno.env.get("DB_NAME") ?? "postgres",
        hostname: Deno.env.get("DB_HOST") ?? "127.0.0.1",
        port: 5432,

        user: Deno.env.get("DB_USER") ?? "mcp_agent",
        password: Deno.env.get("DB_PASSWORD") ?? "agent123",
      },
      10,
    );
  }
  return pool;
}

export async function runDbQuery(sql: string) {
  const client = await getPool().connect();
  try {
    const result = await client.queryObject(sql);
    const rows = (result.rows as Array<Record<string, any>>) ?? [];

    if (rows.length === 0) {
      return { rows: [] };
    }

    const sampleRow = rows[0];
    const dynamicLimit = computeDynamicRowLimit(sampleRow);

    if (rows.length > dynamicLimit) {
      return {
        error: "Result exceeds token-safe row limit",
        hint:
          `Rows returned: ${rows.length}, allowed_rows: ${dynamicLimit}. Add a tighter LIMIT`,
      };
    }

    return { rows };
  } finally {
    client.release();
  }
}

export default getPool;
