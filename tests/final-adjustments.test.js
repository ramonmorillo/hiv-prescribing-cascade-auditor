'use strict';
const { loadKB, CE, assert, reset, summary } = require('./helpers');

const COMPLETE_CASE = 'Mujer de 59 años con infección por VIH, en tratamiento con Biktarvy desde 2023. Mantiene peso estable y no presenta diabetes ni síndrome metabólico. No toma metformina; únicamente se plantearía iniciarla en el futuro si desarrollara diabetes. En abril de 2026 inicia diclofenaco 50 mg cada 8 horas por artrosis de rodilla. No tenía antecedentes de hipertensión. En julio de 2026 presenta cifras repetidas de presión arterial de 170/98 y 166/94 mmHg, se diagnostica hipertensión arterial y se inicia losartán 50 mg cada 24 horas.';
const FORBIDDEN = /secuencia causal|causada por|provocada por|cascada confirmada/i;

function run() {
  reset(); console.log('== final-adjustments.test.js ==');
  const kb = loadKB('prod');
  const model = CE.buildCaseModel(COMPLETE_CASE, kb, { lang: 'es' });
  const active = model.medications.map((m) => m.normalized_name);
  ['bictegravir', 'emtricitabine', 'tenofovir alafenamide', 'diclofenac', 'losartan']
    .forEach((name) => assert('complete case active medication: ' + name, active.includes(name)));
  assert('complete case contains exactly five active ingredients', active.length === 5);
  assert('metformin is excluded from active medications and active classes',
    !active.includes('metformin') && !model.medications.some((m) => /biguanide/i.test(m.drug_class)));
  const metformin = model.allMedicationMentions.filter((m) => m.normalized_name === 'metformin');
  assert('present metformin negation is retained', metformin.some((m) => m.assertion === 'negated' && m.status === 'not_taking'));
  assert('future conditional metformin event and condition are retained', metformin.some((m) =>
    m.assertion === 'conditional' && m.temporality === 'future' && /diabetes/i.test(m.condition || '')));
  assert('all metformin events are excluded from current reasoning', metformin.every((m) =>
    m.active_for_clinical_reasoning === false && !!m.exclusion_reason && m.provenance === 'clinical_note'));
  assert('metformin activates no current interaction', model.currentInteractions.length === 0);
  const plausible = model.possibleCascades.filter((c) =>
    ['supported_possible_cascade', 'possible_but_incomplete'].includes(c.classification));
  assert('only diclofenac → hypertension → losartan is plausible', plausible.length === 1 &&
    plausible[0].index_drug === 'diclofenac' && plausible[0].cascade_drug === 'losartan');
  assert('supported conclusion requires professional causal validation',
    /relación causal requiere validación profesional/i.test(plausible[0].classification_reason_es));

  const cases = [
    ['No toma metformina.', 'negated', 'not_taking', null],
    ['Se podría iniciar metformina si desarrollara diabetes.', 'conditional', 'conditional_future', /diabetes/i],
    ['No toma actualmente metformina, pero se valorará iniciarla si desarrolla diabetes.', 'negated', 'not_taking', null],
    ['Metformina suspendida en enero de 2025.', 'affirmed', 'discontinued', null],
    ['Toma metformina 850 mg cada 12 horas.', 'affirmed', 'active', null]
  ];
  cases.forEach(([note, assertion, status, condition]) => {
    const result = CE.buildCaseModel(note, kb);
    const mention = result.allMedicationMentions.find((m) => m.normalized_name === 'metformin' &&
      (m.assertion === assertion || (assertion === 'conditional' && m.assertion === 'hypothetical')));
    assert(note + ' → structured status', mention && mention.status === status && (!condition || condition.test(mention.condition || '')));
    assert(note + ' → active reasoning isolation', status === 'active' ? result.medications.some((m) => m.normalized_name === 'metformin') :
      !result.medications.some((m) => m.normalized_name === 'metformin') && result.currentInteractions.length === 0 && result.possibleCascades.length === 0);
    if (/suspendida/.test(note)) assert('suspension date retained', /enero de 2025/i.test(mention.start_date || ''));
  });
  const mixed = CE.buildCaseModel(cases[2][0], kb).allMedicationMentions.filter((m) => m.normalized_name === 'metformin');
  assert('negation plus future possibility creates two traceable events',
    mixed.some((m) => m.assertion === 'negated') && mixed.some((m) => m.assertion === 'conditional'));

  Object.keys(CE.CLASSIFICATION_MESSAGES).forEach((classification) => {
    ['es', 'en'].forEach((lang) => assert(classification + ' automated conclusion is cautious (' + lang + ')',
      !FORBIDDEN.test(CE.classificationReason(classification, lang))));
  });
  assert('all generated automated conclusions avoid forbidden causal claims', model.possibleCascades.every((c) =>
    !FORBIDDEN.test((c.classification_reason_es || '') + ' ' + (c.classification_reason_en || ''))));

  const r = summary(); console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`); return r.fail === 0;
}
module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
