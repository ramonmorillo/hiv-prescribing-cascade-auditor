# HIV Prescribing Cascade Auditor — Pipeline Specification v1.0

**Date:** 2026-03-02
**Status:** Stable baseline

---

## 1. Architecture Overview

The HIV Prescribing Cascade Auditor is a **local-first** web application. All processing occurs in the user's browser; no clinical data is transmitted to external servers and no API calls are made to third-party services.

Key architectural principles:

- **No external API calls.** The knowledge base (KB) is loaded as static JSON files served alongside the application. No LLM or cloud service is contacted at runtime.
- **Browser-only storage.** Patient state is persisted exclusively in the browser (localStorage / IndexedDB). Data never leaves the device.
- **Static deployment.** The application consists of plain HTML, CSS, and JavaScript files and can be served from any static file host (GitHub Pages, local HTTP server, etc.).
- **Offline capable.** After the initial page load the application functions fully offline.

---

## 2. Five-Agent Workflow

The pipeline is structured as a sequential six-step wizard, driven by five conceptual agents. Each agent corresponds to one processing step between data entry and final report.

### Step 1 — Input (Human)
The clinician provides:
- Patient identifier (pseudonymised)
- Free-text clinical note (copied from the EHR)
- Optional: dispensing/medication CSV export

No agent processing occurs at this step.

### Step 2 — Agent 1: Extractor
**Role:** Structured extraction from the unstructured clinical note.

Outputs:
- List of active medications (drug name, dose, start date where available)
- Identified adverse drug events (ADEs) or symptoms mentioned
- Relevant comorbidities and diagnoses

### Step 3 — Agent 2: Normaliser
**Role:** Temporal ordering and classification of the extracted medication list.

Each drug is assigned a temporal grade (see Section 3). The normaliser produces a chronologically ordered medication timeline and flags candidate index drug / ADE / cascade drug triplets.

### Step 4 — Agent 3: Detector
**Role:** Pattern matching against the knowledge base.

The detector compares candidate triplets to entries in:
- `kb_core_cascades.json` — general prescribing cascade patterns
- `kb_vih_modifiers.json` — ARV-specific cascade patterns
- `ddi_watchlist.json` — critical drug–drug interactions

Each candidate is assigned a plausibility rating (high / medium / low) and flagged DDIs are surfaced alongside the cascade finding.

### Step 5 — Agent 4: Planner
**Role:** Generation of a structured clinical action plan.

For each confirmed or probable cascade, the planner proposes:
- Medication review priorities
- Suggested clinical questions for the prescribing encounter
- Relevant monitoring parameters

### Step 5b — Agent 5: Verifier
**Role:** Internal consistency check and safety review.

The verifier cross-checks the planner output against the KB, flags any contradictions, and ensures that CONTRAINDICATED combinations are prominently highlighted before the report is rendered.

### Step 6 — Report (Output)
A bilingual (English / Spanish) structured report is rendered in the browser. The clinician can export the report as JSON for record-keeping. No data is sent externally.

---

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

## 5. Known Limitations (v1.0)

1. **Limited KB coverage.** Version 0.1 of the knowledge base includes a curated but intentionally small set of well-evidenced cascade patterns. Many clinically relevant cascades are not yet represented.
2. **No real LLM integration.** In the current baseline, steps 2–5 (Agents 1–5) display placeholder interfaces. Full agent integration is planned for a future version.
3. **Free-text extraction accuracy.** When agent integration is added, extraction quality will depend on the quality and completeness of the clinical note provided.
4. **English and Spanish only.** The KB and UI support English and Spanish. Other languages are not supported.
5. **No structured data import validation.** Dispensing CSV import accepts any well-formed CSV; field mapping is not validated against a fixed schema.
6. **Temporal grading is heuristic.** Start dates inferred from free text are approximate; the TX grade will be common in real-world use.
7. **Not a medical device.** This tool is for informational and educational purposes only. It has not been validated in a clinical trial or registered as a medical device. Clinical decisions must not be based solely on its output.
