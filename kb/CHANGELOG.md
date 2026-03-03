# Knowledge Base Changelog

## Version 0.3-dev — 2026-03-03

**DEV KB updated: version 0.3-dev — schema unified + KB validator**

**Summary:** Unified all cascade entries to a single canonical schema; added `/kb/dev/kb_validator.js`; applied clinical adjustments; moved CORE-033 to `non_cascade_iatrogenic`.

### Schema changes
- Defined and enforced a canonical schema for every entry. Required fields: `id`, `name_es`, `name_en`, `index_drug_classes` (array), `index_drug_examples` (array), `ade_es`, `ade_en`, `cascade_drug_examples` (array), `confidence`, `age_sensitivity`, `risk_focus` (array), `differential_hints` (array), `appropriateness`.
- Optional fields: `ade_mechanism_es/en`, `cascade_drug_class`, `time_window_days_min/max`, `recommended_first_action_es/en`, `references`.

### Migrations — CC001–CC012 (old schema → canonical)
- `index_drug_class` (string) → `index_drug_classes` (array).
- `index_drugs_examples` → `index_drug_examples`; `cascade_drugs_examples` → `cascade_drug_examples`.
- `plausibility` → `confidence`; removed `evidence_level`, `prevalence_es/en`.
- `time_to_ade_typical_days_min/max` → `time_window_days_min/max`.
- `clinical_note_es/en` → `recommended_first_action_es/en`.
- Added `age_sensitivity`, `risk_focus`, `differential_hints` (≥5 per entry), `appropriateness` to all CC entries.

### Migrations — CORE-013–CORE-040 (new schema → bilingual canonical)
- `ade` (English only) → split into `ade_es` + `ade_en`.
- Added `name_es` (Spanish translations) to all CORE entries.
- `clinical_note_en` → `recommended_first_action_en`; added `recommended_first_action_es`.
- Added `appropriateness` to all entries.

### Clinical adjustments
- **CC008** (Opioid → Constipation → Laxative): `appropriateness` set to `"often_appropriate"`; `recommended_first_action` emphasises prophylactic laxative initiation and PAMORA escalation.
- **CC006** (Corticosteroid → Osteoporosis → Bisphosphonate): `appropriateness` set to `"context_dependent"`.
- **CORE-033** (Antibiotic → C. difficile → Treatment): moved to top-level `non_cascade_iatrogenic` array with `confidence="medium"`, `appropriateness="context_dependent"`, and explanatory `note` field clarifying it is not a classic prescribing cascade.

### New file
- `/kb/dev/kb_validator.js`: exports `validateKB(kbJson)` → `{ ok, errors, warnings }`. Checks required fields, types, enum values, bilingual pair consistency, warns if `differential_hints < 3`. Compatible with browser (window global) and Node.js (module.exports).

### app.js / index.html
- `kb_validator.js` loaded via script tag in `index.html` (before `app.js`).
- `app.js`: `runKBValidation()` called after every `loadKB()`. Errors block loading and display an error panel; warnings show a dismissible non-blocking banner.

---

## Version 0.2-dev — 2026-03-02

**DEV KB updated: version 0.2-dev**

**Summary:** Expanded CORE coverage to ~40 cascades; conservative; added differential hints.

- Added 28 new CORE cascades (CORE-013 through CORE-040) to `/kb/dev/kb_core_cascades.json`.
- New entries focus on high-yield cascades in aging patients (also relevant in PLWH):
  - **Cardio/renal:** beta-blocker→depression, statin→myalgia, loop diuretic→hypokalemia, ACEi/ARB→hyperkalemia, antihypertensive→orthostatic hypotension, amiodarone→hypothyroidism, corticosteroid→hypertension, corticosteroid→edema.
  - **CNS/falls:** benzodiazepine→falls, TCA→urinary retention, gabapentinoid→falls, levodopa→orthostatic hypotension.
  - **Anticholinergic/urinary:** first-gen antihistamine→cognitive impairment, anticholinergic(urinary)→constipation, alpha-1 blocker→orthostatic hypotension, anticholinergic→delirium→antipsychotic, loop diuretic→nocturia→anticholinergic.
  - **GI:** PPI→hypomagnesemia, PPI→B12 deficiency, opioid→nausea, oral iron→constipation, broad-spectrum antibiotic→C. difficile.
  - **Metabolic/steroids:** atypical antipsychotic→metabolic syndrome, atypical antipsychotic→hyperlipidemia, thiazide→hyponatremia, loop diuretic→hypomagnesemia, SSRI/SNRI→hyponatremia, enzyme-inducing antiepileptic→vitamin D deficiency.
- Each new entry includes: `id`, `index_drug_classes`, `index_drug_examples`, `ade`, `cascade_drug_examples`, `confidence`, `age_sensitivity`, `risk_focus`, `differential_hints`, `clinical_note_en`.
- Coverage remains intentionally conservative (confidence defaults to "medium"; "high" only for canonical, well-evidenced patterns).

---

## Version 0.1 — 2026-03-02

**Summary:** Initial basic cascade set

- First release of the HIV Prescribing Cascade Auditor knowledge base.
- Includes core prescribing cascade patterns (`kb_core_cascades.json`): common drug-ADE-cascade triplets drawn from published literature (Rochon & Gurwitz, BMJ 1997 and subsequent evidence).
- Includes HIV-specific ARV cascade modifiers (`kb_vih_modifiers.json`): patterns specific to antiretroviral therapy and PLHIV (people living with HIV).
- Includes critical DDI watchlist (`ddi_watchlist.json`): high-priority drug–drug interactions relevant to cascade detection in PLHIV.
- Coverage is intentionally conservative and limited to well-evidenced cascades. Expansion planned in future versions.
