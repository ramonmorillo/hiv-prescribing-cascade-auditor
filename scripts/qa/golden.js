// Browser golden capture of clinical outputs (manual QA tool; needs Playwright).
// Usage: node scripts/qa/golden.js <baseUrl> <appPath> <outFile> [shotsDir]
//   e.g. node scripts/qa/golden.js http://localhost:8081/ index.html before.json   (pre-redesign build)
//        node scripts/qa/golden.js http://localhost:8080/ app.html   after.json
// then: node scripts/qa/compare.js before.json after.json
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [BASE, appPath, outFile, shotsDir] = process.argv.slice(2);
const repo = path.join(__dirname, '..', '..');
const notes = {
  example: fs.readFileSync(path.join(repo, 'examples/example_note.txt'), 'utf8'),
  amlo: 'Paciente con VIH en TAR con Biktarvy. HTA tratada con amlodipino 10 mg desde 2021. Desde 2022 edema maleolar bilateral. Se inicia furosemida 40 mg en 2023.',
  altind: 'PVVIH con Biktarvy. Insuficiencia cardiaca con FEVI reducida. Enalapril 10 mg por insuficiencia cardiaca. Ibuprofeno 600 mg a demanda.',
  symtuza: 'Symtuza 1 comp/día. Atorvastatina 40 mg. Metformina 850 mg/12h.',
  negative: 'Revisión rutinaria sin incidencias. Paciente asintomático.',
  discontinued: 'TAR con Dovato. Dejó de tomar amlodipino en 2023. Furosemida 40 mg por edema.'
};
(async () => {
  const browser = await chromium.launch();
  const result = { consoleErrors: [], cases: {} };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  page.on('console', m => { if (m.type() === 'error') result.consoleErrors.push(m.text()); });
  page.on('pageerror', e => result.consoleErrors.push('PAGEERROR ' + e.message));
  await page.goto(BASE + appPath);
  await page.waitForFunction(() => typeof state !== 'undefined' && state.kb && state.kb.coreCascades && state.kb.clinicalProblems);
  const strip = (r) => { r = JSON.parse(JSON.stringify(r)); delete r.generated_at; return r; };
  async function runCase(name, setup, arg) {
    await page.evaluate(setup, arg);
    const out = {};
    for (let s = 1; s <= 6; s++) { await page.evaluate((s) => goTo(s), s); }
    out.auto = await page.evaluate(() => {
      const r = buildReport(); const res = {};
      ['es','en'].forEach(l => { currentLanguage = l; invalidateDetectedCascades();
        const rep = buildReport(); const g = JSON.parse(JSON.stringify(rep)); delete g.generated_at;
        res[l] = { report: g, csv: ReportContract.toCsv(rep, l), text: formatReportForClinicalRecord(rep).replace(/\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d+)?Z?( UTC)?/g,'<TS>') };
      });
      currentLanguage = 'es'; invalidateDetectedCascades();
      return res;
    });
    // professional review: confirm meds/problems in step 2, classify first cascade in step 5
    await page.evaluate(() => goTo(2));
    for (const a of ['confirm-medication-review', 'confirm-problem-review']) {
      const b = await page.$('[data-action="' + a + '"]'); if (b) await b.click();
    }
    await page.evaluate(() => goTo(5));
    const cb = await page.$('[data-action="classify-cascade"][data-classification="confirmed"]');
    if (cb) await cb.click();
    out.reviewed = await page.evaluate(() => { const r = buildReport(); const g = JSON.parse(JSON.stringify(r)); delete g.generated_at;
      return { report: g, csv: ReportContract.toCsv(r, 'es') }; });
    result.cases[name] = out;
  }
  await runCase('demo', () => { state.clinicalNote = ''; loadDemoCase(); });
  for (const [k, v] of Object.entries(notes)) {
    await runCase(k, (v) => { clearState(); state.clinicalNote = v; invalidateDetectedCascades(); saveState(); }, v);
  }
  fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
  if (shotsDir) {
    fs.mkdirSync(shotsDir, { recursive: true });
    await page.evaluate(() => { clearState(); goTo(1); });
    await page.screenshot({ path: shotsDir + '/d-step1-empty.png', fullPage: true });
    await page.evaluate(() => { state.clinicalNote=''; loadDemoCase(); });
    for (const s of [1,2,4,5,6]) { await page.evaluate((s) => goTo(s), s); await page.waitForTimeout(150);
      await page.screenshot({ path: shotsDir + '/d-step' + s + '.png', fullPage: true }); }
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const mp = await m.newPage(); mp.on('dialog', d => d.accept());
    await mp.goto(BASE + appPath);
    await mp.waitForFunction(() => typeof state !== 'undefined' && state.kb && state.kb.coreCascades);
    for (const s of [1,4,6]) { await mp.evaluate((s) => goTo(s), s); await mp.waitForTimeout(150);
      await mp.screenshot({ path: shotsDir + '/m-step' + s + '.png', fullPage: s === 1 }); }
  }
  await browser.close();
  console.log('console errors:', result.consoleErrors.length, result.consoleErrors.slice(0,5));
})();
