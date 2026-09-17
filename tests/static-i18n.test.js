'use strict';

const fs = require('fs');
const path = require('path');
const { assert, assertEqual, reset, summary } = require('./helpers');
const strings = require('../ui-static-i18n.js');

function read(name) {
  return fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
}

function referencedKeys(html) {
  const keys = new Set();
  const pattern = /data-i18n(?:-title|-placeholder|-aria-label|-content)?="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(html))) keys.add(match[1]);
  return [...keys].sort();
}

function run() {
  reset(); console.log('== static-i18n.test.js ==');
  const html = read('index.html');
  const app = read('app.js');
  const keys = referencedKeys(html);
  const esKeys = Object.keys(strings.es).sort();
  const enKeys = Object.keys(strings.en).sort();

  assertEqual('static dictionaries have identical ES/EN keys', enKeys, esKeys);
  assert('static shell declares translation bindings', keys.length >= 40);
  keys.forEach((key) => {
    assert('Spanish static translation exists: ' + key,
      Object.prototype.hasOwnProperty.call(strings.es, key) && strings.es[key] !== '');
    assert('English static translation exists: ' + key,
      Object.prototype.hasOwnProperty.call(strings.en, key) && strings.en[key] !== '');
  });

  assert('Spanish is the default document language', /<html\s+lang="es">/.test(html));
  assert('static dictionary loads before app.js',
    html.indexOf('<script src="ui-static-i18n.js"') > -1 &&
      html.indexOf('<script src="ui-static-i18n.js"') < html.indexOf('<script src="app.js"'));
  assert('language switch updates document language', /document\.documentElement\.lang\s*=\s*lang/.test(app));
  assert('static updater covers text, title, placeholder, aria-label and meta content',
    ['[data-i18n]', '[data-i18n-title]', '[data-i18n-placeholder]', '[data-i18n-aria-label]', '[data-i18n-content]']
      .every((selector) => app.includes(selector)));
  assert('legacy bilingual slash labels are absent', ![
    'Patient ID / ID Paciente',
    'Best Practices / Buenas Prácticas',
    'Privacy / Privacidad',
    'Research / Investigación',
    'Decision Support Only /',
    'No Real Patient Data /'
  ].some((fragment) => html.includes(fragment)));
  assert('no external font import is present', !/@import\s+url|fonts\.googleapis|fonts\.gstatic/.test(read('theme-siafcmo.css')));

  const r = summary(); console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`); return r.fail === 0;
}

module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
