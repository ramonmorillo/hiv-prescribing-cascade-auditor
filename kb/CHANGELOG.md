# Knowledge Base Changelog

## Unreleased — 2026-09-21: resolved near-duplicate rule pairs and unlinked symptom bridges

**Fixes duplicate/contradictory cascade cards for the same clinical finding**, reported against the production demo case and confirmed systematically against the full active catalogue (prod + dev). Full audit trail in `docs/audit/02-registro-hallazgos.md` (HAL-02) and `docs/audit/03-auditoria-kb.md`.

### Changed — near-duplicate rule pairs merged (`kb/{prod,dev}/kb_core_cascades.json`)

- Nine pairs of active rules that `kb/dev/kb_validator.js`'s own near-duplicate detector flags (index-drug overlap ≥0.75, cascade-drug overlap ≥0.75, intermediate-problem-text overlap ≥0.5) were reviewed and merged, using the same `status: "merged"` / `merged_into` / `merged_from` mechanism already used for CC050→CC033 and CC061→CC001: **CC042→CC003, CC045→CC007, CC070→CC013, CC082→CC019, CC053→CC023, CC079→CC025, CC068→CC026, CC067→CC027, CC065→CC028**. In every pair the surviving rule is the lower-numbered, originally-referenced entry; the merged rule is the higher-numbered entry bulk-imported from `kb/dev/prescribing_cascades_CC041_CC090_FINAL.json` (no bibliographic reference of its own). The surviving rule's `index_drug_examples`/`cascade_drug_examples` were expanded with the union of both rules' examples, so no detection capability is lost. CC007 and CC019 also had their `appropriateness` elevated to `often_inappropriate` (the more specific of the two source values, matching the 2026-09-14 precedent). Full rationale per pair in `kb/kb_cascade_registry.md`.
- The operational near-duplicate detector now reports zero unreviewed overlapping pairs against the production catalogue (previously nine).

### Changed — symptom-bridge entries linked to the formal rules they overlap with (`kb/{prod,dev}/kb_symptoms.json`)

- `ClinicalEngine.evaluateSymptomBridgeCascades()` derives each symptom entry's `linked_rule_ids` by scanning its own `cascade_relevance` free text for `CC###`/`VIH###` tokens (the mechanism that already consolidates SYM008 into CC004). Nine of the ten symptom-bridge entries structurally overlapped with a formal drug_drug rule (same index-drug class AND same cascade-drug class) without ever naming it, so the same clinical finding could render as two independent cards — e.g. amitriptyline→constipation→macrogol produced both a CC013 card and an unlinked SYM001 card. Added the missing rule references to `cascade_relevance` (existing wording preserved, nothing removed) for SYM001 (→CC008, CC013, CC090), SYM002 (→CC014), SYM004 (→CC021), SYM005 (→CC016), SYM006 (→CC022), SYM007 (→CC015, VIH005), SYM008 (additionally →CC027, alongside the existing CC004), SYM009 (→CC015, CC032, CC037, CC087), SYM010 (additionally →CC010, CC058, CC074, CC086, alongside the existing VIH004).
- Each addition was verified against the symptom's own `caused_by_drug_examples`/`treated_by_drug_examples` lists before being added — no rule reference was added without a genuine, mechanism-consistent drug-class overlap.

### Tests

- `tests/kb-audit.test.js`: updated to assert zero remaining unreviewed overlapping pairs (was nine).
- `tests/regression.test.js`: the oxybutynin/oxibutinina→constipation/estreñimiento→lactulose cases now assert consolidation into CC013 (with SYM001 as provenance), mirroring the existing CC004/SYM008 assertion, instead of asserting a standalone symptom-bridge card.
- `tests/multi-candidate-cascades.test.js`, `tests/demo-case-regression.test.js`: added regression coverage for the redundant composite/bare index-drug match fix in `clinical-engine.js` (VIH027/cobicistat, CC072/ritonavir) and for the `candidate_role` labelling of genuine multi-candidate cascades (CC001).

## Version 2.3.0 — 2026-09-14 (second round)

**Clinical-engine audit, second round: negation/temporality with historical vs. current scope, event-sequence model, medication↔indication linking, VIH003 logic fix, scoped DDI display, real anticholinergic burden scale, four-dimension label system, non-hardcoded priority filtering.**

Full root-cause analysis and design in `docs/clinical-engine-fix-audit.md`. Triggered by a second reported index case (56F, HIV+ on Dovato, anastrozole + amitriptyline, NSAID started for joint pain, explicit "no antecedentes de hipertensión" followed by a later, separately-dated hypertension diagnosis and enalapril) that the tool mishandled in 8 distinct ways — see the audit doc §1 for the full list. This version's KB changes are paired with a `clinical-engine.js`/`app.js` rewrite; the two must be read together.

### New file
- `kb/anticholinergic_burden_scale.json` (v1.0.0, track-independent): sourced ACB (Anticholinergic Cognitive Burden) scale, Boustani et al. 2008 — 15 score-3 entries only (score 1-2 deliberately excluded pending further pharmacological review, see the file's own `pending_review_note`). Replaces the old `CM006` keyword-trigger "carga anticolinérgica elevada" alert, which listed every detected drug as a contributor regardless of actual anticholinergic activity.

### Changed
- `kb/{prod,dev}/kb_vih_modifiers.json`: VIH003 renamed from `"INSTI (DTG/BIC/RAL) + TDF → Ganancia de peso → Antidiabético/Antihipertensivo"` to `"INSTI (DTG/BIC/RAL) → Ganancia de peso → Antidiabético/Antihipertensivo"` — the rule's own `index_drug_class`/`index_drugs_examples` never required TDF co-administration; the "+ TDF" in the title was never backed by the rule's logic. Added `name_correction_note_es/en` documenting the change.
- `kb/{prod,dev}/kb_vih_modifiers.json`: added `ddi_required_drugs` (CNF drug-requirement groups) to the 5 rules whose `ddi_warning` names a third-party drug not already covered by the rule's own matched index/cascade pair: VIH001 (`simvastatin`/`lovastatin`), VIH003 (`metformin`), VIH009 (`rivaroxaban`/`apixaban`), VIH011 (`rifampicin`), VIH014 (`rifampicin`). This is the fix for "dolutegravir-metformin DDI warning shown with no metformin in the note" (VIH003) and the same pattern in the other four. The remaining rules with a `ddi_warning` were reviewed and found to already have their DDI participants covered by the rule's own index/cascade match; a further 14 are flagged pending review in `kb/kb_cascade_registry.md` rather than silently left as-is or guessed.
- `kb/{prod,dev}/kb_core_cascades.json`: CC001's `recommended_first_action_es/en` rewrote a blanket, HIV-unrelated "En PVVIH, preferir paracetamol cuando sea posible" (CC001 has no HIV-specific mechanism at all — the NSAID→hypertension pathway is prostaglandin-mediated and identical in any patient) into a general, mechanism-appropriate recommendation (review NSAID necessity/duration, temporal relationship, rule out other causes, consider withdrawal/substitution with BP reassessment). `kb/dev/` was additionally missing the `_es` field entirely (only had `_en`); added.
- `kb/{prod,dev}/clinical_problems.json`: added `"dolor articular"`/`"joint pain"` to CPB005's keyword lists (osteoarthritis/chronic musculoskeletal pain), and `"VIH003"` to CPB003's (type 2 diabetes) `source_cascade_ids`.
- `kb/{prod,dev}/kb_clinical_modifiers.json`: CM006 (the old "carga anticolinérgica elevada" keyword trigger) is superseded by `kb/anticholinergic_burden_scale.json` and skipped by the engine (`SUPERSEDED_MODIFIER_IDS`); the JSON entry itself is kept, unmodified, for traceability rather than deleted. CM007 (CNS-depressant burden) is unchanged in logic; its `drugs_involved` output now reflects only the mentions that matched CM007's own trigger keywords, not the full drug list (the same class of bug CM006 had).

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
