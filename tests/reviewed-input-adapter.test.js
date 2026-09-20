'use strict';

const Adapter = require('../reviewed-input-adapter.js');
const MR = require('../medication-review.js');
const PR = require('../problem-review.js');
const { loadKB, assert, assertEqual, reset, summary } = require('./helpers');

function confirmedMedicationReview(source) {
  let review = MR.create(source, '2026-09-20T08:00:00.000Z');
  review = MR.updateItem(review, 'extracted-1', { normalized_name: 'nifedipine' });
  review = MR.updateItem(review, 'extracted-2', { included: false });
  review = MR.addManualItem(review);
  review = MR.updateItem(review, 'manual-1', { normalized_name: 'metformin', drug_class: 'Biguanide' });
  return MR.confirm(review, '2026-09-20T08:05:00.000Z').review;
}

function confirmedProblemReview(source) {
  let review = PR.create(source, '2026-09-20T08:00:00.000Z');
  review = PR.updateItem(review, 'extracted-1', { status: 'resolved', temporality: 'historical' });
  review = PR.addManualItem(review);
  review = PR.updateItem(review, 'manual-1', {
    concept: 'Hipertensión arterial', status: 'active', temporality: 'current', onset_date: '2026-09'
  });
  return PR.confirm(review, '2026-09-20T08:06:00.000Z').review;
}

function run() {
  reset(); console.log('== reviewed-input-adapter.test.js ==');
  const kb = loadKB();
  const medications = [
    { normalized_name: 'amlodipine', drug_class: 'Calcium channel blocker', dose: '5 mg', source: 'explicit', active_ingredients: ['amlodipine'] },
    { normalized_name: 'furosemide', drug_class: 'Loop diuretic', dose: '40 mg', source: 'explicit', active_ingredients: ['furosemide'] }
  ];
  const problems = [
    { id: 'CP_EDEMA', problem: 'Edema periférico', concept_es: 'Edema periférico', concept_en: 'Peripheral oedema', status: 'active', assertion: 'affirmed', temporality: 'current', first_active_date: null, source: 'explicit' }
  ];

  const draftMedication = MR.create(medications);
  const draftResult = Adapter.adaptMedications(medications, draftMedication);
  assert('draft medication review is never applied', !draftResult.applied && draftResult.reason === 'review_not_confirmed');
  assertEqual('draft fallback preserves extracted medicines', draftResult.items, medications);
  assert('adapter does not mutate extracted medicines', !medications[0].review_provenance);

  const medReview = confirmedMedicationReview(medications);
  const medResult = Adapter.adaptMedications(medications, medReview);
  assert('confirmed current medication review is applied', medResult.applied);
  assertEqual('correction, exclusion and manual addition determine reviewed medicines',
    medResult.items.map((item) => item.normalized_name), ['nifedipine', 'metformin']);
  assert('unchanged clinical fields survive a name correction', medResult.items[0].dose === '5 mg');
  assert('corrected ingredients cannot retain the old active ingredient', medResult.items[0].active_ingredients[0] === 'nifedipine');
  assert('manual medication has explicit professional provenance', medResult.items[1].source === 'professional_manual');
  assert('medication audit separates changes, additions and exclusions',
    medResult.audit.changed.length === 1 && medResult.audit.added.length === 1 && medResult.audit.excluded.length === 1);

  const staleReview = Object.assign({}, medReview, { source_signature: 'stale' });
  const staleResult = Adapter.adaptMedications(medications, staleReview);
  assert('stale confirmed medication review safely falls back', !staleResult.applied && staleResult.reason === 'stale_source');

  const problemReview = confirmedProblemReview(problems);
  const problemResult = Adapter.adaptProblems(problems, problemReview, kb);
  assert('confirmed current problem review is applied', problemResult.applied);
  assert('professional status overrides extracted status', problemResult.items[0].status === 'resolved');
  const manualHtn = problemResult.items.find((item) => item.source === 'professional_manual');
  assert('manual catalogued problem resolves to the KB identifier', manualHtn && manualHtn.id === 'CPB001');
  assert('reviewed YYYY-MM onset becomes comparable without inventing a day',
    manualHtn.first_active_date.value === 202609 && manualHtn.first_active_date.month === 9);
  assert('problem audit separates change and addition',
    problemResult.audit.changed.length === 1 && problemResult.audit.added.length === 1);

  let renamedReview = PR.create(problems);
  renamedReview = PR.updateItem(renamedReview, 'extracted-1', { concept: 'Hipertensión arterial' });
  renamedReview = PR.confirm(renamedReview, '2026-09-20T08:07:00.000Z').review;
  const renamedProblem = Adapter.adaptProblems(problems, renamedReview, kb).items[0];
  assert('renaming a problem cannot retain the old clinical identifier', renamedProblem.id === 'CPB001');

  const htnSource = [{ id: 'CPB001', problem: 'Hipertensión arterial', status: 'active', temporality: 'current' }];
  let duplicateIdentityReview = PR.create(htnSource);
  duplicateIdentityReview = PR.addManualItem(duplicateIdentityReview);
  duplicateIdentityReview = PR.updateItem(duplicateIdentityReview, 'manual-1', { concept: 'HTA' });
  duplicateIdentityReview = PR.confirm(duplicateIdentityReview, '2026-09-20T08:08:00.000Z').review;
  const duplicateIdentityResult = Adapter.adaptProblems(htnSource, duplicateIdentityReview, kb);
  assert('two reviewed concepts resolving to one KB identity fail closed',
    !duplicateIdentityResult.applied && duplicateIdentityResult.reason === 'duplicate_problem_identity');

  assert('unsupported free-text dates remain non-comparable', Adapter.parseReviewedDate('last spring') === null);
  assertEqual('year-only date retains month uncertainty', Adapter.parseReviewedDate('2024'),
    { year: 2024, month: null, value: 202400, raw: '2024', source: 'professional_review' });

  const combined = Adapter.build({ medications, activeProblems: problems }, medReview, problemReview, kb);
  assert('combined contract records domain-specific application state',
    combined.application.medications.applied && combined.application.problems.applied);
  assert('combined contract is versioned', combined.version === 1);

  const r = summary(); console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`); return r.fail === 0;
}

module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
