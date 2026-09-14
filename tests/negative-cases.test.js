'use strict';
/* ============================================================================
   Negative / edge-case regression tests — the 8 cases required by the audit
   brief, each targeting one specific way a naive drug-class-coincidence
   engine over- or under-calls a cascade.
   ============================================================================ */
const { loadKB, CE, assert, reset, summary } = require('./helpers');

function findCC001(model) {
  return model.possibleCascades.find((c) => c.cascade_id === 'CC001');
}

function run() {
  reset();
  console.log('== negative-cases.test.js ==');
  const kb = loadKB('prod');

  /* 1. Same start date, no hypertension mentioned, no chronology at all
        -> must NOT be presented as a supported cascade. */
  {
    const note = 'Paciente inicia naproxeno 500 mg y enalapril 10 mg el mismo día, ambos de forma programada.';
    const model = CE.buildCaseModel(note, kb, { lang: 'es' });
    const cc001 = findCC001(model);
    assert('Case 1: naproxen+enalapril same date, no HTN mentioned -> not supported_possible_cascade',
      !cc001 || cc001.classification !== 'supported_possible_cascade');
    assert('Case 1: classified as a bare pharmacological coincidence (no problem evidence at all)',
      !cc001 || cc001.classification === 'pharmacological_match_only');
  }

  /* 2. Enalapril indicated for heart failure -> must not be assumed to be
        treating an NSAID-induced hypertension. */
  {
    const note = 'Paciente con insuficiencia cardiaca en tratamiento con enalapril 10 mg. Toma naproxeno 500 mg ocasionalmente para dolor articular.';
    const model = CE.buildCaseModel(note, kb, { lang: 'es' });
    const cc001 = findCC001(model);
    assert('Case 2: enalapril for heart failure -> CC001 discarded (alternative indication documented)',
      !!cc001 && cc001.classification === 'discarded');
    assert('Case 2: discard reason is the alternative-indication path, not a false "supported"',
      !!cc001 && cc001.classification_reason_code === 'alternative_indication_found');
  }

  /* 3. Explicit negation of hypertension must be respected. */
  {
    const note = 'Paciente toma naproxeno 500 mg y enalapril 10 mg. No presenta hipertensión.';
    const model = CE.buildCaseModel(note, kb, { lang: 'es' });
    const htn = model.activeProblems.find((p) => p.id === 'CPB001');
    assert('Case 3: "no presenta hipertensión" -> problem status is negated', !!htn && htn.status === 'negated');
    const cc001 = findCC001(model);
    assert('Case 3: negated hypertension -> CC001 discarded, never presented as a finding',
      !!cc001 && cc001.classification === 'discarded');
  }

  /* 4. Antecedent of hypertension pre-dating naproxen -> reduce/discard. */
  {
    const note = 'Antecedente de hipertensión arterial. Inicia naproxeno 500 mg. Enalapril 10 mg.';
    const model = CE.buildCaseModel(note, kb, { lang: 'es' });
    const htn = model.activeProblems.find((p) => p.id === 'CPB001');
    assert('Case 4: "antecedente de hipertensión" -> problem status is history (pre-existing)',
      !!htn && htn.status === 'history');
    const cc001 = findCC001(model);
    assert('Case 4: pre-existing hypertension -> CC001 not presented as a supported cascade',
      !cc001 || cc001.classification !== 'supported_possible_cascade');
  }

  /* 5. Hypertension after naproxen, but no antihypertensive documented ->
        should surface as a possible ADE, never as a complete cascade. */
  {
    const note = 'Inicia naproxeno 500 mg. Posteriormente presenta hipertensión de nueva aparición.';
    const model = CE.buildCaseModel(note, kb, { lang: 'es' });
    assert('Case 5: no cascade drug present -> no CC001 entry in possibleCascades at all',
      !findCC001(model));
    assert('Case 5: surfaced instead as a possible-ADE note in missingInformation',
      model.missingInformation.some((m) => m.type === 'potential_ade_without_cascade_drug'));
  }

  /* 6. Enalapril started later, but no intermediate problem documented at
        all -> coincidence / incomplete, not a cascade. */
  {
    const note = 'Toma naproxeno 500 mg de forma habitual. Posteriormente se añade enalapril 10 mg.';
    const model = CE.buildCaseModel(note, kb, { lang: 'es' });
    const cc001 = findCC001(model);
    assert('Case 6: no intermediate problem documented -> pharmacological_match_only',
      !!cc001 && cc001.classification === 'pharmacological_match_only');
  }

  /* 7. Text with no drugs and no problems -> no false positives anywhere. */
  {
    const note = 'Paciente acude a revisión rutinaria sin incidencias.';
    const model = CE.buildCaseModel(note, kb, { lang: 'es' });
    assert('Case 7: no medications extracted from an unrelated note', model.medications.length === 0);
    assert('Case 7: no cascades from an unrelated note', model.possibleCascades.length === 0);
    assert('Case 7: no active problems from an unrelated note', model.activeProblems.length === 0);
  }

  /* 8. Orthographic variants: "HTA", accent-free "hipertension arterial". */
  {
    const noteA = 'Antecedentes de HTA. Toma naproxeno y enalapril.';
    const modelA = CE.buildCaseModel(noteA, kb, { lang: 'es' });
    const htnA = modelA.activeProblems.find((p) => p.id === 'CPB001');
    assert('Case 8a: "HTA" abbreviation normalized and detected', !!htnA);
    assert('Case 8a: "Antecedentes de HTA" -> status history', !!htnA && htnA.status === 'history');

    const noteB = 'Paciente con hipertension arterial (sin tilde). Naproxeno y enalapril pautados.';
    const modelB = CE.buildCaseModel(noteB, kb, { lang: 'es' });
    const htnB = modelB.activeProblems.find((p) => p.id === 'CPB001');
    assert('Case 8b: accent-free "hipertension arterial" detected', !!htnB);
  }

  /* Empty note: must never throw, must return an empty, well-formed model. */
  {
    const model = CE.buildCaseModel('', kb, { lang: 'es' });
    assert('Empty note: returns well-formed empty CaseModel', Array.isArray(model.medications) &&
      Array.isArray(model.possibleCascades) && model.medications.length === 0 && model.possibleCascades.length === 0);
  }

  const r = summary();
  console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`);
  return r.fail === 0;
}

module.exports = { run };
if (require.main === module) { process.exit(run() ? 0 : 1); }
