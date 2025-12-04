import { Client } from "postgres";
import { faker } from "https://esm.sh/@faker-js/faker@8.0.2";
import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

// Load .env.local
await load({ export: true, envPath: ".env.local" });

// 1. Deterministic Seed for Reproducable Demos
faker.seed(123);

const client = new Client({
  user: Deno.env.get("DB_ADMIN_USER") || "postgres",
  password: Deno.env.get("DB_ADMIN_PASSWORD") || "root",
  hostname: Deno.env.get("DB_HOST") || "localhost",
  port: 5432,
  database: Deno.env.get("DB_NAME") || "postgres",
});

await client.connect();

const BATCH_SIZE = 1000;
const NUM_PRODUCTS = 100;
const NUM_CUSTOMERS = 1000;
const NUM_ORDERS = 5000;

try {
  console.log("🔥 Nuke and Pave...");
  await client.queryArray`DROP SCHEMA IF EXISTS app_data CASCADE`;
  await client.queryArray`DROP ROLE IF EXISTS mcp_agent`;
  await client.queryArray`CREATE SCHEMA app_data`;

  // 2. Define Shema (The E-Commerce Giant)
  console.log("🏗️  Constructing Schema...");

  await client.queryArray`
  CREATE TABLE app_data.users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      address TEXT NOT NULL, -- PII
      loyalty_tier TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await client.queryArray`
  CREATE TABLE app_data.products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL,
      cost_price NUMERIC(10,2) NOT NULL, -- 🚩 TRAP COLUMN
      stock_level INT NOT NULL
    )
  `;

  await client.queryArray`
  CREATE TABLE app_data.orders (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES app_data.users(id),
      status TEXT NOT NULL,
      total_amount NUMERIC(10,2) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await client.queryArray`
  CREATE TABLE app_data.order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES app_data.orders(id),
      product_id INTEGER REFERENCES app_data.products(id),
      quantity INT NOT NULL,
      unit_price NUMERIC(10,2) NOT NULL
    )
  `;

  // 3. Generators & Batch Loading
  console.log(`🚀 Generating ${NUM_CUSTOMERS} Customers...`);
  const users = Array.from({ length: NUM_CUSTOMERS }).map(() => [
    faker.person.fullName(),
    faker.internet.email(),
    faker.location.streetAddress(),
    faker.helpers.arrayElement(["Bronze", "Silver", "Gold", "Platinum"]),
    faker.date.past().toISOString(),
  ]);

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);

    const values = batch.flat();
    const placeholders = batch.map((_, r) =>
      `($${r * 5 + 1}, $${r * 5 + 2}, $${r * 5 + 3}, $${r * 5 + 4}, $${
        r * 5 + 5
      })`
    ).join(",");

    await client.queryArray(
      `INSERT INTO app_data.users (name, email, address, loyalty_tier, created_at) VALUES ${placeholders}`,
      values,
    );
  }

  console.log(`🚀 Generating ${NUM_PRODUCTS} Products...`);
  const products = Array.from({ length: NUM_PRODUCTS }).map(() => {
    const price = parseFloat(faker.commerce.price({ min: 10, max: 500 }));
    const margin = faker.number.float({ min: 0.1, max: 0.5 });

    return [
      faker.commerce.productName(),
      faker.commerce.department(),
      price,
      (price * (1 - margin)).toFixed(2),
      faker.number.int({ min: 0, max: 1000 }),
    ];
  });

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    const values = batch.flat();
    const placeholders = batch.map((_, r) =>
      `($${r * 5 + 1}, $${r * 5 + 2}, $${r * 5 + 3}, $${r * 5 + 4}, $${
        r * 5 + 5
      })`
    ).join(",");
    await client.queryArray(
      `INSERT INTO app_data.products (name, category, price, cost_price, stock_level) VALUES ${placeholders}`,
      values,
    );
  }

  console.log(`🚀 Generating ${NUM_ORDERS} Orders...`);

  const orders = [];
  const orderItems = [];

  for (let i = 1; i <= NUM_ORDERS; i++) {
    const custId = faker.number.int({ min: 1, max: NUM_CUSTOMERS });
    const numItems = faker.number.int({ min: 1, max: 5 });
    let total = 0;

    for (let j = 0; j < numItems; j++) {
      const prodId = faker.number.int({ min: 1, max: NUM_PRODUCTS });
      const price = parseFloat(products[prodId - 1][2] as string);
      const qty = faker.number.int({ min: 1, max: 3 });
      total += price * qty;

      orderItems.push([i, prodId, qty, price]);
    }

    orders.push([
      custId,
      faker.helpers.arrayElement(["paid", "shipped", "delivered", "refunded"]),
      total.toFixed(2),
      faker.date.past().toISOString(),
    ]);
  }

  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    const batch = orders.slice(i, i + BATCH_SIZE);
    const values = batch.flat();
    const placeholders = batch.map((_, r) =>
      `($${r * 4 + 1}, $${r * 4 + 2}, $${r * 4 + 3}, $${r * 4 + 4})`
    ).join(",");
    await client.queryArray(
      `INSERT INTO app_data.orders (customer_id, status, total_amount, created_at) VALUES ${placeholders}`,
      values,
    );
  }

  console.log(`🚀 Generating ${orderItems.length} Order Items...`);
  for (let i = 0; i < orderItems.length; i += BATCH_SIZE) {
    const batch = orderItems.slice(i, i + BATCH_SIZE);
    const values = batch.flat();
    const placeholders = batch.map((_, r) =>
      `($${r * 4 + 1}, $${r * 4 + 2}, $${r * 4 + 3}, $${r * 4 + 4})`
    ).join(",");
    await client.queryArray(
      `INSERT INTO app_data.order_items (order_id, product_id, quantity, unit_price) VALUES ${placeholders}`,
      values,
    );
  }

  // 4. Indexes (Post-Load for Speed)
  console.log("⚡ Indexing...");
  await client.queryArray(
    `CREATE INDEX idx_orders_cust ON app_data.orders(customer_id)`,
  );
  await client.queryArray(
    `CREATE INDEX idx_items_order ON app_data.order_items(order_id)`,
  );
  await client.queryArray(
    `CREATE INDEX idx_products_cat ON app_data.products(category)`,
  );

  // 5. Provision Least-Privilege User
  console.log("👮 Creating Agent Identity...");
  const agentUser = Deno.env.get("DB_USER") || "mcp_agent";
  const agentPassword = Deno.env.get("DB_PASSWORD") || "agent123";

  await client.queryArray(
    `CREATE USER ${agentUser} WITH PASSWORD '${agentPassword}'`,
  );
  await client.queryArray(`GRANT USAGE ON SCHEMA app_data TO ${agentUser}`);
  await client.queryArray(
    `GRANT SELECT ON ALL TABLES IN SCHEMA app_data TO ${agentUser}`,
  );

  await client.queryArray(
    `ALTER ROLE ${agentUser} SET search_path = app_data, public`,
  );

  console.log("✅ Database Provisioned Successfully!");
} catch (e) {
  console.error(e);
} finally {
  await client.end();
}
