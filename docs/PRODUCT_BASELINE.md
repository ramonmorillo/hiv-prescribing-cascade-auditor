# Product baseline

## Frozen reference

| Field | Baseline |
|---|---|
| Product | HIV Prescribing Cascade Auditor |
| Software version | 1.0.0 |
| Reference commit | `14cf94e43cb8aea0eee948dbf4f91d4d85b023a4` |
| Freeze date | 2026-09-17 |
| Maturity | Research prototype / TRL 5 |
| Test baseline | 9 suites, 1,750 assertions |
| Runtime architecture | Static, browser-only, local-first |
| Supported languages | Spanish and English |

This reference is the comparison point for the professionalization programme. It freezes observed behavior; it does not assert clinical validation, regulatory clearance, or fitness for unsupervised clinical use.

## Product boundaries

- The application supports qualified professionals reviewing possible prescribing cascades.
- Automated findings are hypotheses for professional verification, not diagnoses or treatment instructions.
- Clinical logic lives in `clinical-engine.js`; `app.js` owns interface and state orchestration.
- Curated clinical content lives in `kb/prod/`; development content remains separate in `kb/dev/`.
- Case state is stored locally in the browser. No backend, account system, or clinical-record integration is part of this baseline.
- Only pseudonymised example or test data may be committed.

## Governance

Ramón Morillo Verdugo and Cecilia Solís Martín are coauthors and equal co-owners (50% each). Intellectual-property registration: 04/2026/2614.

Regulatory qualification and classification under Regulation (EU) 2017/745 must be established from the intended purpose before open clinical deployment. Until that work and the planned validation are complete, public materials must describe the application as clinical decision support under evaluation.

## What the freeze protects

The regression suite is the executable baseline. A pull request must not silently alter:

- drug and problem extraction;
- cascade candidates, evidence, certainty, or exclusions;
- interaction and global-medication alerts;
- bilingual report meaning;
- import, export, or locally persisted case semantics.

Changes to any protected area require explicit clinical-impact documentation, focused acceptance cases, full regression, and the review gate defined in [`RELEASE_GATES.md`](RELEASE_GATES.md).

## Deliberately outside this baseline

- prospective clinical validation;
- formal usability and accessibility validation;
- regulatory classification and quality-management implementation;
- production-domain, security, analytics, and incident-response decisions;
- redesign of the interface and design system.

These are planned workstreams, not properties claimed by version 1.0.0.
