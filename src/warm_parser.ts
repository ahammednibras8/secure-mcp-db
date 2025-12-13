import factory from "../parser.mjs";

const Module = await factory();

const malloc = Module._malloc;
const free = Module._free;
const parseSqlRaw = Module._parse_sql;
const freeResult = Module._free_result;

export interface PgAst {
  version: number;
  stmts: Array<{
    stmt: Record<string, any>;
    stmt_len?: number;
  }>;
}

export function parseSql(sql: string): PgAst {
  // 1. Allocate memory for query
  const len = Module.lengthBytesUTF8(sql);
  const ptr = malloc(len + 1);

  try {
    // 2. Write SQL to WASM memory
    Module.stringToUTF8(sql, ptr, len + 1);

    // 3. Call the C parser
    const resultPtr = parseSqlRaw(ptr, len);

    // 4. Read the JSON result back
    const jsonStr = Module.UTF8ToString(resultPtr);

    // 5. Cleanup result memory Immediately
    freeResult(resultPtr);

    // 6. Check for errors from our C bridge
    const result = JSON.parse(jsonStr);
    if (result.error) {
      throw new Error(`Postgres Parser Error: ${result.error}`);
    }

    return result as PgAst;
  } finally {
    // 7. Always free the input buffer
    free(ptr);
  }
}
