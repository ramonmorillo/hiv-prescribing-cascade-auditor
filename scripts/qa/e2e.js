const { chromium } = require('playwright');
const fs = require('fs');
// End-to-end browser checks + axe-core WCAG scan (manual QA tool; needs Playwright).
// Usage: AXE_PATH=/path/to/axe.min.js node scripts/qa/e2e.js [baseUrl]
// Serve the repository root first, e.g. python3 -m http.server 8080.
// bypassCSP is used ONLY so the test can inject axe-core; the site's CSP
// correctly blocks inline injection otherwise.
const AXE = process.env.AXE_PATH ? fs.readFileSync(process.env.AXE_PATH, 'utf8') : null;
const BASE = process.argv[2] || 'http://localhost:8080/';
const results = []; const errors = []; const requests = new Set();
const ok = (label, cond, extra) => { results.push([cond ? 'PASS' : 'FAIL', label, extra || '']); };
async function axe(page, label) {
  if (!AXE) return;
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations
    .map(v => v.id + '(' + v.impact + ') x' + v.nodes.length + ': ' + v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')));
  ok('axe WCAG A/AA: ' + label, r.length === 0, r.join('\n      '));
}
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, bypassCSP: true });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('request', r => requests.add(new URL(r.url()).origin));

  // Landing
  await page.goto(BASE + 'index.html'); await page.waitForTimeout(500);
  await axe(page, 'landing ES');
  await page.click('[data-lang="en"]'); await page.waitForTimeout(100);
  ok('landing switches to English', (await page.textContent('#hero-title + .hero__subtitle')).startsWith('Technology applied'));
  ok('landing sets html lang=en', await page.evaluate(() => document.documentElement.lang) === 'en');
  await axe(page, 'landing EN');
  ok('resume hint hidden with no saved case', await page.isHidden('#resume-case'));
  ok('award link hidden while awardUrl empty', await page.isHidden('#award-link'));
  await page.click('.hero__actions a[href="app.html"]');
  await page.waitForFunction(() => typeof state !== 'undefined' && state.kb && state.kb.coreCascades);
  ok('CTA opens the tool; language preference carried over', await page.evaluate(() => currentLanguage === 'en' && document.documentElement.lang === 'en'));
  await page.click('#lang-es');

  // Tool: demo case flow via the UI
  await page.click('#btn-demo'); await page.waitForTimeout(200);
  ok('demo loads into step 1', await page.evaluate(() => state.step === 1 && state.clinicalNote.includes('DEMO-001')));
  ok('save indicator shows local save', (await page.textContent('#save-indicator')).includes('Guardado'));
  ok('toast text has no literal HTML entities', !(await page.textContent('#toast-container')).includes('&'));
  ok('toast stack is capped at 3', await page.locator('.toast').count() <= 3);
  await axe(page, 'tool step 1');
  for (const s of [2, 3, 4, 5, 6]) {
    await page.click('#btn-next'); await page.waitForTimeout(120);
    ok('next → step ' + s, await page.evaluate(() => state.step) === s);
    if (s === 2 || s === 4 || s === 5 || s === 6) await axe(page, 'tool step ' + s);
  }
  ok('next button hidden on last step', await page.isHidden('#btn-next'));
  ok('focus moved to step heading after navigation', await page.evaluate(() => document.activeElement && document.activeElement.matches('.step-header h2')));
  const st = await page.evaluate(() => [...document.querySelectorAll('.step-status')].map(e => e.textContent));
  ok('workflow status populated', st[3].includes('7') && st[4].includes('de 7'), JSON.stringify(st));

  // Step 5 verdict via keyboard
  await page.click('.step-btn[data-step="5"]');
  const btn = page.locator('[data-action="classify-cascade"][data-classification="possible"]').first();
  await btn.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  ok('verdict recorded via keyboard, aria-pressed reflects it', await page.evaluate(() =>
    Object.values(state.cascadeClassifications).includes('possible') &&
    document.querySelector('[data-classification="possible"][aria-pressed="true"]') !== null));

  // Report exports (real downloads)
  await page.click('.step-btn[data-step="6"]');
  for (const fmt of ['json', 'csv']) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-action="export-report"][data-format="${fmt}"]`)]);
    const p = await dl.path(); const body = fs.readFileSync(p, 'utf8');
    ok(`report export ${fmt} downloads (${dl.suggestedFilename()})`, body.length > 200 && (fmt === 'json' ? JSON.parse(body).cascade_count === 7 : body.startsWith('report_schema_version')));
  }
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('[data-action="copy-report"]'); await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok('copy-for-record puts the clinical text on the clipboard', clip.length > 200);
  const [caseDl] = await Promise.all([page.waitForEvent('download'), (async () => { await page.click('#dev-panel-toggle'); await page.click('#btn-export-json'); })()]);
  const casePath = await caseDl.path();
  ok('case JSON export from tools panel', JSON.parse(fs.readFileSync(casePath, 'utf8')).clinicalNote.includes('DEMO-001'));
  const [csvDl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-csv')]);
  ok('CSV export from tools panel', fs.readFileSync(await csvDl.path(), 'utf8').length > 200);
  for (const id of ['btn-export-kb', 'btn-export-kb-operational']) {
    const [kbDl] = await Promise.all([page.waitForEvent('download'), page.click('#' + id)]);
    ok('KB export ' + id, fs.readFileSync(await kbDl.path(), 'utf8').length > 1000);
  }

  // Print emulation: only the report is visible
  await page.emulateMedia({ media: 'print' });
  ok('print view hides sidebar/header/actions', await page.evaluate(() =>
    getComputedStyle(document.querySelector('.app-sidebar')).display === 'none' &&
    getComputedStyle(document.querySelector('.app-header')).display === 'none' &&
    getComputedStyle(document.querySelector('.report-actions')).display === 'none'));
  await page.pdf({ path: require('os').tmpdir() + '/report-print.pdf', format: 'A4' });
  await page.emulateMedia({ media: 'screen' });

  // Delete all data, then import the exported case
  await page.click('#btn-delete-data'); await page.waitForTimeout(150);
  ok('delete clears the case', await page.evaluate(() => !state.clinicalNote && !localStorage.getItem('hiv_cascade_state') || !JSON.parse(localStorage.getItem('hiv_cascade_state') || '{}').clinicalNote));
  await page.setInputFiles('#import-file-input', casePath); await page.waitForTimeout(300);
  ok('import restores the exported case and verdict', await page.evaluate(() => state.clinicalNote.includes('DEMO-001') && Object.values(state.cascadeClassifications).includes('possible')));

  // Views + reload/direct navigation
  await page.click('[data-view-link="knowledge"]'); await page.waitForTimeout(150);
  ok('knowledge view shows catalogue', await page.locator('.catalog-item').count() > 100);
  await page.fill('#kb-search', 'amlodipino'); await page.waitForTimeout(100);
  ok('catalogue search by Spanish name', await page.locator('.catalog-item').count() >= 1 && (await page.textContent('#kb-results')).includes('CC004'));
  await page.locator('.catalog-item summary').first().click();
  await axe(page, 'knowledge view');
  ok('hash reflects view', page.url().endsWith('#knowledge'));
  await page.reload(); await page.waitForTimeout(700);
  ok('reload keeps knowledge view', await page.isVisible('#view-knowledge') && await page.isHidden('#view-analysis'));
  await page.goto(BASE + 'app.html#about'); await page.waitForTimeout(700);
  ok('direct navigation to #about', await page.isVisible('#view-about'));
  await axe(page, 'about view');
  await page.click('.step-btn[data-step="4"]'); await page.waitForTimeout(150);
  ok('stepper click returns to analysis view', await page.isVisible('#view-analysis') && page.url().endsWith('#analysis'));
  await page.goto(BASE + 'index.html'); await page.waitForTimeout(300);
  ok('landing offers to resume the saved case', await page.isVisible('#resume-case'));

  // Language switch inside the tool re-renders KB view too
  await page.goto(BASE + 'app.html#knowledge'); await page.waitForTimeout(600);
  await page.click('#lang-en'); await page.waitForTimeout(150);
  ok('tool EN switch updates KB view', (await page.textContent('#kb-view-body')).includes('Loaded files'));
  await page.click('#lang-es');

  // Keyboard: skip link
  await page.goto(BASE + 'app.html'); await page.waitForTimeout(500);
  await page.keyboard.press('Tab');
  ok('first Tab focuses the skip link', await page.evaluate(() => document.activeElement.classList.contains('skip-link')));

  ok('no console errors', errors.length === 0, errors.join(' | '));
  ok('no third-party requests (same origin only)', [...requests].every(o => o === new URL(BASE).origin), [...requests].join(', '));
  await browser.close();
  results.forEach(r => console.log(r[0], r[1], r[2] ? '\n      ' + r[2] : ''));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
})();
