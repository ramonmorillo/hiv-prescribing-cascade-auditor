## Purpose

<!-- Explain the user or clinical problem. Keep the PR limited to one coherent change. -->

## Scope

- [ ] The files and behavior changed are described below.
- [ ] Unrelated refactors are excluded.
- [ ] A rollback consists of reverting this PR, or an alternative is documented below.

## Safety and clinical impact

- [ ] No clinical logic, thresholds, classifications, warnings, or report semantics change.
- [ ] If any item above changes, the clinical impact and acceptance cases are documented below.
- [ ] No knowledge-base content changes.
- [ ] If the KB changes, sources, reviewer, version, and `kb/CHANGELOG.md` are included.
- [ ] The product remains decision support: no output is presented as a diagnosis or autonomous recommendation.

## Data and privacy

- [ ] No new external request, telemetry, tracker, cookie, or server-side storage is introduced.
- [ ] No identifiable patient data is added to code, fixtures, screenshots, or logs.
- [ ] Export, import, and local-storage effects have been assessed when applicable.

## Spanish and English

- [ ] User-facing content is complete and equivalent in Spanish and English, or this PR has no user-facing text.

## Verification

- [ ] `npm test` passes locally.
- [ ] New or changed behavior has regression coverage, or the reason it does not need it is documented below.
- [ ] The relevant desktop and mobile flows were checked when UI is affected.
- [ ] Accessibility was checked when UI is affected (keyboard, focus, labels, contrast, reduced motion).

## Change description and evidence

<!-- Include test output, screenshots, sources, risk notes, and rollback details as applicable. -->
