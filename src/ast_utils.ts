export function extractAllTableNames(node: any): string[] {
  const tables = new Set<string>();

  function visit(item: any, path: string = "") {
    // 1. Base Case: primitives or null
    if (!item || typeof item !== "object") {
      return;
    }

    // 2. Arrays: Iterate all elements
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }

    // 3. The "RangeVar" Detection (The Target)
    if ("RangeVar" in item) {
      const rv = item.RangeVar;

      // Defensively check shape
      if (!rv || typeof rv !== "object") {
        console.warn(
          `[Security Warning] Malformed RangeVar found at ${path}:`,
          rv,
        );
        return;
      }

      const { schemaname, relname } = rv;

      if (!relname) {
        console.warn(`[Security] RangeVar missing relname at ${path}`);
        return;
      }

      if (!schemaname) {
        throw new Error(
          `Unqualified table reference detected: "${relname}". ` +
            `Fully qualified schema.table is required.`,
        );
      }

      const fqdn = `${schemaname}.${relname}`.toLowerCase();
      tables.add(fqdn);
    }

    // 4. Generic Recursion: Check every key in the object
    for (const key of Object.keys(item)) {
      visit(item[key], path ? `${path}.${key}` : key);
    }
  }

  visit(node);
  return Array.from(tables);
}
