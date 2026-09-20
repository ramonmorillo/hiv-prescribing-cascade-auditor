# PR 8 — integral clinical QA matrix

This matrix freezes the expected behaviour of the reviewed-input workflow
before the reporting layer is redesigned in PR 9.

| Risk | Required result | Automated coverage |
|---|---|---|
| Draft review affects reasoning | Never applied | `reviewed-input-e2e.test.js` |
| Confirmed exclusion is ignored | Medicine and dependent signal disappear | `reviewed-input-e2e.test.js` |
| Review belongs to another extraction | Fail closed as `stale_source` | `reviewed-input-e2e.test.js` |
| One domain confirms the other implicitly | Domains apply independently | `reviewed-input-e2e.test.js` |
| Suspected problem is treated as established | Candidate becomes not evaluable | `reviewed-input-e2e.test.js` |
| Prior problem is treated as incident | Explicit reviewed onset changes temporal decision | `reviewed-input-e2e.test.js` |
| JSON re-entry changes the analysis | Candidate identity and classification remain stable | `reviewed-input-e2e.test.js` |
| Excluded drug still triggers a DDI or burden alert | Interaction/alert disappears | `reviewed-input-edge-cases.test.js` |
| One exclusion removes all candidates | Only the matching candidate disappears | `reviewed-input-edge-cases.test.js` |
| Language changes clinical identity | IDs and classifications remain identical | `reviewed-input-edge-cases.test.js` |
| Manual data invents chronology or missing drugs | No inferred chronology or index medicine | Both suites |
| Imported malformed data corrupts the case | Sanitized and rejected; extraction retained | `reviewed-input-edge-cases.test.js` |
| Two labels activate one KB concept twice | Entire problem review fails closed | `reviewed-input-edge-cases.test.js` |
| Analysis mutates source extraction | Source snapshot remains byte-equivalent | Both suites |

The report and export parity tests belong to PR 9 because that PR introduces
the pure report contract they will exercise.
