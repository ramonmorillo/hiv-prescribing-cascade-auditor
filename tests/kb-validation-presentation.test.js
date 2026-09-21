'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { assert, assertEqual, reset, summary } = require('./helpers');
const strings = require('../ui-static-i18n.js');

function loadRunKBValidation(options) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const start = source.indexOf('function runKBValidation()');
  const end = source.indexOf('\n/* Strip in-memory', start);
  if (start < 0 || end < 0) throw new Error('runKBValidation source not found');

  const elements = {};
  const main = {
    firstChild: null,
    insertBefore(element) {
      element.parentNode = this;
      elements[element.id] = element;
      this.firstChild = element;
    },
    removeChild(element) {
      delete elements[element.id];
      if (this.firstChild === element) this.firstChild = null;
      element.parentNode = null;
    }
  };
  const document = {
    body: main,
    getElementById(id) { return elements[id] || null; },
    querySelector(selector) { return selector === 'main.app-main' ? main : null; },
    createElement() { return { id: '', style: {}, innerHTML: '', parentNode: null }; }
  };
  const calls = { validations: 0, warnings: [], errors: [] };
  const language = options.language || 'es';
  const context = {
    state: { kbMode: options.mode, kb: { coreCascades: {} } },
    document,
    validateKBOperational() {
      calls.validations += 1;
      return options.result;
    },
    console: {
      warn() { calls.warnings.push(Array.from(arguments).join(' ')); },
      error() { calls.errors.push(Array.from(arguments).join(' ')); }
    },
    escHtml(value) {
      return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
    tStatic(key) {
      const value = strings[language][key];
      const args = Array.prototype.slice.call(arguments, 1);
      return typeof value === 'function' ? value.apply(null, args) : value;
    }
  };
  vm.runInNewContext(source.slice(start, end), context);
  return { run: context.runKBValidation, document, calls };
}

function report(overrides) {
  return Object.assign({
    ok: true,
    errors: [],
    warnings: [],
    fallbackCascadeCount: 0,
    fallbackFieldCount: 0,
    fallbackByField: {},
    fallbackByFieldIds: {}
  }, overrides);
}

function run() {
  reset();
  console.log('== kb-validation-presentation.test.js ==');

  const technicalWarning = '[CC003/CC042] Possible overlapping active rules';
  const prodWarnings = loadRunKBValidation({
    mode: 'PROD',
    result: report({ warnings: [technicalWarning] })
  });
  prodWarnings.run();
  assertEqual('PROD warnings still execute operational KB validation', prodWarnings.calls.validations, 1);
  assert('PROD warnings do not create a validation banner',
    !prodWarnings.document.getElementById('kb-validation-banner'));
  assert('PROD warnings are retained in console diagnostics',
    prodWarnings.calls.warnings.some((entry) => entry.includes(technicalWarning)));

  const devWarnings = loadRunKBValidation({
    mode: 'DEV',
    result: report({ warnings: [technicalWarning] })
  });
  devWarnings.run();
  const devBanner = devWarnings.document.getElementById('kb-validation-banner');
  assert('DEV warnings render the complete validation banner', devBanner &&
    devBanner.innerHTML.includes('Avisos de la KB') &&
    devBanner.innerHTML.includes('CC003/CC042') &&
    devBanner.innerHTML.includes('kb-val-detail'));

  const technicalError = '[CC999] Missing required field "ade_en".';
  ['es', 'en'].forEach((language) => {
    const prodError = loadRunKBValidation({
      mode: 'PROD',
      language,
      result: report({ ok: false, errors: [technicalError], warnings: [technicalWarning] })
    });
    prodError.run();
    const banner = prodError.document.getElementById('kb-validation-banner');
    assert(`[PROD/${language}] blocking error renders the localised generic message`, banner &&
      banner.innerHTML.includes(strings[language].kb_validation_failed_generic));
    assert(`[PROD/${language}] blocking banner excludes rule IDs and technical details`, banner &&
      !banner.innerHTML.includes('CC999') && !banner.innerHTML.includes('ade_en') &&
      !banner.innerHTML.includes('CC003') && !banner.innerHTML.includes('kb-val-detail'));
    assert(`[PROD/${language}] technical error remains in console diagnostics`,
      prodError.calls.errors.some((entry) => entry.includes(technicalError)));
  });

  const r = summary();
  console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`);
  return r.fail === 0;
}

module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
