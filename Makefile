.PHONY: dev up down server inspector clean build-wasm help

# Default target
all: dev

# --- Development Workflow ---

# Start the database and run the MCP Inspector (Interactive Mode)
dev: up
	@echo "🚀 Starting MCP Inspector with Database..."
	npx @modelcontextprotocol/inspector deno run --env-file=.env.local -A main.ts

# Start the database and run the MCP Server (Headless/Stdio Mode)
run: up
	@echo "🤖 Starting MCP Server (Headless)..."
	deno run --env-file=.env.local -A main.ts

# --- Database Management ---

# Start PostgreSQL container and wait for it to be ready
up:
	@echo "🐘 Starting PostgreSQL..."
	docker-compose up -d --wait postgres
	@echo "✅ Database is ready!"

# Stop PostgreSQL container
down:
	@echo "🛑 Stopping PostgreSQL..."
	docker-compose down

# Tail database logs
logs:
	docker-compose logs -f postgres

# --- Build & Maintenance ---

# Compile the WASM parser from C source
build-wasm:
	@echo "🏗️  Building WASM Parser..."
	emcc bridge.c vendor/libpg_query/src/*.c \
		vendor/libpg_query/src/postgres/*.c \
		vendor/libpg_query/vendor/protobuf-c/protobuf-c.c \
		vendor/libpg_query/vendor/xxhash/xxhash.c \
		vendor/libpg_query/protobuf/pg_query.pb-c.c \
		-Ivendor/libpg_query \
		-Ivendor/libpg_query/src/postgres/include \
		-Ivendor/libpg_query/vendor \
		-Ivendor/libpg_query/src/include \
		-o parser.mjs \
		-s WASM=1 \
		-s EXPORT_ES6=1 \
		-s MODULARIZE=1 \
		-s ENVIRONMENT=node \
		-s ALLOW_MEMORY_GROWTH=1 \
		-s EXPORTED_FUNCTIONS="['_parse_sql', '_free_result', '_malloc', '_free']" \
		-s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','UTF8ToString','stringToUTF8','lengthBytesUTF8']" \
		-DPG_QUERY_NO_DEPARSE \
		&& sed -i '' 's/from "module"/from "node:module"/g' parser.mjs
	@echo "✅ Build Complete: parser.mjs & parser.wasm"

# Build the optimized Docker image
docker-build:
	@echo "🐳 Building Docker Image..."
	docker build -t secure-mcp-db:latest .

# Clean build artifacts
clean:
	rm -f parser.mjs parser.wasm

# Show help
help:
	@echo "Available commands:"
	@echo "  make dev        - Start DB and run MCP Inspector (Recommended)"
	@echo "  make run        - Start DB and run MCP Server (Headless)"
	@echo "  make up         - Start Database only"
	@echo "  make down       - Stop Database"
	@echo "  make logs       - View Database logs"
	@echo "  make build-wasm - Recompile the C parser to WASM"
