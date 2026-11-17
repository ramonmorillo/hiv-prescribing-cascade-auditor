'use strict';
/* ============================================================================
   HAL-01 — discontinued medicines, and the scope of a discontinuation verb.

   Two defects closed in Fase 0 (2026-11):
   1. Common phrasings ("dejó de tomar X", "X: ya no lo toma", "se retiró X",
      "sin X actualmente", "efavirenz previo", "stopped X") left X active, so
      it could start a cascade with a medicine the note says is not taken.
   2. The old test matched a discontinuation verb ANYWHERE in the sentence:
      "se suspendió atorvastatina y se inició rosuvastatina" deactivated the
      NEW drug too — a silent false negative for every rule involving it.
   Each case states the medicine and whether it must remain active.
   ============================================================================ */
const { loadKB, CE, assert, reset, summary } = require('./helpers');

const CASES = [
  /* Spanish — must become inactive */
  ['Dejó de tomar amlodipino hace 2 meses.', 'amlodipine', false],
  ['Ha dejado de tomar amlodipino.', 'amlodipine', false],
  ['Amlodipino: ya no lo toma.', 'amlodipine', false],
  ['Amlodipino 5 mg, ya no lo toma desde marzo.', 'amlodipine', false],
  ['Ya no toma amlodipino.', 'amlodipine', false],
  ['Se retiró amlodipino en 2024.', 'amlodipine', false],
  ['Retiramos amlodipino por edemas.', 'amlodipine', false],
  ['Sin amlodipino actualmente.', 'amlodipine', false],
  ['Efavirenz previo. Actualmente Biktarvy.', 'efavirenz', false],
  ['TAR previo: efavirenz.', 'efavirenz', false],
  ['Amlodipino (suspendido en 2024).', 'amlodipine', false],
  ['Enalapril había sido suspendido en 2022.', 'enalapril', false],
  ['Enalapril estaba suspendido.', 'enalapril', false],
  ['Tomó hidroclorotiazida durante 2022, pero fue suspendida en enero de 2023.', 'hydrochlorothiazide', false],
  ['Tomó hidroclorotiazida, pero se suspendió en 2023.', 'hydrochlorothiazide', false],
  ['Dolutegravir desde 2019 (previo efavirenz).', 'efavirenz', false],
  /* Spanish — scope: the OTHER medicine must stay active */
  ['Se suspendió atorvastatina y se inició rosuvastatina.', 'rosuvastatin', true],
  ['Se suspendió atorvastatina y se inició rosuvastatina.', 'atorvastatin', false],
  ['Dejó de tomar amlodipino y continúa con furosemida.', 'furosemide', true],
  ['Dolutegravir desde 2019 (previo efavirenz).', 'dolutegravir', true],
  ['Amlodipino 5 mg, pero se suspendió furosemida.', 'amlodipine', true],
  ['Amlodipino 5 mg, pero se suspendió furosemida.', 'furosemide', false],
  ['Atorvastatina 20 mg, aunque fue suspendida la simvastatina.', 'atorvastatin', true],
  /* Spanish — "sin"/"previo" in unrelated phrases must not deactivate */
  ['Amlodipino 5 mg/24h, sin cambios.', 'amlodipine', true],
  ['Sin cambios en amlodipino 5 mg.', 'amlodipine', true],
  ['Amlodipino 5 mg. Sin edemas.', 'amlodipine', true],
  ['Toma amlodipino sin problemas.', 'amlodipine', true],
  ['Continúa con amlodipino, previo control de TA.', 'amlodipine', true],
  ['Enalapril 10 mg, se mantiene.', 'enalapril', true],
  /* English */
  ['Stopped amlodipine two months ago.', 'amlodipine', false],
  ['Amlodipine discontinued in 2024.', 'amlodipine', false],
  ['No longer taking amlodipine.', 'amlodipine', false],
  ['Previously on efavirenz, now on Biktarvy.', 'efavirenz', false],
  ['Previously on efavirenz, now on Biktarvy.', 'bictegravir', true]
];

function run() {
  reset();
  console.log('== discontinuation-scope.test.js ==');
  const kb = loadKB('prod');

  CASES.forEach(([note, drug, expectActive]) => {
    const model = CE.buildCaseModel(note, kb, { lang: /^[A-Z][a-z]+ (on|taking)|^(Stopped|Amlodipine|No longer|Previously)/.test(note) ? 'en' : 'es' });
    const active = model.activeMedications.some((m) => m.normalized_name === drug);
    assert(`"${note}" → ${drug} ${expectActive ? 'stays active' : 'is not active'}`, active === expectActive);
    if (!expectActive) {
      assert(`"${note}" → ${drug} is kept as an inactive mention (traceable, not dropped)`,
        model.inactiveOrNegatedMedications.some((m) => m.normalized_name === drug));
    }
  });

  /* The HAL-01 clinical consequence: no cascade from a stopped drug. */
  const audit = CE.buildCaseModel('Paciente VIH con Biktarvy. HTA. Dejó de tomar amlodipino hace 2 meses por edema maleolar. Furosemida 40 mg desde marzo.', kb, { lang: 'es' });
  assert('HAL-01 audit note: no amlodipine → furosemide cascade from a discontinued drug',
    !audit.possibleCascades.some((c) => c.index_drug === 'amlodipine' && c.classification !== 'discarded'));

  const r = summary();
  console.log('  -> ' + r.pass + ' passed, ' + r.fail + ' failed');
  return r.fail === 0;
}

module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
