export interface AuditEntry {
  actor_id: string;
  action: string;
  target: string;
  justification: string;
  timestamp: string;
}
