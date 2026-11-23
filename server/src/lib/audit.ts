import { getDb } from '../db/index.js';
import { json } from './util.js';

export function logActivity(e: {
  userId?: number | null;
  actorUserId?: number | null;
  event: string;
  entityType?: string | null;
  entityId?: number | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
}) {
  // Never put secrets in meta (passwords, tokens, cookies).
  getDb()
    .prepare(
      `INSERT INTO user_activity_logs(user_id, actor_user_id, event_type, entity_type, entity_id, metadata_json, ip)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(e.userId ?? null, e.actorUserId ?? e.userId ?? null, e.event, e.entityType ?? null, e.entityId ?? null, e.meta ? json(e.meta) : null, e.ip ?? null);
}

export function audit(e: {
  entityType: string;
  entityId?: number | null;
  operation: string;
  previous?: unknown;
  next?: unknown;
  source?: string;
  importJobId?: number | null;
  userId?: number | null;
  approval?: string | null;
}) {
  getDb()
    .prepare(
      `INSERT INTO audit_log(entity_type, entity_id, operation, previous_json, new_json, source, import_job_id, user_id, approval_status)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(e.entityType, e.entityId ?? null, e.operation, json(e.previous), json(e.next), e.source ?? null, e.importJobId ?? null, e.userId ?? null, e.approval ?? null);
}
