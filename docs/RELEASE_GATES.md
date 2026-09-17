# Release gates

Every change is classified before implementation. Higher-risk changes inherit all lower-risk checks.

| Change class | Examples | Required evidence | Required review |
|---|---|---|---|
| Documentation / operations | Governance, CI, repository metadata | Full regression; diff review | Maintainer |
| Presentation | Layout, tokens, responsive behavior, non-clinical copy | Full regression; ES/EN parity; desktop/mobile; accessibility check | Product/design and maintainer |
| Workflow / data | Case state, import/export, reports, privacy behavior | Focused tests plus full regression; migration and rollback notes | Product, engineering, privacy/security as applicable |
| Clinical engine | Extraction, thresholds, classification, evidence, alerts | Acceptance cases; negative cases; full regression; documented clinical rationale | Clinical reviewer and engineering |
| Knowledge base | New or edited cascade, interaction, synonym, or source | Traceable source; KB version and changelog; structural validation; full regression | Clinical reviewer independent of the author where practicable |

## Mandatory gates for `main`

1. The pull request has one coherent purpose and a reversible scope.
2. The clinical-impact and KB-impact declarations are completed.
3. No real or identifiable patient information appears in the repository.
4. Spanish and English are equivalent for every affected user-facing concept.
5. `npm test` passes in the `Clinical regression` workflow.
6. Reviewers required by the change class approve before merge.
7. User-visible or clinical changes are recorded in `CHANGELOG.md`.

Branch protection should require the `Node.js 22 / full test suite` check and prevent direct pushes to `main`. GitHub administration of that protection is an operational action outside this repository change.

## Version and release train

| Train | Purpose | Exit condition |
|---|---|---|
| `1.1.x` | Professional visual system, responsive shell, accessibility foundations, bilingual content architecture | Approved UI baseline with unchanged clinical behavior |
| `1.2.x` | Workflow clarity, report quality, evidence traceability, safety and privacy hardening | Usability and safety acceptance criteria met |
| `2.0.0-rc.x` | Locked clinical candidate for formal validation | Frozen engine and KB; validation protocol and regulatory path approved |
| `2.0.0` | Production candidate | Evidence, operational controls, and applicable regulatory obligations satisfied |

A release candidate is immutable except for documented corrections. Any clinical-engine or production-KB correction creates a new release candidate and restarts the affected verification.

## Rollback

Repository changes must remain revertible as a single pull request. For a released defect, restore the last known-good tagged version, preserve exported case-schema compatibility where possible, and document the incident and corrective action before re-release.
