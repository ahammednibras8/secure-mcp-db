export interface AuditEntry {
  actor_id: string;
  action: string;
  target: string;
  justification: string;
  timestamp: string;
}

export function logAudit(entry: Omit<AuditEntry, "timestamp">) {
  const record: AuditEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  const line = JSON.stringify(record) + "\n";

  const logPath = "./audit.log";

  try {
    Deno.writeTextFileSync(logPath, line, { append: true });
  } catch (err) {
    console.error("AUDIT_LOG_WRITE_FAILED", err);
  }

  return record;
}
