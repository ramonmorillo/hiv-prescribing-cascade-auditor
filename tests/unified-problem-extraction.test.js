'use strict';
/* Unified clinical-problem pipeline: note → terminology normalization →
 * consolidated problem list → professional review → cascade engine →
 * report. Covers the mandatory regression case (PVVIH, 58 y, 7 documented
 * problems) and its variants, plus generic cases that do NOT reuse that
 * case's vocabulary, so the fixes are demonstrated structurally rather than
 * for one note. */

const { loadKB, CE, assert, assertEqual, reset, summary } = require('./helpers');
const PR = require('../problem-review.js');
const Adapter = require('../reviewed-input-adapter.js');
const RC = require('../report-contract.js');

const CASE = [
  'Varón de 58 años en tratamiento con Biktarvy, con buen control virológico desde 2021.',
  'Olmesartán 20 mg/hidroclorotiazida 25 mg, un comprimido cada 24 horas desde febrero de 2024 por hipertensión.',
  'Propranolol 10 mg, tres comprimidos cada 24 horas desde julio de 2022 por temblor esencial.',
  'Amlodipino 10 mg, un comprimido cada 24 horas desde agosto de 2023 por hipertensión.',
  'Metformina 1 g cada 24 horas desde febrero de 2023 por diabetes mellitus tipo 2.',
  'Rosuvastatina 20 mg/ezetimiba 10 mg, un comprimido cada 24 horas desde febrero de 2024 por dislipemia.',
  'Lormetazepam 1 mg cada 24 horas desde septiembre de 2022 por insomnio.',
  'Silodosina 8 mg cada 24 horas desde noviembre de 2017 por hiperplasia benigna de próstata.',
  'En octubre de 2026 consulta por insomnio y recibe una nueva prescripción de trazodona 100 mg cada 24 horas.'
].join('\n');

function byConcept(model, conceptId) {
  return model.activeProblems.filter((p) => p.concept_id === conceptId);
}
function med(model, name) {
  return model.medications.find((m) => m.normalized_name === name);
}
function cascade(model, ruleId) {
  return model.possibleCascades.find((c) => c.cascade_id === ruleId);
}
function confirmAll(model, edit) {
  let review = PR.create(model.activeProblems, '2026-10-19T10:00:00.000Z');
  if (edit) review = edit(review);
  const confirmed = PR.confirm(review, '2026-10-19T10:05:00.000Z');
  return confirmed;
}

function run() {
  reset(); console.log('== unified-problem-extraction.test.js ==');
  const kb = loadKB('prod');
  const model = CE.buildCaseModel(CASE, kb, { lang: 'es' });

  /* ---- 1. Mandatory regression case: the seven documented problems ---- */
  const expected = ['TC_HTN', 'TC_ESSENTIAL_TREMOR', 'TC_DM2', 'TC_DYSLIPIDEMIA', 'TC_INSOMNIA', 'TC_BPH', 'TC_HIV'];
  expected.forEach((cid) => assertEqual('case: exactly one record for ' + cid, byConcept(model, cid).length, 1));
  assert('case: every documented problem is active', expected.every((cid) => byConcept(model, cid)[0].status === 'active'));
  const htn = byConcept(model, 'TC_HTN')[0];
  assertEqual('case: HTN keeps catalog id used by cascade rules', htn.id, 'CPB001');
  assertEqual('case: single HTN record keeps all three treating drugs',
    htn.related_medications.map((m) => m.drug).sort(), ['amlodipine', 'hydrochlorothiazide', 'olmesartan']);
  assert('case: HTN evidence is the documented indication', htn.evidence_types.indexOf('documented_indication') !== -1);
  const insomnia = byConcept(model, 'TC_INSOMNIA')[0];
  assertEqual('case: single insomnia record lists lormetazepam and trazodone',
    insomnia.related_medications.map((m) => m.drug).sort(), ['lormetazepam', 'trazodone']);
  const hiv = byConcept(model, 'TC_HIV')[0];
  assert('case: HIV recognised from context (ART + virological control), not from the drug alone',
    hiv.evidence_types.indexOf('contextual_inference') !== -1);
  assert('case: virological control kept as an attribute, distinct from the chronic condition',
    hiv.attributes.virological_control && hiv.attributes.virological_control.date === 'desde 2021');
  assert('case: HIV has no invented onset date', hiv.documented_onset === null && hiv.first_active_date === null);

  /* Dates keep their meaning. */
  assert('case: no problem converts a treatment start into a documented onset',
    expected.every((cid) => byConcept(model, cid)[0].documented_onset === null));
  assertEqual('case: HTN documented since earliest treatment (amlodipine)', htn.first_active_date.raw, 'desde agosto de 2023');
  assertEqual('case: that date is labelled as treatment start', htn.first_active_date.semantics, 'treatment_start');
  assertEqual('case: olmesartan start date comes from its own line', med(model, 'olmesartan').start_date, 'desde febrero de 2024');
  assertEqual('case: Biktarvy has no start date ("desde 2021" dates virological control)', med(model, 'bictegravir').start_date, null);
  assertEqual('case: lormetazepam recognised (dictionary gap closed)', med(model, 'lormetazepam') && med(model, 'lormetazepam').drug_class, 'Benzodiazepine');
  assertEqual('case: trazodone keeps its pharmacological class', med(model, 'trazodone').drug_class, 'Antidepressant / SARI');
  assertEqual('case: trazodone indication read from "consulta por insomnio y recibe ..."',
    med(model, 'trazodone').explicit_indication && med(model, 'trazodone').explicit_indication.terminology_concept_id, 'TC_INSOMNIA');

  /* ---- 2. Cascade engine: no unjustified causal conclusions ---- */
  assert('cascade A: no cascade signal links lormetazepam to trazodone',
    !model.possibleCascades.some((c) => /lormetazepam/.test(c.index_drug) && /trazodone/.test(c.cascade_drug)));
  const sed = model.globalMedicationAlerts.find((a) => a.id === 'CM007');
  assert('cascade A: concomitant sedative alert names both agents', !!sed && sed.drugs_involved.indexOf('lormetazepam') !== -1 && sed.drugs_involved.indexOf('trazodone') !== -1);
  assert('cascade A: alert is a safety finding, flagged as temporal association only',
    !!sed && sed.finding_category === 'pharmacotherapy_safety' && sed.temporal_association_only === true);
  assert('cascade A: chronology ordered lormetazepam → trazodone', !!sed && sed.contributors[0].canonical === 'lormetazepam');
  assert('cascade A: shared documented indication reported', !!sed && sed.shared_documented_indications.indexOf('insomnio') !== -1);
  const vih001 = cascade(model, 'VIH001');
  assert('cascade B: dyslipidaemia is verified against the problem list', !!vih001 && vih001.evidence.intermediate_problem.status === 'active');
  assert('cascade B: bictegravir → statin is never a supported cascade', !!vih001 && vih001.classification !== 'supported_possible_cascade');
  assert('cascade B: it is not discarded for a false indication mismatch', !!vih001 && vih001.classification_reason_code !== 'medication_indication_mismatch');
  assertEqual('cascade B: categorised as insufficient evidence', vih001 && vih001.finding_category, 'insufficient_evidence');
  assert('no supported cascade at all in the regression case',
    !model.possibleCascades.some((c) => c.classification === 'supported_possible_cascade'));

  /* INSTI vs boosted PI differentiated per active ingredient. */
  const insti = CE.buildCaseModel('Biktarvy desde 2019. Rosuvastatina 10 mg desde 2024 por dislipemia.', kb, { lang: 'es' });
  assertEqual('VIH001 INSTI: indirect mechanism caps the classification',
    cascade(insti, 'VIH001').classification_reason_code, 'index_drug_indirect_mechanism');
  const pi = CE.buildCaseModel('Darunavir/cobicistat desde 2019. Rosuvastatina 10 mg desde 2024 por dislipemia.', kb, { lang: 'es' });
  assertEqual('VIH001 boosted PI with documented problem and chronology stays a potential cascade',
    cascade(pi, 'VIH001').classification, 'supported_possible_cascade');
  const piNoProblem = CE.buildCaseModel('Darunavir/cobicistat desde 2019. Rosuvastatina 10 mg desde 2024.', kb, { lang: 'es' });
  assertEqual('VIH001 without documented dyslipidaemia is only a pharmacological match',
    cascade(piNoProblem, 'VIH001').classification, 'pharmacological_match_only');
  assertEqual('ART alone (no virological context) only proposes HIV as a suspicion',
    byConcept(piNoProblem, 'TC_HIV')[0].status, 'suspected');

  /* ---- 3. Variants of the insomnia wording ---- */
  const variant = (w) => CE.buildCaseModel(CASE.replace(/insomnio/g, w), kb, { lang: 'es' });
  ['problemas para dormir', 'dificultad para conciliar el sueño', 'insomino', 'INSOMNIO'].forEach((w) => {
    const m = variant(w);
    assertEqual('variant "' + w + '": one insomnia record', byConcept(m, 'TC_INSOMNIA').length, 1);
    assert('variant "' + w + '": no separate uncoded duplicate', !m.activeProblems.some((p) => /^FREE_/.test(p.id)));
  });
  const lay = byConcept(variant('problemas para dormir'), 'TC_INSOMNIA')[0];
  assertEqual('variant colloquial wording: medium certainty, needs validation', lay.certainty_level, 'medium');
  const typo = byConcept(variant('insomino'), 'TC_INSOMNIA')[0];
  assert('variant misspelling: approximate match recorded', typo.normalization.match_types.indexOf('approximate') !== -1);
  const sleep = variant('trastorno del sueño');
  assertEqual('variant "trastorno del sueño" is NOT converted into insomnia', byConcept(sleep, 'TC_INSOMNIA').length, 0);
  assertEqual('variant "trastorno del sueño" kept as the broader concept', byConcept(sleep, 'TC_SLEEP_DISORDER').length, 1);

  /* Abbreviations, accents and order. */
  const abbr = CE.buildCaseModel('Enalapril 10 mg/24h desde 2019 por HTA. Metformina 850 mg por DM2. Atorvastatina por dislipidemia. Tamsulosina por HBP.', kb, { lang: 'es' });
  ['TC_HTN', 'TC_DM2', 'TC_DYSLIPIDEMIA', 'TC_BPH'].forEach((cid) => assertEqual('abbreviations: ' + cid, byConcept(abbr, cid).length, 1));
  const noAccents = CE.buildCaseModel('Amlodipino 5 mg por hipertension. Silodosina 8 mg por hiperplasia benigna de prostata.', kb, { lang: 'es' });
  assert('missing accents still resolve', byConcept(noAccents, 'TC_HTN').length === 1 && byConcept(noAccents, 'TC_BPH').length === 1);
  const multi = CE.buildCaseModel('Enalapril 20 mg cada 24 horas por HTA y diabetes tipo II.', kb, { lang: 'es' });
  assert('several problems in one reason are split', byConcept(multi, 'TC_HTN').length === 1 && byConcept(multi, 'TC_DM2').length === 1);
  const broader = CE.buildCaseModel('Paciente con diabetes. Metformina por DM2.', kb, { lang: 'es' });
  assert('broader "diabetes" folded into DM2 (single record)', byConcept(broader, 'TC_DM').length === 0 && byConcept(broader, 'TC_DM2').length === 1);

  /* Related-but-not-equivalent concepts. */
  const tremor = CE.buildCaseModel('Propranolol 40 mg por temblor de acción.', kb, { lang: 'es' });
  assertEqual('"temblor de acción" is not essential tremor', byConcept(tremor, 'TC_ESSENTIAL_TREMOR').length, 0);
  assert('"temblor de acción" kept as tremor with a relation note',
    byConcept(tremor, 'TC_TREMOR').length === 1 && byConcept(tremor, 'TC_TREMOR')[0].normalization.relation_notes_es.length > 0);
  const pulm = CE.buildCaseModel('Sildenafilo por hipertensión pulmonar.', kb, { lang: 'es' });
  assertEqual('"hipertensión pulmonar" is not arterial hypertension', byConcept(pulm, 'TC_HTN').length, 0);
  const resp = CE.buildCaseModel('Antecedente de depresión respiratoria por opioides.', kb, { lang: 'es' });
  assertEqual('"depresión respiratoria" is not depression', byConcept(resp, 'TC_DEPRESSION').length, 0);

  /* ---- 4. Medicines without indication never create diagnoses ---- */
  const bare = CE.buildCaseModel('Metformina 850 mg cada 12 horas. Lormetazepam 1 mg por la noche.', kb, { lang: 'es' });
  assertEqual('drug without indication: no diabetes', byConcept(bare, 'TC_DM2').length + byConcept(bare, 'TC_DM').length, 0);
  assertEqual('drug without indication: no insomnia ("por la noche" is a schedule)', byConcept(bare, 'TC_INSOMNIA').length, 0);
  const undocumented = bare.missingInformation.find((m) => m.type === 'undocumented_indication');
  assert('undocumented indications listed as their own category',
    !!undocumented && undocumented.drugs.indexOf('metformin') !== -1 && undocumented.drugs.indexOf('lormetazepam') !== -1);

  /* ---- 5. Negation, resolution, suspicion, incomplete dates ---- */
  const neg = CE.buildCaseModel('No presenta insomnio. Niega dislipemia.', kb, { lang: 'es' });
  assert('negated problems stay traceable as absent',
    byConcept(neg, 'TC_INSOMNIA')[0].status === 'absent' && byConcept(neg, 'TC_DYSLIPIDEMIA')[0].status === 'absent');
  const resolved = CE.buildCaseModel('Insomnio resuelto en 2023.', kb, { lang: 'es' });
  assertEqual('resolved antecedent', byConcept(resolved, 'TC_INSOMNIA')[0].status, 'resolved');
  const susp = CE.buildCaseModel('Sospecha de hiperplasia benigna de próstata, pendiente de ecografía.', kb, { lang: 'es' });
  assertEqual('suspected diagnosis', byConcept(susp, 'TC_BPH')[0].status, 'suspected');
  const hedgedInd = CE.buildCaseModel('Silodosina 8 mg por posible HBP.', kb, { lang: 'es' });
  assertEqual('hedged indication stays suspected', byConcept(hedgedInd, 'TC_BPH')[0].status, 'suspected');
  const contra = CE.buildCaseModel('No tiene hipertensión. Amlodipino 5 mg por hipertensión.', kb, { lang: 'es' });
  assert('negation + active treatment for it = contradiction, never silently resolved', byConcept(contra, 'TC_HTN')[0].contradiction === true);
  const yearOnly = CE.buildCaseModel('Diagnosticado de dislipemia en 2019.', kb, { lang: 'es' });
  const yo = byConcept(yearOnly, 'TC_DYSLIPIDEMIA')[0];
  assert('year-only onset keeps year precision', yo.documented_onset && yo.documented_onset.raw === 'en 2019' && yo.documented_onset.precision === 'year');
  const decimal = CE.buildCaseModel('Lorazepam 0.5 mg cada 24 horas desde 2021 por ansiedad.', kb, { lang: 'es' });
  assertEqual('decimal dose does not split the sentence', byConcept(decimal, 'TC_ANXIETY').length, 1);
  assertEqual('decimal dose: start date kept', med(decimal, 'lorazepam').start_date, 'desde 2021');

  /* ---- 6. Off-label / multi-indication drugs: class ≠ indication ---- */
  const offLabel = CE.buildCaseModel('Amitriptilina 25 mg por dolor neuropático. Quetiapina 25 mg para dormir por insomnio.', kb, { lang: 'es' });
  assertEqual('amitriptyline (antidepressant class) read with its documented indication', byConcept(offLabel, 'TC_CHRONIC_PAIN').length, 1);
  assertEqual('no depression invented from an antidepressant', byConcept(offLabel, 'TC_DEPRESSION').length, 0);

  /* ---- 7. Professional review propagates to every module ---- */
  const exclude = confirmAll(model, (review) => {
    const item = review.items.find((it) => it.concept === 'dislipemia');
    return PR.updateItem(review, item.id, { included: false });
  });
  assert('review with dyslipidaemia excluded is confirmable', exclude.ok);
  const reviewedInput = Adapter.build(model, null, exclude.review, kb);
  assert('review is applied', reviewedInput.application.problems.applied);
  const reviewed = CE.buildCaseModel(CASE, kb, { lang: 'es', reviewedInput });
  assertEqual('excluded problem disappears from the effective list', byConcept(reviewed, 'TC_DYSLIPIDEMIA').length, 0);
  assertEqual('cascade engine no longer sees the excluded problem (no raw-text rescan)',
    cascade(reviewed, 'VIH001').evidence.intermediate_problem.status, 'none');
  assert('reviewed problems are marked as professionally validated',
    reviewed.activeProblems.every((p) => p.validation_status === 'professionally_validated'));

  const manual = confirmAll(model, (review) => {
    let next = PR.addManualItem(review, '2026-10-19T10:01:00.000Z');
    const id = next.items[next.items.length - 1].id;
    next = PR.updateItem(next, id, { concept: 'Edema maleolar', status: 'active', temporality: 'current' });
    return next;
  });
  const manualModel = CE.buildCaseModel(CASE, kb, { lang: 'es', reviewedInput: Adapter.build(model, null, manual.review, kb) });
  const edema = manualModel.activeProblems.find((p) => p.problem === 'Edema maleolar');
  assert('manual problem resolved through the terminology', !!edema && edema.concept_id === 'TC_EDEMA');
  assert('manual problem carries manual_entry evidence', !!edema && edema.evidence_types.indexOf('manual_entry') !== -1);
  const cc004 = cascade(manualModel, 'CC004');
  assertEqual('manual problem reaches the cascade engine (amlodipine → oedema)', cc004 && cc004.evidence.intermediate_problem.status, 'active');

  const renamed = confirmAll(model, (review) => {
    const item = review.items.find((it) => it.concept === 'insomnio');
    return PR.updateItem(review, item.id, { concept: 'trastorno del sueño' });
  });
  const renamedModel = CE.buildCaseModel(CASE, kb, { lang: 'es', reviewedInput: Adapter.build(model, null, renamed.review, kb) });
  assert('renamed problem drops the extraction concept and is re-resolved',
    renamedModel.activeProblems.some((p) => p.concept_id === 'TC_SLEEP_DISORDER') &&
    !renamedModel.activeProblems.some((p) => p.concept_id === 'TC_INSOMNIA'));

  /* Symptom-bridge reasoning follows the review. */
  const ssri = 'Sertralina 50 mg desde enero de 2026. En marzo de 2026 presenta insomnio y se pauta zolpidem.';
  const ssriModel = CE.buildCaseModel(ssri, kb, { lang: 'es' });
  const ssriExcluded = confirmAll(ssriModel, (review) => {
    const item = review.items.find((it) => it.concept === 'insomnio');
    return PR.updateItem(review, item.id, { included: false });
  });
  const ssriReviewed = CE.buildCaseModel(ssri, kb, { lang: 'es', reviewedInput: Adapter.build(ssriModel, null, ssriExcluded.review, kb) });
  assert('excluded symptom no longer drives symptom-bridge signals',
    !ssriReviewed.possibleCascades.some((c) => c.signal_type === 'symptom_bridge' && c.evidence.intermediate_problem.status === 'active'));
  assert('excluded symptom no longer verifies drug-drug insomnia rules',
    !ssriReviewed.possibleCascades.some((c) => c.signal_type === 'drug_drug' && c.evidence.intermediate_problem.status === 'active' &&
      /insomn/i.test(c.ade_es || '')));

  /* ---- 8. Step 2 review and engine read the same list ---- */
  const step2 = CE.detectActiveProblems(CASE, kb, 'es');
  assertEqual('Step 2 extraction == CaseModel extraction (same ids)',
    step2.map((p) => p.id), model.activeProblems.map((p) => p.id));
  assert('review signature matches the engine input (review can be applied)',
    PR.sourceSignature(step2) === PR.sourceSignature(model.activeProblems));
  const review = PR.create(model.activeProblems);
  assertEqual('every problem enters the review circuit', review.items.length, model.activeProblems.length);
  assert('review rows carry evidence types and related medicines',
    review.items.every((it) => it.traceability && it.traceability.evidence_types.length > 0));
  assert('treatment start never pre-fills the editable onset field', review.items.every((it) => it.onset_date === ''));

  /* ---- 9. Report reflects the validated data ---- */
  const report = RC.enrich({ activeProblems: reviewed.activeProblems, cascades: [], reviewed_input_application: reviewed.reviewedInputApplication }, {
    language: 'es', extractedClinicalInput: { activeProblems: model.activeProblems, medications: model.medications }, allCandidates: [] });
  assert('report clinical_problems mirrors the effective list',
    report.clinical_problems.length === reviewed.activeProblems.length &&
    !report.clinical_problems.some((p) => p.concept === 'dislipemia'));
  const text = RC.toClinicalText(report, 'es');
  assert('clinical text lists problems and states the review source',
    /PROBLEMAS CLÍNICOS/.test(text) && /revisión profesional confirmada/.test(text) && !/dislipemia/.test(text));
  const csv = RC.toCsv(report, 'es');
  assert('CSV includes the clinical problems column', csv.split('\r\n')[0].indexOf('clinical_problems_json') !== -1);

  /* ---- 10. DEV KB gives the same extraction ---- */
  const dev = CE.buildCaseModel(CASE, loadKB('dev'), { lang: 'es' });
  assert('DEV track: same seven documented problems', expected.every((cid) => byConcept(dev, cid).length === 1));

  const r = summary(); console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`); return r.fail === 0;
}

module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
