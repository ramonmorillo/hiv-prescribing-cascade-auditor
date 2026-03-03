'use strict';

/* ============================================================
   HIV Prescribing Cascade Auditor — app.js
   Minimal working implementation
   - KB loading from /kb/
   - Wizard tab navigation
   - localStorage persistence
   - Export JSON / Import Case / Delete All Data
   ============================================================ */

const LS_KEY = 'hiv_cascade_state';

/* ── State ── */
const state = {
  step: 1,
  patientId: '',
  clinicalNote: '',
  kbMode: 'PROD',
  kb: { coreCascades: null, vihModifiers: null, ddiWatchlist: null }
};

/* ============================================================
   localStorage helpers
   ============================================================ */
function saveState() {
  try {
    const payload = {
      step: state.step,
      patientId: state.patientId,
      clinicalNote: state.clinicalNote
    };
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error('[Storage] Could not save state:', err);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.patientId)    state.patientId    = saved.patientId;
    if (saved.clinicalNote) state.clinicalNote = saved.clinicalNote;
    if (saved.step)         state.step         = saved.step;
  } catch (err) {
    console.error('[Storage] Could not load state:', err);
  }
}

function clearState() {
  try {
    localStorage.removeItem(LS_KEY);
    state.step = 1;
    state.patientId = '';
    state.clinicalNote = '';
  } catch (err) {
    console.error('[Storage] Could not clear state:', err);
  }
}

/* ============================================================
   KB loading
   ============================================================ */
async function loadKB(track) {
  var folder = 'kb/' + (track || state.kbMode).toLowerCase();
  const files = {
    coreCascades: folder + '/kb_core_cascades.json',
    vihModifiers: folder + '/kb_vih_modifiers.json',
    ddiWatchlist: folder + '/ddi_watchlist.json'
  };

  const results = await Promise.allSettled(
    Object.entries(files).map(async ([key, url]) => {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status + ' for ' + url);
      state.kb[key] = await resp.json();
      return key;
    })
  );

  const failed = results
    .filter(r => r.status === 'rejected')
    .map(r => r.reason);

  failed.forEach(err => console.error('[KB] Failed to load knowledge base file:', err));

  const loaded = results.filter(r => r.status === 'fulfilled').length;
  updateKBStatus(loaded, failed.length);
  runKBValidation();

  return failed.length === 0;
}

function getKBVersion() {
  var src = state.kb.coreCascades || state.kb.vihModifiers || state.kb.ddiWatchlist;
  return (src && src.version) ? src.version : 'unknown';
}

function updateKBStatus(loaded, failed) {
  var mode = state.kbMode;
  var version = getKBVersion();

  var statusEl = document.getElementById('kb-status');
  if (statusEl) {
    if (failed === 0) {
      statusEl.innerHTML = '<span class="kb-chip ok">&#10003; KB loaded (' + loaded + '/3) &mdash; ' + mode + '</span>';
    } else {
      statusEl.innerHTML =
        '<span class="kb-chip ok">&#10003; ' + loaded + ' loaded</span> ' +
        '<span class="kb-chip fail">&#10007; ' + failed + ' failed</span> ' +
        '<span class="kb-chip ok">' + mode + '</span>';
    }
  }

  var footerModeEl = document.getElementById('kb-footer-mode');
  if (footerModeEl) {
    footerModeEl.textContent = 'KB mode: ' + mode + ' | KB version: ' + version;
  }
}

/* ============================================================
   KB validation banner
   ============================================================ */
function runKBValidation() {
  /* validateKB is loaded by kb/dev/kb_validator.js script tag */
  if (typeof validateKB !== 'function') return;

  var kbData = state.kb.coreCascades;
  if (!kbData) return;

  var result = validateKB(kbData);

  var banner = document.getElementById('kb-validation-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'kb-validation-banner';
    banner.style.cssText = [
      'position:relative', 'z-index:100', 'font-size:.8rem',
      'font-family:inherit', 'padding:0'
    ].join(';');
    var main = document.querySelector('main.app-main') || document.body;
    main.insertBefore(banner, main.firstChild);
  }

  if (!result.ok && result.errors.length > 0) {
    /* Blocking error panel */
    banner.innerHTML =
      '<div style="background:#c0392b;color:#fff;padding:.6rem 1rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;">' +
        '<strong>&#9888; KB load error &mdash; ' + result.errors.length + ' schema error(s) detected. Some features may be unavailable.</strong>' +
        '<button onclick="document.getElementById(\'kb-val-detail\').style.display=document.getElementById(\'kb-val-detail\').style.display===\'none\'?\'block\':\'none\'" ' +
          'style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.5);color:#fff;padding:.2rem .5rem;cursor:pointer;border-radius:3px;font-size:.75rem;">View errors</button>' +
      '</div>' +
      '<div id="kb-val-detail" style="display:none;background:#fadbd8;color:#922b21;padding:.6rem 1rem;border-bottom:2px solid #c0392b;">' +
        '<strong>Errors:</strong><ul style="margin:.4rem 0 0 1.2rem;padding:0;">' +
          result.errors.map(function(e){ return '<li>' + escHtml(e) + '</li>'; }).join('') +
        '</ul>' +
        (result.warnings.length ? '<strong>Warnings:</strong><ul style="margin:.4rem 0 0 1.2rem;padding:0;">' +
          result.warnings.map(function(w){ return '<li>' + escHtml(w) + '</li>'; }).join('') + '</ul>' : '') +
      '</div>';
  } else if (result.warnings.length > 0) {
    /* Non-blocking warning banner */
    banner.innerHTML =
      '<div style="background:#f39c12;color:#fff;padding:.4rem 1rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;">' +
        '<span>&#9888; KB warnings (' + result.warnings.length + ')</span>' +
        '<button onclick="document.getElementById(\'kb-val-detail\').style.display=document.getElementById(\'kb-val-detail\').style.display===\'none\'?\'block\':\'none\'" ' +
          'style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.5);color:#fff;padding:.15rem .45rem;cursor:pointer;border-radius:3px;font-size:.75rem;">click to view</button>' +
        '<button onclick="this.parentElement.parentElement.style.display=\'none\'" ' +
          'style="margin-left:auto;background:transparent;border:none;color:#fff;cursor:pointer;font-size:1rem;line-height:1;" title="Dismiss">&times;</button>' +
      '</div>' +
      '<div id="kb-val-detail" style="display:none;background:#fef9e7;color:#7d6608;padding:.5rem 1rem;border-bottom:2px solid #f39c12;">' +
        '<ul style="margin:.3rem 0 0 1.2rem;padding:0;">' +
          result.warnings.map(function(w){ return '<li>' + escHtml(w) + '</li>'; }).join('') +
        '</ul>' +
      '</div>';
  } else {
    banner.innerHTML = '';
  }
}

/* Export KB bundle — downloads core+modifiers+watchlist as single JSON */
function exportKBBundle() {
  if (!state.kb.coreCascades && !state.kb.vihModifiers && !state.kb.ddiWatchlist) {
    alert('KB not loaded yet. Please wait for KB to finish loading.');
    return;
  }
  var bundle = {
    exportedAt: new Date().toISOString(),
    kbMode: state.kbMode,
    kbVersion: getKBVersion(),
    coreCascades: state.kb.coreCascades,
    vihModifiers: state.kb.vihModifiers,
    ddiWatchlist: state.kb.ddiWatchlist
  };
  var blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = 'kb-bundle-' + state.kbMode.toLowerCase() + '-' + isoDate() + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

/* ============================================================
   Step content — each step renders a minimal placeholder so
   the wizard is navigable from day one; richer logic can be
   layered in later without touching this file's structure.
   ============================================================ */
const STEP_CONTENT = {
  1: {
    title: '&#128203; Step 1 — Clinical Note Input',
    body: function () {
      return (
        '<div class="form-group">' +
          '<label class="form-label" for="note-input">Clinical Note / Nota Cl&iacute;nica</label>' +
          '<textarea id="note-input" class="textarea-clinical" ' +
            'placeholder="Paste pseudonymized clinical note here…">' +
            escHtml(state.clinicalNote) +
          '</textarea>' +
          '<div class="form-hint">No real patient identifiers. Data stays in this browser.</div>' +
        '</div>'
      );
    },
    onMount: function (el) {
      var ta = el.querySelector('#note-input');
      if (ta) {
        ta.addEventListener('input', function () {
          state.clinicalNote = ta.value;
          saveState();
        });
      }
    }
  },
  2: {
    title: '&#128269; Step 2 — Extractor',
    body: function () {
      return (
        '<div class="callout callout-info">' +
          '<strong>Coming soon.</strong> This step will extract drug names from the clinical note.' +
        '</div>'
      );
    }
  },
  3: {
    title: '&#9881;&#65039; Step 3 — Normalizer',
    body: function () {
      return (
        '<div class="callout callout-info">' +
          '<strong>Coming soon.</strong> This step will normalize extracted names to canonical drug classes.' +
        '</div>'
      );
    }
  },
  4: {
    title: '&#128300; Step 4 — Cascade Detector',
    body: function () {
      var kbReady = state.kb.coreCascades && state.kb.vihModifiers && state.kb.ddiWatchlist;
      if (!kbReady) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; Knowledge base not loaded.</strong> ' +
            'Check the KB status in the footer and reload the page if needed.' +
          '</div>'
        );
      }
      var cCount = (state.kb.coreCascades.cascades || []).length;
      var vCount = (state.kb.vihModifiers.art_related_cascades || []).length;
      var dCount = (state.kb.ddiWatchlist.interactions || []).length;
      return (
        '<div class="callout callout-info">' +
          '<strong>KB ready.</strong> ' +
          cCount + ' core cascades &mdash; ' +
          vCount + ' VIH modifiers &mdash; ' +
          dCount + ' DDI entries loaded.' +
        '</div>' +
        '<div class="callout callout-warning" style="margin-top:.75rem;">' +
          '<strong>Detection engine coming soon.</strong> ' +
          'Complete Steps 2 &amp; 3 first.' +
        '</div>'
      );
    }
  },
  5: {
    title: '&#128221; Step 5 — Plan &amp; Verify',
    body: function () {
      return (
        '<div class="callout callout-info">' +
          '<strong>Coming soon.</strong> This step will let you confirm or rule out each detected cascade.' +
        '</div>'
      );
    }
  },
  6: {
    title: '&#9654; Step 6 — Report',
    body: function () {
      return (
        '<div class="callout callout-info">' +
          '<strong>Coming soon.</strong> The final report with export options will appear here.' +
        '</div>'
      );
    }
  }
};

/* ============================================================
   Wizard navigation
   ============================================================ */
function goTo(step) {
  if (step < 1 || step > 6) return;
  state.step = step;
  saveState();
  renderStepContent(step);
  updateStepNav(step);
  updateNavButtons(step);
}

function renderStepContent(step) {
  var container = document.getElementById('step-content');
  if (!container) return;

  var cfg = STEP_CONTENT[step];
  if (!cfg) {
    container.innerHTML = '<div class="loading-placeholder">Unknown step.</div>';
    return;
  }

  container.innerHTML =
    '<div class="step-header"><h2>' + cfg.title + '</h2></div>' +
    '<div class="step-section">' + cfg.body() + '</div>';

  if (typeof cfg.onMount === 'function') {
    cfg.onMount(container);
  }
}

function updateStepNav(active) {
  document.querySelectorAll('.step-btn').forEach(function (btn) {
    var s = parseInt(btn.dataset.step, 10);
    btn.classList.remove('active', 'completed');
    if (s === active)   btn.classList.add('active');
    else if (s < active) btn.classList.add('completed');
  });
}

function updateNavButtons(step) {
  var prev    = document.getElementById('btn-prev');
  var next    = document.getElementById('btn-next');
  var counter = document.getElementById('step-counter');
  if (prev)    prev.disabled = step === 1;
  if (next)    next.innerHTML = step === 6 ? '&#10003; Done' : 'Next &#8594;';
  if (counter) counter.textContent = 'Step ' + step + ' of 6';
}

/* ============================================================
   Top-bar buttons
   ============================================================ */

/* Export JSON — serialises current state to a downloadable file */
function exportJSON() {
  var payload = {
    exportedAt: new Date().toISOString(),
    patientId: state.patientId,
    clinicalNote: state.clinicalNote,
    step: state.step
  };
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = 'cascade-audit-' + (state.patientId || 'case') + '-' + isoDate() + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

/* Import Case — reads a previously exported JSON and restores state */
function importCase(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (e) {
    try {
      var data = JSON.parse(e.target.result);
      if (typeof data !== 'object' || data === null) {
        throw new Error('File does not contain a JSON object.');
      }
      if (data.patientId)    state.patientId    = data.patientId;
      if (data.clinicalNote) state.clinicalNote = data.clinicalNote;
      if (data.step)         state.step         = data.step;

      var pidEl = document.getElementById('patient-id');
      if (pidEl) pidEl.value = state.patientId;

      saveState();
      goTo(state.step);
    } catch (err) {
      console.error('[Import] Could not parse imported file:', err);
      alert('Import failed: ' + err.message);
    }
  };
  reader.onerror = function () {
    console.error('[Import] FileReader error while reading import file.');
    alert('Could not read the selected file.');
  };
  reader.readAsText(file);
}

/* Delete All Data — clears localStorage and resets the UI */
function deleteAllData() {
  if (!confirm('Delete ALL local data? This cannot be undone.')) return;
  clearState();
  var pidEl = document.getElementById('patient-id');
  if (pidEl) pidEl.value = '';
  goTo(1);
}

/* ============================================================
   Utility helpers
   ============================================================ */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isoDate() {
  return new Date().toISOString().split('T')[0];
}

/* ============================================================
   Event wiring
   ============================================================ */
function wireEvents() {
  /* Step tab buttons */
  document.querySelectorAll('.step-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var s = parseInt(btn.dataset.step, 10);
      if (s) goTo(s);
    });
  });

  /* Prev / Next */
  var btnPrev = document.getElementById('btn-prev');
  var btnNext = document.getElementById('btn-next');
  if (btnPrev) btnPrev.addEventListener('click', function () { goTo(state.step - 1); });
  if (btnNext) btnNext.addEventListener('click', function () { goTo(state.step + 1); });

  /* Patient ID */
  var pidEl = document.getElementById('patient-id');
  if (pidEl) {
    pidEl.value = state.patientId;
    pidEl.addEventListener('input', function () {
      state.patientId = pidEl.value.trim();
      saveState();
    });
  }

  /* Safety banner toggle */
  var safetyToggle  = document.getElementById('safety-toggle');
  var safetyContent = document.getElementById('safety-content');
  var safetyArrow   = document.getElementById('safety-arrow');
  if (safetyToggle && safetyContent) {
    safetyToggle.addEventListener('click', function () {
      var open = safetyToggle.getAttribute('aria-expanded') === 'true';
      safetyToggle.setAttribute('aria-expanded', String(!open));
      safetyContent.style.display = open ? 'none' : '';
      if (safetyArrow) safetyArrow.classList.toggle('collapsed', open);
    });
  }

  /* Export JSON */
  var btnExportJSON = document.getElementById('btn-export-json');
  if (btnExportJSON) btnExportJSON.addEventListener('click', exportJSON);

  /* Export CSV — disabled in MVP, kept wired so button activates without error */
  var btnExportCSV = document.getElementById('btn-export-csv');
  if (btnExportCSV) {
    btnExportCSV.addEventListener('click', function () {
      alert('CSV export will be available once cascade detection is implemented.');
    });
  }

  /* Import Case */
  var btnImport   = document.getElementById('btn-import');
  var fileInput   = document.getElementById('import-file-input');
  if (btnImport && fileInput) {
    btnImport.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function (e) {
      importCase(e.target.files && e.target.files[0]);
      e.target.value = '';
    });
  }

  /* Delete All Data */
  var btnDelete = document.getElementById('btn-delete-data');
  if (btnDelete) btnDelete.addEventListener('click', deleteAllData);

  /* KB mode selector */
  var kbModeSelect = document.getElementById('kb-mode-select');
  if (kbModeSelect) {
    kbModeSelect.value = state.kbMode;
    kbModeSelect.addEventListener('change', async function () {
      var newMode = kbModeSelect.value;
      if (newMode !== state.kbMode) {
        state.kbMode = newMode;
        state.kb.coreCascades = null;
        state.kb.vihModifiers = null;
        state.kb.ddiWatchlist = null;
        var statusEl = document.getElementById('kb-status');
        if (statusEl) statusEl.innerHTML = '<span class="kb-chip">Loading ' + newMode + '&hellip;</span>';
        var ok = await loadKB(newMode);
        if (!ok) {
          console.error('[KB] Some files failed to load from ' + newMode + ' track.');
        }
        /* Re-render current step in case it depends on KB */
        renderStepContent(state.step);
      }
    });
  }

  /* Export KB bundle */
  var btnExportKB = document.getElementById('btn-export-kb');
  if (btnExportKB) btnExportKB.addEventListener('click', exportKBBundle);
}

/* ============================================================
   init
   ============================================================ */
async function init() {
  try {
    /* Restore persisted state first so the correct step is shown */
    loadState();

    /* Wire all UI events */
    wireEvents();

    /* Load knowledge base files */
    var kbOk = await loadKB();
    if (!kbOk) {
      console.error('[App] One or more KB files failed to load. Some features will be unavailable.');
    }

    /* Enable export buttons now that we have something to export */
    var btnExportJSON = document.getElementById('btn-export-json');
    var btnExportCSV  = document.getElementById('btn-export-csv');
    if (btnExportJSON) btnExportJSON.disabled = false;
    if (btnExportCSV)  btnExportCSV.disabled  = false;

    /* Render the active step — this replaces "Loading application..." */
    goTo(state.step);

  } catch (err) {
    console.error('[App] Initialization failed:', err);

    /* Show visible error in the step content area */
    var container = document.getElementById('step-content');
    if (container) {
      container.innerHTML =
        '<div class="callout callout-danger">' +
          '<strong>&#9888; Application failed to initialize.</strong> ' +
          'Error: ' + escHtml(err.message) + '. ' +
          'Check the browser console for details.' +
        '</div>';
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
