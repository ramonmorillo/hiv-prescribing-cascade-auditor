# HIV Prescribing Cascade Auditor — Pipeline Specification v1.0

**Date:** 2026-03-02
**Status:** Stable baseline

---

## 1. Architecture Overview

The HIV Prescribing Cascade Auditor is a **local-first** web application. All processing occurs in the user's browser; no clinical data is transmitted to external servers and no API calls are made to third-party services.

Key architectural principles:

- **No external API calls.** The knowledge base (KB) is loaded as static JSON files served alongside the application. No LLM or cloud service is contacted at runtime.
- **Browser-only storage.** Case state is persisted exclusively in the browser (`localStorage`). Data never leaves the device.
- **Static deployment.** The application consists of plain HTML, CSS, and JavaScript files and can be served from any static file host (GitHub Pages, local HTTP server, etc.).
- **Offline capable.** After the initial page load the application functions fully offline.

---

## 2. Processing Pipeline (as implemented)

**Corrected 2026-11-13 (Fase 0, HAL-08).** Earlier versions of this section described a workflow of "five conceptual agents" (Extractor, Normaliser, Detector, Planner, Verifier) and stated that steps 2–5 were placeholders awaiting LLM integration. Neither was true of the implementation: there are no agents and no language model. The pipeline is a single deterministic function, `ClinicalEngine.buildCaseModel()` (`clinical-engine.js`), whose output (the `CaseModel`) is rendered by `app.js` and serialized by `report-contract.js`. The same note and the same KB always produce the same result.

| Stage | Implementation | Output in `CaseModel` |
|---|---|---|
| 1. Input | Clinician pastes a pseudonymised free-text note (step 1). | — |
| 2. Medication extraction | `buildDrugResolver()` (dictionary, fixed-dose combinations, cascade-rule labels) and `resolveClassifiedMentions()`; each mention is classified as active / negated / discontinued / never started / conditional, scoped to the mention it governs. | `medications`, `allMedicationMentions`, `inactiveOrNegatedMedications` |
| 3. Problems and measurements | `detectActiveProblems()` through the central terminology (`kb/clinical_terminology.json`). | `activeProblems`, `clinicalMeasurements` |
| 4. Cascade evaluation | `evaluateDrugDrugCascades()` and `evaluateSymptomBridgeCascades()`; each candidate classified by `classifyCascadeSignal()` (§4). | `possibleCascades` |
| 5. Interactions | `evaluateCurrentInteractions()` over `ddi_watchlist.json` explicit participants, ordered by severity. | `currentInteractions` |
| 6. Global medication alerts | `buildGlobalMedicationAlerts()` (anticholinergic burden, CNS-depressant burden, NSAID duplication). | `globalMedicationAlerts` |
| 7. Coverage and missing data | `detectUnrecognizedMedicationCandidates()` (prescription-like text no medicine resolved) and missing-information rules. | `missingInformation`, `unrecognizedMedicationCandidates` |
| 8. Professional review | Optional confirmed medication / problem review (step 2) re-runs the same pipeline on the reviewed input; per-finding verdict in step 5. | `reviewedInputApplication`, `reviewAudit` |
| 9. Report | `report-contract.js` builds one report for screen, clinical text, JSON and CSV. | — |

### Verification layers

Planning and verification are **not** performed by a model. Instead the engine and the repository enforce explicit, testable checks:

- **Input coverage (runtime).** Prescription-like text that resolves to no medicine is reported as incomplete coverage in steps 2, 4, 5 and the report; no screen shows a reassuring result while coverage is incomplete.
- **Output completeness (runtime).** Every computed interaction is rendered on screen, in the clinical text and in the CSV (`tests/ddi-display.test.js`).
- **KB reachability (CI).** Every interaction participant must resolve to a dictionary medicine and fire its rule end to end in Spanish and English (`tests/kb-ddi-coverage.test.js`); cascade-rule drug names unknown to the dictionary are held to a shrink-only baseline.
- **Behavioural regression (CI).** The full suite (`npm test`) must pass on every pull request to `main`.

## 3. Temporal Grading Definition

Each drug in the medication list is classified into one of four temporal grades based on its chronological relationship to candidate ADEs.

| Grade | Label | Definition |
|-------|-------|------------|
| **T0** | Index drug (established) | Drug present **before** the onset of the candidate ADE. Plausible causative agent. |
| **T1** | Early cascade candidate | Drug started **within the typical time-to-ADE window** defined in the KB for this pattern (usually < 90 days after T0). High temporal plausibility. |
| **T2** | Late cascade candidate | Drug started **after the typical window** but in a clinically plausible timeframe (90–365 days). Moderate temporal plausibility. |
| **TX** | Temporally indeterminate | Start date unknown or insufficient temporal information to classify. Cascade cannot be confirmed or excluded on temporal grounds alone. |

Temporal grading informs — but does not solely determine — the final plausibility rating. Clinical context always takes precedence.

---

## 4. Conservative Detection Logic

**Updated 2026-09-14** — see `KB_REFERENCE.md` §"Fichero 5" and `kb/CHANGELOG.md` v2.2.0 for the audit that produced the classification scheme below; the old T0/T1/T2/TX-only wording in this section pre-dates that audit and has been superseded by the classification engine actually implemented in `clinical-engine.js`.

The pipeline applies conservative detection criteria to minimise false positives in a clinical safety context. A cascade signal requires that both the index drug class and the cascade drug class are present in the extracted medication list and match a KB entry (`index_drug_examples`/`cascade_drug_examples`) — but presence of both drugs alone is **never** sufficient to call it a supported cascade. Every `drug_drug` signal is additionally classified into exactly one of five levels, computed by `ClinicalEngine.classifyCascadeSignal()`:

| Classification | Meaning | UI label (ES) |
|---|---|---|
| `supported_possible_cascade` | Intermediate problem explicitly active in the note, compatible chronology, no documented alternative indication, no measurement discordance. | "Posible cascada con evidencia suficiente para revisión" |
| `possible_but_incomplete` | Intermediate problem active but chronology unknown, OR an alternative indication is also documented, OR a linked clinical measurement contradicts the stated diagnosis (e.g. a single 130/80 mmHg reading labelled "hipertensión"). | "Posible cascada, información incompleta" |
| `pharmacological_match_only` | Only the two drug classes coincide; the intermediate problem is never mentioned in the note at all. This is the classification a bare drug×drug KB match degrades to when nothing verifies it — the pre-audit engine presented this case as a full cascade. | "Coincidencia farmacológica de baja certeza" |
| `not_evaluable` | The intermediate problem is mentioned only in hedged/suspected terms ("posible", "sospecha de"). | "No evaluable por falta de cronología" |
| `discarded` | The intermediate problem is explicitly negated, is a documented antecedent/chronic condition pre-dating the index drug, or a documented alternative indication exists with no corroborating evidence of the cascade's own ADE. | "Descartada por el sistema (evidencia incompatible)" — distinct from "Descartada tras validación profesional", reserved for the clinician's own manual verdict (Step 5). |

Additional rules:
- DDI alerts from `ddi_watchlist.json` are surfaced independently of cascade classification and are never suppressed.
- Patient-level clinical context modifiers (age, frailty, renal/hepatic impairment, polypharmacy, fall risk, CV risk, dementia — `kb_clinical_modifiers.json`) may raise a signal's confidence one level and attach a context note. Drug-burden modifiers that describe the medication list as a whole rather than one specific drug pair (anticholinergic burden, CNS-depressant burden) are **never** attached to a cascade signal; they are always surfaced as their own `globalMedicationAlerts` entry, structurally separate from `possibleCascades`.
- The system never recommends stopping or changing a medication; it surfaces information for clinician review only. No classification level is ever rendered as "confirmed" — that word is reserved for the clinician's own manual verdict, recorded independently in Step 5.

---

## 5. Known Limitations

1. **Limited KB coverage.** The knowledge base is a curated subset of cascade and interaction patterns; many clinically relevant patterns are not represented. Interaction alerts cover only `ddi_watchlist.json` rules and recognised medicines: the absence of an alert does not rule out an interaction.
2. **Term-based extraction, no language model.** Medicines, problems and their status are recognised by dictionary and pattern matching. Spelling variants, abbreviations and brands not in the dictionary are not recognised; when they carry a dose or frequency they are reported as incomplete coverage, otherwise they may be missed silently.
3. **Unverifiable conditions.** Dose, route and duration conditions of an interaction rule (e.g. oral vs intramuscular, pulmonary-hypertension dose) are not verified from the note; they are shown as an applicability note with the alert.
4. **Chronology is heuristic.** Dates inferred from free text are approximate; undetermined chronology is common in real notes.
5. **English and Spanish only.**
6. **No clinical validation yet.** Sensitivity and positive predictive value have not been measured against an annotated corpus. Fase 0 knowledge-base additions are pending clinical validation (`docs/validation/fase0-ddi-participants.md`).
7. **Regulatory status under evaluation.** The tool has not completed regulatory assessment and does not bear CE marking; its qualification and classification under Regulation (EU) 2017/745 must be established from its intended purpose before open clinical deployment. Outputs must be reviewed by a qualified professional.
