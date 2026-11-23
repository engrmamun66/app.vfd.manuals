/**
 * Usage: npm run sessions:reset
 * Revokes ALL active sessions (every user is signed out). Rows are kept and marked revoked
 * (audit trail preserved); a running server rejects them immediately and drops live sockets within ~30s.
 */
import { openDb } from '../db/index.js';

const db = openDb();
const now = new Date().toISOString();
const r = db.prepare("UPDATE user_sessions SET revoked_at = ?, revoke_reason = 'cli_reset_all' WHERE revoked_at IS NULL").run(now);
db.prepare("INSERT INTO user_activity_logs(event_type, metadata_json) VALUES ('cli_reset_all_sessions', ?)").run(JSON.stringify({ revoked: r.changes }));
console.log(`Revoked ${r.changes} active session(s).`);
db.close();
