# Build Stage
FROM denoland/deno:2.5.6 AS builder

WORKDIR /app

COPY deno.json deno.lock ./
COPY main.ts ./
COPY src ./src
COPY parser.mjs parser.wasm ./
COPY config.yaml ./

# Compile to a standalone binary
# Use --no-check to bypass TS errors in generated Emscripten code
RUN deno compile --allow-net --allow-read --allow-write --allow-env --no-check --output server main.ts

# Runtime Stage
# Use distroless/cc (contains libc) for minimal size (~30MB base)
FROM gcr.io/distroless/cc-debian12

WORKDIR /app

# Copy the binary and necessary assets
COPY --from=builder /app/server ./server
COPY --from=builder /app/parser.wasm ./parser.wasm
COPY --from=builder /app/parser.mjs ./parser.mjs 
COPY --from=builder /app/config.yaml ./config.yaml

# Expose the server command
CMD ["./server"]