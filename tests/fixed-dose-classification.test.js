'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { loadKB, CE, assert, assertEqual, reset, summary } = require('./helpers');

function demoNote() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const fnStart = source.indexOf('function loadDemoCase()');
  const assignment = source.indexOf('state.clinicalNote = [', fnStart);
  const expressionStart = source.indexOf('[', assignment);
  const expressionEnd = source.indexOf("].join('\\n')", expressionStart) + "].join('\\n')".length;
  return vm.runInNewContext(source.slice(expressionStart, expressionEnd));
}

function names(model) { return model.medications.map((m) => m.normalized_name).sort(); }
function expectSymtuza(label, note, kb) {
  const model = CE.buildCaseModel(note, kb, { lang: 'es' });
  const expected = ['cobicistat', 'darunavir', 'emtricitabine', 'tenofovir alafenamide'].sort();
  assertEqual(label + ': exactly four ingredients', JSON.stringify(names(model)), JSON.stringify(expected));
  const classes = Object.fromEntries(model.medications.map((m) => [m.normalized_name, m.drug_class]));
  assert(label + ': authoritative ingredient classes',
    classes.darunavir === 'Antiretroviral / PI' &&
    classes.cobicistat === 'Pharmacokinetic Booster' &&
    classes.emtricitabine === 'Antiretroviral / NRTI' &&
    classes['tenofovir alafenamide'] === 'Antiretroviral / NRTI');
  return model;
}

function run() {
  reset(); console.log('== fixed-dose-classification.test.js ==');
  const kb = loadKB('prod');
  expectSymtuza('Symtuza brand', 'Symtuza', kb);
  const composed = expectSymtuza('full composition plus brand',
    'darunavir/cobicistat/emtricitabina/tenofovir alafenamida (Symtuza)', kb);
  assert('composition and brand mentions remain traceable', composed.medications.every((m) =>
    m.brand === 'Symtuza' && m.original_mentions.includes('darunavir/cobicistat/emtricitabina/tenofovir alafenamida') &&
    m.original_mentions.includes('symtuza')));

  const darunavir = CE.buildCaseModel('darunavir', kb).medications;
  assert('unboosted darunavir remains an individual PI', darunavir.length === 1 &&
    darunavir[0].normalized_name === 'darunavir' && darunavir[0].drug_class === 'Antiretroviral / PI');
  const boosted = CE.buildCaseModel('darunavir/cobicistat', kb);
  assertEqual('darunavir/cobicistat expands to two ingredients', JSON.stringify(names(boosted)),
    JSON.stringify(['cobicistat', 'darunavir']));

  ['Rezolsta', 'Evotaz', 'Kaletra'].forEach((brand) => {
    assert(brand + ' expands to ingredient-level medications', CE.buildCaseModel(brand, kb).medications.length === 2);
  });

  const demo = CE.buildCaseModel(demoNote(), kb, { lang: 'es' });
  assertEqual('complete demo has ten unique active ingredients', demo.medications.length, 10);
  assertEqual('complete demo has zero unclassified ingredients', demo.medications.filter((m) => !m.drug_class).length, 0);
  assert('cascade engine still recognizes boosted darunavir regimen', demo.possibleCascades.some((s) =>
    s.index_drug === 'darunavir/cobicistat'));

  const interaction = CE.buildCaseModel('Symtuza y simvastatin', kb);
  assert('interaction engine recognizes cobicistat from boosted regimen', interaction.currentInteractions.some((ddi) =>
    ddi.id === 'DDI001' && ddi.active_participants.includes('cobicistat')));

  const r = summary(); console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`); return r.fail === 0;
}
module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
