'use strict';

const Adapter = require('../reviewed-input-adapter.js');
const MR = require('../medication-review.js');
const PR = require('../problem-review.js');
const { loadKB, CE, assert, assertEqual, reset, summary } = require('./helpers');

function run() {
  reset(); console.log('== reviewed-input-edge-cases.test.js ==');
  const kb = loadKB('prod');

  const interactionNote = 'Paciente en tratamiento activo con dolutegravir 50 mg y metformina 850 mg.';
  const interactionBase = CE.buildCaseModel(interactionNote, kb, { lang: 'es' });
  assert('interaction baseline contains DDI003', interactionBase.currentInteractions.some((rule) => rule.id === 'DDI003'));
  let interactionReview = MR.create(interactionBase.medications);
  const metformin = interactionReview.items.find((item) => item.normalized_name === 'metformin');
  interactionReview = MR.updateItem(interactionReview, metformin.id, { included: false });
  interactionReview = MR.confirm(interactionReview, '2026-09-20T11:00:00.000Z').review;
  const interactionInput = Adapter.build(interactionBase, interactionReview, null, kb);
  const interactionEffective = CE.buildCaseModel(interactionNote, kb, { lang: 'es', reviewedInput: interactionInput });
  assert('confirmed exclusion removes the current interaction',
    !interactionEffective.currentInteractions.some((rule) => rule.id === 'DDI003'));

  const burdenNote = 'Paciente tratado con amitriptilina y paroxetina.';
  const burdenBase = CE.buildCaseModel(burdenNote, kb, { lang: 'es' });
  const burdenBefore = burdenBase.globalMedicationAlerts.find((alert) => alert.id === 'ACB_SCORE');
  assert('burden baseline has at least one ACB contributor', burdenBefore && burdenBefore.drugs_involved.length >= 1);
  let burdenReview = MR.create(burdenBase.medications);
  burdenReview.items.forEach((item) => { burdenReview = MR.updateItem(burdenReview, item.id, { included: false }); });
  burdenReview = MR.confirm(burdenReview, '2026-09-20T11:05:00.000Z').review;
  const burdenInput = Adapter.build(burdenBase, burdenReview, null, kb);
  const burdenEffective = CE.buildCaseModel(burdenNote, kb, { lang: 'es', reviewedInput: burdenInput });
  assert('excluding all contributors removes the ACB alert',
    !burdenEffective.globalMedicationAlerts.some((alert) => alert.id === 'ACB_SCORE'));

  const multiNote = 'Inicia naproxeno en enero. En marzo desarrolla hipertensión e inicia amlodipino. ' +
    'En abril añade losartán por control insuficiente.';
  const multiBase = CE.buildCaseModel(multiNote, kb, { lang: 'es' });
  const initialCandidates = multiBase.possibleCascades.filter((c) => c.cascade_id === 'CC001');
  assert('multi-candidate baseline contains two independent candidates', initialCandidates.length === 2);
  let multiReview = MR.create(multiBase.medications);
  const amlodipine = multiReview.items.find((item) => item.normalized_name === 'amlodipine');
  multiReview = MR.updateItem(multiReview, amlodipine.id, { included: false });
  multiReview = MR.confirm(multiReview, '2026-09-20T11:10:00.000Z').review;
  const multiInput = Adapter.build(multiBase, multiReview, null, kb);
  const multiEffective = CE.buildCaseModel(multiNote, kb, { lang: 'es', reviewedInput: multiInput });
  const remaining = multiEffective.possibleCascades.filter((c) => c.cascade_id === 'CC001');
  assert('excluding one treatment removes only its own candidate',
    remaining.length === 1 && remaining[0].cascade_drug === 'losartan');

  const bilingualEs = CE.buildCaseModel(multiNote, kb, { lang: 'es', reviewedInput: multiInput });
  const bilingualEn = CE.buildCaseModel(multiNote, kb, { lang: 'en', reviewedInput: multiInput });
  assertEqual('language switch preserves effective medicine identities',
    bilingualEn.medications.map((m) => m.normalized_name), bilingualEs.medications.map((m) => m.normalized_name));
  assertEqual('language switch preserves candidate ids and classifications',
    bilingualEn.possibleCascades.map((c) => [c.candidate_id, c.classification]),
    bilingualEs.possibleCascades.map((c) => [c.candidate_id, c.classification]));

  const noDrugNote = 'Paciente con hipertensión arterial activa, sin tratamiento farmacológico documentado.';
  const noDrugBase = CE.buildCaseModel(noDrugNote, kb, { lang: 'es' });
  let manualReview = MR.create(noDrugBase.medications);
  manualReview = MR.addManualItem(manualReview);
  manualReview = MR.updateItem(manualReview, 'manual-1', { normalized_name: 'enalapril', drug_class: 'ACE inhibitor' });
  manualReview = MR.confirm(manualReview, '2026-09-20T11:15:00.000Z').review;
  const manualInput = Adapter.build(noDrugBase, manualReview, null, kb);
  const manualEffective = CE.buildCaseModel(noDrugNote, kb, { lang: 'es', reviewedInput: manualInput });
  assert('manual treatment alone does not fabricate an index drug or cascade',
    manualEffective.medications.some((m) => m.normalized_name === 'enalapril') && manualEffective.possibleCascades.length === 0);

  const malformedMedication = MR.sanitize({ version: 999, source_signature: '', items: [] });
  const malformedProblem = PR.sanitize({ version: 999, source_signature: '', items: [] });
  const malformedInput = Adapter.build(multiBase, malformedMedication, malformedProblem, kb);
  assert('malformed imported reviews are rejected without changing either domain',
    !malformedInput.application.medications.applied && !malformedInput.application.problems.applied);
  assertEqual('malformed import falls back to extracted medicines',
    malformedInput.medications.map((m) => m.normalized_name), multiBase.medications.map((m) => m.normalized_name));

  let duplicateProblem = PR.create([{ id: 'CPB001', problem: 'Hipertensión arterial', status: 'active', temporality: 'current' }]);
  duplicateProblem = PR.addManualItem(duplicateProblem);
  duplicateProblem = PR.updateItem(duplicateProblem, 'manual-1', { concept: 'HTA' });
  duplicateProblem = PR.confirm(duplicateProblem, '2026-09-20T11:20:00.000Z').review;
  const duplicateResult = Adapter.adaptProblems(
    [{ id: 'CPB001', problem: 'Hipertensión arterial', status: 'active', temporality: 'current' }],
    duplicateProblem, kb
  );
  assert('two labels resolving to one KB identity fail closed',
    !duplicateResult.applied && duplicateResult.reason === 'duplicate_problem_identity');

  const sourceSnapshot = JSON.stringify(multiBase);
  CE.buildCaseModel(multiNote, kb, { lang: 'es', reviewedInput: multiInput });
  assertEqual('repeat reviewed analysis never mutates source extraction', JSON.stringify(multiBase), sourceSnapshot);

  const r = summary(); console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`); return r.fail === 0;
}

module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
