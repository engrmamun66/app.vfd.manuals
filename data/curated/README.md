# Curated extraction files

Each `*.json` file in this folder holds technical records extracted from ONE manufacturer
document. Files are imported with `npm run import:curated` into the staging/review area.

Rules (see master prompt §2):

- Every value must be copied from the manual. Never infer, assume or use outside knowledge.
- Unknown field → `null`. Never guess defaults, ranges, units or scaling.
- `evidence_quote` must be text copied verbatim from the cited page (≤ 400 chars). The importer
  checks the quote against the extracted PDF text of that page; mismatches are flagged
  `Requires Manual Verification`.
- Knowledge items may also list `"pages": [13, 14]` = extra pages of the same topic (e.g. a wiring section over several pages); `page_index` stays the main page. `npm run topics:pages -- --apply` adds further related pages automatically from the page text.
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

---

## Full-manual extraction (format v2)

Goal: import EVERYTHING useful from a manual — every parameter, the communication/Modbus data,
fault & alarm lists, warnings/safety, troubleshooting, wiring/terminals, installation and key specifications.

### Parameters: `importance` + `param_group` (both required for every parameter)

`importance` (exactly one of):

| Tier | Meaning | Typical content |
|------|---------|-----------------|
| `Important` | Needed to commission and run the drive safely | motor nameplate data, run-command source, frequency source/reference, min/max/base frequency, accel/decel time, V/f pattern, motor overload protection, basic I/O function selection, communication setup (address, baud rate, parity, protocol, timeout/loss action), reset/lock/initialization, auto-tune |
| `Medium` | Commonly used features | multi-speed, jog, basic PID, carrier frequency, stall prevention, DC braking, auto-restart, analog scaling, skip frequency, S-curve, torque boost, output terminal functions, display/monitor selection |
| `Optional` | Advanced, rarely changed, fine tuning, read-only monitor values, reserved/manufacturer-specific | extended application functions, counters, history data, OEM/factory parameters |

`param_group` = the group/section name as printed in the manual (e.g. `"F0 Basic Parameters"`, `"Group 02 – V/f Control"`).
Decide `importance` from what the manual says the parameter does, never from guesswork about the product.

### `knowledge_items` (non-parameter manual knowledge)

```json
"knowledge_items": [
  {
    "kind": "fault | alarm | warning | troubleshooting | wiring | installation | safety | specification | communication | maintenance | note",
    "code": "OC1 (display code / terminal name / table id) or null",
    "title": "short title",
    "description": "what it is / means (manual wording)",
    "cause": "documented cause(s) or null",
    "remedy": "documented corrective action or null",
    "details": { "free": "structured extras, e.g. terminal functions, ratings per model, frame layout" },
    "page_index": 123, "printed_page": "8-4", "section": "section heading",
    "evidence_quote": "verbatim text from that page (max 400 chars)",
    "importance": "Important | Medium | Optional"
  }
]
```

One item per fault/alarm code, per warning/caution statement, per troubleshooting symptom, per terminal (or terminal block),
per installation requirement, per specification table row-group, per communication topic (framing, CRC, function codes, exception codes, timing, connector pinout).
Modbus register maps still go in `modbus_registers`.

### Completeness + quality rules

1. Extract ALL parameters (not a sample). Use scripts that parse the page text stored in the DB (`document_pages`), then review.
2. Copy values verbatim; unknown → `null`; never invent or use outside knowledge.
3. `evidence_quote` must appear on the cited `page_index` (checked automatically).
4. Run `npx tsx server/src/cli/check-curated.ts data/curated/<file>.json` until `problems` is empty,
   quote `not_found` is (near) zero, and `possibleMissingParameterCodes` is explained (noise like default values is fine).
5. Keep records already present in an existing curated file (same code/address); add the missing ones and the new fields.
