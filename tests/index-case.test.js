'use strict';
/* ============================================================================
   Index-case regression test — Prueba A.
   ----------------------------------------------------------------------------
   Case mandated by the 2026-09-14 (second round) clinical-engine audit: a
   56-year-old woman on Dovato since 2019, taking anastrozole and
   amitriptyline, who starts naproxen in May 2026 for joint pain, with NO
   prior history of hypertension, and is diagnosed with hypertension from two
   repeated elevated BP readings in August 2026, at which point enalapril is
   started. See docs/clinical-engine-fix-audit.md for the full root-cause
   diagnosis this test guards against regressing.

   Every assertion here maps 1:1 to a requirement from "Prueba A" in the
   audit brief.
   ============================================================================ */
const { loadKB, CE, assert, reset, summary } = require('./helpers');

function run() {
  reset();
  console.log('== index-case.test.js ==');

  const kb = loadKB('prod');
  const note = 'Mujer de 56 años con infección por VIH, en tratamiento con Dovato desde 2019. ' +
    'Toma anastrozol 1 mg cada 24 horas y amitriptilina 25 mg por la noche. ' +
    'En mayo de 2026 inicia naproxeno 550 mg cada 12 horas por dolor articular. ' +
    'No tenía antecedentes de hipertensión. ' +
    'En agosto de 2026 presenta cifras repetidas de presión arterial de 165/95 y 160/92 mmHg, ' +
    'por lo que se diagnostica hipertensión arterial y se inicia enalapril 5 mg cada 24 horas.';

  const model = CE.buildCaseModel(note, kb, { lang: 'es' });
  const meds = model.medications.map((m) => m.normalized_name);

  /* ---- Medication extraction ---- */
  assert('Dovato detected and split into dolutegravir + lamivudine',
    meds.includes('dolutegravir') && meds.includes('lamivudine'));
  ['anastrozole', 'amitriptyline', 'naproxen', 'enalapril'].forEach((d) =>
    assert('Drug detected: ' + d, meds.includes(d)));
  assert('Exactly six active ingredients detected (no extras, no omissions)', meds.length === 6);

  /* ---- Dates ---- */
  const naproxenMed = model.medications.find((m) => m.normalized_name === 'naproxen');
  const enalaprilMed = model.medications.find((m) => m.normalized_name === 'enalapril');
  const dtgMed = model.medications.find((m) => m.normalized_name === 'dolutegravir');
  assert('Naproxen start date captured as "mayo de 2026" (literal, not invented)',
    !!naproxenMed && /mayo de 2026/i.test(naproxenMed.start_date || ''));
  assert('Enalapril start date captured as "agosto de 2026"',
    !!enalaprilMed && /agosto de 2026/i.test(enalaprilMed.start_date || ''));
  assert('Dovato/dolutegravir start date captured as "desde 2019"',
    !!dtgMed && /2019/.test(dtgMed.start_date || ''));

  /* ---- BP measurements ---- */
  const values = model.clinicalMeasurements.map((m) => m.value.systolic + '/' + m.value.diastolic);
  assert('165/95 mmHg captured as a measurement', values.includes('165/95'));
  assert('160/92 mmHg captured as a measurement', values.includes('160/92'));

  /* ---- Temporal reconciliation: historical absence != current negation ---- */
  const htn = model.activeProblems.find((p) => p.id === 'CPB001');
  assert('Hypertension concept detected', !!htn);
  assert('"No tenía antecedentes de hipertensión" recorded as one event, status=absent, temporality=historical',
    !!htn && htn.events.some((e) => e.status === 'absent' && e.temporality === 'historical'));
  assert('The later affirmed August 2026 diagnosis is recorded as its own separate event (history preserved, not overwritten)',
    !!htn && htn.events.length >= 2);
  assert('Final reconciled hypertension status is ACTIVE, never "negated"/"absent"',
    !!htn && htn.status === 'active');
  assert('Final status is not a contradiction (the dated Aug-2026 event resolves the historical-absence event unambiguously)',
    !!htn && htn.contradiction === false);

  /* ---- Medication-indication linking (Fase 3) ---- */
  assert('Enalapril is explicitly linked to hypertension as its indication',
    !!enalaprilMed && enalaprilMed.explicit_indication &&
    /hipertensi/i.test(enalaprilMed.explicit_indication.concept_es || ''));
  assert('Naproxen is explicitly linked to joint pain / musculoskeletal pain as its indication',
    !!naproxenMed && naproxenMed.explicit_indication);

  /* ---- CC001: exactly one candidate, never auto-discarded by the
     historical-absence defect, classified prudently ---- */
  const cc001Signals = model.possibleCascades.filter((c) => c.cascade_id === 'CC001');
  assert('Exactly one CC001 candidate generated', cc001Signals.length === 1);
  const cc001 = cc001Signals[0];
  assert('CC001 is index_drug=naproxen, cascade_drug=enalapril',
    !!cc001 && cc001.index_drug === 'naproxen' && cc001.cascade_drug === 'enalapril');
  assert('CC001 is NOT discarded by the historical-negation defect ("problem_negated")',
    !!cc001 && cc001.classification_reason_code !== 'problem_negated');
  assert('CC001 classification is never the literal word "confirmada"/"confirmed" (system never self-confirms)',
    !!cc001 && cc001.classification !== 'confirmed' && cc001.classification !== 'confirmada');
  assert('CC001 is a prudent possible-cascade classification (supported or incomplete), not discarded/coincidence',
    !!cc001 && ['supported_possible_cascade', 'possible_but_incomplete'].includes(cc001.classification));

  /* ---- VIH003: must not fire a cardiometabolic intervention when weight
     gain/diabetes/metabolic syndrome is nowhere in the note, and must not
     reuse enalapril (whose explicit indication is hypertension) ---- */
  const vih003 = model.possibleCascades.find((c) => c.cascade_id === 'VIH003');
  assert('VIH003 does not appear as a supported or incomplete cascade (no weight gain/diabetes evidence in the note)',
    !vih003 || !['supported_possible_cascade', 'possible_but_incomplete'].includes(vih003.classification));
  assert('If VIH003 is generated at all, it is discarded specifically for reusing an incompatible explicit indication',
    !vih003 || vih003.classification_reason_code === 'medication_indication_mismatch' ||
    vih003.classification === 'pharmacological_match_only');
  assert('No signal proposes a weight-gain/diabetes intervention (absent from the note)',
    !model.possibleCascades.some((c) =>
      ['supported_possible_cascade', 'possible_but_incomplete'].includes(c.classification) &&
      /peso|diabetes|metab[oó]lico/i.test((c.ade_es || '') + (c.recommended_action_es || ''))));

  /* ---- No metformin, no metformin interaction ---- */
  assert('Metformin is not in the detected medication list (never mentioned in the note)',
    !meds.includes('metformin'));
  assert('No signal carries a dolutegravir-metformin DDI warning when metformin is absent',
    !model.possibleCascades.some((c) => /metformin|metformina/i.test(c.ddi_warning_es || '')));

  /* ---- Anticholinergic burden (Fase 6): only amitriptyline contributes,
     and single-contributor wording must not claim cumulative/multi-drug
     exposure ---- */
  const acbAlert = model.globalMedicationAlerts.find((a) => a.id === 'ACB_SCORE');
  assert('An ACB_SCORE alert is generated (amitriptyline is a defined ACB-3 contributor)', !!acbAlert);
  assert('Only amitriptyline is listed as a contributor',
    !!acbAlert && acbAlert.drugs_involved.length === 1 && acbAlert.drugs_involved[0] === 'amitriptyline');
  ['dolutegravir', 'lamivudine', 'anastrozole', 'naproxen', 'enalapril'].forEach((d) =>
    assert('Drug NOT listed as an anticholinergic contributor: ' + d,
      !acbAlert || acbAlert.drugs_involved.indexOf(d) === -1));
  assert('Single-contributor wording does not claim a cumulative/multi-drug effect',
    !!acbAlert && !/efecto acumulado de (varios|m[uú]ltiples)/i.test(acbAlert.message_es || ''));

  /* ---- Fase 8: top-intervention priority filtering must never surface a
     discarded cascade's recommendation (VIH003 was discarded above; its
     "switch the INSTI" action must not appear as a leading intervention
     just because it happened to exist in possibleCascades) ---- */
  var topInterventions = CE.selectTopInterventions(model.possibleCascades, 'es', 3);
  assert('Top interventions include the CC001 (actionable) recommendation',
    topInterventions.some((t) => /AINE/i.test(t)));
  assert('Top interventions never include the discarded VIH003 recommendation',
    !topInterventions.some((t) => /INSTI/i.test(t)));

  /* ---- Duplicate suppression ---- */
  const seenPairs = {};
  let hasDuplicatePair = false;
  model.possibleCascades.forEach((c) => {
    const key = c.index_drug + '|' + c.cascade_drug;
    if (seenPairs[key]) hasDuplicatePair = true;
    seenPairs[key] = true;
  });
  assert('No duplicate index/cascade drug pair produces two separate cards', !hasDuplicatePair);

  const r = summary();
  console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`);
  return r.fail === 0;
}

module.exports = { run };
if (require.main === module) { process.exit(run() ? 0 : 1); }
