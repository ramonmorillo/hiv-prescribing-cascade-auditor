# Reviewed clinical input contract

Version: 1

`reviewed-input-adapter.js` is the only boundary allowed to convert the
automatic extraction plus the pharmacist review into clinical-engine input.
It is deliberately independent from the DOM and from `clinical-engine.js`.

## Activation rules

- A review is applied only when it is structurally valid, confirmed, and its
  source signature still matches the current automatic extraction.
- Draft, invalid, and stale reviews fall back to the untouched extracted input.
- Medication and problem reviews are evaluated independently. Confirming one
  domain never implicitly confirms the other.
- The adapter never mutates the extracted `CaseModel` or a review object.

## Provenance

Every included reviewed item carries `review_provenance`. The returned audit
object separately lists corrected, manually added, and excluded items. A manual
problem is linked to a knowledge-base concept only by an exact normalized match
against its identifier, bilingual concept names, or registered keywords.

## Dates and uncertainty

Only `YYYY` and `YYYY-MM`/`YYYYMM` review values become comparable dates. Free
text remains visible in the review record but is not converted into a guessed
date. No day is inferred.

## PR 7A boundary

This contract is tested but not yet consumed by the clinical engine. PR 7B is
the separate activation change and must demonstrate the before/after clinical
effects with end-to-end tests.
