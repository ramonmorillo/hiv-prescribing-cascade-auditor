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
   Cascade Detection Engine
   ============================================================ */

/**
 * Returns true when `drug` (or any slash-separated component) appears
 * as a whole word inside `noteText` (case-insensitive).
 */
function drugFoundInNote(noteText, drug) {
  var parts = drug.split('/');
  return parts.some(function (part) {
    part = part.trim();
    if (!part) return false;
    try {
      var escaped = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('\\b' + escaped + '\\b', 'i').test(noteText);
    } catch (e) {
      return noteText.toLowerCase().indexOf(part.toLowerCase()) !== -1;
    }
  });
}

/**
 * Return the index drug examples for a cascade entry, handling both the
 * singular field name used in kb_core_cascades.json ("index_drug_examples")
 * and the plural form used in kb_vih_modifiers.json ("index_drugs_examples").
 */
function getIndexExamples(cascade) {
  return cascade.index_drug_examples || cascade.index_drugs_examples || [];
}

/**
 * Return the cascade drug examples for a cascade entry, handling both the
 * singular field name used in kb_core_cascades.json ("cascade_drug_examples")
 * and the plural form used in kb_vih_modifiers.json ("cascade_drugs_examples").
 */
function getCascadeExamples(cascade) {
  return cascade.cascade_drug_examples || cascade.cascade_drugs_examples || [];
}

/**
 * Scan `noteText` against every loaded cascade entry.
 * A signal fires when at least one index drug AND at least one cascade drug
 * are both found in the note.
 *
 * @param {string} noteText  Raw clinical note from state.clinicalNote
 * @returns {Array<{cascade_id, cascade_name, index_drug, cascade_drug, confidence, risk_focus, clinical_hint}>}
 */
function detectCascades(noteText) {
  if (!noteText || !noteText.trim()) return [];
  var detected = [];

  /* --- Core cascades (kb_core_cascades.json) --- */
  var coreCascades = (state.kb.coreCascades && state.kb.coreCascades.cascades) || [];
  coreCascades.forEach(function (cascade) {
    var indexExamples   = getIndexExamples(cascade);
    var cascadeExamples = getCascadeExamples(cascade);

    var foundIndex   = indexExamples.find(function (d) { return drugFoundInNote(noteText, d); });
    var foundCascade = cascadeExamples.find(function (d) { return drugFoundInNote(noteText, d); });

    if (foundIndex && foundCascade) {
      detected.push({
        cascade_id:    cascade.id,
        cascade_name:  cascade.name_en || cascade.id,
        index_drug:    foundIndex,
        cascade_drug:  foundCascade,
        confidence:    cascade.plausibility || cascade.confidence || 'unknown',
        risk_focus:    cascade.risk_focus || [],
        clinical_hint: cascade.clinical_note_en || cascade.recommended_first_action_en || ''
      });
    }
  });

  /* --- HIV modifier cascades (kb_vih_modifiers.json) --- */
  var vihCascades = (state.kb.vihModifiers && state.kb.vihModifiers.art_related_cascades) || [];
  vihCascades.forEach(function (cascade) {
    var indexExamples   = getIndexExamples(cascade);
    var cascadeExamples = getCascadeExamples(cascade);

    var foundIndex   = indexExamples.find(function (d) { return drugFoundInNote(noteText, d); });
    var foundCascade = cascadeExamples.find(function (d) { return drugFoundInNote(noteText, d); });

    if (foundIndex && foundCascade) {
      var hint = cascade.clinical_note_en || '';
      if (cascade.ddi_warning_en) hint = cascade.ddi_warning_en + (hint ? ' ' + hint : '');
      detected.push({
        cascade_id:    cascade.id,
        cascade_name:  cascade.name_en || cascade.id,
        index_drug:    foundIndex,
        cascade_drug:  foundCascade,
        confidence:    cascade.plausibility || 'unknown',
        risk_focus:    [],
        clinical_hint: hint
      });
    }
  });

  return detected;
}

/**
 * Scan `noteText` for any drug name present in the KB (both index and cascade
 * drug examples across all loaded cascade entries).
 *
 * @param {string} noteText
 * @returns {string[]} Unique drug names found (in KB casing)
 */
function extractDrugs(noteText) {
  if (!noteText || !noteText.trim()) return [];

  var seen   = {};
  var result = [];

  var allCascades = [].concat(
    (state.kb.coreCascades && state.kb.coreCascades.cascades) || [],
    (state.kb.vihModifiers && state.kb.vihModifiers.art_related_cascades) || []
  );

  allCascades.forEach(function (cascade) {
    var examples = [].concat(
      getIndexExamples(cascade),
      getCascadeExamples(cascade)
    );
    examples.forEach(function (drug) {
      var key = drug.toLowerCase();
      if (!seen[key] && drugFoundInNote(noteText, drug)) {
        seen[key] = true;
        result.push(drug);
      }
    });
  });

  return result;
}

/**
 * Map an array of drug names to their canonical drug classes using the KB.
 * A drug can appear as an index drug (→ index_drug_class) or a cascade drug
 * (→ cascade_drug_class); both classes are included.
 *
 * @param {string[]} drugs  Output of extractDrugs()
 * @returns {string[]} Unique drug class names
 */
function normalizeDrugs(drugs) {
  if (!drugs || !drugs.length) return [];

  var drugToClasses = {};

  var allCascades = [].concat(
    (state.kb.coreCascades && state.kb.coreCascades.cascades) || [],
    (state.kb.vihModifiers && state.kb.vihModifiers.art_related_cascades) || []
  );

  allCascades.forEach(function (cascade) {
    var idxClass = cascade.index_drug_class   || '';
    var casClass = cascade.cascade_drug_class || '';

    getIndexExamples(cascade).forEach(function (drug) {
      var key = drug.toLowerCase();
      if (!drugToClasses[key]) drugToClasses[key] = {};
      if (idxClass) drugToClasses[key][idxClass] = true;
    });

    getCascadeExamples(cascade).forEach(function (drug) {
      var key = drug.toLowerCase();
      if (!drugToClasses[key]) drugToClasses[key] = {};
      if (casClass) drugToClasses[key][casClass] = true;
    });
  });

  var classSet = {};
  drugs.forEach(function (drug) {
    var classes = drugToClasses[drug.toLowerCase()] || {};
    Object.keys(classes).forEach(function (cls) { classSet[cls] = true; });
  });

  return Object.keys(classSet);
}

/**
 * Look up a full cascade entry by its ID across both loaded KB files.
 *
 * @param {string} cascadeId  e.g. "CC001" or "VIH001"
 * @returns {Object|null}
 */
function findCascadeEntry(cascadeId) {
  var coreCascades = (state.kb.coreCascades && state.kb.coreCascades.cascades) || [];
  var vihCascades  = (state.kb.vihModifiers && state.kb.vihModifiers.art_related_cascades) || [];
  var all = [].concat(coreCascades, vihCascades);
  for (var i = 0; i < all.length; i++) {
    if (all[i].id === cascadeId) return all[i];
  }
  return null;
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
    title: '&#128269; Step 2 — Drug Extractor',
    body: function () {
      var kbReady = state.kb.coreCascades && state.kb.vihModifiers;
      if (!kbReady) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; Knowledge base not loaded.</strong> ' +
            'Check the KB status in the footer and reload the page if needed.' +
          '</div>'
        );
      }
      if (!state.clinicalNote || !state.clinicalNote.trim()) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; No clinical note found.</strong> ' +
            'Please enter a clinical note in Step 1 before running extraction.' +
          '</div>'
        );
      }

      var drugs = extractDrugs(state.clinicalNote);

      if (drugs.length === 0) {
        return (
          '<div class="callout callout-success">' +
            '<strong>&#10003; No known drug names detected</strong> in the clinical note. ' +
            'The note may use trade names, abbreviations, or drugs not covered by the current KB.' +
          '</div>'
        );
      }

      /* Build a drug → class label map from the KB for display purposes */
      var drugClassMap = {};
      var allCascadesForDisplay = [].concat(
        (state.kb.coreCascades && state.kb.coreCascades.cascades) || [],
        (state.kb.vihModifiers && state.kb.vihModifiers.art_related_cascades) || []
      );
      allCascadesForDisplay.forEach(function (cascade) {
        var idxClass = cascade.index_drug_class || '';
        var casClass = cascade.cascade_drug_class || '';
        getIndexExamples(cascade).forEach(function (d) {
          if (!drugClassMap[d.toLowerCase()]) drugClassMap[d.toLowerCase()] = idxClass;
        });
        getCascadeExamples(cascade).forEach(function (d) {
          if (!drugClassMap[d.toLowerCase()]) drugClassMap[d.toLowerCase()] = casClass;
        });
      });

      var tags = drugs.map(function (d) {
        var cls = drugClassMap[d.toLowerCase()] || '';
        var clsLabel = cls
          ? '<span style="display:block;font-size:.68rem;opacity:.82;margin-top:.1rem;font-weight:400;">' + escHtml(cls) + '</span>'
          : '';
        return (
          '<span style="display:inline-block;background:#1a6b9a;color:#fff;border-radius:4px;' +
            'padding:.28rem .65rem;margin:.25rem .18rem;font-size:.84rem;font-weight:600;' +
            'vertical-align:top;line-height:1.3;">' +
            escHtml(d) + clsLabel +
          '</span>'
        );
      }).join('');

      return (
        '<div class="callout callout-info" style="margin-bottom:.85rem;">' +
          '<strong>' + drugs.length + ' drug name' + (drugs.length === 1 ? '' : 's') +
          ' extracted</strong> from the clinical note (matched against all KB entries).' +
        '</div>' +
        '<div style="padding:.35rem 0 .6rem;">' + tags + '</div>' +
        '<div class="callout callout-warning" style="margin-top:.75rem;font-size:.83rem;">' +
          '&#9888;&nbsp;Extraction is keyword-based. Trade names and abbreviations not in the KB will be missed.' +
        '</div>'
      );
    }
  },
  3: {
    title: '&#9881;&#65039; Step 3 — Drug Normalizer',
    body: function () {
      var kbReady = state.kb.coreCascades && state.kb.vihModifiers;
      if (!kbReady) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; Knowledge base not loaded.</strong> ' +
            'Check the KB status in the footer and reload the page if needed.' +
          '</div>'
        );
      }
      if (!state.clinicalNote || !state.clinicalNote.trim()) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; No clinical note found.</strong> ' +
            'Please enter a clinical note in Step 1 before running normalization.' +
          '</div>'
        );
      }

      var drugs   = extractDrugs(state.clinicalNote);
      var classes = normalizeDrugs(drugs);

      if (drugs.length === 0) {
        return (
          '<div class="callout callout-success">' +
            '<strong>&#10003; No drugs to normalize.</strong> ' +
            'No known drug names were detected in the clinical note (Step 2).' +
          '</div>'
        );
      }

      if (classes.length === 0) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; No drug classes mapped.</strong> ' +
            'Extracted drugs could not be mapped to any KB drug class.' +
          '</div>'
        );
      }

      var classTags = classes.map(function (cls) {
        return (
          '<span style="display:inline-block;background:#1e8449;color:#fff;border-radius:3px;' +
            'padding:.22rem .6rem;margin:.2rem .15rem;font-size:.84rem;font-weight:500;">' +
            escHtml(cls) +
          '</span>'
        );
      }).join('');

      return (
        '<div class="callout callout-info" style="margin-bottom:.85rem;">' +
          '<strong>' + drugs.length + ' drug name' + (drugs.length === 1 ? '' : 's') +
          ' mapped to ' + classes.length + ' drug class' + (classes.length === 1 ? '' : 'es') + '.</strong>' +
        '</div>' +
        '<div style="padding:.35rem 0 .6rem;">' + classTags + '</div>'
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

      if (!state.clinicalNote || !state.clinicalNote.trim()) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; No clinical note found.</strong> ' +
            'Please enter a clinical note in Step 1 before running detection.' +
          '</div>'
        );
      }

      var cCount = (state.kb.coreCascades.cascades || []).length;
      var vCount = (state.kb.vihModifiers.art_related_cascades || []).length;
      var dCount = (state.kb.ddiWatchlist.interactions || []).length;

      var kbInfo = (
        '<div class="callout callout-info">' +
          '<strong>KB ready.</strong> ' +
          cCount + ' core cascades &mdash; ' +
          vCount + ' VIH modifiers &mdash; ' +
          dCount + ' DDI entries loaded.' +
        '</div>'
      );

      var detected = detectCascades(state.clinicalNote);

      if (detected.length === 0) {
        return (
          kbInfo +
          '<div class="callout callout-success" style="margin-top:.75rem;">' +
            '<strong>&#10003; No cascade signals detected.</strong> ' +
            'No prescribing cascade patterns were identified in the clinical note.' +
          '</div>'
        );
      }

      var confidenceBadge = function (conf) {
        var color = conf === 'high' ? '#27ae60' : conf === 'medium' ? '#f39c12' : '#7f8c8d';
        return (
          '<span style="font-size:.72rem;font-weight:700;color:#fff;background:' + color + ';' +
            'padding:.1rem .42rem;border-radius:3px;vertical-align:middle;margin-left:.45rem;">' +
            escHtml(conf) +
          '</span>'
        );
      };

      var rows = detected.map(function (c) {
        var riskTags = c.risk_focus.length
          ? '<div style="margin-top:.35rem;font-size:.76rem;color:#666;">Risk: ' + escHtml(c.risk_focus.join(', ')) + '</div>'
          : '';
        var hint = c.clinical_hint
          ? '<div style="margin-top:.5rem;font-size:.84rem;color:#34495e;' +
              'border-left:3px solid #2980b9;padding:.3rem .65rem;background:#eaf4fb;">' +
              escHtml(c.clinical_hint) +
            '</div>'
          : '';
        return (
          '<div style="border:1px solid #d0d7de;border-radius:6px;padding:.85rem 1rem;' +
            'margin-bottom:.75rem;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.06);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.4rem;">' +
              '<span style="font-size:.93rem;font-weight:600;">' + escHtml(c.cascade_name) + confidenceBadge(c.confidence) + '</span>' +
              '<code style="font-size:.78rem;color:#888;">' + escHtml(c.cascade_id) + '</code>' +
            '</div>' +
            '<div style="margin:.55rem 0 0;font-size:.9rem;">' +
              '&#128138;&nbsp;<strong>' + escHtml(c.index_drug) + '</strong>' +
              '&nbsp;&rarr;&nbsp;<strong>' + escHtml(c.cascade_drug) + '</strong>' +
            '</div>' +
            riskTags + hint +
          '</div>'
        );
      });

      return (
        kbInfo +
        '<div style="margin-top:1rem;">' +
          '<h3 style="margin:0 0 .7rem;font-size:.97rem;color:#2c3e50;">' +
            '&#128204;&nbsp;' + detected.length +
            (detected.length === 1 ? ' cascade signal detected' : ' cascade signals detected') +
          '</h3>' +
          rows.join('') +
        '</div>' +
        '<div class="callout callout-warning" style="margin-top:.75rem;font-size:.84rem;">' +
          '&#9888;&nbsp;For clinician review only. Does not recommend medication changes.' +
        '</div>'
      );
    }
  },
  5: {
    title: '&#128221; Step 5 — Plan &amp; Verify',
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
      if (!state.clinicalNote || !state.clinicalNote.trim()) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; No clinical note found.</strong> ' +
            'Please enter a clinical note in Step 1 before reviewing the plan.' +
          '</div>'
        );
      }

      var detected = detectCascades(state.clinicalNote);

      if (detected.length === 0) {
        return (
          '<div class="callout callout-success">' +
            '<strong>&#10003; No cascade signals detected.</strong> ' +
            'No prescribing cascade patterns were identified — no action plan required.' +
          '</div>'
        );
      }

      var rows = detected.map(function (c) {
        var entry      = findCascadeEntry(c.cascade_id);
        var clinNote   = entry ? (entry.clinical_note_en   || '') : '';
        var ddiWarning = entry ? (entry.ddi_warning_en     || '') : '';

        var ddiHtml = ddiWarning
          ? '<div style="background:#fadbd8;border-left:3px solid #c0392b;padding:.45rem .75rem;' +
              'margin-top:.55rem;font-size:.83rem;color:#922b21;border-radius:0 3px 3px 0;">' +
              '&#9888;&nbsp;' + escHtml(ddiWarning) +
            '</div>'
          : '';

        var noteHtml = clinNote
          ? '<div style="background:#eaf4fb;border-left:3px solid #2980b9;padding:.45rem .75rem;' +
              'margin-top:.55rem;font-size:.83rem;color:#1a5276;border-radius:0 3px 3px 0;">' +
              '&#128203;&nbsp;<strong>Recommended first action:</strong> ' + escHtml(clinNote) +
            '</div>'
          : '';

        return (
          '<div style="border:1px solid #d0d7de;border-radius:6px;padding:.85rem 1rem;' +
            'margin-bottom:.75rem;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.06);">' +
            '<div style="font-weight:600;font-size:.93rem;">' + escHtml(c.cascade_name) + '</div>' +
            '<div style="font-size:.87rem;color:#555;margin-top:.3rem;">' +
              '&#128138;&nbsp;Index drug: <strong>' + escHtml(c.index_drug) + '</strong>' +
              '&nbsp;&rarr;&nbsp;Cascade drug: <strong>' + escHtml(c.cascade_drug) + '</strong>' +
            '</div>' +
            ddiHtml + noteHtml +
          '</div>'
        );
      });

      return (
        '<div class="callout callout-warning" style="margin-bottom:.85rem;font-size:.85rem;">' +
          '&#9888;&nbsp;Review each signal below. These are clinician-facing decision-support prompts only.' +
        '</div>' +
        rows.join('')
      );
    }
  },
  6: {
    title: '&#128196; Step 6 — Report',
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
      if (!state.clinicalNote || !state.clinicalNote.trim()) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; No clinical note found.</strong> ' +
            'Please enter a clinical note in Step 1 to generate a report.' +
          '</div>'
        );
      }

      var drugs    = extractDrugs(state.clinicalNote);
      var classes  = normalizeDrugs(drugs);
      var detected = detectCascades(state.clinicalNote);
      var pid      = state.patientId || '&mdash;';
      var now      = new Date().toISOString().replace('T', ' ').split('.')[0] + ' UTC';

      var drugsCell = drugs.length
        ? escHtml(drugs.join(', '))
        : '<em style="color:#888;">None detected</em>';

      var classesCell = classes.length
        ? escHtml(classes.join(', '))
        : '<em style="color:#888;">None</em>';

      var cascadeRows = detected.length === 0
        ? '<p style="color:#1e8449;margin:.4rem 0;">&#10003; No prescribing cascade signals detected.</p>'
        : detected.map(function (c) {
            var entry = findCascadeEntry(c.cascade_id);
            var rec   = entry ? (entry.clinical_note_en || '') : '';
            return (
              '<div style="margin:.45rem 0;padding:.6rem .85rem;border:1px solid #d0d7de;' +
                'border-radius:5px;background:#fafafa;">' +
                '<strong>' + escHtml(c.cascade_name) + '</strong>' +
                '&nbsp;<code style="font-size:.74rem;color:#888;">' + escHtml(c.cascade_id) + '</code>' +
                '<br><span style="font-size:.84rem;">&#128138;&nbsp;' +
                  escHtml(c.index_drug) + ' &rarr; ' + escHtml(c.cascade_drug) +
                '</span>' +
                (rec
                  ? '<br><span style="font-size:.81rem;color:#1a5276;">&#128203;&nbsp;' + escHtml(rec) + '</span>'
                  : '') +
              '</div>'
            );
          }).join('');

      return (
        '<div style="background:#fff;border:1px solid #d0d7de;border-radius:6px;padding:1.15rem 1.3rem;">' +
          '<h3 style="margin:0 0 .85rem;font-size:1rem;color:#2c3e50;">&#128196;&nbsp;Cascade Audit Report</h3>' +

          '<table style="width:100%;font-size:.87rem;border-collapse:collapse;margin-bottom:.85rem;">' +
            '<tr style="border-bottom:1px solid #eee;">' +
              '<td style="padding:.35rem .5rem;color:#666;width:38%;vertical-align:top;">Patient ID</td>' +
              '<td style="padding:.35rem .5rem;font-weight:600;">' + pid + '</td>' +
            '</tr>' +
            '<tr style="border-bottom:1px solid #eee;">' +
              '<td style="padding:.35rem .5rem;color:#666;">Generated</td>' +
              '<td style="padding:.35rem .5rem;">' + escHtml(now) + '</td>' +
            '</tr>' +
            '<tr>' +
              '<td style="padding:.35rem .5rem;color:#666;">KB version</td>' +
              '<td style="padding:.35rem .5rem;">' + escHtml(getKBVersion()) + ' (' + escHtml(state.kbMode) + ')</td>' +
            '</tr>' +
          '</table>' +

          '<strong style="font-size:.88rem;">Drugs Detected (' + drugs.length + ')</strong>' +
          '<p style="margin:.35rem 0 .8rem;font-size:.86rem;">' + drugsCell + '</p>' +

          '<strong style="font-size:.88rem;">Drug Classes (' + classes.length + ')</strong>' +
          '<p style="margin:.35rem 0 .8rem;font-size:.86rem;">' + classesCell + '</p>' +

          '<strong style="font-size:.88rem;">Cascade Signals (' + detected.length + ')</strong>' +
          '<div style="margin:.35rem 0 .75rem;">' + cascadeRows + '</div>' +

          '<div class="callout callout-warning" style="margin-top:.85rem;font-size:.82rem;">' +
            '&#9888;&nbsp;Decision support only. Not a medical device. ' +
            'Do not use with real patient identifiers outside a pseudonymised research context.' +
          '</div>' +
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
