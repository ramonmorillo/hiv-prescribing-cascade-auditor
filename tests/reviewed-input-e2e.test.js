'use strict';

const Adapter = require('../reviewed-input-adapter.js');
const MR = require('../medication-review.js');
const PR = require('../problem-review.js');
const { loadKB, CE, assert, assertEqual, reset, summary } = require('./helpers');

const NOTE = 'En enero de 2026 inicia naproxeno 500 mg por dolor articular. ' +
  'En marzo de 2026 presenta hipertensión arterial de nueva aparición y se inicia enalapril 5 mg.';

function effectiveModel(note, kb, medicationReview, problemReview, lang) {
  const extracted = CE.buildCaseModel(note, kb, { lang: lang || 'es' });
  const input = Adapter.build(extracted, medicationReview, problemReview, kb);
  const applied = input.application.medications.applied || input.application.problems.applied;
  return {
    extracted,
    input,
    effective: applied ? CE.buildCaseModel(note, kb, { lang: lang || 'es', reviewedInput: input }) : extracted
  };
}

function updateMedication(review, name, patch) {
  const item = review.items.find((candidate) => candidate.normalized_name === name);
  return MR.updateItem(review, item.id, patch);
}

function updateProblem(review, problemId, patch) {
  const item = review.items.find((candidate) => candidate.problem_id === problemId);
  return PR.updateItem(review, item.id, patch);
}

function signal(model) {
  return model.possibleCascades.find((candidate) => candidate.cascade_id === 'CC001');
}

function run() {
  reset(); console.log('== reviewed-input-e2e.test.js ==');
  const kb = loadKB('prod');
  const baseline = CE.buildCaseModel(NOTE, kb, { lang: 'es' });
  assert('baseline case contains the expected CC001 signal', !!signal(baseline));

  let draftMedication = MR.create(baseline.medications);
  draftMedication = updateMedication(draftMedication, 'naproxen', { included: false });
  const draftJourney = effectiveModel(NOTE, kb, draftMedication, null);
  assert('draft medication review is not applied', !draftJourney.input.application.medications.applied);
  assert('draft medication change leaves the clinical result unchanged', !!signal(draftJourney.effective));

  const confirmedMedication = MR.confirm(draftMedication, '2026-09-20T10:00:00.000Z').review;
  const confirmedJourney = effectiveModel(NOTE, kb, confirmedMedication, null);
  assert('confirmed medication review is applied', confirmedJourney.input.application.medications.applied);
  assert('confirmed index-drug exclusion removes the signal', !signal(confirmedJourney.effective));
  assert('problem domain stays on extraction when only medication is confirmed',
    !confirmedJourney.input.application.problems.applied && confirmedJourney.effective.activeProblems.some((p) => p.id === 'CPB001'));

  const staleMedication = Object.assign({}, confirmedMedication, { source_signature: 'outdated' });
  const staleJourney = effectiveModel(NOTE, kb, staleMedication, null);
  assert('stale confirmed review fails closed',
    !staleJourney.input.application.medications.applied && staleJourney.input.application.medications.reason === 'stale_source');
  assert('stale review cannot remove a clinical signal', !!signal(staleJourney.effective));

  let problemReview = PR.create(baseline.activeProblems);
  problemReview = updateProblem(problemReview, 'CPB001', { status: 'suspected', temporality: 'current' });
  const draftProblemJourney = effectiveModel(NOTE, kb, null, problemReview);
  assert('draft problem review is not applied', !draftProblemJourney.input.application.problems.applied);
  problemReview = PR.confirm(problemReview, '2026-09-20T10:05:00.000Z').review;
  const suspectedJourney = effectiveModel(NOTE, kb, null, problemReview);
  assert('confirmed problem review is applied independently',
    suspectedJourney.input.application.problems.applied && !suspectedJourney.input.application.medications.applied);
  assert('suspected intermediate problem becomes not evaluable',
    signal(suspectedJourney.effective).classification === 'not_evaluable' &&
    signal(suspectedJourney.effective).classification_reason_code === 'problem_suspected_only');

  let priorProblem = PR.create(baseline.activeProblems);
  priorProblem = updateProblem(priorProblem, 'CPB001', {
    status: 'active', temporality: 'historical', onset_date: '2020'
  });
  priorProblem = PR.confirm(priorProblem, '2026-09-20T10:10:00.000Z').review;
  const priorJourney = effectiveModel(NOTE, kb, null, priorProblem);
  assert('reviewed onset before index drug changes the temporal decision',
    signal(priorJourney.effective).classification_reason_code === 'problem_predates_index');
  assert('reviewed prior problem is discarded as an incident cascade',
    signal(priorJourney.effective).classification === 'discarded');

  let bothMedication = MR.create(baseline.medications);
  bothMedication = updateMedication(bothMedication, 'enalapril', { normalized_name: 'candesartan', drug_class: 'ARB' });
  bothMedication = MR.confirm(bothMedication, '2026-09-20T10:15:00.000Z').review;
  let bothProblem = PR.create(baseline.activeProblems);
  bothProblem = updateProblem(bothProblem, 'CPB001', { status: 'active', temporality: 'current' });
  bothProblem = PR.confirm(bothProblem, '2026-09-20T10:16:00.000Z').review;
  const bothJourney = effectiveModel(NOTE, kb, bothMedication, bothProblem);
  assert('both confirmed domains are applied together',
    bothJourney.input.application.medications.applied && bothJourney.input.application.problems.applied);
  assert('corrected medicine replaces the extracted medicine in effective input',
    bothJourney.effective.medications.some((m) => m.normalized_name === 'candesartan') &&
    !bothJourney.effective.medications.some((m) => m.normalized_name === 'enalapril'));
  assert('corrected medicine produces the corresponding candidate',
    signal(bothJourney.effective).cascade_drug === 'candesartan');

  const exported = JSON.parse(JSON.stringify({
    clinicalNote: NOTE, medicationReview: bothMedication, problemReview: bothProblem
  }));
  const importedMedication = MR.sanitize(exported.medicationReview);
  const importedProblem = PR.sanitize(exported.problemReview);
  const resumedJourney = effectiveModel(exported.clinicalNote, kb, importedMedication, importedProblem);
  assertEqual('JSON round-trip preserves effective medicines',
    resumedJourney.effective.medications.map((m) => m.normalized_name),
    bothJourney.effective.medications.map((m) => m.normalized_name));
  assertEqual('JSON round-trip preserves candidate identity and classification',
    resumedJourney.effective.possibleCascades.map((c) => [c.candidate_id, c.classification]),
    bothJourney.effective.possibleCascades.map((c) => [c.candidate_id, c.classification]));
  assert('round-trip preserves both confirmation timestamps',
    resumedJourney.input.application.medications.confirmed_at === '2026-09-20T10:15:00.000Z' &&
    resumedJourney.input.application.problems.confirmed_at === '2026-09-20T10:16:00.000Z');

  const r = summary(); console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`); return r.fail === 0;
}

module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
