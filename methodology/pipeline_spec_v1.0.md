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

The pipeline applies conservative detection criteria to minimise false positives in a clinical safety context:

- A cascade is only flagged when **all three elements** (index drug class, ADE/symptom, cascade drug class) are present in the extracted medication list and match a KB entry.
- Temporal plausibility must be **T0 + T1 or T0 + T2**; TX alone does not generate a positive flag (it generates a "temporally indeterminate" advisory instead).
- DDI alerts from `ddi_watchlist.json` are surfaced independently of cascade confirmation and are never suppressed.
- CONTRAINDICATED interactions are displayed with the highest visual prominence regardless of cascade plausibility rating.
- When confidence is low (e.g., TX grade, single weak KB match), the output is labelled "possible" rather than "probable" or "confirmed".
- The system never recommends stopping or changing a medication; it surfaces information for clinician review only.

---

## 5. Known Limitations (v1.0)

1. **Limited KB coverage.** Version 0.1 of the knowledge base includes a curated but intentionally small set of well-evidenced cascade patterns. Many clinically relevant cascades are not yet represented.
2. **No real LLM integration.** In the current baseline, steps 2–5 (Agents 1–5) display placeholder interfaces. Full agent integration is planned for a future version.
3. **Free-text extraction accuracy.** When agent integration is added, extraction quality will depend on the quality and completeness of the clinical note provided.
4. **English and Spanish only.** The KB and UI support English and Spanish. Other languages are not supported.
5. **No structured data import validation.** Dispensing CSV import accepts any well-formed CSV; field mapping is not validated against a fixed schema.
6. **Temporal grading is heuristic.** Start dates inferred from free text are approximate; the TX grade will be common in real-world use.
7. **Not a medical device.** This tool is for informational and educational purposes only. It has not been validated in a clinical trial or registered as a medical device. Clinical decisions must not be based solely on its output.
