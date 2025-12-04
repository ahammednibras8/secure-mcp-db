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

// Helper to handle BigInt serialization
function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj === "bigint") {
    return obj.toString();
  }
  if (Array.isArray(obj)) {
    return obj.map(serializeBigInt);
  }
  if (typeof obj === "object") {
    const newObj: any = {};
    for (const key in obj) {
      newObj[key] = serializeBigInt(obj[key]);
    }
    return newObj;
  }
  return obj;
}

export async function runDbQuery(sql: string) {
  const client = await getPool().connect();

  await client.queryArray`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`;

  try {
    const result = await client.queryObject(sql);
    const rawRows = (result.rows as Array<Record<string, any>>) ?? [];

    if (rawRows.length === 0) {
      return { rows: [] };
    }

    // Serialize BigInts before any processing
    const rows = serializeBigInt(rawRows);

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
