'use strict';

const fs = require('fs');
const path = require('path');
const { assert, reset, summary } = require('./helpers');

function read(file) { return fs.readFileSync(path.join(__dirname, '..', file), 'utf8'); }

function run() {
  reset(); console.log('== report-wiring.test.js ==');
  const html = read('index.html');
  const app = read('app.js');
  const contract = read('report-contract.js');
  const reportScript = '<script src="report-contract.js"></script>';
  const appScript = '<script src="app.js"></script>';

  assert('report contract loads before app.js',
    html.indexOf(reportScript) !== -1 && html.indexOf(reportScript) < html.indexOf(appScript));
  assert('screen/JSON model is enriched through the shared contract', /ReportContract\.enrich\(baseReport/.test(app));
  assert('clinical-record text delegates to the shared contract', /ReportContract\.toClinicalText\(report, currentLanguage\)/.test(app));
  assert('CSV export delegates to the shared contract', /ReportContract\.toCsv\(report, currentLanguage\)/.test(app));
  assert('legacy inline CSV schema is removed from app.js', !/var csvCols = \[/.test(app));
  assert('report declares schema, language, provenance, audit and limitations',
    ['report_schema_version', 'language', 'input_provenance', 'professional_changes', 'discarded_findings', 'limitations']
      .every((field) => contract.includes(field)));
  assert('screen renders professional changes and limitations',
    /section_prof_changes/.test(app) && /section_limitations_report/.test(app));
  assert('discarded findings remain separate from report.cascades',
    /report\.discarded_findings = allCandidates\.filter/.test(contract));

  const r = summary(); console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`); return r.fail === 0;
}

module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
