'use strict';
/* ============================================================================
   Index-case regression test.
   ----------------------------------------------------------------------------
   This is the exact case reported during the clinical-engine audit (see
   KB_REFERENCE.md and kb/CHANGELOG.md for the full diagnosis): a 56-year-old
   woman on Dovato since 2019 for HIV category C3, with a fixed medication
   list, who is later prescribed enalapril for a single 130/80 mmHg BP
   reading documented as "hipertensión".

   Every assertion here maps 1:1 to a requirement from the audit brief.
   ============================================================================ */
const { loadKB, CE, assert, reset, summary } = require('./helpers');

function run() {
  reset();
  console.log('== index-case.test.js ==');

  const kb = loadKB('prod');
  const note = [
    'Mujer de 56 años, en tratamiento con Dovato desde 2019 por VIH categoría C3.',
    'Medicación habitual:',
    '- Calcio carbonato/colecalciferol, un comprimido cada 24 horas.',
    '- Atorvastatina 10 mg al día.',
    '- Anastrozol 1 mg cada 24 horas.',
    '- Gabapentina, una cápsula cada 8 horas.',
    '- Hidroxizina si precisa.',
    '- Amitriptilina 50 mg al día.',
    '- Naproxeno 550 mg cada 8 horas desde mayo de 2026.',
    '- Etoricoxib si precisa.',
    'Posteriormente acude al médico y se prescribe enalapril 5 mg por una presión arterial de 130/80 mmHg, descrita en la nota como hipertensión.'
  ].join('\n');

  const model = CE.buildCaseModel(note, kb, { lang: 'es' });
  const meds = model.medications.map((m) => m.normalized_name);

  /* ---- Medication extraction / normalization ---- */
  assert('Dovato detected and split into dolutegravir + lamivudine',
    meds.includes('dolutegravir') && meds.includes('lamivudine'));
  const dovatoMeds = model.medications.filter((m) => m.brand === 'Dovato');
  assert('Both Dovato ingredients carry brand=Dovato for traceability', dovatoMeds.length === 2);

  assert('Calcium carbonate detected', meds.includes('calcium carbonate'));
  assert('Cholecalciferol (colecalciferol) detected', meds.includes('colecalciferol'));
  assert('Anastrozole detected', meds.includes('anastrozole'));

  ['atorvastatin', 'gabapentin', 'hydroxyzine', 'amitriptyline', 'naproxen', 'etoricoxib', 'enalapril']
    .forEach((d) => assert('Drug detected: ' + d, meds.includes(d)));

  /* ---- Active problems ---- */
  const htn = model.activeProblems.find((p) => p.id === 'CPB001');
  assert('Hypertension detected as an explicit active problem', !!htn && htn.status === 'active');
  assert('Hypertension source is explicit (literal note text), not inferred',
    !htn || htn.source === 'explicit');

  /* ---- Clinical measurements + discordance ---- */
  const bp = model.clinicalMeasurements.find((m) => m.type === 'blood_pressure');
  assert('BP 130/80 mmHg captured as a clinical measurement',
    !!bp && bp.value.systolic === 130 && bp.value.diastolic === 80);
  assert('System records the diagnosis is NOT confirmed by this single reading (discordance)',
    !!bp && bp.interpretation.meets_single_reading_hypertension_threshold === false);

  /* ---- Cascade signal count / classification ---- */
  const htnSignals = model.possibleCascades.filter((c) =>
    CE.normalizeDrugText(c.index_drug) === 'naproxen' && CE.normalizeDrugText(c.cascade_drug) === 'enalapril');
  assert('At most one NSAID→hypertension→enalapril signal (CC001/CC061 duplicate consolidated)',
    htnSignals.length === 1);
  assert('That signal is NEVER presented as a confirmed/fully-supported cascade',
    htnSignals[0] && htnSignals[0].classification !== 'supported_possible_cascade');
  assert('That signal is downgraded specifically for the measurement discordance reason',
    htnSignals[0] && htnSignals[0].classification_reason_code === 'measurement_discordant');

  /* ---- Recommendation scoping (the CM006/CM007-leak bug) ---- */
  const cc001 = htnSignals[0];
  assert('The cardiovascular recommendation text is CC001-specific, not generic',
    cc001 && /AINE/i.test(cc001.recommended_action_es));
  assert('Anticholinergic-burden modifier (CM006) is NOT attached to this cascade signal',
    cc001 && (!cc001.patient_context_modifiers || cc001.patient_context_modifiers.indexOf('CM006') === -1));
  assert('CNS-depressant-burden modifier (CM007) is NOT attached to this cascade signal',
    cc001 && (!cc001.patient_context_modifiers || cc001.patient_context_modifiers.indexOf('CM007') === -1));

  /* ---- Global alerts vs. cascades: strict separation ---- */
  const alertIds = model.globalMedicationAlerts.map((a) => a.id);
  assert('Anticholinergic burden (CM006) appears as a GLOBAL alert', alertIds.includes('CM006'));
  assert('CNS depressant burden (CM007) appears as a GLOBAL alert', alertIds.includes('CM007'));
  assert('NSAID duplicity (naproxen+etoricoxib) appears as its own separate global finding, not a cascade',
    alertIds.includes('GA_NSAID_DUPLICITY') &&
    !model.possibleCascades.some((c) => c.cascade_id === 'GA_NSAID_DUPLICITY'));

  /* ---- PRN preservation ---- */
  const hydroxyzine = model.medications.find((m) => m.normalized_name === 'hydroxyzine');
  const etoricoxib = model.medications.find((m) => m.normalized_name === 'etoricoxib');
  const amitriptyline = model.medications.find((m) => m.normalized_name === 'amitriptyline');
  assert('Hydroxyzine "si precisa" preserved as prn=true', hydroxyzine && hydroxyzine.prn === true);
  assert('Etoricoxib "si precisa" preserved as prn=true', etoricoxib && etoricoxib.prn === true);
  assert('Amitriptyline (scheduled, not prn) is NOT contaminated by the neighbouring prn line',
    amitriptyline && amitriptyline.prn === false);

  /* ---- No invented data ---- */
  model.medications.forEach((m) => {
    assert('No invented start_date for ' + m.normalized_name + ' (must be null or literally present in note)',
      m.start_date === null);
  });
  assert('No cascade signal claims a confirmed/diagnostic-certainty classification anywhere in this case',
    !model.possibleCascades.some((c) => c.classification === 'supported_possible_cascade' && c.evidence.measurement_discordance.discordant));

  const r = summary();
  console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`);
  return r.fail === 0;
}

module.exports = { run };
if (require.main === module) { process.exit(run() ? 0 : 1); }
