/**
 * HIV Prescribing Cascade Auditor — app.js
 * Vanilla JS, no frameworks. Local-first (IndexedDB).
 * v1.0
 */
'use strict';

// ============================================================
// Constants
// ============================================================
const APP_VERSION = '1.0';
const DB_NAME     = 'hiv_cascade_auditor';
const DB_VERSION  = 1;
const STORE_NAME  = 'cases';
const KB = {
  coreCascades : 'kb/kb_core_cascades.json',
  vihModifiers : 'kb/kb_vih_modifiers.json',
  ddiWatchlist : 'kb/ddi_watchlist.json'
};

// ============================================================
// Application state (single mutable object)
// ============================================================
const S = {
  step         : 1,
  totalSteps   : 6,
  patientId    : '',
  clinicalNote : '',
  extractedMeds    : [],   // [{name,dose,indication,drugClass,source}]
  normalizedMeds   : [],   // [{original,canonical,drugClass,isArv,arvClass,dose}]
  detectedCascades : [],   // [{cascade,matchedIndex[],matchedCascade[],ddiAlerts[],source}]
  verifications    : {},   // {cascadeId:{status,note}}
  kb : {
    coreCascades : null,
    vihModifiers : null,
    ddiWatchlist : null,
    loaded       : false
  },
  db : null
};

// ============================================================
// IndexedDB helpers
// ============================================================
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'patientId' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function dbPut(record) {
  if (!S.db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx  = S.db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(record);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

function dbGet(patientId) {
  if (!S.db) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const tx  = S.db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(patientId);
    req.onsuccess = e => resolve(e.target.result || null);
    req.onerror   = e => reject(e.target.error);
  });
}

function dbClear() {
  if (!S.db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx  = S.db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).clear();
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

// ============================================================
// Auto-save
// ============================================================
let _saveTimer = null;

function scheduleAutoSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    if (!S.db || !S.patientId) return;
    try {
      await dbPut(buildPayload());
      const el = document.getElementById('save-indicator');
      if (el) { el.textContent = '✓ Saved'; setTimeout(() => { if (el) el.textContent = ''; }, 2000); }
    } catch (err) {
      console.error('[AutoSave]', err);
    }
  }, 800);
}

function buildPayload() {
  return {
    patientId        : S.patientId,
    savedAt          : new Date().toISOString(),
    step             : S.step,
    clinicalNote     : S.clinicalNote,
    extractedMeds    : S.extractedMeds,
    normalizedMeds   : S.normalizedMeds,
    detectedCascades : S.detectedCascades,
    verifications    : S.verifications
  };
}

// ============================================================
// KB loading
// ============================================================
async function loadKB() {
  const statusEl = document.getElementById('kb-status');
  if (statusEl) statusEl.innerHTML = '<span class="kb-chip loading">⏳ Loading KB…</span>';

  async function fetchOne(key, url) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      S.kb[key] = await r.json();
      return true;
    } catch (err) {
      console.error('[KB] Failed to load', url, err);
      return false;
    }
  }

  const [r1, r2, r3] = await Promise.all([
    fetchOne('coreCascades', KB.coreCascades),
    fetchOne('vihModifiers', KB.vihModifiers),
    fetchOne('ddiWatchlist', KB.ddiWatchlist)
  ]);

  S.kb.loaded = r1 && r2 && r3;

  const chips = [
    `<span class="kb-chip ${r1 ? 'ok' : 'fail'}">${r1 ? '✓' : '✗'} Core Cascades</span>`,
    `<span class="kb-chip ${r2 ? 'ok' : 'fail'}">${r2 ? '✓' : '✗'} VIH Modifiers</span>`,
    `<span class="kb-chip ${r3 ? 'ok' : 'fail'}">${r3 ? '✓' : '✗'} DDI Watchlist</span>`
  ].join(' ');

  if (statusEl) statusEl.innerHTML = '<span class="kb-chips">' + chips + '</span>';

  if (!S.kb.loaded) {
    showToast('Some KB files could not be loaded. Results may be incomplete.', 'warning');
  }
}

// ============================================================
// Wizard navigation
// ============================================================
function goTo(step) {
  if (step < 1 || step > S.totalSteps) return;
  S.step = step;
  renderStep(step);
  _updateStepNav(step);
  _updateNavBtns(step);
}

function _updateStepNav(active) {
  document.querySelectorAll('.step-btn').forEach(btn => {
    const s = parseInt(btn.dataset.step, 10);
    btn.classList.remove('active', 'completed');
    if (s === active) btn.classList.add('active');
    else if (s < active) btn.classList.add('completed');
  });
}

function _updateNavBtns(step) {
  const prev    = document.getElementById('btn-prev');
  const next    = document.getElementById('btn-next');
  const counter = document.getElementById('step-counter');
  if (prev)    prev.disabled = step === 1;
  if (next)    next.innerHTML = step === S.totalSteps ? '&#10003; Done' : 'Next &#8594;';
  if (counter) counter.textContent = 'Step ' + step + ' of ' + S.totalSteps;
}

// ============================================================
// Step renderers
// ============================================================
function renderStep(step) {
  const c = document.getElementById('step-content');
  if (!c) return;
  const map = { 1: renderStep1, 2: renderStep2, 3: renderStep3, 4: renderStep4, 5: renderStep5, 6: renderStep6 };
  if (map[step]) map[step](c);
}

/* ---- Step 1: Input ---- */
function renderStep1(c) {
  c.innerHTML = `
    <div class="step-header">
      <h2>&#128203; Step 1 — Clinical Note Input</h2>
      <p>Paste a pseudonymized clinical note or medication list. No real patient identifiers.</p>
    </div>
    <div class="step-section">
      <div class="form-group">
        <label class="form-label" for="note-ta">Clinical Note / Nota Clínica <span class="required">*</span></label>
        <textarea id="note-ta" class="textarea-clinical" placeholder="Paste clinical note here…">${esc(S.clinicalNote)}</textarea>
        <div class="form-hint">All data stays in your browser. Use pseudonymized IDs only.</div>
      </div>
      <div class="flex-center" style="gap:.5rem;flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" id="btn-load-eg">Load Example</button>
        <button class="btn btn-primary"         id="btn-go-extract">Extract Medications &#8594;</button>
      </div>
    </div>`;

  const ta = c.querySelector('#note-ta');
  ta.addEventListener('input', () => { S.clinicalNote = ta.value; scheduleAutoSave(); });

  c.querySelector('#btn-load-eg').addEventListener('click', loadExample);
  c.querySelector('#btn-go-extract').addEventListener('click', () => {
    if (!S.clinicalNote.trim()) { showToast('Please enter a clinical note first.', 'warning'); return; }
    runExtraction();
    goTo(2);
  });
}

async function loadExample() {
  try {
    const r = await fetch('examples/example_note.txt');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    S.clinicalNote = await r.text();
    const ta = document.getElementById('note-ta');
    if (ta) ta.value = S.clinicalNote;
    scheduleAutoSave();
    showToast('Example note loaded.', 'info');
  } catch (err) {
    console.error('[Example]', err);
    showToast('Could not load example note.', 'error');
  }
}

/* ---- Step 2: Extractor ---- */
function renderStep2(c) {
  if (S.extractedMeds.length === 0 && S.clinicalNote.trim()) runExtraction();

  c.innerHTML = `
    <div class="step-header">
      <h2>&#128269; Step 2 — Medication Extractor</h2>
      <p>Medications extracted from the note by keyword matching against the knowledge base.</p>
    </div>
    <div class="step-section">
      <div class="callout callout-info"><strong>Review the list.</strong> Remove false positives or add missed medications.</div>
      <div id="med-table">${buildMedTable(S.extractedMeds)}</div>
    </div>
    <div class="step-section">
      <label class="form-label">Add medication manually</label>
      <div class="flex-center" style="flex-wrap:wrap;gap:.5rem;">
        <input type="text" id="add-name" placeholder="Drug name" style="max-width:200px;">
        <input type="text" id="add-dose" placeholder="Dose / info (optional)" style="max-width:200px;">
        <button class="btn btn-outline btn-sm" id="btn-add-med">+ Add</button>
      </div>
    </div>`;

  c.querySelector('#btn-add-med').addEventListener('click', () => {
    const name = c.querySelector('#add-name').value.trim();
    if (!name) return;
    S.extractedMeds.push({ name: name.toLowerCase(), dose: c.querySelector('#add-dose').value.trim(), indication: '', source: 'manual' });
    c.querySelector('#add-name').value = '';
    c.querySelector('#add-dose').value = '';
    c.querySelector('#med-table').innerHTML = buildMedTable(S.extractedMeds);
    wireRemoveBtns(c);
    scheduleAutoSave();
  });

  wireRemoveBtns(c);
}

function buildMedTable(meds) {
  if (!meds.length) return '<p class="text-muted text-small">No medications extracted. Add manually below.</p>';
  return `<div class="table-wrapper"><table>
    <thead><tr><th>Drug</th><th>Dose / Info</th><th>Source</th><th></th></tr></thead>
    <tbody>${meds.map((m, i) => `<tr>
      <td><strong>${esc(m.name)}</strong></td>
      <td class="text-small">${esc(m.dose || '—')}</td>
      <td class="text-small">${esc(m.source || 'text')}</td>
      <td><button class="btn btn-secondary btn-sm btn-rm" data-idx="${i}">&#x2715;</button></td>
    </tr>`).join('')}</tbody>
  </table></div>
  <div class="form-hint mt-1">${meds.length} medication(s) found.</div>`;
}

function wireRemoveBtns(c) {
  c.querySelectorAll('.btn-rm').forEach(btn => {
    btn.addEventListener('click', () => {
      S.extractedMeds.splice(parseInt(btn.dataset.idx, 10), 1);
      const mt = document.getElementById('med-table');
      if (mt) mt.innerHTML = buildMedTable(S.extractedMeds);
      wireRemoveBtns(c);
      scheduleAutoSave();
    });
  });
}

/* ---- Step 3: Normalizer ---- */
function renderStep3(c) {
  if (S.normalizedMeds.length === 0 && S.extractedMeds.length > 0) runNormalization();

  const rows = S.normalizedMeds.map(m => `<tr>
    <td class="text-mono">${esc(m.original)}</td>
    <td>${esc(m.canonical)}</td>
    <td>${esc(m.drugClass || '—')}</td>
    <td>${m.isArv ? '<span class="badge badge-T0">ARV</span>' : '—'}</td>
    <td class="text-small">${esc(m.arvClass || '—')}</td>
  </tr>`).join('');

  c.innerHTML = `
    <div class="step-header">
      <h2>&#9881;&#65039; Step 3 — Drug Normalizer</h2>
      <p>Maps extracted names to canonical drug names and classes. ARV drugs are flagged for HIV-specific cascade detection.</p>
    </div>
    <div class="step-section">
      ${S.normalizedMeds.length === 0
        ? '<div class="callout callout-warning"><strong>No medications to normalize.</strong> Return to Step 2.</div>'
        : `<div class="table-wrapper"><table>
             <thead><tr><th>Extracted</th><th>Canonical</th><th>Drug Class</th><th>ARV?</th><th>ARV Class</th></tr></thead>
             <tbody>${rows}</tbody>
           </table></div>`}
    </div>`;
}

/* ---- Step 4: Detector ---- */
function renderStep4(c) {
  if (!S.kb.loaded) {
    c.innerHTML = `<div class="step-header"><h2>&#128300; Step 4 — Cascade Detector</h2></div>
      <div class="callout callout-warning"><strong>Knowledge base not loaded.</strong> Please reload the page.</div>`;
    return;
  }

  if (S.detectedCascades.length === 0 && S.normalizedMeds.length > 0) runDetection();

  const found = S.detectedCascades;
  const hasCrit  = found.some(f => f.ddiAlerts.some(d => d.severity === 'CONTRAINDICATED'));
  const hasMajor = found.some(f => f.ddiAlerts.some(d => d.severity === 'MAJOR'));
  const semClass = found.length === 0 ? 'green' : hasCrit || hasMajor ? 'red' : 'amber';
  const semMsg   = found.length === 0
    ? '&#10003; No potential cascades detected'
    : hasCrit  ? '&#9888; CRITICAL — Contraindicated combination detected'
    : hasMajor ? '&#9888; HIGH ALERT — Major DDI in cascade found'
    :             '&#9888; ' + found.length + ' potential cascade(s) detected';

  c.innerHTML = `
    <div class="step-header">
      <h2>&#128300; Step 4 — Cascade Detector</h2>
      <p>Cross-references normalized medications against the prescribing cascade knowledge base.</p>
    </div>
    <div class="step-section">
      <div class="semaphore ${semClass} mb-2">
        <div class="semaphore-dot"></div><span>${semMsg}</span>
      </div>
      ${found.length === 0
        ? '<div class="callout callout-info">No cascades detected. This does <strong>not</strong> rule out cascades outside the KB scope.</div>'
        : found.map(buildCascadeCard).join('')}
    </div>
    <div id="ddi-panel"></div>`;

  renderGlobalDDI(document.getElementById('ddi-panel'));
}

function buildCascadeCard(f) {
  const c = f.cascade;
  const pl = (c.plausibility || 'medium').toLowerCase();
  const ddiHtml = f.ddiAlerts.map(d =>
    `<div class="ddi-alert ${d.severity === 'CONTRAINDICATED' ? '' : d.severity === 'MAJOR' ? 'major' : 'moderate'}">
      <strong>&#9888; DDI ${esc(d.severity)}: ${esc(d.drug_a)} &#x2194; ${esc(d.drug_b)}</strong><br>
      <span class="text-small">EN: ${esc(d.consequence_en || '')}</span><br>
      <span class="text-small">ES: ${esc(d.consequence_es || '')}</span><br>
      <span class="text-small"><strong>Management:</strong> ${esc(d.management_en || '')}</span>
    </div>`).join('');

  return `<div class="cascade-card">
    <div class="cascade-card-header">
      <span class="cascade-id">${esc(c.id)}</span>
      <div style="flex:1">
        <strong>${esc(c.name_en || c.name_es || '')}</strong><br>
        <span class="text-small text-muted">${esc(c.name_es || '')}</span>
      </div>
      <span class="badge badge-${pl}">${esc(c.plausibility || '?')}</span>
      <span class="badge badge-TX">Ev: ${esc(c.evidence_level || '?')}</span>
    </div>
    <div class="cascade-card-body">
      <div class="bilingual-block mb-1">
        <div class="lang-block es">
          <div class="lang-label">ES — Mecanismo</div>
          <p>${esc(c.ade_mechanism_es || '')}</p>
          <p><strong>RAM:</strong> ${esc(c.ade_es || '')}</p>
        </div>
        <div class="lang-block en">
          <div class="lang-label">EN — Mechanism</div>
          <p>${esc(c.ade_mechanism_en || '')}</p>
          <p><strong>ADE:</strong> ${esc(c.ade_en || '')}</p>
        </div>
      </div>
      <div class="text-small text-muted mb-1">
        <strong>Index:</strong> ${esc(f.matchedIndex.join(', ') || '—')}
        &nbsp;|&nbsp;
        <strong>Cascade:</strong> ${esc(f.matchedCascade.join(', ') || '—')}
      </div>
      ${c.ddi_warning_en ? `<div class="callout callout-danger"><strong>&#9888; DDI Warning:</strong> ${esc(c.ddi_warning_en)}</div>` : ''}
      ${ddiHtml}
      <div class="bilingual-block mt-1">
        <div class="lang-block es"><div class="lang-label">ES — Nota</div><p>${esc(c.clinical_note_es || '')}</p></div>
        <div class="lang-block en"><div class="lang-label">EN — Note</div><p>${esc(c.clinical_note_en || '')}</p></div>
      </div>
    </div>
  </div>`;
}

function renderGlobalDDI(container) {
  if (!container || !S.kb.ddiWatchlist) return;
  const drugNames = S.normalizedMeds.map(m => m.canonical.toLowerCase());
  const alerts = [];

  for (const ddi of (S.kb.ddiWatchlist.interactions || [])) {
    const aTerms = ddi.drug_a.toLowerCase().split(/[\s\/,()]+/).filter(t => t.length > 3);
    const bTerms = ddi.drug_b.toLowerCase().split(/[\s\/,()]+/).filter(t => t.length > 3);
    const aHit = aTerms.some(t => drugNames.some(d => d.includes(t) || t.includes(d)));
    const bHit = bTerms.some(t => drugNames.some(d => d.includes(t) || t.includes(d)));
    if (aHit && bHit) alerts.push(ddi);
  }

  if (!alerts.length) return;

  container.innerHTML = `
    <div class="step-section mt-2">
      <h3>&#9889; DDI Watchlist Alerts</h3>
      <div class="table-wrapper"><table>
        <thead><tr><th>Drug A</th><th>Drug B</th><th>Severity</th><th>Management (EN)</th></tr></thead>
        <tbody>${alerts.map(d => `<tr>
          <td>${esc(d.drug_a)}</td>
          <td>${esc(d.drug_b)}</td>
          <td><span class="badge badge-${(d.severity || '').toLowerCase()}">${esc(d.severity || '')}</span></td>
          <td class="text-small">${esc(d.management_en || '')}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
}

/* ---- Step 5: Plan & Verify ---- */
function renderStep5(c) {
  const found = S.detectedCascades;

  if (!found.length) {
    c.innerHTML = `
      <div class="step-header"><h2>&#128221; Step 5 — Plan &amp; Verify</h2></div>
      <div class="callout callout-info">No cascades to review. Proceed to the Report.</div>`;
    return;
  }

  const cards = found.map(f => {
    const cascade = f.cascade;
    const v = S.verifications[cascade.id] || { status: 'pending', note: '' };
    const btns = ['confirmed', 'ruled_out', 'pending'].map(s => {
      const labels = { confirmed: '&#10003; Confirm', ruled_out: '&#10007; Rule Out', pending: '? Pending' };
      return `<button class="btn btn-sm ${v.status === s ? 'btn-primary' : 'btn-secondary'}"
        data-cid="${esc(cascade.id)}" data-status="${s}">${labels[s]}</button>`;
    }).join('');

    return `<div class="cascade-card">
      <div class="cascade-card-header">
        <span class="cascade-id">${esc(cascade.id)}</span>
        <strong style="flex:1">${esc(cascade.name_en || cascade.name_es || '')}</strong>
        <span class="badge badge-${(cascade.plausibility || 'medium').toLowerCase()}">${esc(cascade.plausibility || '?')}</span>
      </div>
      <div class="cascade-card-body">
        <p class="text-small">${esc(cascade.clinical_note_en || '')}</p>
        <div class="flex-center mt-1" style="flex-wrap:wrap;gap:.4rem;">${btns}</div>
        <div class="form-group mt-1">
          <label class="form-label">Clinician note</label>
          <textarea class="verify-note" data-cid="${esc(cascade.id)}" rows="2"
            placeholder="Add verification note…">${esc(v.note || '')}</textarea>
        </div>
      </div>
    </div>`;
  }).join('');

  c.innerHTML = `
    <div class="step-header">
      <h2>&#128221; Step 5 — Plan &amp; Verify</h2>
      <p>Confirm or rule out each potential cascade. All judgments are yours.</p>
    </div>
    <div class="callout callout-warning mb-2">
      <strong>Clinical judgment required.</strong> Mark each finding as Confirmed, Ruled Out, or Pending.
    </div>
    <div class="step-section">${cards}</div>`;

  c.querySelectorAll('[data-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.cid;
      if (!S.verifications[id]) S.verifications[id] = { status: 'pending', note: '' };
      S.verifications[id].status = btn.dataset.status;
      scheduleAutoSave();
      renderStep5(c);
    });
  });

  c.querySelectorAll('.verify-note').forEach(ta => {
    ta.addEventListener('input', () => {
      const id = ta.dataset.cid;
      if (!S.verifications[id]) S.verifications[id] = { status: 'pending', note: '' };
      S.verifications[id].note = ta.value;
      scheduleAutoSave();
    });
  });
}

/* ---- Step 6: Report ---- */
function renderStep6(c) {
  const found      = S.detectedCascades;
  const confirmed  = found.filter(f => (S.verifications[f.cascade.id] || {}).status === 'confirmed');
  const ruledOut   = found.filter(f => (S.verifications[f.cascade.id] || {}).status === 'ruled_out');
  const pending    = found.filter(f => {
    const s = (S.verifications[f.cascade.id] || {}).status;
    return s !== 'confirmed' && s !== 'ruled_out';
  });

  const semClass = confirmed.length > 0 ? 'red' : pending.length > 0 ? 'amber' : 'green';
  const semMsg   = confirmed.length > 0
    ? confirmed.length + ' confirmed cascade(s) — clinical review recommended'
    : pending.length > 0
    ? pending.length + ' unverified finding(s)'
    : 'No confirmed cascades';

  const summaryRows = found.map(f => {
    const v = S.verifications[f.cascade.id] || {};
    const labels = { confirmed: '&#10003; Confirmed', ruled_out: '&#10007; Ruled Out', pending: '? Pending' };
    return `<tr>
      <td class="text-mono text-small">${esc(f.cascade.id)}</td>
      <td>${esc(f.cascade.name_en || f.cascade.name_es || '')}</td>
      <td><span class="badge badge-${(f.cascade.plausibility || 'medium').toLowerCase()}">${esc(f.cascade.plausibility || '?')}</span></td>
      <td class="text-small">${labels[v.status || 'pending'] || '? Pending'}</td>
      <td class="text-small">${esc((v.note || '').substring(0, 60))}${(v.note || '').length > 60 ? '…' : ''}</td>
    </tr>`;
  }).join('');

  c.innerHTML = `
    <div class="report-container">
      <div class="report-header">
        <h2>HIV Prescribing Cascade Audit Report</h2>
        <p>Patient: ${esc(S.patientId || 'Unknown')} &mdash; Generated: ${new Date().toISOString().split('T')[0]} &mdash; v${APP_VERSION}</p>
      </div>

      <div class="semaphore ${semClass} mb-2">
        <div class="semaphore-dot"></div><span>${semMsg}</span>
      </div>

      <div class="report-section">
        <div class="report-section-header">&#128138; Medications Reviewed (${S.normalizedMeds.length})</div>
        <div class="report-section-body">
          <div class="table-wrapper"><table>
            <thead><tr><th>Drug</th><th>Class</th><th>ARV?</th></tr></thead>
            <tbody>${S.normalizedMeds.map(m => `<tr>
              <td>${esc(m.canonical || m.original)}</td>
              <td class="text-small">${esc(m.drugClass || '—')}</td>
              <td>${m.isArv ? '<span class="badge badge-T0">ARV</span>' : '—'}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>

      <div class="report-section">
        <div class="report-section-header">&#128300; Cascade Findings (${found.length} detected &mdash; ${confirmed.length} confirmed, ${ruledOut.length} ruled out)</div>
        <div class="report-section-body">
          ${found.length === 0
            ? '<p class="text-muted">No cascades detected.</p>'
            : `<div class="table-wrapper"><table>
                <thead><tr><th>ID</th><th>Cascade</th><th>Plausibility</th><th>Status</th><th>Note</th></tr></thead>
                <tbody>${summaryRows}</tbody>
              </table></div>`}
        </div>
      </div>

      <div class="report-section">
        <div class="report-section-header">&#9888; Disclaimer</div>
        <div class="report-section-body">
          <p class="text-small text-muted">Decision-support prototype. All findings require clinician review. KB is not exhaustive. No data transmitted externally.</p>
        </div>
      </div>

      <div class="flex-center mt-2" style="gap:.5rem;flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" id="btn-print">&#128424; Print</button>
        <button class="btn btn-secondary btn-sm" id="btn-dl-json">&#8595; Download JSON</button>
        <button class="btn btn-secondary btn-sm" id="btn-dl-csv">&#8595; Download CSV</button>
      </div>
    </div>`;

  c.querySelector('#btn-print').addEventListener('click',   () => window.print());
  c.querySelector('#btn-dl-json').addEventListener('click', exportJSON);
  c.querySelector('#btn-dl-csv').addEventListener('click',  exportCSV);
}

// ============================================================
// Extraction pipeline
// ============================================================
function runExtraction() {
  S.extractedMeds = extractMeds(S.clinicalNote);
  console.log('[Extractor] Found', S.extractedMeds.length, 'medications');
}

function extractMeds(text) {
  if (!text || !text.trim()) return [];

  const masterList = buildMasterList();
  const seen  = new Set();
  const found = [];
  const lower = text.toLowerCase();

  for (const drug of masterList) {
    const name = drug.name.toLowerCase();
    if (name.length < 4) continue;
    if (seen.has(name)) continue;

    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?<![a-z])' + escaped + '(?![a-z])', 'i');
    if (!re.test(lower)) continue;

    seen.add(name);
    const doseRe = new RegExp('\\b' + escaped + '\\s+([\\d.]+\\s*(?:mg|g|mcg|ml|iu)[^,;.\\n]{0,40})', 'i');
    const dm = text.match(doseRe);
    found.push({ name, dose: dm ? dm[1].trim() : '', indication: drug.indication || '', source: 'text' });
  }
  return found;
}

function buildMasterList() {
  const list = [];
  const seen = new Set();

  function add(name, indication) {
    const k = name.toLowerCase();
    if (seen.has(k) || k.length < 4) return;
    seen.add(k);
    list.push({ name, indication });
  }

  for (const c of (S.kb.coreCascades?.cascades || [])) {
    (c.index_drugs_examples   || []).forEach(d => add(d, 'index'));
    (c.cascade_drugs_examples || []).forEach(d => add(d, 'cascade'));
  }
  for (const c of (S.kb.vihModifiers?.art_related_cascades || [])) {
    (c.index_drugs_examples   || []).forEach(d => add(d, 'ARV'));
    (c.cascade_drugs_examples || []).forEach(d => add(d, 'cascade'));
    (c.contraindicated_cascade_drugs || []).forEach(d => add(d, 'contraindicated'));
  }
  // Extra ARV names not present in KB drug examples
  const extra = [
    'cobicistat','darunavir','emtricitabine','rilpivirine','doravirine','etravirine',
    'abacavir','lamivudine','atazanavir','saquinavir','elvitegravir',
    'symtuza','biktarvy','triumeq','descovy','truvada','genvoya','odefsey',
    'taf','tdf','ftc'
  ];
  extra.forEach(d => add(d, 'ARV'));

  return list;
}

// ============================================================
// Normalization pipeline
// ============================================================
function runNormalization() {
  S.normalizedMeds = S.extractedMeds.map(normalizeMed);
  console.log('[Normalizer]', S.normalizedMeds.length, 'medications normalized');
}

const ARV_LOOKUP = {
  // INSTI
  'dolutegravir'  : { canonical:'dolutegravir',              drugClass:'INSTI',                           isArv:true, arvClass:'INSTI'     },
  'bictegravir'   : { canonical:'bictegravir',               drugClass:'INSTI',                           isArv:true, arvClass:'INSTI'     },
  'raltegravir'   : { canonical:'raltegravir',               drugClass:'INSTI',                           isArv:true, arvClass:'INSTI'     },
  'elvitegravir'  : { canonical:'elvitegravir',              drugClass:'INSTI',                           isArv:true, arvClass:'INSTI'     },
  // NNRTI
  'efavirenz'     : { canonical:'efavirenz',                 drugClass:'NNRTI (CYP3A4/2B6 inducer)',      isArv:true, arvClass:'NNRTI'     },
  'nevirapine'    : { canonical:'nevirapine',                drugClass:'NNRTI (CYP3A4 inducer)',          isArv:true, arvClass:'NNRTI'     },
  'rilpivirine'   : { canonical:'rilpivirine',               drugClass:'NNRTI',                           isArv:true, arvClass:'NNRTI'     },
  'etravirine'    : { canonical:'etravirine',                drugClass:'NNRTI',                           isArv:true, arvClass:'NNRTI'     },
  'doravirine'    : { canonical:'doravirine',                drugClass:'NNRTI',                           isArv:true, arvClass:'NNRTI'     },
  // PI
  'darunavir'     : { canonical:'darunavir',                 drugClass:'PI',                              isArv:true, arvClass:'PI'        },
  'lopinavir'     : { canonical:'lopinavir',                 drugClass:'PI',                              isArv:true, arvClass:'PI'        },
  'atazanavir'    : { canonical:'atazanavir',                drugClass:'PI',                              isArv:true, arvClass:'PI'        },
  'saquinavir'    : { canonical:'saquinavir',                drugClass:'PI (QT-prolonging)',              isArv:true, arvClass:'PI'        },
  // Boosters
  'ritonavir'     : { canonical:'ritonavir',                 drugClass:'CYP3A4/P-gp inhibitor (booster)',isArv:true, arvClass:'PI/booster'},
  'cobicistat'    : { canonical:'cobicistat',                drugClass:'CYP3A4 inhibitor (booster)',     isArv:true, arvClass:'Booster'   },
  // NRTI
  'tenofovir disoproxil fumarate': { canonical:'tenofovir DF (TDF)', drugClass:'NRTI', isArv:true, arvClass:'NRTI' },
  'tenofovir alafenamide'        : { canonical:'tenofovir AF (TAF)', drugClass:'NRTI', isArv:true, arvClass:'NRTI' },
  'tdf'                          : { canonical:'tenofovir DF (TDF)', drugClass:'NRTI', isArv:true, arvClass:'NRTI' },
  'taf'                          : { canonical:'tenofovir AF (TAF)', drugClass:'NRTI', isArv:true, arvClass:'NRTI' },
  'emtricitabine' : { canonical:'emtricitabine',             drugClass:'NRTI',                            isArv:true, arvClass:'NRTI'      },
  'ftc'           : { canonical:'emtricitabine',             drugClass:'NRTI',                            isArv:true, arvClass:'NRTI'      },
  'lamivudine'    : { canonical:'lamivudine',                drugClass:'NRTI',                            isArv:true, arvClass:'NRTI'      },
  '3tc'           : { canonical:'lamivudine',                drugClass:'NRTI',                            isArv:true, arvClass:'NRTI'      },
  'abacavir'      : { canonical:'abacavir',                  drugClass:'NRTI',                            isArv:true, arvClass:'NRTI'      },
  'abc'           : { canonical:'abacavir',                  drugClass:'NRTI',                            isArv:true, arvClass:'NRTI'      },
  'zidovudine'    : { canonical:'zidovudine (AZT)',          drugClass:'NRTI',                            isArv:true, arvClass:'NRTI'      },
  'azt'           : { canonical:'zidovudine (AZT)',          drugClass:'NRTI',                            isArv:true, arvClass:'NRTI'      },
  // Combos
  'symtuza'  : { canonical:'darunavir/cobicistat/emtricitabine/TAF', drugClass:'PI+Booster+NRTI combo', isArv:true, arvClass:'Combo' },
  'biktarvy' : { canonical:'bictegravir/emtricitabine/TAF',          drugClass:'INSTI+NRTI combo',      isArv:true, arvClass:'Combo' },
  'triumeq'  : { canonical:'dolutegravir/abacavir/lamivudine',       drugClass:'INSTI+NRTI combo',      isArv:true, arvClass:'Combo' },
  'descovy'  : { canonical:'emtricitabine/TAF',                      drugClass:'NRTI combo',            isArv:true, arvClass:'NRTI'  },
  'truvada'  : { canonical:'emtricitabine/tenofovir DF',             drugClass:'NRTI combo',            isArv:true, arvClass:'NRTI'  },
  'genvoya'  : { canonical:'elvitegravir/cobicistat/emtricitabine/TAF', drugClass:'INSTI+Booster+NRTI', isArv:true, arvClass:'Combo' },
  'odefsey'  : { canonical:'rilpivirine/emtricitabine/TAF',          drugClass:'NNRTI+NRTI combo',      isArv:true, arvClass:'Combo' },
};

const CLASS_LOOKUP = {
  'ibuprofen':'NSAID','naproxen':'NSAID','diclofenac':'NSAID','meloxicam':'NSAID',
  'ketorolac':'NSAID','celecoxib':'NSAID','indomethacin':'NSAID','aspirin':'NSAID','piroxicam':'NSAID',
  'amlodipine':'Calcium channel blocker','nifedipine':'Calcium channel blocker',
  'felodipine':'Calcium channel blocker','lercanidipine':'Calcium channel blocker',
  'enalapril':'ACE inhibitor','lisinopril':'ACE inhibitor','ramipril':'ACE inhibitor',
  'captopril':'ACE inhibitor','perindopril':'ACE inhibitor','fosinopril':'ACE inhibitor',
  'losartan':'ARB','valsartan':'ARB','candesartan':'ARB','irbesartan':'ARB',
  'furosemide':'Loop diuretic','torasemide':'Loop diuretic',
  'hydrochlorothiazide':'Thiazide diuretic','chlorthalidone':'Thiazide diuretic','indapamide':'Thiazide diuretic',
  'spironolactone':'Potassium-sparing diuretic',
  'atorvastatin':'Statin','rosuvastatin':'Statin','pravastatin':'Statin','pitavastatin':'Statin',
  'simvastatin':'Statin (CYP3A4 substrate — AVOID with PI/r)','lovastatin':'Statin (CYP3A4 substrate — AVOID with PI/r)',
  'omeprazole':'PPI','pantoprazole':'PPI','lansoprazole':'PPI','esomeprazole':'PPI','rabeprazole':'PPI',
  'metformin':'Biguanide antidiabetic','sitagliptin':'DPP-4 inhibitor','liraglutide':'GLP-1 agonist',
  'insulin glargine':'Insulin','insulin aspart':'Insulin',
  'prednisone':'Corticosteroid','prednisolone':'Corticosteroid','dexamethasone':'Corticosteroid',
  'methylprednisolone':'Corticosteroid','betamethasone':'Corticosteroid','hydrocortisone':'Corticosteroid',
  'alendronate':'Bisphosphonate','risedronate':'Bisphosphonate','zoledronic acid':'Bisphosphonate','ibandronate':'Bisphosphonate',
  'allopurinol':'Urate-lowering','febuxostat':'Urate-lowering','colchicine':'Antigout',
  'morphine':'Opioid','oxycodone':'Opioid','fentanyl':'Opioid','tramadol':'Opioid','codeine':'Opioid',
  'buprenorphine':'Opioid','methadone':'Opioid',
  'lactulose':'Laxative','macrogol':'Laxative','bisacodyl':'Laxative','senna':'Laxative',
  'sodium docusate':'Laxative','naloxegol':'Opioid-antagonist laxative','methylnaltrexone':'Opioid-antagonist laxative',
  'loperamide':'Antidiarrheal','bismuth subsalicylate':'Antidiarrheal',
  'ondansetron':'Antiemetic (5-HT3)','metoclopramide':'Antiemetic/prokinetic','domperidone':'Antiemetic/prokinetic',
  'zolpidem':'Hypnotic','zopiclone':'Hypnotic',
  'lorazepam':'Benzodiazepine','alprazolam':'Benzodiazepine','clonazepam':'Benzodiazepine',
  'diazepam':'Benzodiazepine','midazolam':'Benzodiazepine (CYP3A4 substrate)','triazolam':'Benzodiazepine (CYP3A4 substrate)',
  'fluoxetine':'SSRI','sertraline':'SSRI','paroxetine':'SSRI','citalopram':'SSRI',
  'escitalopram':'SSRI','fluvoxamine':'SSRI',
  'mirtazapine':'NaSSA antidepressant','trazodone':'SARI antidepressant',
  'amitriptyline':'TCA','nortriptyline':'TCA',
  'haloperidol':'Antipsychotic','chlorpromazine':'Antipsychotic','risperidone':'Antipsychotic',
  'olanzapine':'Antipsychotic','quetiapine':'Antipsychotic','aripiprazole':'Antipsychotic',
  'donepezil':'Cholinesterase inhibitor','rivastigmine':'Cholinesterase inhibitor','galantamine':'Cholinesterase inhibitor',
  'biperiden':'Anticholinergic','trihexyphenidyl':'Anticholinergic','benztropine':'Anticholinergic','procyclidine':'Anticholinergic',
  'oxybutynin':'Anticholinergic (urinary)','tolterodine':'Anticholinergic (urinary)','solifenacin':'Anticholinergic (urinary)',
  'warfarin':'Anticoagulant (VKA)','apixaban':'DOAC','rivaroxaban':'DOAC','dabigatran':'DOAC','edoxaban':'DOAC',
  'sildenafil':'PDE5 inhibitor','tadalafil':'PDE5 inhibitor','vardenafil':'PDE5 inhibitor',
  'dextromethorphan':'Antitussive','benzonatate':'Antitussive','guaifenesin':'Expectorant',
  'calcium carbonate':'Calcium supplement','cholecalciferol':'Vitamin D','calcitriol':'Vitamin D (active)',
  'ferrous sulfate':'Iron supplement','folic acid':'Vitamin B9',
  'epoetin alfa':'Erythropoietin','darbepoetin':'Erythropoietin','filgrastim':'G-CSF',
  'bisoprolol':'Beta-blocker','atenolol':'Beta-blocker','metoprolol':'Beta-blocker','carvedilol':'Beta-blocker',
  'doxazosin':'Alpha-1 blocker',
  'fluticasone':'Inhaled corticosteroid (CYP3A4 substrate)','budesonide':'Inhaled corticosteroid (CYP3A4 substrate)',
  'beclometasone':'Inhaled corticosteroid',
  'ursodeoxycholic acid':'Ursodeoxycholic acid',
  'sodium phosphate':'Phosphate supplement','potassium phosphate':'Phosphate supplement',
};

function normalizeMed(med) {
  const key = med.name.toLowerCase();
  const arv = ARV_LOOKUP[key];
  if (arv) {
    return { original: med.name, ...arv, dose: med.dose, indication: med.indication };
  }
  return {
    original   : med.name,
    canonical  : med.name,
    drugClass  : CLASS_LOOKUP[key] || '',
    isArv      : false,
    arvClass   : '',
    dose       : med.dose,
    indication : med.indication
  };
}

// ============================================================
// Detection pipeline
// ============================================================
function runDetection() {
  if (!S.kb.loaded) { console.warn('[Detector] KB not loaded'); return; }

  S.detectedCascades = [];
  const drugNames  = S.normalizedMeds.map(m => m.canonical.toLowerCase());
  const origNames  = S.normalizedMeds.map(m => m.original.toLowerCase());
  const drugClasses = S.normalizedMeds.map(m => (m.drugClass || '').toLowerCase());

  function hits(examples, classHint) {
    const ex  = (examples || []).map(d => d.toLowerCase());
    const cls = (classHint || '').toLowerCase();
    const matched = ex.filter(d =>
      drugNames.some(n => n.includes(d) || d.includes(n)) ||
      origNames.some(n => n.includes(d) || d.includes(n))
    );
    const classMatch = cls && drugClasses.some(c => c.includes(cls) || cls.includes(c));
    return { hit: matched.length > 0 || classMatch, drugs: matched };
  }

  function checkCascade(cascade, source) {
    const idx = hits(cascade.index_drugs_examples,   cascade.index_drug_class);
    const cas = hits(cascade.cascade_drugs_examples, cascade.cascade_drug_class);
    if (idx.hit && cas.hit) {
      const already = S.detectedCascades.some(d => d.cascade.id === cascade.id);
      if (!already) {
        S.detectedCascades.push({
          cascade,
          matchedIndex   : idx.drugs,
          matchedCascade : cas.drugs,
          source,
          ddiAlerts      : findCascadeDDI()
        });
      }
    }
  }

  (S.kb.coreCascades?.cascades || []).forEach(c => checkCascade(c, 'core'));
  (S.kb.vihModifiers?.art_related_cascades || []).forEach(c => checkCascade(c, 'vih'));

  console.log('[Detector]', S.detectedCascades.length, 'cascades detected');
  toggleExportBtns(true);
}

function findCascadeDDI() {
  const drugNames = S.normalizedMeds.map(m => m.canonical.toLowerCase());
  return (S.kb.ddiWatchlist?.interactions || []).filter(ddi => {
    const aT = ddi.drug_a.toLowerCase().split(/[\s\/,()]+/).filter(t => t.length > 3);
    const bT = ddi.drug_b.toLowerCase().split(/[\s\/,()]+/).filter(t => t.length > 3);
    const aH = aT.some(t => drugNames.some(d => d.includes(t) || t.includes(d)));
    const bH = bT.some(t => drugNames.some(d => d.includes(t) || t.includes(d)));
    return aH && bH;
  });
}

// ============================================================
// Import / Export
// ============================================================
function toggleExportBtns(enabled) {
  ['btn-export-json', 'btn-export-csv'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(buildPayload(), null, 2)], { type: 'application/json' });
  triggerDownload(URL.createObjectURL(blob), 'cascade-audit-' + (S.patientId || 'case') + '-' + isoDate() + '.json');
}

function exportCSV() {
  const rows = [['Cascade ID','Name EN','Name ES','Plausibility','Evidence','Status','Index Drugs','Cascade Drugs','DDI Count','Clinician Note']];
  for (const f of S.detectedCascades) {
    const v = S.verifications[f.cascade.id] || {};
    rows.push([
      f.cascade.id,
      f.cascade.name_en || '',
      f.cascade.name_es || '',
      f.cascade.plausibility || '',
      f.cascade.evidence_level || '',
      v.status || 'pending',
      f.matchedIndex.join('; '),
      f.matchedCascade.join('; '),
      f.ddiAlerts.length,
      (v.note || '').replace(/\n/g, ' ')
    ]);
  }
  const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(URL.createObjectURL(blob), 'cascade-audit-' + (S.patientId || 'case') + '-' + isoDate() + '.csv');
}

function importCase(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.patientId) throw new Error('Missing patientId in file');
      S.patientId        = data.patientId    || '';
      S.clinicalNote     = data.clinicalNote || '';
      S.extractedMeds    = data.extractedMeds    || [];
      S.normalizedMeds   = data.normalizedMeds   || [];
      S.detectedCascades = data.detectedCascades || [];
      S.verifications    = data.verifications    || {};
      const pidEl = document.getElementById('patient-id');
      if (pidEl) pidEl.value = S.patientId;
      toggleExportBtns(S.extractedMeds.length > 0 || S.detectedCascades.length > 0);
      goTo(data.step || 1);
      showToast('Case "' + S.patientId + '" imported.', 'success');
    } catch (err) {
      console.error('[Import]', err);
      showToast('Import failed: ' + err.message, 'error');
    }
  };
  reader.onerror = () => showToast('Could not read file.', 'error');
  reader.readAsText(file);
}

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isoDate() { return new Date().toISOString().split('T')[0]; }

// ============================================================
// UI utilities
// ============================================================
function showToast(msg, type, duration) {
  duration = duration === undefined ? 4000 : duration;
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.innerHTML = '<span>' + esc(msg) + '</span><button class="toast-close" aria-label="Close">&#x2715;</button>';
  toast.querySelector('.toast-close').addEventListener('click', () => removeToast(toast));
  container.appendChild(toast);
  if (duration > 0) setTimeout(() => removeToast(toast), duration);
}

function removeToast(toast) {
  toast.classList.add('hiding');
  toast.addEventListener('animationend', () => toast.remove(), { once: true });
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ============================================================
// Wire event listeners
// ============================================================
function wireEvents() {
  // Patient ID
  const pidEl = document.getElementById('patient-id');
  if (pidEl) {
    pidEl.addEventListener('input', () => { S.patientId = pidEl.value.trim(); scheduleAutoSave(); });
    pidEl.addEventListener('change', async () => {
      if (!S.db || !S.patientId) return;
      try {
        const saved = await dbGet(S.patientId);
        if (saved) {
          Object.assign(S, {
            clinicalNote     : saved.clinicalNote     || '',
            extractedMeds    : saved.extractedMeds    || [],
            normalizedMeds   : saved.normalizedMeds   || [],
            detectedCascades : saved.detectedCascades || [],
            verifications    : saved.verifications    || {}
          });
          toggleExportBtns(S.extractedMeds.length > 0);
          showToast('Case "' + S.patientId + '" loaded from local storage.', 'info');
          goTo(saved.step || 1);
        }
      } catch (err) {
        console.error('[PatientLoad]', err);
      }
    });
  }

  // Wizard prev/next
  document.getElementById('btn-prev')?.addEventListener('click', () => {
    if (S.step > 1) goTo(S.step - 1);
  });
  document.getElementById('btn-next')?.addEventListener('click', handleNext);

  // Step tabs
  document.querySelectorAll('.step-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = parseInt(btn.dataset.step, 10);
      if (s) goTo(s);
    });
  });

  // Safety banner toggle
  const toggle  = document.getElementById('safety-toggle');
  const content = document.getElementById('safety-content');
  const arrow   = document.getElementById('safety-arrow');
  if (toggle && content) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      content.style.display = open ? 'none' : '';
      if (arrow) arrow.classList.toggle('collapsed', open);
    });
  }

  // Header export/import/delete
  document.getElementById('btn-export-json')?.addEventListener('click', exportJSON);
  document.getElementById('btn-export-csv')?.addEventListener('click', exportCSV);
  document.getElementById('btn-import')?.addEventListener('click', () => {
    document.getElementById('import-file-input')?.click();
  });
  document.getElementById('import-file-input')?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) importCase(f);
    e.target.value = '';
  });
  document.getElementById('btn-delete-data')?.addEventListener('click', async () => {
    if (!confirm('Delete ALL local data? This cannot be undone.')) return;
    try {
      if (S.db) await dbClear();
      Object.assign(S, { patientId:'', clinicalNote:'', extractedMeds:[], normalizedMeds:[], detectedCascades:[], verifications:{} });
      const pidEl2 = document.getElementById('patient-id');
      if (pidEl2) pidEl2.value = '';
      toggleExportBtns(false);
      goTo(1);
      showToast('All local data deleted.', 'success');
    } catch (err) {
      console.error('[Delete]', err);
      showToast('Could not delete data: ' + err.message, 'error');
    }
  });
}

function handleNext() {
  const step = S.step;
  if (step === 1) {
    if (!S.clinicalNote.trim()) { showToast('Enter a clinical note first.', 'warning'); return; }
    runExtraction();
  } else if (step === 2) {
    runNormalization();
  } else if (step === 3) {
    if (S.normalizedMeds.length > 0) runDetection();
  }
  if (step < S.totalSteps) goTo(step + 1);
}

// ============================================================
// Bootstrap
// ============================================================
async function init() {
  console.log('[App] HIV Prescribing Cascade Auditor v' + APP_VERSION);

  try {
    S.db = await openDB();
    console.log('[DB] IndexedDB ready');
  } catch (err) {
    console.error('[DB] IndexedDB unavailable:', err);
    showToast('Local storage unavailable — data will not be saved.', 'warning');
  }

  await loadKB();
  wireEvents();
  goTo(1);

  console.log('[App] Ready');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
