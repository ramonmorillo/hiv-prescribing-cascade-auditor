'use strict';
/* Shared test helpers: no external dependencies (no Jest/Mocha), so the
 * suite runs anywhere Node runs, with nothing to install. See tests/run.js. */

const fs = require('fs');
const path = require('path');
const CE = require('../clinical-engine.js');

function loadJSON(relPath) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8'));
}

/** Load the PROD knowledge base exactly as loadKB() in app.js does (same
 * file set, same keys), plus the new clinicalProblems entry. */
function loadKB(track) {
  const folder = 'kb/' + (track || 'prod');
  return {
    coreCascades: loadJSON(folder + '/kb_core_cascades.json'),
    vihModifiers: loadJSON(folder + '/kb_vih_modifiers.json'),
    ddiWatchlist: loadJSON(folder + '/ddi_watchlist.json'),
    symptomDictionary: loadJSON(folder + '/kb_symptoms.json'),
    clinicalModifiers: loadJSON(folder + '/kb_clinical_modifiers.json'),
    adeTreatmentMap: loadJSON(folder + '/ade_treatment_map.json'),
    clinicalProblems: loadJSON(folder + '/clinical_problems.json'),
    drugDictionary: loadJSON('kb/drug_dictionary.json'),
    drugCombinations: loadJSON('kb/drug_combinations.json')
  };
}

let _results = { pass: 0, fail: 0, failures: [] };

function reset() { _results = { pass: 0, fail: 0, failures: [] }; }

function assert(label, condition) {
  if (condition) {
    _results.pass++;
  } else {
    _results.fail++;
    _results.failures.push(label);
    console.error('  FAIL | ' + label);
  }
}

function assertEqual(label, got, expected) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) {
    console.error('  FAIL | ' + label + '  (got=' + JSON.stringify(got) + ' want=' + JSON.stringify(expected) + ')');
    _results.fail++;
    _results.failures.push(label);
  } else {
    _results.pass++;
  }
}

function summary() { return _results; }

module.exports = { loadKB, loadJSON, CE, assert, assertEqual, reset, summary };
