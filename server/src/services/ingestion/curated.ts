import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';

export interface CuratedParameter {
  common_function?: string | null;
  equivalence?: string | null;
  equivalence_note?: string | null;
  code: string;
  name?: string | null;
  description?: string | null;
  unit?: string | null;
  data_type?: string | null;
  default_value?: string | null;
  min_value?: string | null;
  max_value?: string | null;
  resolution?: string | null;
  access?: string | null;
  setting_conditions?: string | null;
  options?: { value: string; label: string }[] | null;
  page_index?: number | null;
  printed_page?: string | null;
  section?: string | null;
  table_ref?: string | null;
  evidence_quote?: string | null;
  /** Priority tier: Important (core setup/commissioning), Medium, Optional (rarely needed / advanced). */
  importance?: 'Important' | 'Medium' | 'Optional' | null;
  /** Parameter group as printed in the manual, e.g. "F0 Basic Parameters". */
  param_group?: string | null;
}
export interface CuratedRegister {
  common_function?: string | null;
  name: string;
  original_address: string;
  address_format?: string | null;
  register_type?: string | null;
  function_codes?: string | null;
  access?: string | null;
  data_length_words?: number | null;
  data_type?: string | null;
  scaling?: string | null;
  unit?: string | null;
  bit_definitions?: { bit: string; meaning: string }[] | null;
  description?: string | null;
  page_index?: number | null;
  printed_page?: string | null;
  section?: string | null;
  table_ref?: string | null;
  evidence_quote?: string | null;
}
export type KnowledgeKind = 'fault' | 'alarm' | 'warning' | 'troubleshooting' | 'wiring' | 'installation' | 'safety' | 'specification' | 'communication' | 'maintenance' | 'note';
export interface CuratedKnowledge {
  kind: KnowledgeKind;
  code?: string | null;
  title: string;
  description?: string | null;
  cause?: string | null;
  remedy?: string | null;
  details?: Record<string, unknown> | null;
  /** extra manual pages of the same topic (e.g. a wiring section spanning several pages); page_index stays the primary page */
  pages?: number[];
  page_index?: number | null;
  printed_page?: string | null;
  section?: string | null;
  evidence_quote?: string | null;
  importance?: 'Important' | 'Medium' | 'Optional' | null;
}
export interface CuratedFile {
  document_file: string;
  document_title?: string | null;
  document_revision?: string | null;
  brand: string;
  model: string;
  model_evidence?: { page_index?: number; evidence_quote?: string } | null;
  extraction_method?: string;
  parameters?: CuratedParameter[];
  modbus_registers?: CuratedRegister[];
  knowledge_items?: CuratedKnowledge[];
  notes?: string[];
  _file?: string;
}

const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();

/** Finds a curated extraction file whose document_file matches the given manual path. */
export function findCuratedFor(relManualPath: string): CuratedFile | null {
  if (!fs.existsSync(config.curatedDir)) return null;
  for (const f of fs.readdirSync(config.curatedDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(config.curatedDir, f), 'utf8')) as CuratedFile;
      if (data?.document_file && norm(data.document_file) === norm(relManualPath)) return { ...data, _file: f };
    } catch {
      /* invalid file is reported by the import report, not silently used */
    }
  }
  return null;
}

export function listCuratedFiles(): { file: string; document_file?: string; valid: boolean; error?: string }[] {
  if (!fs.existsSync(config.curatedDir)) return [];
  return fs
    .readdirSync(config.curatedDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(config.curatedDir, f), 'utf8'));
        return { file: f, document_file: d.document_file, valid: true };
      } catch (e) {
        return { file: f, valid: false, error: (e as Error).message };
      }
    });
}
