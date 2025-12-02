export interface ColumnInfo {
  name: string;
  type: string;
  description: string;
}

export function getSafeSchema(
  allowedColumns: Record<string, { description: string }>,
  dbSchema: Array<{ name: string; type: string }>,
): ColumnInfo[] {
  const safeSchema: ColumnInfo[] = [];

  const dbMap = new Map(
    dbSchema.map((col) => [col.name, col.type]),
  );

  for (const [colName, meta] of Object.entries(allowedColumns)) {
    const colType = dbMap.get(colName);

    if (!colType) continue;

    safeSchema.push({
      name: colName,
      type: colType,
      description: meta.description,
    });
  }

  return safeSchema;
}
