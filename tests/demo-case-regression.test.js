'use strict';
/* Regression against the literal note assigned by loadDemoCase(). Reading
 * that array from app.js prevents this fixture drifting away from the demo. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { loadKB, CE, assert, assertEqual, reset, summary } = require('./helpers');

function exactLoadDemoCaseText() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = source.indexOf('function loadDemoCase()');
  const assignment = source.indexOf('state.clinicalNote = [', fnStart);
  const expressionStart = source.indexOf('[', assignment);
  const expressionEnd = source.indexOf("].join('\\n')", expressionStart) + "].join('\\n')".length;
  if (fnStart < 0 || assignment < 0 || expressionEnd < 12) throw new Error('loadDemoCase clinical-note literal not found');
  return vm.runInNewContext(source.slice(expressionStart, expressionEnd));
}

function run() {
  reset(); console.log('== demo-case-regression.test.js ==');
  const note = exactLoadDemoCaseText();

  ['prod', 'dev'].forEach((track) => {
    const model = CE.buildCaseModel(note, loadKB(track), { lang: 'es' });
    const episode = model.possibleCascades.filter((signal) =>
      CE.normalizeDrugText(signal.index_drug) === 'amlodipine' &&
      CE.normalizeDrugText(signal.cascade_drug) === 'furosemide');
    assertEqual(`[${track}] demo renders one amlodipine-edema-furosemide clinical card`, episode.length, 1);
    const card = episode[0];
    assert(`[${track}] canonical demo card is CC004`, card && card.cascade_id === 'CC004' && card.rule_id === 'CC004');
    assert(`[${track}] CC041 is inactive`, !model.possibleCascades.some((signal) => signal.rule_id === 'CC041'));
    assert(`[${track}] SYM008 is consolidated rather than independently rendered`,
      !model.possibleCascades.some((signal) => signal.rule_id === 'SYM008'));
    assert(`[${track}] abbreviated explicit dates support the chronology`, card &&
      card.evidence.temporal_order.status === 'supportive' &&
      card.evidence.temporal_order.reason_code === 'explicit_dates_compatible' &&
      card.evidence.temporal_order.index_date.value === 202107 &&
      card.evidence.temporal_order.cascade_date.value === 202302);
    assert(`[${track}] consolidated card preserves SYM008 symptom evidence and provenance`, card &&
      card.evidence.symptom_bridge_provenance.some((item) => item.rule_id === 'SYM008' && item.symptom === 'oedema' &&
        item.evidence.intermediate_problem.onset_date.value === 202209 &&
        item.evidence.temporal_order.reason_code === 'explicit_dates_compatible') &&
      card.provenance.some((item) => item.source === 'symptom_bridge' && item.rule_id === 'SYM008'));

    /* VIH027 (cobicistat, from Symtuza) must fire exactly once, not once for
       "cobicistat" and once more for the redundant "darunavir/cobicistat"
       label — the duplicate reported against this exact demo case. */
    const vih027 = model.possibleCascades.filter((signal) => signal.rule_id === 'VIH027');
    assertEqual(`[${track}] VIH027 fires once for cobicistat, never once per matching index example`,
      vih027.length, 1);

    /* CC001 legitimately fires once per active antihypertensive already
       compatible with the rule (amlodipine, furosemide) — two genuinely
       distinct candidates, not a duplicate — so each must carry a distinct
       candidate_role identifying which is the initial response and which is
       the later intensification, for the UI to explain the difference. */
    const cc001 = model.possibleCascades.filter((signal) => signal.rule_id === 'CC001');
    assertEqual(`[${track}] CC001 evaluates both active antihypertensives independently`, cc001.length, 2);
    assert(`[${track}] CC001 candidates are labelled initial response vs. subsequent intensification`,
      cc001.some((c) => c.cascade_drug === 'amlodipine' && c.candidate_role === 'initial_response') &&
      cc001.some((c) => c.cascade_drug === 'furosemide' && c.candidate_role === 'subsequent_intensification'));
  });

  const r = summary(); console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`); return r.fail === 0;
}
module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
