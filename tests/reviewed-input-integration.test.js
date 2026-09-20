'use strict';

const Adapter = require('../reviewed-input-adapter.js');
const MR = require('../medication-review.js');
const PR = require('../problem-review.js');
const { loadKB, CE, assert, assertEqual, reset, summary } = require('./helpers');

function confirmExclusion(sourceMedications, name) {
  let review = MR.create(sourceMedications);
  const item = review.items.find((candidate) => candidate.normalized_name === name);
  review = MR.updateItem(review, item.id, { included: false });
  return MR.confirm(review, '2026-09-20T09:00:00.000Z').review;
}

function run() {
  reset(); console.log('== reviewed-input-integration.test.js ==');
  const kb = loadKB('prod');
  const note = 'En mayo de 2026 inicia naproxeno 550 mg por dolor articular. ' +
    'En agosto de 2026 presenta hipertensión arterial y se inicia enalapril 5 mg.';
  const extracted = CE.buildCaseModel(note, kb, { lang: 'es' });
  assert('baseline includes CC001', extracted.possibleCascades.some((signal) => signal.cascade_id === 'CC001'));

  const exclusionReview = confirmExclusion(extracted.medications, 'naproxen');
  const excludedInput = Adapter.build(extracted, exclusionReview, null, kb);
  const afterExclusion = CE.buildCaseModel(note, kb, { lang: 'es', reviewedInput: excludedInput });
  assert('confirmed medication exclusion removes the medicine from engine input',
    !afterExclusion.medications.some((medication) => medication.normalized_name === 'naproxen'));
  assert('excluding the index medicine removes CC001',
    !afterExclusion.possibleCascades.some((signal) => signal.cascade_id === 'CC001'));
  assert('engine output carries medication-review application metadata',
    afterExclusion.reviewedInputApplication.medications.applied === true);
  assert('exclusion remains available in the engine audit trail',
    afterExclusion.reviewAudit.medications.excluded.length === 1);

  const noteMissingTreatment = 'Paciente que toma naproxeno. Presenta hipertensión arterial de nueva aparición.';
  const missingTreatment = CE.buildCaseModel(noteMissingTreatment, kb, { lang: 'es' });
  let additionReview = MR.create(missingTreatment.medications);
  additionReview = MR.addManualItem(additionReview);
  additionReview = MR.updateItem(additionReview, 'manual-1', {
    normalized_name: 'enalapril', drug_class: 'ACE inhibitor'
  });
  additionReview = MR.confirm(additionReview, '2026-09-20T09:05:00.000Z').review;
  const addedInput = Adapter.build(missingTreatment, additionReview, null, kb);
  const afterAddition = CE.buildCaseModel(noteMissingTreatment, kb, { lang: 'es', reviewedInput: addedInput });
  assert('manual medication addition enters the effective engine list',
    afterAddition.medications.some((medication) => medication.normalized_name === 'enalapril'));
  assert('manual medication addition can create a new cascade signal',
    afterAddition.possibleCascades.some((signal) => signal.cascade_id === 'CC001'));
  const addedSignal = afterAddition.possibleCascades.find((signal) => signal.cascade_id === 'CC001');
  assert('manual medicine never invents supportive chronology',
    addedSignal.evidence.temporal_order.status === 'unknown');

  let problemReview = PR.create(extracted.activeProblems);
  const htnItem = problemReview.items.find((item) => item.problem_id === 'CPB001');
  problemReview = PR.updateItem(problemReview, htnItem.id, { status: 'absent', temporality: 'current' });
  problemReview = PR.confirm(problemReview, '2026-09-20T09:10:00.000Z').review;
  const problemInput = Adapter.build(extracted, null, problemReview, kb);
  const afterProblemCorrection = CE.buildCaseModel(note, kb, { lang: 'es', reviewedInput: problemInput });
  const correctedSignal = afterProblemCorrection.possibleCascades.find((signal) => signal.cascade_id === 'CC001');
  assert('professional problem correction reaches cascade reasoning',
    correctedSignal && correctedSignal.classification_reason_code === 'problem_negated');
  assert('problem correction changes automated classification to discarded',
    correctedSignal && correctedSignal.classification === 'discarded');

  const sourceSnapshot = JSON.stringify(extracted);
  CE.buildCaseModel(note, kb, { lang: 'es', reviewedInput: excludedInput });
  assertEqual('reviewed analysis does not mutate the extracted model', JSON.stringify(extracted), sourceSnapshot);

  const r = summary(); console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`); return r.fail === 0;
}

module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
