'use strict';
/* ============================================================================
   DDI display — an interaction the engine computes must reach the clinician.

   Defect this guards against (Fase 0 audit, 2026-11): currentInteractions was
   computed but only written to the JSON export. Step 4 showed "Sin señales de
   cascada detectadas" for Prezista + Norvir + simvastatin while DDI001
   (CONTRAINDICATED) sat unrendered in the model. This suite loads the real
   app.js in a VM with a minimal DOM stub and renders the real step bodies,
   so it fails if any surface stops presenting interactions.
   ============================================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadKB, assert, reset, summary } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = ['ui-static-i18n.js', 'clinical-engine.js', 'report-contract.js', 'medication-review.js',
  'problem-review.js', 'reviewed-input-adapter.js', 'kb/dev/kb_validator.js', 'app.js'];

function loadApp(language) {
  const noop = () => {};
  const element = () => ({
    style: {}, dataset: {}, innerHTML: '', textContent: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop, getAttribute: () => null, addEventListener: noop, appendChild: noop,
    querySelectorAll: () => [], querySelector: () => null
  });
  const store = {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    document: {
      addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: element, documentElement: element(), body: element(), readyState: 'loading'
    },
    navigator: { language: 'es' }, location: { hash: '', search: '' },
    localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    setTimeout, clearTimeout, fetch: () => Promise.reject(new Error('offline test'))
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.addEventListener = noop;
  vm.createContext(ctx);
  SCRIPTS.forEach((file) => vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file }));
  vm.runInContext('this.__app = { state: state, steps: STEP_CONTENT, buildReport: buildReport, ' +
    'setLang: function (l) { currentLanguage = l; } };', ctx);
  Object.assign(ctx.__app.state.kb, loadKB('prod'));
  ctx.__app.setLang(language);
  return ctx;
}

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '·').replace(/\s+/g, ' ');

function run() {
  reset();
  console.log('== ddi-display.test.js ==');

  const NOTE = 'Paciente con infección por VIH. Prezista 800 mg + Norvir 100 mg. Simvastatina 40 mg por dislipemia.';

  ['es', 'en'].forEach((lang) => {
    const ctx = loadApp(lang);
    const app = ctx.__app;
    app.state.clinicalNote = NOTE;

    const step4 = app.steps[4].body();
    assert(`[${lang}] step 4 renders the interaction section`, /id="ddi-section"/.test(step4));
    assert(`[${lang}] step 4 shows DDI001 with contraindicated styling`,
      /DDI001/.test(step4) && /ddi-card--contraindicated/.test(step4));
    assert(`[${lang}] step 4 names the interacting medicines`, /ritonavir/.test(step4) && /simvastatin/.test(step4));
    assert(`[${lang}] step 4 places interactions before the cascade result`,
      step4.indexOf('ddi-section') < step4.indexOf(lang === 'es' ? 'Sin se&ntilde;ales de cascada' : 'No cascade signals'));
    assert(`[${lang}] step 4 states the scope of the interaction check`,
      text(step4).indexOf(lang === 'es' ? 'La ausencia de alerta no descarta' : 'The absence of an alert does not rule out') !== -1);

    const report = app.buildReport();
    assert(`[${lang}] report carries drug_interactions`,
      Array.isArray(report.drug_interactions) && report.drug_interactions.some((d) => d.id === 'DDI001' && d.severity === 'CONTRAINDICATED'));
    assert(`[${lang}] report interaction summary counts the contraindication`,
      report.interaction_summary && report.interaction_summary.contraindicated === 1);

    const step6 = app.steps[6].body();
    assert(`[${lang}] step 6 report renders DDI001`, /DDI001/.test(step6) && /ddi-card--contraindicated/.test(step6));

    const clinicalText = ctx.ReportContract.toClinicalText(report, lang);
    assert(`[${lang}] clinical text lists the interaction with its severity`,
      /DDI001/.test(clinicalText) && (lang === 'es' ? /\[CONTRAINDICADA\]/ : /\[CONTRAINDICATED\]/).test(clinicalText));

    const csv = ctx.ReportContract.toCsv(report, lang);
    assert(`[${lang}] CSV header declares drug_interactions_json`, csv.split('\r\n')[0].indexOf('drug_interactions_json') !== -1);
    assert(`[${lang}] CSV rows carry the interaction`, /DDI001/.test(csv.split('\r\n')[1] || ''));
  });

  /* No interaction: an explicit, non-reassuring statement — never silence. */
  const ctx = loadApp('es');
  ctx.__app.state.clinicalNote = 'Paciente con infección por VIH. Biktarvy 1 comprimido al día. Paracetamol 1 g a demanda.';
  const empty = ctx.__app.steps[4].body();
  assert('no-interaction case states that no rule fired AND the scope caveat',
    /ddi-section/.test(empty) && text(empty).indexOf('No se ha activado ninguna regla de interacción') !== -1 &&
    text(empty).indexOf('La ausencia de alerta no descarta') !== -1);

  /* Severity order: contraindications first, whatever the KB order. */
  ctx.__app.state.clinicalNote = 'Norvir 100 mg. Atorvastatina 20 mg. Simvastatina 40 mg.';
  ctx.__app.state.caseModel = null; /* the app invalidates its cache on note input (see HAL-15) */
  const ordered = ctx.__app.steps[4].body();
  assert('contraindicated interaction is rendered before a moderate one',
    ordered.indexOf('DDI001') !== -1 && ordered.indexOf('DDI011') !== -1 && ordered.indexOf('DDI001') < ordered.indexOf('DDI011'));

  const r = summary();
  console.log('  -> ' + r.pass + ' passed, ' + r.fail + ' failed');
  return r.fail === 0;
}

module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
