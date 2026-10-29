const [fa, fb] = process.argv.slice(2);
// Compares two golden captures, ignoring ISO timestamps. Exit code 1 on any difference.
const path = require('path');
const a = require(path.resolve(fa)), b = require(path.resolve(fb));
const norm = (v) => JSON.stringify(v).replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '<TS>');
let diffs = 0, checks = 0;
for (const k of Object.keys(a.cases)) for (const part of ['auto', 'reviewed']) {
  checks++;
  if (norm(a.cases[k][part]) !== norm(b.cases[k][part])) { diffs++; console.log('DIFF', k, part); }
}
const sum = (r) => Object.entries(r.cases).map(([k, v]) => k + ':' + v.auto.es.report.cascade_count + '/' + v.auto.es.report.cascades.map(c => c.cascade_id + '=' + c.classification).join(',')).join('\n');
console.log(sum(b));
console.log(`compared ${checks} case/state pairs (report ES+EN, CSV ES+EN, clinical text ES+EN, reviewed report+CSV): ${diffs} differences; console errors after: ${b.consoleErrors.length}`);
process.exit(diffs ? 1 : 0);
