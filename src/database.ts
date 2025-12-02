import { Pool } from "https://deno.land/x/postgres@v0.19.5/mod.ts";

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

export default pool;
