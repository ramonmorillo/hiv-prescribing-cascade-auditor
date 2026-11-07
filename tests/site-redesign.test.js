'use strict';
/* Guards for the public site + tool redesign. None of these touch clinical
 * logic; they pin the presentation-layer contracts that the redesign added:
 * the read-only KB catalogue must describe the KB exactly as the engine uses
 * it, the landing page must be fully bilingual, the award must keep its exact
 * official wording, and nothing may depend on the current hosting domain. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadKB, CE, assert, assertEqual, reset, summary } = require('./helpers');
const Catalog = require('../kb-catalog.js');
const Landing = require('../landing.js');

function read(file) { return fs.readFileSync(path.join(__dirname, '..', file), 'utf8'); }

const AWARD = 'XII Premios SEFH/CSL sobre Calidad de los Servicios de Farmacia y Seguridad en el Uso de los Medicamentos';
const PROJECT = 'Mejora de la seguridad farmacoterapéutica en personas que viven con VIH mediante una herramienta digital basada en inteligencia artificial para la detección y abordaje de cascadas terapéuticas';

function uiStrings() {
  const source = read('app.js');
  const start = source.indexOf('const UI_STRINGS = {');
  const end = source.indexOf('function tUI(key)');
  const ctx = {};
  vm.runInNewContext(source.slice(start, end).replace('const UI_STRINGS', 'this.UI_STRINGS'), ctx);
  return ctx.UI_STRINGS;
}

function run() {
  reset(); console.log('== site-redesign.test.js ==');

  /* ── KB catalogue mirrors the engine ── */
  ['prod', 'dev'].forEach((track) => {
    const kb = loadKB(track);
    const rows = Catalog.buildRows(kb, 'es');
    const expectedActive = kb.coreCascades.cascades.filter((c) => c.status !== 'merged').length +
      kb.vihModifiers.art_related_cascades.filter((c) => c.status !== 'merged').length;
    assertEqual(`[${track}] catalogue lists exactly the active (non-merged) rules`, rows.length, expectedActive);
    assert(`[${track}] catalogue never lists a merged rule`,
      rows.every((r) => {
        const entry = CE.findCascadeEntry(r.id, kb);
        return entry && entry.status !== 'merged';
      }));
    assert(`[${track}] catalogue rule ids are unique`, new Set(rows.map((r) => r.id)).size === rows.length);
  });

  const kb = loadKB('prod');
  const rows = Catalog.buildRows(kb, 'es');
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const demo = 'TAR: Symtuza. HTA con amlodipino 10 mg desde 2021. Edema maleolar desde 2022. Furosemida 40 mg desde 2023. ' +
    'Atorvastatina 20 mg. Ibuprofeno 600 mg a demanda.';
  const model = CE.buildCaseModel(demo, kb, { lang: 'es' });
  const ruleSignals = model.possibleCascades.filter((c) => byId[c.cascade_id]);
  assert('demo-like note yields rule-backed signals to compare', ruleSignals.length > 0);
  assert('catalogue knowledge-validation status equals the engine status for every signal',
    ruleSignals.every((c) => byId[c.cascade_id].knowledge_validation_status === c.knowledge_validation_status));

  assert('search accepts Spanish INN via the drug dictionary (amlodipino → CC004)',
    Catalog.filterRows(rows, 'amlodipino').some((r) => r.id === 'CC004'));
  assert('search is accent-insensitive', Catalog.filterRows(rows, 'diuretico').length === Catalog.filterRows(rows, 'diurético').length);
  assert('source filter isolates HIV-specific rules', Catalog.filterRows(rows, '', { source: 'hiv' }).every((r) => r.source === 'hiv'));
  assert('status filter isolates pending rules',
    Catalog.filterRows(rows, '', { status: 'pending_review' }).every((r) => r.knowledge_validation_status === 'pending_review'));
  const inventory = Catalog.inventory(kb);
  assert('inventory reports every KB file as loaded with a version', inventory.every((f) => f.loaded && f.version));
  assert('catalogue does not mutate the KB', JSON.stringify(loadKB('prod').coreCascades) === JSON.stringify(kb.coreCascades));

  /* ── Bilingual coverage ── */
  const landing = read('index.html');
  const landingKeys = [...new Set([...landing.matchAll(/data-i18n(?:-aria-label|-content)?="([^"]+)"/g)].map((m) => m[1]))];
  assert('landing declares translation bindings', landingKeys.length >= 60);
  const missingEn = landingKeys.filter((k) => !Object.prototype.hasOwnProperty.call(Landing.EN, k) || !Landing.EN[k]);
  assertEqual('every landing string has an English translation', missingEn, []);
  assert('landing default language is Spanish', /<html\s+lang="es">/.test(landing));
  assert('landing shares the tool’s language preference key', /'hiv_cascade_lang'/.test(read('landing.js')));

  const ui = uiStrings();
  assertEqual('UI_STRINGS ES/EN key parity', Object.keys(ui.en).sort(), Object.keys(ui.es).sort());

  /* ── Award: exact denomination, project vs. tool distinction ── */
  const app = read('app.html');
  const statics = require('../ui-static-i18n.js');
  [['index.html', landing], ['app.html', app], ['ui-static-i18n (es)', statics.es.award_title + statics.es.award_project],
    ['ui-static-i18n (en)', statics.en.award_title + statics.en.award_project]].forEach(([label, text]) => {
    assert('exact award name present: ' + label, text.includes(AWARD) && /1\.<sup>er<\/sup> Premio/.test(text));
    assert('exact awarded project title present: ' + label, text.includes(PROJECT));
  });
  assert('landing distinguishes the awarded project from the software',
    /no constituye una validación clínica ni una certificación regulatoria del software/i.test(landing));
  assert('no official SEFH/CSL logo files are bundled',
    !fs.readdirSync(path.join(__dirname, '..', 'assets', 'brand')).some((f) => /sefh|csl/i.test(f)));

  /* ── Domain independence ── */
  [['index.html', landing], ['app.html', app]].forEach(([label, html]) => {
    const refs = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    assert(label + ': all links and assets are relative', refs.every((r) => !/^(?:[a-z]+:)?\/\//i.test(r) && !r.startsWith('/')));
    refs.filter((r) => !r.startsWith('#')).forEach((r) => {
      const file = r.split('#')[0];
      if (file) assert(label + ' references an existing file: ' + file, fs.existsSync(path.join(__dirname, '..', file)));
    });
    assert(label + ': no hard-coded hosting domain', !/github\.io|githubusercontent/i.test(html));
  });
  assert('landing links to the tool', /href="app\.html"/.test(landing));
  assert('tool links back to the landing', /href="index\.html"/.test(app));
  const views = [...app.matchAll(/data-view-link="([a-z]+)"/g)].map((m) => m[1]);
  assert('every view link has a matching view section', views.every((v) => app.includes('id="view-' + v + '"')));
  assert('tool view routes are declared in app.js', views.every((v) => new RegExp("'" + v + "'").test(read('app.js').match(/var VIEWS = \[[^\]]*\]/)[0])));
  assert('tool is not indexed by search engines (landing is)', /name="robots" content="noindex"/.test(app) && !/noindex/.test(landing));

  /* ── Presentation regressions fixed during the redesign ── */
  const appJs = read('app.js');
  assert('toasts render text, not double-escaped entities', /text\.textContent = decoder\.value/.test(appJs));
  assert('print stylesheet keeps only the report', /@media print[\s\S]*\.app-sidebar[\s\S]*display:\s*none/.test(read('assets/css/app.css')));
  assert('reduced-motion preference is honoured', /prefers-reduced-motion:\s*reduce/.test(read('assets/css/base.css')));

  const r = summary(); console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`); return r.fail === 0;
}

module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
