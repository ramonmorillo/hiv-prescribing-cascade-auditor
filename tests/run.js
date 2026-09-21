#!/usr/bin/env node
'use strict';
/* Runs every *.test.js in this directory. No test framework, no
 * dependencies -- `node tests/run.js` is the entire contract, so this suite
 * can run in CI or locally with nothing to install. Exits non-zero if any
 * suite has a failure. */
const path = require('path');

const suites = [
  './index-case.test.js',
  './negative-cases.test.js',
  './temporal-events.test.js',
  './regression.test.js',
  './demo-case-regression.test.js',
  './legacy-nlp.test.js',
  './fixed-dose-classification.test.js',
  './kb-audit.test.js',
  './kb-validation-presentation.test.js',
  './medication-status-interactions.test.js',
  './multi-candidate-cascades.test.js',
  './final-adjustments.test.js',
  './static-i18n.test.js',
  './browser-security.test.js',
  './medication-review.test.js',
  './problem-review.test.js',
  './reviewed-input-adapter.test.js',
  './reviewed-input-integration.test.js',
  './reviewed-input-wiring.test.js',
  './reviewed-input-e2e.test.js',
  './reviewed-input-edge-cases.test.js',
  './report-contract.test.js',
  './report-wiring.test.js'
];

let allOk = true;
suites.forEach((rel) => {
  const mod = require(path.join(__dirname, rel));
  const ok = mod.run();
  allOk = allOk && ok;
});

if (allOk) {
  console.log('ALL TEST SUITES PASSED');
  process.exit(0);
} else {
  console.error('SOME TESTS FAILED');
  process.exit(1);
}
