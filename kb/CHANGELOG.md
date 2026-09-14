# Knowledge Base Changelog

## Version 2.2.0 — 2026-09-14

**Clinical-engine audit: fix drug catalog errors, consolidate duplicate cascade rules, add active-problem dictionary, wire the already-existing `ade_treatment_map.json` into detection.**

This release follows a full audit of the detection pipeline triggered by a reported index case (HIV+ patient on Dovato with an NSAID → single-reading "hypertension" → enalapril sequence that the tool presented as a confirmed cascade without ever checking whether hypertension was actually documented). Full root-cause analysis, the new CaseModel/classification design, and file-by-file rationale are in `KB_REFERENCE.md` and the accompanying audit report. This is a KB + engine change together — `clinical-engine.js` (new) is the only place these files are consumed by app.js from now on.

### New file
- `kb/prod/clinical_problems.json` + `kb/dev/clinical_problems.json` (v1.0.0): centralizes the active-problem dictionary (hypertension, heart failure, type 2 diabetes, GERD/dyspepsia, osteoarthritis, Parkinson's disease) that previously lived as a hardcoded `ALTERNATIVE_INDICATION_MAP` array inside `app.js`. Drives `CaseModel.activeProblems`, intermediate-problem verification for `drug_drug` cascades linked via `source_cascade_ids`, and alternative-indication detection. Each hypertension entry additionally documents that a single blood-pressure reading does not equal a confirmed diagnosis (`diagnostic_note_es/en`, `measurement_type`).
- `kb/kb_cascade_registry.md`: Fase-8 audit table of every active core/VIH cascade rule (evidence source or explicit "PENDIENTE DE REVISIÓN CLÍNICA" flag, required conditions, exclusions). Generated from the JSON KB; regenerate after any rule change.

### Fixed — drug catalog errors (root cause of "Dovato → dolutegravir only, no lamivudine")
- `kb/drug_dictionary.json`: **Dovato, Triumeq, Juluca** were miscatalogued as single-ingredient *variants* of `dolutegravir` (collapsing a 2-3 drug combination to one ingredient); **Kivexa/Epzicom** were miscatalogued as variants of `abacavir`; **Truvada/Descovy** were separately miscatalogued in `app.js`'s `MANUAL_ALIASES` as variants of `tenofovir disoproxil fumarate` (Descovy's tenofovir is actually **alafenamide**, not disoproxil fumarate — a factual error, not just a missing entry). All six brands removed from single-ingredient variant lists.
- `kb/drug_combinations.json` (v1.1.0): added Dovato (dolutegravir+lamivudine), Triumeq (dolutegravir+abacavir+lamivudine), Juluca (dolutegravir+rilpivirine), Kivexa/Epzicom (abacavir+lamivudine), Truvada (emtricitabine+tenofovir disoproxil fumarate), Descovy (emtricitabine+tenofovir alafenamide) as proper fixed-dose combinations, each ingredient extracted as its own medication with brand traceability preserved.
- `kb/drug_dictionary.json`: added **anastrozole** (Antineoplastic / Aromatase inhibitor), entirely absent from the dictionary before this release.
- `kb/prod/kb_vih_modifiers.json` + `kb/dev/kb_vih_modifiers.json`: removed a redundant literal `"AZT"` entry from two cascades' `index_drugs_examples` (alongside the already-present `"zidovudine"`). Because the drug resolver treats every list entry as its own independent canonical, listing both created two unrelated canonical drugs and silently defeated the `AZT → zidovudine` alias.

### Fixed — near-duplicate cascade rules (root cause of "7 posibles cascadas" over-detection)
- **CC061 merged into CC001** (both: AINE/NSAID → Hipertensión → Antihipertensivo). CC061's broader index list (etoricoxib, ketoprofen, indomethacin, meloxicam) and `often_inappropriate` appropriateness were folded into CC001; CC061 kept in the JSON with `status: "merged"`, `merged_into: "CC001"` for traceability, excluded from active detection.
- **CC050 merged into CC033** (both: Estatina → Mialgia → Analgésico/AINE). CC050's extra cascade-drug example (codeine) folded into CC033; CC050 kept with `status: "merged"`.

### Removed — dead files
- `kb/kb_core_cascades.json`, `kb/kb_vih_modifiers.json`, `kb/ddi_watchlist.json` (repo root): stale pre-PROD/DEV-split copies (338/187/173 lines vs. 3800+/1100+/900+ in `kb/prod/`), never read by `loadKB()` (which only loads from `kb/prod/` or `kb/dev/`, plus the track-independent `kb/drug_dictionary.json` and `kb/drug_combinations.json`). Confirmed unused before deletion; not a rule removal.

## Version 2.1.1 — 2026-03-12

**Promote therapeutic plausibility KB to production: `ade_treatment_map.json` v1.0.0**

### New file
- `/kb/dev/ade_treatment_map.json` (v1.0.0, `last_updated` 2026-03-11): 25 ADE entries covering the main adverse effects that drive prescribing cascades. Each entry includes bilingual ADE terms and synonyms (`ade_en`/`ade_es` + synonym arrays), treatment drug classes and examples (EN + ES), a `plausibility_weight` field (`high`/`medium`), links back to source cascade IDs, and clinical references.
- `/kb/prod/ade_treatment_map.json` (v1.0.0, `last_updated` 2026-03-12): production copy, schema identical to dev, date bumped to promotion date.

### Coverage (25 ADEs)
| ATM ID | ADE (EN) | Plausibility weight |
|--------|----------|---------------------|
| ATM001 | Blood pressure elevation | high |
| ATM002 | Nausea | high |
| ATM003 | Constipation | high |
| ATM004 | Peripheral oedema | high |
| ATM005 | Hypokalemia | high |
| ATM006 | Osteoporosis | high |
| ATM007 | Dyspepsia | high |
| ATM008 | Depression | high |
| ATM009 | Insomnia | medium |
| ATM010 | Urinary incontinence / overactive bladder | high |
| ATM011 | Hypomagnesemia | high |
| ATM012 | Vitamin B12 deficiency | high |
| ATM013 | Hypothyroidism | high |
| ATM014 | Hyperglycemia / Diabetes | high |
| ATM015 | Hyperlipidemia | high |
| ATM016 | Hyponatremia | medium |
| ATM017 | Hyperkalemia | high |
| ATM018 | Orthostatic hypotension | medium |
| ATM019 | Vitamin D deficiency | high |
| ATM020 | Myalgia / Muscle pain | medium |
| ATM021 | Confusion / Delirium | medium |
| ATM022 | Urinary retention | high |
| ATM023 | Dizziness | medium |
| ATM024 | Metabolic syndrome | medium |
| ATM025 | Anxiety | medium |

### app.js
- `loadKB()`: added `adeTreatmentMap` key → `{folder}/ade_treatment_map.json` so the file is fetched for both `dev` and `prod` tracks and stored in `state.kb.adeTreatmentMap`.

---

## Version 2.0.0 — 2026-03-10

**KB validation run: `kb_validator.js` against `kb/dev/kb_core_cascades.json` (v2.0.0, last_updated 2026-03-04)**

### `validateKBStrict` — FAIL

- **ok:** false
- **Errors (68):** All 40 cascades missing `ade_es`; CC013–CC040 also missing `name_es`.
- **Warnings:** none
- **Conclusion:** Expected for a KB where Spanish translations are not yet explicitly authored. Strict mode flags all missing `*_es` fields as errors with no automatic fallback.

### `validateKBOperational` — PASS

- **ok:** true
- **Errors:** none
- **Warnings:** none
- **Fallback summary — EN→ES auto-fill applied to 40/40 cascades (148 total field fills):**

| Field                        | Cascades filled |
|------------------------------|-----------------|
| `ade_es`                     | 40              |
| `ade_mechanism_es`           | 40              |
| `recommended_first_action_es`| 40              |
| `name_es`                    | 28              |

- **Conclusion:** KB is structurally sound and operationally valid. All required fields are present in English; the operational validator auto-fills Spanish fields from English counterparts. No structural or type errors detected.

### Action items

- Spanish translations (`name_es`, `ade_es`, `ade_mechanism_es`, `recommended_first_action_es`) should be explicitly authored for all cascades to pass `validateKBStrict` before promotion to production.

---

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
