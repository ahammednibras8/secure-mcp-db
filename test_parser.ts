import factory from "./parser.mjs";

const Module = await factory();

const malloc = Module._malloc;
const free = Module._free;
const parseSql = Module._parse_sql;
const freeResult = Module._free_result;

function writeString(sql: string): { ptr: number; len: number } {
  const len = Module.lengthBytesUTF8(sql);
  const ptr = malloc(len + 1);

  Module.stringToUTF8(sql, ptr, len + 1);
  return { ptr, len };
}

function readCString(ptr: number): string {
  return Module.UTF8ToString(ptr);
}

const sql = "SELECT id, name FROM app_data.users LIMIT 5;";

console.log("SQL:", sql);

const { ptr, len } = writeString(sql);

const resultPtr = parseSql(ptr, len);

const json = readCString(resultPtr);

console.log("Parsed JSON:");
console.log(json);

free(ptr);
freeResult(resultPtr);

console.log("Done.");
