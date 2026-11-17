'use strict';
/* ============================================================================
   Coverage warning — prescription-like text that resolves to no medicine must
   be reported, and no screen may then read as a complete, reassuring result.

   Defect this guards against (Fase 0 audit, 2026-11): "Norvir + sildenafilo +
   metadona + voriconazol" returned only ritonavir, an empty
   missingInformation, and step 5 said "no se requiere plan de actuación".
   ============================================================================ */
const { loadKB, CE, assert, reset, summary } = require('./helpers');
const { loadApp } = require('./ddi-display.test.js');

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');

function run() {
  reset();
  console.log('== coverage-warning.test.js ==');
  const kb = loadKB('prod');
  const terms = (note) => CE.buildCaseModel(note, kb, { lang: 'es' }).unrecognizedMedicationCandidates.map((c) => c.term);

  /* True positives: unknown medicines and misspellings with a dose or frequency. */
  [
    ['Vericiguat 2,5 mg/24h.', 'Vericiguat'],
    ['Finerenona 10 mg cada 24 h.', 'Finerenona'],
    ['Amlodipno 10 mg.', 'Amlodipno'],
    ['Tratamiento: Xyzofeno 2 comprimidos al día.', 'Xyzofeno'],
    ['Current medication: Zorbatide 5 mg daily.', 'Zorbatide']
  ].forEach(([note, term]) => {
    assert(`flags unrecognised "${term}"`, terms(note).indexOf(term) !== -1);
  });

  /* False positives that must NOT be flagged. */
  [
    'Creatinina 1,2 mg/dL. Calcio 9,5 mg/dL. Glucosa 110 mg/dl. Hb 13 g/dL. Potasio 3,5 mmol/L.',
    'Proteinuria 300 mg/24h. Peso 70 kg. Dosis máxima 20 mg.',
    'Carga viral <50 copias/mL. CD4 620 células/μL.',
    'Darunavir/ritonavir 800/100 mg. Furosemida 40mg/día. Tratado con furosemide 40 mg/día.',
    'Xarelto 20 mg cada 24 h. Lyrica 75 mg/12h. Paracetamol 1 g a demanda.',
    'No toma metformina 850 mg desde hace un año.'
  ].forEach((note) => {
    assert(`no false coverage warning: "${note.slice(0, 60)}"`, terms(note).length === 0);
  });

  const model = CE.buildCaseModel('Norvir 100 mg. Vericiguat 2,5 mg.', kb, { lang: 'es' });
  const item = model.missingInformation.find((m) => m.type === 'unrecognized_medication_candidates');
  assert('coverage gap is a bilingual missingInformation item', !!item && /Vericiguat/.test(item.message_es) && /Vericiguat/.test(item.message_en));
  assert('unrecognised term is never added to the medication list',
    !model.activeMedications.some((m) => /vericiguat/i.test(m.normalized_name)));
  assertEmptyModel();

  /* UI: no reassuring result while coverage is incomplete. */
  const ctx = loadApp('es');
  const app = ctx.__app;
  app.state.clinicalNote = 'Paciente con infección por VIH. Biktarvy 1 comp/24h. Vericiguat 2,5 mg/24h.';
  const step4 = app.steps[4].body();
  assert('step 4 shows the coverage warning', /Cobertura incompleta/.test(text(step4)) && /Vericiguat/.test(step4));
  assert('step 4 does not show the green "no cascade signals" success callout', !/callout-success/.test(step4));
  const step5 = app.steps[5].body();
  assert('step 5 shows the coverage warning and no success callout', /Cobertura incompleta/.test(text(step5)) && !/callout-success/.test(step5));
  assert('step 5 never claims "no se requiere plan de actuación"', !/no se requiere plan/i.test(text(step5)));
  const step2 = app.steps[2].body();
  assert('step 2 (medications) shows the coverage warning', /Cobertura incompleta/.test(text(step2)));
  const report = app.buildReport();
  assert('report limitations carry the coverage gap', (report.limitations || []).some((l) => l.code === 'unrecognized_medication_candidates'));

  /* A complete note keeps its success state (the warning is not noise). */
  app.state.clinicalNote = 'Paciente con infección por VIH. Biktarvy 1 comp/24h.';
  app.state.caseModel = null;
  assert('complete note keeps the success callout', /callout-success/.test(app.steps[4].body()) && !/Cobertura incompleta/.test(text(app.steps[4].body())));

  const r = summary();
  console.log('  -> ' + r.pass + ' passed, ' + r.fail + ' failed');
  return r.fail === 0;

  function assertEmptyModel() {
    assert('empty note exposes an empty coverage list', Array.isArray(CE.buildCaseModel('', kb).unrecognizedMedicationCandidates));
  }
}

module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
