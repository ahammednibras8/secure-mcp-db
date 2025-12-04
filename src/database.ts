import { Pool } from "postgres";
import { computeDynamicRowLimit } from "./safety.ts";

let pool: Pool | null = null;

function getEnvOrThrow(key: string): string {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool(
      {
        database: getEnvOrThrow("DB_NAME"),
        hostname: getEnvOrThrow("DB_HOST"),
        port: 5432,

        user: getEnvOrThrow("DB_USER"),
        password: getEnvOrThrow("DB_PASSWORD"),
      },
      10,
    );
  }
  return pool;
}

export async function runDbQuery(sql: string) {
  const client = await getPool().connect();

  await client.queryArray`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`;

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
