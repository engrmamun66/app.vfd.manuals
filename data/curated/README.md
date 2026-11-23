# Curated extraction files

Each `*.json` file in this folder holds technical records extracted from ONE manufacturer
document. Files are imported with `npm run import:curated` into the staging/review area.

Rules (see master prompt §2):

- Every value must be copied from the manual. Never infer, assume or use outside knowledge.
- Unknown field → `null`. Never guess defaults, ranges, units or scaling.
- `evidence_quote` must be text copied verbatim from the cited page (≤ 400 chars). The importer
  checks the quote against the extracted PDF text of that page; mismatches are flagged
  `Requires Manual Verification`.
- `page_index` = 1-based physical PDF page index. `printed_page` = number printed on the page
  (e.g. `"4-12"`) or `null` if not clearly visible. They are stored separately.
- All AI-assisted extraction is imported as `Unverified` and must be approved by a human.

## Format

```json
{
  "document_file": "vfd-manuals/Delta/Delta-VFD-EL-Series-Users-Manual.pdf",
  "document_title": "title as printed in the manual",
  "document_revision": "revision/edition string as printed, or null",
  "brand": "Delta",
  "model": "VFD-EL",
  "model_evidence": { "page_index": 1, "evidence_quote": "..." },
  "extraction_method": "ai-assisted-reading",
  "parameters": [
    {
      "common_function": "maximum-frequency",
      "equivalence": "Exact Equivalent | Functionally Similar | Partially Equivalent | Insufficient Documentation",
      "equivalence_note": "why, if not exact (or null)",
      "code": "01.00",
      "name": "Maximum Output Frequency",
      "description": "short description using the manual's wording",
      "unit": "Hz",
      "default_value": "60.00",
      "min_value": "50.00",
      "max_value": "600.0",
      "resolution": "0.01",
      "access": "Read-Write | Read | Write | null",
      "setting_conditions": "e.g. 'cannot be changed during run' if documented, else null",
      "options": [{ "value": "0", "label": "..." }],
      "page_index": 45,
      "printed_page": "4-12",
      "section": "section heading as printed",
      "table_ref": "table/figure label or null",
      "evidence_quote": "verbatim text from that page"
    }
  ],
  "modbus_registers": [
    {
      "common_function": "reg-output-frequency",
      "name": "Output frequency",
      "original_address": "2103H",
      "address_format": "HEX | Decimal | Parameter-derived",
      "register_type": "Holding | Input | Coil | Discrete | null",
      "function_codes": "03H",
      "access": "Read | Write | Read-Write | null",
      "data_length_words": 1,
      "data_type": "UINT16 | INT16 | ... | null",
      "scaling": "as documented, e.g. '0.01 Hz' or null",
      "unit": "Hz",
      "bit_definitions": [{ "bit": "0-1", "meaning": "..." }],
      "description": "...",
      "page_index": 120,
      "printed_page": "5-30",
      "section": "...",
      "table_ref": "...",
      "evidence_quote": "verbatim text"
    }
  ],
  "notes": ["anything uncertain, conflicting, or unreadable"]
}
```
