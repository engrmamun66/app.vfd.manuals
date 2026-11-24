/**
 * Versioned, append-only migrations.
 * RULES (master prompt §29.9): never edit an applied migration, never drop/recreate tables
 * holding data, add new migrations at the end only. Each runs inside a transaction.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: /* sql */ `
-- ============ USERS / AUTH ============
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('super_admin','user')),
  status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','disabled')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  display_name TEXT,
  phone TEXT,
  company TEXT,
  designation TEXT,
  login_count INTEGER NOT NULL DEFAULT 0,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT,
  revoke_reason TEXT,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX idx_sessions_user ON user_sessions(user_id, revoked_at, expires_at);

CREATE TABLE user_login_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  success INTEGER NOT NULL,
  reason TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_login_history_user ON user_login_history(user_id, created_at);

CREATE TABLE rate_limit_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,
  key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_rate_limit ON rate_limit_hits(bucket, key, created_at);

CREATE TABLE user_settings (
  user_id INTEGER NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE user_storage_limits (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  quota_bytes INTEGER,
  max_file_bytes INTEGER,
  max_attachments_per_comment INTEGER,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE user_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('comment-attachment','upload','document','export','profile')),
  original_filename TEXT,
  stored_rel_path TEXT NOT NULL,
  thumbnail_rel_path TEXT,
  extension TEXT,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  thumbnail_bytes INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT,
  purged_at TEXT
);
CREATE INDEX idx_uploads_user ON user_uploads(user_id, created_at);

CREATE TABLE user_activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  actor_user_id INTEGER REFERENCES users(id),
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  metadata_json TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_activity_user ON user_activity_logs(user_id, created_at);
CREATE INDEX idx_activity_type ON user_activity_logs(event_type, created_at);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_by_user_id INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============ KNOWLEDGE: BRANDS / MODELS / TAXONOMY ============
CREATE TABLE brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  identification_status TEXT NOT NULL DEFAULT 'needs_review' CHECK (identification_status IN ('verified','needs_review','unverified')),
  identification_evidence_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (brand_id, slug)
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES categories(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_bn TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE common_functions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_bn TEXT,
  short_description TEXT,
  short_description_bn TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_cf_category ON common_functions(category_id);

-- ============ DOCUMENTS ============
CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER REFERENCES brands(id),
  title TEXT NOT NULL,
  doc_type TEXT,
  identification_status TEXT NOT NULL DEFAULT 'needs_review' CHECK (identification_status IN ('verified','needs_review','unverified')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE document_models (
  document_id INTEGER NOT NULL REFERENCES documents(id),
  model_id INTEGER NOT NULL REFERENCES models(id),
  relation_status TEXT NOT NULL DEFAULT 'needs_review',
  PRIMARY KEY (document_id, model_id)
);

CREATE TABLE document_import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','duplicate','dry_run')),
  result_json TEXT,
  error TEXT,
  backup_id INTEGER,
  created_by_user_id INTEGER REFERENCES users(id),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at TEXT
);

CREATE TABLE document_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  revision_label TEXT,
  source_rel_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_format TEXT NOT NULL,
  mime TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  page_count INTEGER,
  text_layer_pages INTEGER,
  ocr_status TEXT NOT NULL DEFAULT 'not_needed' CHECK (ocr_status IN ('not_needed','pending','completed','partial','failed')),
  status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded','archived')),
  import_job_id INTEGER REFERENCES document_import_jobs(id),
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_rev_doc ON document_revisions(document_id);

CREATE TABLE document_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES document_revisions(id),
  page_index INTEGER NOT NULL,
  printed_page TEXT,
  text TEXT,
  text_source TEXT NOT NULL DEFAULT 'none' CHECK (text_source IN ('pdf-text','ocr','none')),
  ocr_confidence REAL,
  char_count INTEGER NOT NULL DEFAULT 0,
  width REAL,
  height REAL,
  image_rel_path TEXT,
  UNIQUE (revision_id, page_index)
);

CREATE VIRTUAL TABLE document_pages_fts USING fts5(text, content='document_pages', content_rowid='id', tokenize='unicode61');
CREATE TRIGGER document_pages_ai AFTER INSERT ON document_pages BEGIN
  INSERT INTO document_pages_fts(rowid, text) VALUES (new.id, coalesce(new.text,''));
END;
CREATE TRIGGER document_pages_ad AFTER DELETE ON document_pages BEGIN
  INSERT INTO document_pages_fts(document_pages_fts, rowid, text) VALUES ('delete', old.id, coalesce(old.text,''));
END;
CREATE TRIGGER document_pages_au AFTER UPDATE OF text ON document_pages BEGIN
  INSERT INTO document_pages_fts(document_pages_fts, rowid, text) VALUES ('delete', old.id, coalesce(old.text,''));
  INSERT INTO document_pages_fts(rowid, text) VALUES (new.id, coalesce(new.text,''));
END;

-- ============ EVIDENCE ============
CREATE TABLE source_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES document_revisions(id),
  page_id INTEGER REFERENCES document_pages(id),
  page_index INTEGER,
  printed_page TEXT,
  page_verified INTEGER NOT NULL DEFAULT 0,
  section TEXT,
  table_ref TEXT,
  figure_ref TEXT,
  extracted_text TEXT,
  quote_match TEXT NOT NULL DEFAULT 'unchecked' CHECK (quote_match IN ('exact','normalized','not_found','no_text_layer','unchecked')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_srcref_rev ON source_references(revision_id, page_index);

-- ============ PARAMETERS / REGISTERS ============
CREATE TABLE parameters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id INTEGER NOT NULL REFERENCES models(id),
  common_function_id INTEGER REFERENCES common_functions(id),
  category_id INTEGER REFERENCES categories(id),
  code TEXT NOT NULL,
  name TEXT,
  description_en TEXT,
  description_bn TEXT,
  technical_explanation TEXT,
  unit TEXT,
  data_type TEXT,
  default_value TEXT,
  min_value TEXT,
  max_value TEXT,
  resolution TEXT,
  access_type TEXT,
  setting_conditions TEXT,
  options_json TEXT,
  equivalence TEXT CHECK (equivalence IS NULL OR equivalence IN ('Exact Equivalent','Functionally Similar','Partially Equivalent','Not Equivalent','Insufficient Documentation')),
  equivalence_note TEXT,
  evidence_status TEXT NOT NULL DEFAULT 'Unverified' CHECK (evidence_status IN ('Explicitly Documented','Calculated from Documented Data','Cross-Referenced','Not Documented','Unverified','Conflicting')),
  verification_status TEXT NOT NULL DEFAULT 'Unverified' CHECK (verification_status IN ('Verified','Unverified','Requires Manual Verification','Documentation Conflict','Rejected')),
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_by_user_id INTEGER REFERENCES users(id),
  updated_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (model_id, code)
);
CREATE INDEX idx_param_cf ON parameters(common_function_id, model_id);
CREATE INDEX idx_param_cat ON parameters(category_id);

CREATE TABLE modbus_registers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id INTEGER NOT NULL REFERENCES models(id),
  common_function_id INTEGER REFERENCES common_functions(id),
  name TEXT NOT NULL,
  original_address TEXT NOT NULL,
  address_format TEXT CHECK (address_format IS NULL OR address_format IN ('HEX','Decimal','Parameter-derived','Other')),
  register_type TEXT,
  function_codes TEXT,
  access TEXT,
  data_length_words INTEGER,
  data_type TEXT,
  signedness TEXT,
  byte_order TEXT,
  word_order TEXT,
  scaling TEXT,
  unit TEXT,
  raw_interpretation TEXT,
  bit_definitions_json TEXT,
  description TEXT,
  restrictions TEXT,
  evidence_status TEXT NOT NULL DEFAULT 'Unverified' CHECK (evidence_status IN ('Explicitly Documented','Calculated from Documented Data','Cross-Referenced','Not Documented','Unverified','Conflicting')),
  verification_status TEXT NOT NULL DEFAULT 'Unverified' CHECK (verification_status IN ('Verified','Unverified','Requires Manual Verification','Documentation Conflict','Rejected')),
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (model_id, original_address, name)
);
CREATE INDEX idx_reg_model ON modbus_registers(model_id);
CREATE INDEX idx_reg_cf ON modbus_registers(common_function_id);

-- Mathematical conversions of an original address. Never a claim about PLC validity.
CREATE TABLE modbus_address_conversions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  register_id INTEGER NOT NULL REFERENCES modbus_registers(id),
  representation TEXT NOT NULL CHECK (representation IN ('hex','decimal')),
  value TEXT NOT NULL,
  method TEXT NOT NULL,
  is_mathematical_only INTEGER NOT NULL DEFAULT 1,
  UNIQUE (register_id, representation)
);

CREATE TABLE evidence_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('parameter','modbus_register','model','document','relationship','explanation')),
  entity_id INTEGER NOT NULL,
  source_reference_id INTEGER NOT NULL REFERENCES source_references(id),
  role TEXT NOT NULL DEFAULT 'original' CHECK (role IN ('original','current','historical','supporting','conflicting')),
  evidence_status TEXT NOT NULL,
  value_snapshot_json TEXT,
  import_job_id INTEGER REFERENCES document_import_jobs(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_evidence_entity ON evidence_records(entity_type, entity_id);

CREATE TABLE entity_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_type TEXT NOT NULL,
  from_id INTEGER NOT NULL,
  to_type TEXT NOT NULL,
  to_id INTEGER NOT NULL,
  relation_kind TEXT NOT NULL CHECK (relation_kind IN ('documented_dependency','documented_relationship','related_function','research_suggestion')),
  note TEXT,
  source_reference_id INTEGER REFERENCES source_references(id),
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (from_type, from_id, to_type, to_id, relation_kind)
);
CREATE INDEX idx_rel_from ON entity_relationships(from_type, from_id);
CREATE INDEX idx_rel_to ON entity_relationships(to_type, to_id);

CREATE TABLE technical_explanations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('short','detailed','advanced','manufacturer')),
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','bn')),
  body TEXT NOT NULL,
  source_reference_id INTEGER REFERENCES source_references(id),
  evidence_status TEXT NOT NULL DEFAULT 'Unverified',
  version INTEGER NOT NULL DEFAULT 1,
  is_current INTEGER NOT NULL DEFAULT 1,
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_expl_entity ON technical_explanations(entity_type, entity_id, is_current);

-- ============ IMPORT STAGING / VERIFICATION / AUDIT ============
CREATE TABLE staged_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_job_id INTEGER NOT NULL REFERENCES document_import_jobs(id),
  revision_id INTEGER REFERENCES document_revisions(id),
  record_type TEXT NOT NULL CHECK (record_type IN ('parameter','modbus_register')),
  payload_json TEXT NOT NULL,
  comparison TEXT NOT NULL CHECK (comparison IN ('Exact Match','New Information','Updated Information','Conflicting Information','Possible Duplicate','Uncertain Match','No Existing Record')),
  comparison_detail_json TEXT,
  matched_entity_id INTEGER,
  quote_match TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','superseded')),
  review_note TEXT,
  reviewed_by_user_id INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_entity_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_staged_job ON staged_records(import_job_id, status);
CREATE INDEX idx_staged_status ON staged_records(status);

CREATE TABLE verification_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  task_type TEXT NOT NULL CHECK (task_type IN ('review_import','conflict','duplicate','uncertain_match','ocr_review','identification','reattachment')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  title TEXT NOT NULL,
  details_json TEXT,
  import_job_id INTEGER REFERENCES document_import_jobs(id),
  resolved_by_user_id INTEGER REFERENCES users(id),
  resolved_at TEXT,
  resolution_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_vtask_status ON verification_tasks(status, task_type);

CREATE TABLE verification_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_vrec_entity ON verification_records(entity_type, entity_id);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  operation TEXT NOT NULL,
  previous_json TEXT,
  new_json TEXT,
  source TEXT,
  import_job_id INTEGER,
  user_id INTEGER REFERENCES users(id),
  approval_status TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);

CREATE TABLE backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_rel_path TEXT NOT NULL,
  operation TEXT NOT NULL,
  size_bytes INTEGER,
  verified INTEGER NOT NULL DEFAULT 0,
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============ CONTENT DISPLAY (kept separate from technical data) ============
CREATE TABLE content_display (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('brand','model','category','common_function','parameter','modbus_register','document','research_topic','nav_section')),
  entity_id INTEGER NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  show_dashboard INTEGER NOT NULL DEFAULT 1,
  show_nav INTEGER NOT NULL DEFAULT 1,
  show_search INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 1000,
  updated_by_user_id INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (entity_type, entity_id)
);

-- ============ RESEARCH BOOKMARKS ============
CREATE TABLE research_bookmark_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  parent_id INTEGER REFERENCES research_bookmark_folders(id),
  name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_bmf_user ON research_bookmark_folders(user_id, parent_id);

CREATE TABLE research_bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  folder_id INTEGER REFERENCES research_bookmark_folders(id),
  name TEXT NOT NULL,
  description TEXT,
  notes TEXT,
  research_url TEXT NOT NULL,
  context_json TEXT,
  brand_id INTEGER REFERENCES brands(id),
  model_id INTEGER REFERENCES models(id),
  entity_type TEXT,
  entity_id INTEGER,
  research_depth TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_opened_at TEXT
);
CREATE INDEX idx_bm_user_folder ON research_bookmarks(user_id, folder_id);
CREATE INDEX idx_bm_user_created ON research_bookmarks(user_id, created_at);

CREATE TABLE research_bookmark_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  UNIQUE (user_id, name)
);
CREATE TABLE research_bookmark_tag_relations (
  bookmark_id INTEGER NOT NULL REFERENCES research_bookmarks(id),
  tag_id INTEGER NOT NULL REFERENCES research_bookmark_tags(id),
  PRIMARY KEY (bookmark_id, tag_id)
);
CREATE TABLE research_bookmark_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  bookmark_id INTEGER NOT NULL REFERENCES research_bookmarks(id),
  opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_bmh_user ON research_bookmark_history(user_id, opened_at);

-- ============ ANNOTATIONS: shared text anchor + independent user annotations ============
CREATE TABLE research_text_anchors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_key TEXT NOT NULL,
  content_hash TEXT,
  research_url TEXT,
  entity_type TEXT,
  entity_id INTEGER,
  brand_id INTEGER REFERENCES brands(id),
  model_id INTEGER REFERENCES models(id),
  parameter_id INTEGER REFERENCES parameters(id),
  modbus_register_id INTEGER REFERENCES modbus_registers(id),
  document_id INTEGER REFERENCES documents(id),
  revision_id INTEGER REFERENCES document_revisions(id),
  document_page_id INTEGER REFERENCES document_pages(id),
  selected_text TEXT NOT NULL,
  start_offset INTEGER,
  end_offset INTEGER,
  text_prefix TEXT,
  text_suffix TEXT,
  anchor_status TEXT NOT NULL DEFAULT 'active' CHECK (anchor_status IN ('active','requires_reattachment','source_unavailable')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_anchor_content ON research_text_anchors(content_key);

CREATE TABLE research_annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anchor_id INTEGER NOT NULL REFERENCES research_text_anchors(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  comment_text TEXT,
  links_json TEXT,
  highlight_color TEXT CHECK (highlight_color IS NULL OR highlight_color IN ('yellow','green','blue','pink','orange','purple')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  research_url TEXT,
  section_id TEXT,
  annotation_status TEXT NOT NULL DEFAULT 'Active' CHECK (annotation_status IN ('Active','Requires Reattachment','Source Unavailable','Archived')),
  favorite INTEGER NOT NULL DEFAULT 0,
  deletion_status TEXT NOT NULL DEFAULT 'active' CHECK (deletion_status IN ('active','trashed')),
  deleted_at TEXT,
  deleted_by_user_id INTEGER REFERENCES users(id),
  restored_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_ann_user ON research_annotations(user_id, created_at);
CREATE INDEX idx_ann_anchor ON research_annotations(anchor_id);
CREATE INDEX idx_ann_vis ON research_annotations(visibility, deletion_status);

CREATE TABLE research_annotation_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  annotation_id INTEGER NOT NULL REFERENCES research_annotations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  upload_id INTEGER NOT NULL REFERENCES user_uploads(id),
  alt_text TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  removed_at TEXT
);
CREATE INDEX idx_att_ann ON research_annotation_attachments(annotation_id);
`,
  },
  {
    version: 2,
    name: 'parameter_importance_and_knowledge_items',
    sql: /* sql */ `
ALTER TABLE parameters ADD COLUMN importance TEXT CHECK (importance IS NULL OR importance IN ('Important','Medium','Optional'));
ALTER TABLE parameters ADD COLUMN param_group TEXT;
CREATE INDEX idx_param_importance ON parameters(model_id, importance);

-- Non-parameter manual knowledge: faults/alarms/warnings, troubleshooting, wiring, installation, safety, specs, communication notes.
CREATE TABLE knowledge_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id INTEGER NOT NULL REFERENCES models(id),
  revision_id INTEGER REFERENCES document_revisions(id),
  kind TEXT NOT NULL CHECK (kind IN ('fault','alarm','warning','troubleshooting','wiring','installation','safety','specification','communication','maintenance','note')),
  code TEXT,
  title TEXT NOT NULL,
  description TEXT,
  cause TEXT,
  remedy TEXT,
  details_json TEXT,
  section TEXT,
  page_index INTEGER,
  printed_page TEXT,
  evidence_quote TEXT,
  quote_match TEXT,
  importance TEXT CHECK (importance IS NULL OR importance IN ('Important','Medium','Optional')),
  evidence_status TEXT NOT NULL DEFAULT 'Unverified' CHECK (evidence_status IN ('Explicitly Documented','Calculated from Documented Data','Cross-Referenced','Not Documented','Unverified','Conflicting')),
  verification_status TEXT NOT NULL DEFAULT 'Unverified' CHECK (verification_status IN ('Verified','Unverified','Requires Manual Verification','Documentation Conflict','Rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX uq_knowledge_item ON knowledge_items(model_id, kind, COALESCE(code,''), title);
CREATE INDEX idx_knowledge_model_kind ON knowledge_items(model_id, kind);
`,
  },
  {
    version: 3,
    name: 'drop_bookmark_description',
    sql: /* sql */ `
ALTER TABLE research_bookmarks DROP COLUMN description;
`,
  },
  {
    version: 4,
    name: 'feedback_requests',
    sql: /* sql */ `
CREATE TABLE feedback_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('request','complaint')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','resolved')),
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_feedback_status ON feedback_requests(status, id);
CREATE INDEX idx_feedback_user ON feedback_requests(user_id, id);
CREATE TABLE feedback_images (
  id INTEGER PRIMARY KEY,
  feedback_id INTEGER NOT NULL REFERENCES feedback_requests(id) ON DELETE CASCADE,
  upload_id INTEGER NOT NULL REFERENCES user_uploads(id)
);
CREATE INDEX idx_feedback_images ON feedback_images(feedback_id);
`,
  },
  {
    version: 5,
    name: 'feedback_contact',
    sql: /* sql */ `
ALTER TABLE feedback_requests ADD COLUMN contact_phone TEXT;
ALTER TABLE feedback_requests ADD COLUMN contact_email TEXT;
`,
  },
  {
    version: 6,
    name: 'user_categories',
    sql: /* sql */ `
CREATE TABLE user_categories (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, name_key)
);
CREATE TABLE parameter_user_categories (
  user_category_id INTEGER NOT NULL REFERENCES user_categories(id) ON DELETE CASCADE,
  parameter_id INTEGER NOT NULL REFERENCES parameters(id) ON DELETE CASCADE,
  PRIMARY KEY (user_category_id, parameter_id)
);
CREATE INDEX idx_puc_parameter ON parameter_user_categories(parameter_id);
`,
  },
  {
    version: 7,
    name: 'user_category_order',
    sql: /* sql */ `
ALTER TABLE user_categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
UPDATE user_categories SET sort_order = id;
`,
  },
  {
    version: 8,
    name: 'category_parameters',
    sql: /* sql */ `
-- extra (many-to-many) membership of a parameter in a system category, e.g. "Basic Parameters"
CREATE TABLE category_parameters (
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  parameter_id INTEGER NOT NULL REFERENCES parameters(id) ON DELETE CASCADE,
  PRIMARY KEY (category_id, parameter_id)
);
CREATE INDEX idx_cp_parameter ON category_parameters(parameter_id);
`,
  },
  {
    version: 9,
    name: 'parameter_function_links',
    sql: /* sql */ `
-- secondary mapping: a parameter that the manual ties to ANOTHER common function (shown in comparisons)
CREATE TABLE parameter_function_links (
  parameter_id INTEGER NOT NULL REFERENCES parameters(id) ON DELETE CASCADE,
  function_id INTEGER NOT NULL REFERENCES common_functions(id) ON DELETE CASCADE,
  equivalence TEXT,
  note TEXT,
  PRIMARY KEY (parameter_id, function_id)
);
CREATE INDEX idx_pfl_function ON parameter_function_links(function_id);
`,
  },
];
