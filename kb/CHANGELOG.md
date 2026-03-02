# Knowledge Base Changelog

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
