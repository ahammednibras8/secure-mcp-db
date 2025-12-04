# Secure MCP Database Bridge (Zero Trust)

> **"The only secure AI is one that cannot see what it doesn't need to see."**

This project is a **reference implementation** of a Zero Trust Data Gateway for
Large Language Models (LLMs). It bridges the gap between the chaotic,
non-deterministic nature of AI agents and the rigid, security-critical
requirements of enterprise databases.

It is **not** a wrapper. It is an **airgap**.

---

## 🏗 Architecture: The "Airgap" Middleware

Most "AI Database" tools are reckless. They give the LLM a connection string and
hope for the best. This project takes the opposite approach: **Paranoia by
Design.**

We implement a strict **Middleware Layer** (`src/middleware.ts`) that intercepts
every single request from the LLM before it ever touches the database connection
pool.

### The Security Pipeline

1. **AST Parsing (Abstract Syntax Tree):** We don't use Regex. We parse the raw
   SQL into an AST using `pgsql-ast-parser`. If the AST reveals _any_ mutation
   (`INSERT`, `UPDATE`, `DROP`, `GRANT`), the query is rejected instantly. The
   database never even sees it.

2. **Schema Allowlisting (The "Need-to-Know" Principle):** The agent does not
   have `SELECT *` permissions.
   - **Config-Driven:** `config.yaml` defines exactly which tables and _which
     specific columns_ are visible.
   - **Row Filtering:** Even if the agent tries `SELECT *`, our middleware
     intercepts the result set and strips out unauthorized columns (like PII,
     internal margins, or trap columns) before passing the JSON back to the
     agent.
   - **Multi-Table Support:** We recursively traverse JOINs in the AST to ensure
     _every_ table involved is authorized.

3. **Dynamic Token Limits:** LLMs have context windows. Dumping 10,000 rows will
   crash your agent or cost you a fortune.
   - We calculate the token density of the result set in real-time.
   - We enforce a dynamic `LIMIT` based on the model's remaining context window.
   - If the result is too large, we truncate it and return a "Delivery Slip" (a
     pointer to a temporary file) instead of the raw data.

4. **Audit Logging:** Every single tool call, successful or failed, is logged to
   `audit.log` with a timestamp, actor, and justification. This is immutable
   proof of what the AI did.

---

## 🛠 Tech Stack & Decisions

- **Runtime:** [Deno](https://deno.com/) (Chosen for its secure-by-default
  permission model. Node.js is too permissive for this.)
- **Protocol:** [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
  (The emerging standard for AI connectivity.)
- **Database:** PostgreSQL 15 (The industry standard.)
- **Validation:** `zod` (Runtime type safety) + `pgsql-ast-parser` (SQL safety).

### "Dark Truths" & Trade-offs

Let's be honest about the engineering costs of this approach:

1. **Latency:** Parsing AST and filtering rows in JavaScript adds overhead. This
   is slower than a direct DB connection. **We trade milliseconds for safety.**
2. **Complexity:** Supporting `JOIN`s and aliases required implementing a custom
   AST traverser. It is complex. A native SQL engine would be robust, but we
   needed logic _outside_ the DB to be database-agnostic.
3. **The "BigInt" Problem:** JSON doesn't support 64-bit integers. PostgreSQL
   `COUNT(*)` returns a 64-bit int. We had to implement a global serializer to
   convert all `BigInt`s to strings at the API boundary. It's a hack, but it's a
   necessary one.
4. **Zero Trust is Hard:** You will find yourself fighting the middleware. "Why
   can't I query this?" Because you didn't allowlist it. Security is friction.

---

## 🚀 How to Run It

### Option A: Docker (Recommended)

We publish to GitHub Container Registry. This is the cleanest way to run.

```bash
# 1. Pull the image
docker pull ghcr.io/ahammednibras8/secure-mcp-db:latest

# 2. Run with the MCP Inspector (The "Browser" for Agents)
npx @modelcontextprotocol/inspector \
  docker run \
  -i \
  --rm \
  -e DB_HOST=host.docker.internal \
  -e DB_NAME=postgres \
  -e DB_USER=mcp_agent \
  -e DB_PASSWORD=agent123 \
  ghcr.io/ahammednibras8/secure-mcp-db:latest
```

### Option B: Local Development (Deno)

If you want to hack on the middleware itself.

1. **Start the Database:**
   ```bash
   docker-compose up -d
   ```

2. **Provision Data (The "Nuke & Pave"):** We use `faker-js` to generate a
   realistic E-Commerce dataset (10k+ rows).
   ```bash
   # This connects as Admin, drops the schema, and rebuilds it.
   deno run --allow-net --allow-read --allow-env setup_db.ts
   ```

3. **Run the Server:**
   ```bash
   deno run --allow-net --allow-read --allow-env --allow-write src/server.ts
   ```

---

## 🔮 Future Roadmap

- **RLS Integration:** Move some row-level filtering to PostgreSQL Row Level
  Security for performance.
- **Vector Search:** Add `pgvector` support to allow semantic search over
  product descriptions.
- **Kubernetes Operator:** Deploy this as a sidecar to your DB pods.

---

### Author

**Ahammed Nibras** _Building the system for the AI era._
