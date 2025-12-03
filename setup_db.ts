import { Client } from "postgres";

const client = new Client({
  user: "postgres",
  password: "root",
  hostname: "localhost",
  port: 5432,
  database: "postgres",
});

await client.connect();

try {
  console.log("🔥 Destroying old data...");
  await client.queryArray`DROP SCHEMA IF EXISTS app_data CASCADE`;
  try {
    await client.queryArray`DROP OWNED BY mcp_agent CASCADE`;
  } catch {
    // Ignore if role doesn't exist
  }
  await client.queryArray`DROP ROLE IF EXISTS mcp_agent`;

  console.log("Building Schema...");
  await client.queryArray`CREATE SCHEMA app_data`;

  await client
    .queryArray`CREATE TABLE app_data.users (id SERIAL PRIMARY KEY, username TEXT, password TEXT, secret_token TEXT,last_login TIMESTAMP DEFAULT NOW())`;

  await client
    .queryArray`INSERT INTO app_data.users (username, password, secret_token) VALUES ('neo', 'trinity123', 'RED_PILL'), ('morpheus', 'nebuchadnezzar', 'BLUE_PILL')`;

  console.log("Creating Least-Privilege Identity...");

  // 1. Create the user (Password is 'agent123')
  await client.queryArray`CREATE USER mcp_agent WITH PASSWORD 'agent123'`;

  // 2. Grant Acces to the Schema
  await client.queryArray`GRANT USAGE ON SCHEMA app_data TO mcp_agent`;

  // 3. Grant Access to the Tables (The File Key)
  await client
    .queryArray`GRANT SELECT ON ALL TABLES IN SCHEMA app_data TO mcp_agent`;

  // 4. Set Search Path so "SELECT * FROM users" works (instead of app_data.users)
  await client
    .queryArray`ALTER ROLE mcp_agent SET search_path = app_data, public`;

  console.log("Database Provisioned Successfully!");
} catch (e) {
  console.error("Setup failed:", e);
} finally {
  await client.end();
}
