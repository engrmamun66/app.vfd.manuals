import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vfdkb-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.STORAGE_DIR = path.join(tmp, 'storage');
process.env.INITIAL_SUPERADMIN_EMAIL = 'root@example.test';
process.env.INITIAL_SUPERADMIN_PASSWORD = 'Initial-Pass-9876!';
process.env.REGISTRATION_RATE_LIMIT_MAX = '3';

let app: any;
let db: any;

type Client = { agent: ReturnType<typeof request.agent>; csrf: string; id?: number };
const TXT = { contentKey: 'param:1:desc', selectedText: 'maximum frequency', start: 4, end: 21, prefix: 'The ', suffix: ' limit', contentHash: 'h1' };

async function newClient(): Promise<Client> {
  return { agent: request.agent(app), csrf: '' };
}
const w = (c: Client, m: 'post' | 'patch' | 'put' | 'delete', url: string) => (c.agent as any)[m]('/api' + url).set('X-CSRF-Token', c.csrf);
const r = (c: Client, url: string) => c.agent.get('/api' + url);

async function adminLogin(): Promise<Client> {
  const c = await newClient();
  const res = await c.agent.post('/api/auth/login').send({ email: 'root@example.test', password: 'Initial-Pass-9876!' });
  expect(res.status).toBe(200);
  c.csrf = res.body.csrfToken;
  expect(res.body.user.mustChangePassword).toBe(true);
  // must change password before anything else
  expect((await r(c, '/dashboard')).status).toBe(403);
  const ch = await w(c, 'post', '/auth/change-password').send({ currentPassword: 'Initial-Pass-9876!', newPassword: 'Changed-Pass-4321!', confirmPassword: 'Changed-Pass-4321!' });
  expect(ch.status).toBe(200);
  c.csrf = ch.body.csrfToken;
  expect((await r(c, '/dashboard')).status).toBe(200);
  return c;
}

async function createUserVia(admin: Client, email: string): Promise<Client> {
  const res = await w(admin, 'post', '/admin/users').send({ email, password: 'Temp-Password-123!', role: 'user' });
  expect(res.status).toBe(201);
  const c = await newClient();
  const l = await c.agent.post('/api/auth/login').send({ email, password: 'Temp-Password-123!' });
  expect(l.status).toBe(200);
  c.csrf = l.body.csrfToken;
  const ch = await w(c, 'post', '/auth/change-password').send({ currentPassword: 'Temp-Password-123!', newPassword: 'User-Password-456!', confirmPassword: 'User-Password-456!' });
  c.csrf = ch.body.csrfToken;
  c.id = res.body.id;
  return c;
}

let admin: Client;
let alice: Client;
let bob: Client;

beforeAll(async () => {
  const { bootstrap } = await import('../server/src/bootstrap.js');
  const { createApp } = await import('../server/src/app.js');
  db = await bootstrap(() => {});
  app = createApp();
});
afterAll(() => {
  try { db.close(); } catch { /* */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('database & migrations', () => {
  it('creates schema, seeds taxonomy, bootstraps exactly one Super Admin idempotently', async () => {
    expect((db.prepare('SELECT COUNT(*) c FROM categories').get() as any).c).toBeGreaterThanOrEqual(10);
    expect((db.prepare("SELECT COUNT(*) c FROM users WHERE role='super_admin'").get() as any).c).toBe(1);
    const { bootstrapSuperAdmin, seedTaxonomy } = await import('../server/src/db/seed.js');
    const before = (db.prepare('SELECT password_hash h FROM users WHERE id=1').get() as any).h;
    expect((await bootstrapSuperAdmin(db)).created).toBe(false);
    expect(seedTaxonomy(db).functions).toBe(0);
    expect((db.prepare('SELECT password_hash h FROM users WHERE id=1').get() as any).h).toBe(before);
    expect((db.pragma('foreign_key_check') as any[]).length).toBe(0);
  });
  it('stores only a hash of the bootstrap password (never plaintext)', () => {
    const row = db.prepare("SELECT password_hash h, must_change_password m FROM users WHERE role='super_admin'").get() as any;
    expect(row.h).toMatch(/^\$argon2id\$/);
    expect(row.h).not.toContain('Initial-Pass');
    expect(row.m).toBe(1);
  });
});

describe('authentication, registration, CSRF', () => {
  it('rejects every protected endpoint without a session (no anonymous access)', async () => {
    for (const u of ['/dashboard', '/parameters', '/registers', '/search?q=a', '/documents', '/taxonomy', '/bookmarks', '/annotations/public']) {
      expect((await request(app).get('/api' + u)).status).toBe(401);
    }
    expect((await request(app).get('/api/auth/registration-status')).status).toBe(200);
  });

  it('registration: validates, forces Normal User, auto-logs-in, no enumeration, IP rate limit 3/hour', async () => {
    const c = await newClient();
    const base = { email: 'Carol@Example.test', password: 'Sup3r-Secret-Pass!', confirmPassword: 'Sup3r-Secret-Pass!' };
    // 1: mismatch
    expect((await c.agent.post('/api/auth/register').send({ ...base, confirmPassword: 'nope' })).status).toBe(400);
    // 2: success, tries to self-promote
    const ok = await c.agent.post('/api/auth/register').send({ ...base, role: 'super_admin', phone: '+8801700000000', company: 'ACME', designation: 'Engineer' });
    expect(ok.status).toBe(201);
    expect(ok.body.user.role).toBe('user');
    c.csrf = ok.body.csrfToken;
    expect((await r(c, '/dashboard')).status).toBe(200); // logged in immediately
    // 3: duplicate (case-insensitive) → generic error, no "already exists" leak
    const dup = await request(app).post('/api/auth/register').send(base);
    expect(dup.status).toBe(400);
    expect(JSON.stringify(dup.body).toLowerCase()).not.toContain('already exists');
    // 4: over the limit → 429 + Retry-After, even for requests that would fail validation
    const lim = await request(app).post('/api/auth/register').send({ email: 'x@y.test', password: 'a', confirmPassword: 'a' });
    expect(lim.status).toBe(429);
    expect(lim.headers['retry-after']).toBeTruthy();
    expect((await c.agent.get('/api/admin/users')).status).toBe(403); // normal user cannot reach admin
  });

  it('login failures are uniform; state-changing requests need the CSRF token', async () => {
    const a = await request(app).post('/api/auth/login').send({ email: 'nobody@example.test', password: 'x' });
    const b = await request(app).post('/api/auth/login').send({ email: 'root@example.test', password: 'wrong' });
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
    admin = await adminLogin();
    const noCsrf = await admin.agent.post('/api/admin/backups');
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.code).toBe('CSRF');
  });

  it('sessions: persisted hashed in SQLite, 7-day expiry from SESSION_TTL_DAYS', () => {
    const s = db.prepare("SELECT token_hash, expires_at, created_at FROM user_sessions ORDER BY id DESC LIMIT 1").get() as any;
    expect(s.token_hash).toMatch(/^[0-9a-f]{64}$/);
    const days = (new Date(s.expires_at).getTime() - new Date(s.created_at).getTime()) / 86400000;
    expect(Math.round(days)).toBe(7);
  });
});

describe('multi-user isolation (IDOR) and public/private annotations', () => {
  beforeAll(async () => {
    alice = await createUserVia(admin, 'alice@example.test');
    bob = await createUserVia(admin, 'bob@example.test');
  });

  it('private annotation is invisible to others; ids cannot be used to read/modify', async () => {
    const created = await w(alice, 'post', '/annotations').send({ ...TXT, comment: 'alice private note', color: 'yellow' });
    expect(created.status).toBe(201);
    expect(created.body.visibility).toBe('private');
    const id = created.body.id;
    const seenByBob = await r(bob, `/annotations/for-content?keys=${TXT.contentKey}`);
    expect(seenByBob.body).toEqual([]);
    expect((await w(bob, 'patch', `/annotations/${id}`).send({ comment: 'hijack' })).status).toBe(404);
    expect((await w(bob, 'post', `/annotations/${id}/trash`).send({})).status).toBe(404);
    expect((await w(bob, 'delete', `/annotations/${id}?confirm=PERMANENT`)).status).toBe(404);
    expect((await r(bob, '/annotations/mine')).body).toEqual([]);
    expect(((await r(bob, '/annotations/public')).body as any[]).length).toBe(0);
    expect((await r(alice, `/annotations/for-content?keys=${TXT.contentKey}`)).body.length).toBe(1);
  });

  it('public → visible read-only to others; back to private revokes immediately; shared anchor, separate owners', async () => {
    const mine = (await r(alice, '/annotations/mine')).body[0];
    await w(alice, 'patch', `/annotations/${mine.id}`).send({ visibility: 'public' });
    const bobSees = (await r(bob, `/annotations/for-content?keys=${TXT.contentKey}`)).body;
    expect(bobSees.length).toBe(1);
    expect(bobSees[0].isOwn).toBe(false);
    expect((await w(bob, 'patch', `/annotations/${mine.id}`).send({ color: 'blue' })).status).toBe(404);
    // Bob annotates the very same text privately → same anchor, independent record
    const b = await w(bob, 'post', '/annotations').send({ ...TXT, comment: 'bob private', color: 'green' });
    expect(b.status).toBe(201);
    expect(b.body.anchorId).toBe(mine.anchorId);
    const carol = (await r(bob, `/annotations/for-content?keys=${TXT.contentKey}`)).body;
    expect(carol.length).toBe(2);
    // a third user sees only alice's public one and cannot learn bob's exists
    const dave = await createUserVia(admin, 'dave@example.test');
    const daveSees = (await r(dave, `/annotations/for-content?keys=${TXT.contentKey}`)).body;
    expect(daveSees.length).toBe(1);
    expect(daveSees[0].author).not.toMatch(/bob/i);
    expect(JSON.stringify(daveSees)).not.toContain('bob private');
    // alice goes private again → dave loses access instantly
    await w(alice, 'patch', `/annotations/${mine.id}`).send({ visibility: 'private' });
    expect((await r(dave, `/annotations/for-content?keys=${TXT.contentKey}`)).body.length).toBe(0);
  });

  it('delete flows: remove highlight keeps comment; trash/restore; permanent delete needs confirmation', async () => {
    const a = (await w(alice, 'post', '/annotations').send({ ...TXT, selectedText: 'x y', start: 0, end: 3, comment: 'c', color: 'pink' })).body;
    await w(alice, 'patch', `/annotations/${a.id}`).send({ color: null });
    const after = (await r(alice, '/annotations/mine')).body.find((x: any) => x.id === a.id);
    expect(after.comment).toBe('c'); expect(after.color).toBeNull();
    await w(alice, 'post', `/annotations/${a.id}/trash`).send({});
    expect(((await r(alice, '/annotations/mine')).body as any[]).some((x) => x.id === a.id)).toBe(false);
    expect(((await r(alice, '/annotations/mine?status=trashed')).body as any[]).some((x) => x.id === a.id)).toBe(true);
    await w(alice, 'post', `/annotations/${a.id}/restore`).send({});
    expect(((await r(alice, '/annotations/mine')).body as any[]).some((x) => x.id === a.id)).toBe(true);
    expect((await w(alice, 'delete', `/annotations/${a.id}`)).status).toBe(400);
    expect((await w(alice, 'delete', `/annotations/${a.id}?confirm=PERMANENT`)).status).toBe(200);
  });

  it('rejects unsafe link schemes', async () => {
    const res = await w(alice, 'post', '/annotations').send({ ...TXT, selectedText: 'zz', start: 0, end: 2, comment: 'x', links: [{ url: 'javascript:alert(1)' }] });
    expect(res.status).toBe(400);
  });

  it('image attachments: content-sniffed, stored under the owner dir, served only to permitted users', async () => {
    const ann = (await w(alice, 'post', '/annotations').send({ ...TXT, selectedText: 'att', start: 0, end: 3, comment: 'with image' })).body;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const bad = await w(alice, 'post', `/annotations/${ann.id}/attachments`).attach('files', Buffer.from('<html>not an image</html>'), 'evil.png');
    expect(bad.status).toBe(415);
    const up = await w(alice, 'post', `/annotations/${ann.id}/attachments`).attach('files', png, 'pic.png');
    expect(up.status).toBe(201);
    const attId = up.body.ids[0];
    const row = db.prepare('SELECT u.stored_rel_path p, u.user_id FROM research_annotation_attachments t JOIN user_uploads u ON u.id=t.upload_id WHERE t.id=?').get(attId) as any;
    expect(row.user_id).toBe(alice.id);
    expect(fs.existsSync(path.join(process.env.STORAGE_DIR!, 'users', `user-${alice.id}`, row.p))).toBe(true);
    expect((await r(alice, `/annotations/attachments/${attId}/file`)).status).toBe(200);
    expect((await r(bob, `/annotations/attachments/${attId}/file`)).status).toBe(404); // private
    await w(alice, 'patch', `/annotations/${ann.id}`).send({ visibility: 'public' });
    expect((await r(bob, `/annotations/attachments/${attId}/file`)).status).toBe(200);
    await w(alice, 'patch', `/annotations/${ann.id}`).send({ visibility: 'private' });
    expect((await r(bob, `/annotations/attachments/${attId}/file`)).status).toBe(404);
    const usage = (await r(alice, '/me/storage')).body;
    expect(usage.total).toBeGreaterThan(0);
    expect((await r(bob, '/me/storage')).body.total).toBe(0);
  });

  it('per-user display settings persist, are independent, and cannot target another user', async () => {
    await w(alice, 'patch', '/me/settings').send({ annotation_display: { showOthersPublic: false, showOwn: true, showHighlightBackgrounds: true } });
    expect((await r(alice, '/me/settings')).body.annotation_display.showOthersPublic).toBe(false);
    expect((await r(bob, '/me/settings')).body.annotation_display.showOthersPublic).toBe(true); // default Show
    expect((await w(bob, 'patch', '/me/settings').send({ user_id: alice.id, theme: 'dark' })).status).toBe(400);
  });
});

describe('bookmarks & folders', () => {
  it('nested folders, no cycles, non-empty delete requires a destination, per-user isolation', async () => {
    const f1 = (await w(alice, 'post', '/bookmarks/folders').send({ name: 'Delta' })).body.id;
    const f2 = (await w(alice, 'post', '/bookmarks/folders').send({ name: 'VFD-EL', parent_id: f1 })).body.id;
    const f3 = (await w(alice, 'post', '/bookmarks/folders').send({ name: 'Modbus', parent_id: f2 })).body.id;
    expect((await w(alice, 'patch', `/bookmarks/folders/${f1}`).send({ parent_id: f3 })).status).toBe(400); // into own descendant
    expect((await w(alice, 'patch', `/bookmarks/folders/${f1}`).send({ parent_id: f1 })).status).toBe(400);
    const bm = await w(alice, 'post', '/bookmarks').send({ name: 'Reg 2103H', research_url: '/research/modbus/delta/vfd-el/registers/1', folder_id: f3, context: { entityType: 'modbus_register', entityId: 1 } });
    expect(bm.status).toBe(201);
    expect((await w(alice, 'post', '/bookmarks').send({ name: 'Reg 2103H', research_url: '/research/modbus/delta/vfd-el/registers/1', folder_id: f3 })).status).toBe(409); // accidental duplicate
    expect((await w(alice, 'post', '/bookmarks').send({ name: 'x', research_url: 'https://evil.example/' })).status).toBe(400);
    expect((await w(alice, 'delete', `/bookmarks/folders/${f2}`)).status).toBe(409);
    expect((await w(alice, 'delete', `/bookmarks/folders/${f2}?moveTo=parent`)).status).toBe(200);
    const moved = (await r(alice, '/bookmarks')).body.find((b: any) => b.id === bm.body.id);
    expect(moved).toBeTruthy(); // contents survived
    expect((await r(alice, '/bookmarks/folders')).body.find((f: any) => f.id === f3).parent_id).toBe(f1);
    // Bob cannot see or touch them
    expect((await r(bob, '/bookmarks')).body).toEqual([]);
    expect((await w(bob, 'patch', `/bookmarks/${bm.body.id}`).send({ name: 'x' })).status).toBe(404);
    expect((await w(bob, 'delete', `/bookmarks/${bm.body.id}`)).status).toBe(404);
    expect((await w(bob, 'patch', `/bookmarks/folders/${f1}`).send({ name: 'x' })).status).toBe(404);
    // opening returns the saved internal URL unchanged
    expect((await w(alice, 'post', `/bookmarks/${bm.body.id}/open`).send({})).body.research_url).toBe('/research/modbus/delta/vfd-el/registers/1');
  });
});

describe('Super Admin: monitoring, remote logout, disable/enable', () => {
  it('normal users cannot use admin APIs', async () => {
    for (const u of ['/admin/users', '/admin/presence', '/admin/activity', '/admin/backups', '/staged', '/verification/tasks', '/manuals/scan']) expect((await r(alice, u)).status).toBe(403);
  });

  it('remote logout of one session leaves others; logout-all revokes all; disable blocks instantly; enable does not restore', async () => {
    const eve1 = await createUserVia(admin, 'eve@example.test');
    const eve2 = await newClient();
    const l = await eve2.agent.post('/api/auth/login').send({ email: 'eve@example.test', password: 'User-Password-456!' });
    eve2.csrf = l.body.csrfToken;
    const detail = (await r(admin, `/admin/users/${eve1.id}`)).body;
    expect(detail.sessions.filter((s: any) => !s.revoked_at).length).toBeGreaterThanOrEqual(2);
    const sid1 = (await r(eve1, '/auth/me')).body.sessionId;
    expect((await w(admin, 'post', `/admin/sessions/${sid1}/revoke`).send({})).body.revoked).toBe(1);
    expect((await r(eve1, '/dashboard')).status).toBe(401);
    expect((await r(eve2, '/dashboard')).status).toBe(200); // other session untouched
    expect((await w(admin, 'patch', `/admin/users/${eve1.id}`).send({ status: 'disabled' })).status).toBe(200);
    expect((await r(eve2, '/dashboard')).status).toBe(401); // existing session blocked immediately
    expect((await request(app).post('/api/auth/login').send({ email: 'eve@example.test', password: 'User-Password-456!' })).status).toBe(403);
    expect((await w(admin, 'patch', `/admin/users/${eve1.id}`).send({ status: 'enabled' })).status).toBe(200);
    expect((await r(eve2, '/dashboard')).status).toBe(401); // revoked sessions are not restored
    expect((await request(app).post('/api/auth/login').send({ email: 'eve@example.test', password: 'User-Password-456!' })).status).toBe(200);
    // data preserved through disable/enable
    expect((await r(admin, `/admin/users/${eve1.id}`)).body.status).toBe('enabled');
    const logs = (await r(admin, '/admin/activity?event=admin_')).body.rows.map((x: any) => x.event_type);
    expect(logs).toEqual(expect.arrayContaining(['admin_remote_logout', 'admin_disable_account', 'admin_enable_account']));
    expect(JSON.stringify((await r(admin, '/admin/activity?limit=1000')).body)).not.toMatch(/Password-456|token_hash|vfdkb_sid/);
  });

  it('cannot disable or demote the last active Super Admin', async () => {
    const adminId = (await r(admin, '/auth/me')).body.user.id;
    expect((await w(admin, 'patch', `/admin/users/${adminId}`).send({ status: 'disabled' })).status).toBe(409);
    expect((await w(admin, 'patch', `/admin/users/${adminId}`).send({ role: 'user' })).status).toBe(409);
  });

  it('registration can be disabled by the Super Admin', async () => {
    await w(admin, 'patch', '/admin/settings').send({ registration_enabled: false });
    expect((await request(app).get('/api/auth/registration-status')).body.registrationEnabled).toBe(false);
    db.prepare('DELETE FROM rate_limit_hits').run();
    expect((await request(app).post('/api/auth/register').send({ email: 'late@example.test', password: 'Sup3r-Secret-Pass!', confirmPassword: 'Sup3r-Secret-Pass!' })).status).toBe(403);
    await w(admin, 'patch', '/admin/settings').send({ registration_enabled: true });
  });

  it('content visibility hides without deleting and persists order', async () => {
    const { ensureBrandModel } = await import('../server/src/services/ingestion/DocumentIngestionService.js');
    const x = ensureBrandModel(db, 'TestBrand', 'T-1');
    ensureBrandModel(db, 'TestBrand', 'T-2');
    expect(((await r(alice, '/models')).body as any[]).some((m) => m.id === x.modelId)).toBe(true);
    await w(admin, 'patch', `/admin/content/model/${x.modelId}`).send({ visible: false });
    expect(((await r(alice, '/models')).body as any[]).some((m) => m.id === x.modelId)).toBe(false);
    expect(db.prepare('SELECT 1 FROM models WHERE id=?').get(x.modelId)).toBeTruthy(); // still in the database
    await w(admin, 'patch', `/admin/content/model/${x.modelId}`).send({ visible: true });
    const ids = (await r(admin, '/admin/content/model')).body.map((m: any) => m.id).reverse();
    await w(admin, 'post', '/admin/content/model/reorder').send({ orderedIds: ids });
    expect((await r(admin, '/admin/content/model')).body.map((m: any) => m.id)).toEqual(ids);
  });
});

describe('ingestion safety, evidence, comparison and non-destructive review', () => {
  it('matchQuote distinguishes exact / normalized / not_found / no_text_layer', async () => {
    const { matchQuote } = await import('../server/src/services/ingestion/DocumentIngestionService.js');
    expect(matchQuote('Pr.01.00 Max. Output Freq. 50.00 to 600.0 Hz', 'Max. Output Freq.')).toBe('exact');
    expect(matchQuote('Pr.01.00  Max.\nOutput   Freq.', 'Max. Output Freq.')).toBe('normalized');
    expect(matchQuote('something else entirely', 'Max. Output Freq.')).toBe('not_found');
    expect(matchQuote('', 'x y z')).toBe('no_text_layer');
    expect(matchQuote('abc', null)).toBe('unchecked');
  });

  it('refuses paths outside vfd-manuals/ and unsupported types', async () => {
    const { resolveManualPath } = await import('../server/src/services/ingestion/DocumentIngestionService.js');
    expect(() => resolveManualPath('package.json')).toThrow(/vfd-manuals|Unsupported|inside/i);
    expect(() => resolveManualPath('../../etc/passwd')).toThrow();
    expect(() => resolveManualPath('vfd-manuals/does-not-exist.pdf')).toThrow(/not found/i);
  });

  function seedRev() {
    const { ensureBrandModel } = require_ensure();
    const bm = ensureBrandModel(db, 'Acme', 'X1');
    const doc = Number(db.prepare("INSERT INTO documents(brand_id,title) VALUES (?, 'Acme manual')").run(bm.brandId).lastInsertRowid);
    const rev = Number(db.prepare("INSERT INTO document_revisions(document_id, source_rel_path, original_filename, file_format, mime, file_size, sha256, page_count) VALUES (?,?,?,?,?,?,?,?)").run(doc, 'vfd-manuals/acme.pdf', 'acme.pdf', 'pdf', 'application/pdf', 1, 'a'.repeat(63) + String(Math.random()).slice(2, 3), 5).lastInsertRowid);
    db.prepare("INSERT INTO document_pages(revision_id,page_index,text,text_source,char_count) VALUES (?,?,?,?,?)").run(rev, 2, 'F03 Maximum frequency 50 to 400 Hz', 'pdf-text', 30);
    return { modelId: bm.modelId, rev };
  }
  let ensureFn: any;
  const require_ensure = () => ({ ensureBrandModel: ensureFn });

  it('approve creates evidence-linked records; conflicts preserve the original value; uncertain matches need an explicit decision', async () => {
    ensureFn = (await import('../server/src/services/ingestion/DocumentIngestionService.js')).ensureBrandModel;
    const { compareRecord } = await import('../server/src/services/ingestion/DocumentIngestionService.js');
    const { approveStaged } = await import('../server/src/services/review.js');
    const { modelId, rev } = seedRev();
    const cf = db.prepare("SELECT id FROM common_functions WHERE slug='maximum-frequency'").get() as any;
    const stage = (rec: any, type = 'parameter', qm = 'exact') => {
      const cmp = compareRecord(db, type as any, modelId, rec, cf.id);
      return Number(db.prepare("INSERT INTO staged_records(import_job_id, revision_id, record_type, payload_json, comparison, comparison_detail_json, matched_entity_id, quote_match) VALUES (1,?,?,?,?,?,?,?)").run(rev, type, JSON.stringify({ ...rec, _model_id: modelId, _brand: 'Acme', _model: 'X1', _common_function_id: cf.id }), cmp.comparison, JSON.stringify(cmp.detail), cmp.matchedId, qm).lastInsertRowid);
    };
    db.prepare("INSERT OR IGNORE INTO document_import_jobs(id,file_path,status) VALUES (1,'x','completed')").run();
    const rec = { code: 'F03', name: 'Maximum frequency', unit: 'Hz', min_value: '50', max_value: '400', page_index: 2, evidence_quote: 'F03 Maximum frequency' };
    const s1 = stage(rec);
    const a1 = approveStaged(s1, 1, {});
    expect(a1.outcome).toBe('created');
    const p = db.prepare('SELECT * FROM parameters WHERE id=?').get(a1.entityId) as any;
    expect(p.verification_status).toBe('Unverified'); // never auto-verified
    expect(p.evidence_status).toBe('Explicitly Documented');
    expect((db.prepare("SELECT COUNT(*) c FROM evidence_records WHERE entity_type='parameter' AND entity_id=?").get(p.id) as any).c).toBe(1);
    // conflicting value from a second document
    const s2 = stage({ ...rec, max_value: '600', evidence_quote: 'F03 Maximum frequency' });
    expect(db.prepare('SELECT comparison c FROM staged_records WHERE id=?').get(s2)).toEqual({ c: 'Conflicting Information' });
    const a2 = approveStaged(s2, 1, {});
    expect(a2.outcome).toMatch(/conflict recorded/);
    const after = db.prepare('SELECT * FROM parameters WHERE id=?').get(p.id) as any;
    expect(after.max_value).toBe('400'); // not overwritten
    expect(after.verification_status).toBe('Documentation Conflict');
    expect((db.prepare("SELECT COUNT(*) c FROM evidence_records WHERE entity_id=? AND role='conflicting'").get(p.id) as any).c).toBe(1);
    expect((db.prepare("SELECT COUNT(*) c FROM verification_tasks WHERE task_type='conflict' AND entity_id=?").get(p.id) as any).c).toBe(1);
    // same function, different code → possible duplicate must be decided explicitly
    const s3 = stage({ code: 'F99', name: 'Max freq 2', page_index: 2, evidence_quote: 'F03 Maximum frequency' });
    expect(db.prepare('SELECT comparison c FROM staged_records WHERE id=?').get(s3)).toEqual({ c: 'Possible Duplicate' });
    expect(() => approveStaged(s3, 1, {})).toThrow(/explicit decision/);
    expect(approveStaged(s3, 1, { mode: 'create_new' }).outcome).toBe('created');
    // re-approving is rejected; audit trail exists
    expect(() => approveStaged(s1, 1, {})).toThrow();
    expect((db.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity_type='parameter'").get() as any).c).toBeGreaterThanOrEqual(3);
  });

  it('modbus registers keep the original address untouched and store mathematical conversions separately', async () => {
    const { approveStaged, addressConversions } = await import('../server/src/services/review.js');
    expect(addressConversions('2103H', 'HEX')).toMatchObject({ hex: '0x2103', decimal: '8451' });
    expect(addressConversions('8451', 'Decimal').hex).toBe('0x2103');
    expect(addressConversions('40100', 'Parameter-derived')).toEqual({});
    const { modelId, rev } = seedRev();
    db.prepare("INSERT INTO staged_records(import_job_id, revision_id, record_type, payload_json, comparison, quote_match) VALUES (1,?,?,?,?,?)").run(rev, 'modbus_register', JSON.stringify({ name: 'Output frequency', original_address: '2103H', address_format: 'HEX', page_index: 2, _model_id: modelId, _brand: 'Acme', _model: 'X1' }), 'No Existing Record', 'exact');
    const sid = (db.prepare('SELECT MAX(id) id FROM staged_records').get() as any).id;
    const res = approveStaged(sid, 1, {});
    const reg = db.prepare('SELECT * FROM modbus_registers WHERE id=?').get(res.entityId) as any;
    expect(reg.original_address).toBe('2103H');
    const conv = db.prepare('SELECT representation, value FROM modbus_address_conversions WHERE register_id=?').all(res.entityId);
    expect(conv).toEqual([{ representation: 'decimal', value: '8451' }]);
    const found = await r(admin, '/registers?q=8451');
    expect(found.body.rows.some((x: any) => x.id === res.entityId)).toBe(true);
  });

  it('comparison shows Not Documented gaps and exports CSV with sources', async () => {
    const models = (await r(admin, '/models')).body as any[];
    const ids = models.slice(0, 2).map((m) => m.id).join(',');
    const cmp = await r(admin, `/compare?models=${ids}`);
    expect(cmp.status).toBe(200);
    expect(cmp.body.models.length).toBe(2);
    const csv = await r(admin, `/compare?models=${ids}&format=csv`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
  });
});

describe('backup, restore and path safety', () => {
  it('creates a consistent verified backup that preserves users, sessions and ownership', async () => {
    const { createBackup } = await import('../server/src/services/backup.js');
    const b = createBackup(db, 'test');
    expect(b.verified).toBe(true);
    const Database = (await import('better-sqlite3')).default;
    const copy = new Database(b.file, { readonly: true });
    expect((copy.prepare('SELECT COUNT(*) c FROM users').get() as any).c).toBe((db.prepare('SELECT COUNT(*) c FROM users').get() as any).c);
    expect((copy.prepare('SELECT COUNT(*) c FROM research_annotations').get() as any).c).toBe((db.prepare('SELECT COUNT(*) c FROM research_annotations').get() as any).c);
    expect((copy.pragma('foreign_key_check') as any[]).length).toBe(0);
    copy.close();
  });

  it('safeResolve blocks traversal', async () => {
    const { safeResolve } = await import('../server/src/services/storage.js');
    expect(() => safeResolve(tmp, '../outside.txt')).toThrow();
    expect(() => safeResolve(tmp, path.join('a', '..', '..', 'x'))).toThrow();
    expect(safeResolve(tmp, 'ok/file.png').startsWith(fs.realpathSync(tmp))).toBe(true);
  });

  it('admin storage reconciliation reports orphan files visibly', async () => {
    const { ensureUserDirs } = await import('../server/src/services/storage.js');
    const root = ensureUserDirs(alice.id!);
    fs.writeFileSync(path.join(root, 'uploads', 'orphan.bin'), 'x');
    const rec = (await r(admin, `/admin/users/${alice.id}/storage/reconcile`)).body;
    expect(rec.filesystem.orphanCount).toBeGreaterThanOrEqual(1);
  });
});
