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
  './regression.test.js',
  './legacy-nlp.test.js',
  './kb-audit.test.js'
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
