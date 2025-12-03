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

    return (result.rows as Array<Record<string, any>>) ?? [];
  } finally {
    client.release();
  }
}

export default pool;
