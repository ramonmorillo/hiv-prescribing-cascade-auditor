'use strict';

const fs = require('fs');
const path = require('path');
const { assert, reset, summary } = require('./helpers');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function run() {
  reset(); console.log('== reviewed-input-wiring.test.js ==');
  const html = read('index.html');
  const app = read('app.js');
  const engine = read('clinical-engine.js');

  assert('reviewed-input adapter loads before app.js',
    html.indexOf('<script src="reviewed-input-adapter.js"></script>') !== -1 &&
    html.indexOf('<script src="reviewed-input-adapter.js"></script>') < html.indexOf('<script src="app.js"></script>'));
  assert('application builds the reviewed input through the dedicated adapter',
    /ReviewedInputAdapter\.build\(extractedModel, state\.medicationReview, state\.problemReview, state\.kb\)/.test(app));
  assert('application passes reviewed input explicitly to the clinical engine',
    /CE\.buildCaseModel\(noteText, state\.kb, \{ lang: currentLanguage, reviewedInput: reviewedInput \}\)/.test(app));
  assert('Step 2 review remains anchored to source extraction',
    /extractedClinicalInput[\s\S]*renderMedicationReview\(extractedMedications\)/.test(app));
  assert('review edits invalidate cached clinical output',
    (app.match(/invalidateReviewedClinicalInput\(\)/g) || []).length >= 9);
  assert('review input changes invalidate previous professional cascade verdicts',
    /function invalidateReviewedClinicalInput\(\)[\s\S]*state\.cascadeClassifications = \{\}/.test(app));
  assert('report application flags are derived rather than hardcoded false',
    !/applied_to_engine:\s*false/.test(app) && /reviewed_input_application/.test(app));
  assert('engine exposes application metadata and review audit',
    /reviewedInputApplication:/.test(engine) && /reviewAudit:/.test(engine));

  const r = summary(); console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`); return r.fail === 0;
}

module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
