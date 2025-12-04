// setup_db.ts
import { Client } from "postgres";
import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

// Load .env.local
await load({ export: true, envPath: ".env.local" });

const client = new Client({
  user: "postgres",
  password: Deno.env.get("DB_PASSWORD")!,
  hostname: "127.0.0.1",
  port: 5432,
  database: "postgres",
});

await client.connect();

try {
  console.log("🔥 Destroying old data...");
  await client.queryArray("DROP SCHEMA IF EXISTS app_data CASCADE");

  try {
    await client.queryArray("DROP OWNED BY mcp_agent CASCADE");
  } catch (_) {}
  await client.queryArray("DROP ROLE IF EXISTS mcp_agent");

  console.log("🏗️ Building Schema...");
  await client.queryArray("CREATE SCHEMA app_data");

  await client.queryArray(`
    CREATE TABLE app_data.users (
      id SERIAL PRIMARY KEY,
      username TEXT,
      password TEXT,
      secret_token TEXT,
      last_login TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.queryArray(`
    INSERT INTO app_data.users (username, password, secret_token)
    VALUES
      ('neo', 'trinity123', 'RED_PILL'),
      ('morpheus', 'nebuchadnezzar', 'BLUE_PILL');
  `);

  console.log("👮 Creating Least-Privilege Identity...");

  // Use ENV password instead of hardcoding
  const agentPassword = Deno.env.get("MCP_AGENT_PASSWORD")!;
  await client.queryArray(
    `CREATE USER mcp_agent WITH PASSWORD '${agentPassword}'`,
  );

  await client.queryArray("GRANT USAGE ON SCHEMA app_data TO mcp_agent");
  await client.queryArray(
    "GRANT SELECT ON ALL TABLES IN SCHEMA app_data TO mcp_agent",
  );

  await client.queryArray(
    "ALTER ROLE mcp_agent SET search_path = app_data, public",
  );

  console.log("✅ Database Provisioned Successfully!");
} catch (e) {
  console.error("Setup failed:", e);
} finally {
  await client.end();
}
