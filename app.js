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
  kb: { coreCascades: null, vihModifiers: null, ddiWatchlist: null, symptomDictionary: null },
  /* Step 2 — symptoms found in the clinical note */
  symptomsDetected: [],
  /* Step 5 clinician classifications, keyed by cascade_id.
     Values: 'confirmed' | 'possible' | 'not_cascade' */
  cascadeClassifications: {},
  /* Cache for detectCascades() — invalidated when note or KB changes */
  detectedCascades: null
};

/* ============================================================
   localStorage helpers
   ============================================================ */
function saveState() {
  try {
    const payload = {
      step: state.step,
      patientId: state.patientId,
      clinicalNote: state.clinicalNote,
      symptomsDetected: state.symptomsDetected,
      cascadeClassifications: state.cascadeClassifications
    };
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error('[Storage] Could not save state:', err);
    /* QuotaExceededError means browser storage is full — surface this to the user
     * so they know their work is at risk, rather than losing it silently. */
    if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      showToast('Storage full — auto-save failed. Export your case now to avoid data loss.', 'error');
    }
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (typeof saved.patientId === 'string')    state.patientId    = saved.patientId;
    if (typeof saved.clinicalNote === 'string') state.clinicalNote = saved.clinicalNote;
    /* Guard against corrupted or out-of-range step values */
    if (Number.isInteger(saved.step) && saved.step >= 1 && saved.step <= 6) state.step = saved.step;
    if (Array.isArray(saved.symptomsDetected))                 state.symptomsDetected       = saved.symptomsDetected;
    if (saved.cascadeClassifications && typeof saved.cascadeClassifications === 'object' &&
        !Array.isArray(saved.cascadeClassifications))          state.cascadeClassifications = saved.cascadeClassifications;
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
    state.symptomsDetected = [];
    state.cascadeClassifications = {};
    state.detectedCascades = null;
  } catch (err) {
    console.error('[Storage] Could not clear state:', err);
  }
}

/* ============================================================
   KB loading
   ============================================================ */

/* Recursively freezes an object and all its properties.
 * Used in dev mode to catch accidental KB mutations at the point they occur. */
function deepFreeze(obj) {
  if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  Object.getOwnPropertyNames(obj).forEach(function (key) { deepFreeze(obj[key]); });
  return obj;
}

async function loadKB(track) {
  var folder = 'kb/' + (track || state.kbMode).toLowerCase();
  const files = {
    coreCascades:      folder + '/kb_core_cascades.json',
    vihModifiers:      folder + '/kb_vih_modifiers.json',
    ddiWatchlist:      folder + '/ddi_watchlist.json',
    symptomDictionary: folder + '/kb_symptoms.json'
  };

  /* cache:'no-cache' sends a conditional GET on each load — the browser still
   * uses ETag / Last-Modified for efficiency but will not serve a stale copy.
   * This ensures that KB updates (e.g. new Spanish synonyms) are picked up
   * without requiring a hard browser-reload or cache-clear by the user. */
  const results = await Promise.allSettled(
    Object.entries(files).map(async ([key, url]) => {
      const resp = await fetch(url, { cache: 'no-cache' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status + ' for ' + url);
      const parsed = await resp.json();
      /* Reject non-object payloads (e.g. a JSON string or array at root level)
       * before they corrupt state.kb and cause downstream null-dereference errors. */
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Unexpected KB format in ' + url + ' — root must be a JSON object');
      }
      state.kb[key] = parsed;
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

  /* Immutability guard — in dev mode, freeze all loaded KB objects so any
   * accidental mutation throws TypeError instead of silently corrupting state. */
  if (typeof window !== 'undefined' && window.__KB_DEV_MODE) {
    Object.keys(state.kb).forEach(function (key) {
      if (state.kb[key] && typeof state.kb[key] === 'object') {
        deepFreeze(state.kb[key]);
      }
    });
  }

  return failed.length === 0;
}

function getKBVersion() {
  var src = state.kb.coreCascades || state.kb.vihModifiers || state.kb.ddiWatchlist;
  return (src && src.version) ? src.version : '';
}

function updateKBStatus(loaded, failed) {
  var mode = state.kbMode;
  var version = getKBVersion();

  var statusEl = document.getElementById('kb-status');
  if (statusEl) {
    if (failed === 0) {
      statusEl.innerHTML = '<span class="kb-chip ok">&#10003; KB ' + mode + (version ? ' v' + version : '') + '</span>';
    } else if (loaded === 0) {
      /* Total failure — all files unavailable */
      statusEl.innerHTML = '<span class="kb-chip fail">&#10007; KB unavailable &mdash; ' + failed + ' file(s) failed to load</span>';
    } else {
      /* Partial failure — some files loaded, some failed */
      statusEl.innerHTML =
        '<span class="kb-chip ok">&#10003; ' + loaded + ' loaded</span> ' +
        '<span class="kb-chip fail">&#10007; ' + failed + ' failed</span> ' +
        '<span class="kb-chip ok">' + mode + '</span>';
    }
  }

  var devModeEl = document.getElementById('kb-footer-mode');
  if (devModeEl) {
    devModeEl.textContent = 'KB: ' + mode + (version ? ' v' + version : '');
  }
}

/* ============================================================
   KB validation banner
   ============================================================ */
function runKBValidation() {
  /* validateKBOperational is loaded by kb/dev/kb_validator.js script tag */
  if (typeof validateKBOperational !== 'function') return;

  var kbData = state.kb.coreCascades;
  if (!kbData) return;

  /* Operational result:
   *   - drives the blocking red-banner (ok:false)
   *   - provides fallbackByField / fallbackByFieldIds for editorial warnings
   * A single validation pass covers both needs — no second validateKBStrict call. */
  var opResult = validateKBOperational(kbData);

  var byField    = opResult.fallbackByField    || {};
  var byFieldIds = opResult.fallbackByFieldIds || {};
  var hasFallback = opResult.fallbackCascadeCount > 0;

  /* i18n detail rows — shown only inside the expandable panel, never in the headline */
  var i18nDetailItems = Object.keys(byField).sort().map(function (field) {
    var count = byField[field];
    var ids   = byFieldIds[field] || [];
    return '<li><code>' + escHtml(field) + '</code>: ' + count + ' cascade(s) using EN fallback' +
      (ids.length ? ' \u2014 <span style="font-family:monospace;font-size:.72rem;word-break:break-all">' +
        escHtml(ids.join(', ')) + '</span>' : '') +
      '</li>';
  });

  /* Structural warnings from the operational pass (e.g. differential_hints < 3).
   * These are genuine quality issues, not translation gaps — kept separate. */
  var structuralItems = opResult.warnings.map(function (w) {
    return '<li>' + escHtml(w) + '</li>';
  });

  var banner = document.getElementById('kb-validation-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'kb-validation-banner';
    banner.style.cssText = 'position:relative;z-index:100;font-size:.8rem;font-family:inherit;padding:0';
    var main = document.querySelector('main.app-main') || document.body;
    main.insertBefore(banner, main.firstChild);
  }

  if (!opResult.ok && opResult.errors.length > 0) {
    /* ── Red blocking banner — structural / missing-EN errors ── */
    var redDetail =
      '<strong>Errors:</strong><ul style="margin:.4rem 0 0 1.2rem;padding:0;">' +
        opResult.errors.map(function(e){ return '<li>' + escHtml(e) + '</li>'; }).join('') +
      '</ul>' +
      (structuralItems.length ?
        '<strong>Warnings:</strong><ul style="margin:.4rem 0 0 1.2rem;padding:0;">' +
          structuralItems.join('') + '</ul>' : '') +
      /* i18n note inside error detail, not as a separate banner */
      (hasFallback ?
        '<details style="margin-top:.5rem"><summary style="cursor:pointer;font-size:.75rem;">' +
          'Show translation details (' + opResult.fallbackCascadeCount + ' cascade(s), ' +
          opResult.fallbackFieldCount + ' field(s))</summary>' +
          '<ul style="margin:.3rem 0 0 1.2rem;padding:0;">' + i18nDetailItems.join('') + '</ul>' +
        '</details>' : '');
    banner.innerHTML =
      '<div style="background:#c0392b;color:#fff;padding:.6rem 1rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;">' +
        '<strong>&#9888; KB load error \u2014 ' + opResult.errors.length + ' schema error(s) detected. Some features may be unavailable.</strong>' +
        '<button onclick="document.getElementById(\'kb-val-detail\').style.display=document.getElementById(\'kb-val-detail\').style.display===\'none\'?\'block\':\'none\'" ' +
          'style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.5);color:#fff;padding:.2rem .5rem;cursor:pointer;border-radius:3px;font-size:.75rem;">View errors</button>' +
      '</div>' +
      '<div id="kb-val-detail" style="display:none;background:#fadbd8;color:#922b21;padding:.6rem 1rem;border-bottom:2px solid #c0392b;">' +
        redDetail +
      '</div>';

  } else if (hasFallback || structuralItems.length > 0) {
    /* ── Amber non-blocking banner ──
     * i18n gaps (fallback active) → single summary headline, no per-field clutter.
     * Structural notices (non-i18n) → listed normally if present.            */

    /* Headline: i18n summary takes priority; structural count appended if both present */
    var headlineText = hasFallback
      ? 'Language: mixed (EN fallback active) \u2014 ' +
        opResult.fallbackCascadeCount + ' cascade(s), ' + opResult.fallbackFieldCount + ' field(s).'
      : 'KB notices (' + structuralItems.length + ')';

    /* Detail panel: structural warnings first, then i18n per-field breakdown */
    var amberDetailParts = [];
    if (structuralItems.length > 0) {
      amberDetailParts.push(
        '<strong style="display:block;margin-bottom:.2rem">Structural notices:</strong>' +
        '<ul style="margin:.2rem 0 .5rem 1.2rem;padding:0;">' + structuralItems.join('') + '</ul>'
      );
    }
    if (hasFallback) {
      amberDetailParts.push(
        '<ul style="margin:.2rem 0 0 1.2rem;padding:0;">' + i18nDetailItems.join('') + '</ul>'
      );
    }

    var detailBtnLabel = hasFallback ? 'Show translation details' : 'View notices';

    banner.innerHTML =
      '<div style="background:#f39c12;color:#fff;padding:.4rem 1rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;">' +
        '<span>&#9888; ' + headlineText + '</span>' +
        '<button onclick="document.getElementById(\'kb-val-detail\').style.display=document.getElementById(\'kb-val-detail\').style.display===\'none\'?\'block\':\'none\'" ' +
          'style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.5);color:#fff;padding:.15rem .45rem;cursor:pointer;border-radius:3px;font-size:.75rem;">' +
          escHtml(detailBtnLabel) + '</button>' +
        '<button onclick="this.parentElement.parentElement.style.display=\'none\'" ' +
          'style="margin-left:auto;background:transparent;border:none;color:#fff;cursor:pointer;font-size:1rem;line-height:1;" title="Dismiss">&times;</button>' +
      '</div>' +
      '<div id="kb-val-detail" style="display:none;background:#fef9e7;color:#7d6608;padding:.5rem 1rem;border-bottom:2px solid #f39c12;">' +
        amberDetailParts.join('') +
      '</div>';

  } else {
    banner.innerHTML = '';
  }
}

/* Strip in-memory __i18n provenance markers from a KB data object before export.
 * Returns a shallow clone so the live state object is not mutated. */
function stripI18nMarkers(kbData) {
  if (!kbData) return kbData;
  var arrays = ['cascades', 'non_cascade_iatrogenic'];
  var cloned = Object.assign({}, kbData);
  arrays.forEach(function (key) {
    if (!Array.isArray(cloned[key])) return;
    cloned[key] = cloned[key].map(function (c) {
      if (!c || !c.__i18n) return c;
      var copy = Object.assign({}, c);
      delete copy.__i18n;
      return copy;
    });
  });
  return cloned;
}

/* Export KB bundle — downloads core+modifiers+watchlist as single JSON.
 * Source KB: unmodified — what you see is exactly what is in the JSON files. */
function exportKBBundle() {
  if (!state.kb.coreCascades && !state.kb.vihModifiers && !state.kb.ddiWatchlist) {
    showToast('KB not loaded yet — wait for the KB to finish loading before exporting.', 'warning');
    return;
  }
  var bundle = {
    exportedAt:  new Date().toISOString(),
    exportType:  'source',
    kbMode:      state.kbMode,
    kbVersion:   getKBVersion(),
    coreCascades: stripI18nMarkers(state.kb.coreCascades),
    vihModifiers: state.kb.vihModifiers,
    ddiWatchlist: state.kb.ddiWatchlist
  };
  downloadJSON(bundle, 'kb-bundle-' + state.kbMode.toLowerCase() + '-' + isoDate() + '.json');
}

/* Export KB bundle (operational) — normalized clone with missing *_es fields
 * filled from *_en counterparts.  Includes a top-level `normalization` block
 * documenting which fields were auto-filled.  The source KB JSON files are
 * NOT modified; add translations there to make them permanent.             */
function exportKBBundleOperational() {
  if (!state.kb.coreCascades) {
    showToast('KB not loaded yet — wait for the KB to finish loading before exporting.', 'warning');
    return;
  }
  if (typeof buildOperationalKB !== 'function') {
    showToast('KB validator not loaded — cannot build operational export.', 'error');
    return;
  }
  var built = buildOperationalKB(state.kb.coreCascades);
  var bundle = {
    exportedAt:  new Date().toISOString(),
    exportType:  'operational',
    kbMode:      state.kbMode,
    kbVersion:   getKBVersion(),
    normalization: {
      appliedAt:           new Date().toISOString(),
      fallbackCascadeCount: built.report.cascadeCount,
      fallbackFieldCount:   built.report.fieldCount,
      fallbackByField:      built.report.byField,
      note: 'Missing *_es fields were auto-filled from *_en. ' +
            'Add translations to KB source JSON files to make them permanent.'
    },
    coreCascades: built.kbData,
    vihModifiers: state.kb.vihModifiers,
    ddiWatchlist: state.kb.ddiWatchlist
  };
  downloadJSON(bundle, 'kb-bundle-operational-' + state.kbMode.toLowerCase() + '-' + isoDate() + '.json');
}

/* Shared download helper used by both export functions */
function downloadJSON(obj, filename) {
  try {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  } catch (err) {
    console.error('[Export] downloadJSON failed:', err);
    showToast('Export failed: ' + (err.message || 'unknown error'), 'error');
  }
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

/* ============================================================
   NLP RELIABILITY LAYER — negation, temporality, context
   ============================================================ */

/**
 * Return the first match position for `term` in `noteText` using the same
 * word-boundary logic as drugFoundInNote(), but yielding {index, length}.
 * Returns null if not found.
 *
 * Handles slash-separated compound names (lopinavir/ritonavir).
 */
function findTermInNote(noteText, term) {
  /* Normalise both strings to NFC so that decomposed Unicode characters
   * (NFD form — e.g. n + combining-tilde instead of ñ U+00F1, or
   * i + combining-acute instead of í U+00ED) still match their composed
   * equivalents stored in the KB.  macOS clipboard and some browsers can
   * produce NFD text; the KB JSON is always stored as NFC. */
  var normNote = (noteText && noteText.normalize) ? noteText.normalize('NFC') : (noteText || '');
  var parts = term.split('/');
  for (var p = 0; p < parts.length; p++) {
    var part = parts[p].trim();
    if (!part) continue;
    var normPart = part.normalize ? part.normalize('NFC') : part;
    try {
      var escaped = normPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var m = new RegExp('\\b' + escaped + '\\b', 'i').exec(normNote);
      if (m) return { index: m.index, length: m[0].length };
    } catch (e) {
      var idx = normNote.toLowerCase().indexOf(normPart.toLowerCase());
      if (idx !== -1) return { index: idx, length: normPart.length };
    }
  }
  return null;
}

/**
 * Determine whether a symptom mention at `matchIndex`…`matchIndex+matchLength`
 * is negated, historical, or resolved — and should therefore NOT be counted
 * as an active symptom.
 *
 * Strategy: extract a token window of ≤6 tokens before and ≤3 tokens after
 * the match and pattern-match against curated negation/resolution lists.
 *
 * @param {string} noteText
 * @param {number} matchIndex  character offset of match start
 * @param {number} matchLength character length of matched term
 * @returns {{ negated: boolean, reason: string }}
 */
function isNegatedSymptom(noteText, matchIndex, matchLength) {
  /* ---- pre-window: up to 80 chars / 6 tokens before match ---- */
  var preRaw  = noteText.slice(Math.max(0, matchIndex - 80), matchIndex);
  var preTokens = preRaw.trim().split(/[\s,;:()\.\!\?]+/).filter(Boolean).slice(-6);
  var preStr  = preTokens.join(' ').toLowerCase();

  /* ---- post-window: up to 60 chars / 3 tokens after match ---- */
  var postRaw = noteText.slice(matchIndex + matchLength,
                               Math.min(noteText.length, matchIndex + matchLength + 60));
  var postTokens = postRaw.trim().split(/[\s,;:()\.\!\?]+/).filter(Boolean).slice(0, 3);
  var postStr = postTokens.join(' ').toLowerCase();

  /* ---- negation cues appearing BEFORE the term ---- */
  var negBefore = [
    /* English */
    /\bno\b/, /\bnot\b/, /\bdenies\b/, /\bdenied\b/, /\bwithout\b/,
    /\bnegative\s+for\b/, /\bfree\s+of\b/, /\brule\s*out\b/, /\br\/o\b/,
    /\bunlikely\b/, /\?/,
    /* Spanish */
    /\bniega\b/, /\bsin\b/, /\bdescarta\b/, /\bnegativo\s+para\b/, /\bnegativa\s+para\b/,
    /\bausencia\s+de\b/, /\bno\s+presenta\b/, /\bno\s+refiere\b/, /\bno\s+hay\b/
  ];
  for (var i = 0; i < negBefore.length; i++) {
    if (negBefore[i].test(preStr)) {
      return { negated: true, reason: 'negated before: "' + preTokens.slice(-3).join(' ') + '"' };
    }
  }

  /* ---- resolved / historical cues appearing BEFORE the term ---- */
  var histBefore = [
    /* English */
    /\bresolved\b/, /\bimproved\b/, /\bprevious\b/, /\bhistory\s+of\b/,
    /\bhx\s+of\b/, /\bh\/o\b/, /\bprior\b/, /\bpast\b/, /\bused\s+to\b/,
    /\bformer(?:ly)?\b/, /\bold\b/,
    /* Spanish */
    /\bantecedentes\s+de\b/, /\bhistoria\s+de\b/, /\bap\s+de\b/,
    /\bprevio\b/, /\bprevia\b/, /\bpreviamente\b/, /\ben\s+el\s+pasado\b/
  ];
  for (var j = 0; j < histBefore.length; j++) {
    if (histBefore[j].test(preStr)) {
      return { negated: true, reason: 'historical before: "' + preTokens.slice(-3).join(' ') + '"' };
    }
  }

  /* ---- resolved / past cues appearing AFTER the term ---- */
  var resolvedAfter = [
    /* English */
    /\bresolved\b/, /\bimproved\b/, /\bcleared\b/, /\bgone\b/, /\babated\b/,
    /* Spanish */
    /\bresuelto\b/, /\bresuelta\b/, /\bmejor[ií]a\b/, /\bmejorado\b/, /\bmejorada\b/,
    /\bcontrolado\b/, /\bcontrolada\b/, /\bcede\b/, /\bdesaparece\b/
  ];
  for (var k = 0; k < resolvedAfter.length; k++) {
    if (resolvedAfter[k].test(postStr)) {
      return { negated: true,
               reason: 'resolved after: "' + noteText.slice(matchIndex, matchIndex + matchLength) +
                       ' ' + postTokens.slice(0, 2).join(' ') + '"' };
    }
  }

  return { negated: false, reason: '' };
}

/**
 * Scan ±40 characters (≈ ±8 tokens) around `matchIndex` for temporal cues
 * that hint at whether a drug was recently started, a symptom is new, or a
 * treatment was recently added.  Also flags "chronic/long-term" patterns that
 * suggest the finding is pre-existing.
 *
 * Returns a plain object — never throws.
 *
 * @param {string} noteText
 * @param {number} matchIndex character offset of the term being evaluated
 * @returns {{ drugStartHint: boolean, symptomNewHint: boolean,
 *             treatmentAddedHint: boolean, chronicHint: boolean,
 *             details: string }}
 */
function detectTimeCues(noteText, matchIndex) {
  var R = 40; /* radius in characters */
  var start = Math.max(0, matchIndex - R);
  var end   = Math.min(noteText.length, matchIndex + R);
  var ctx   = noteText.slice(start, end).toLowerCase();

  return {
    /* EN: started/initiated/… | ES: inicia/se inicia/se empezó/tras iniciar/… */
    drugStartHint: (
      /\b(started|initiated|begin|began|since\s+starting|after\s+starting|on\s+\d|commenced)\b/.test(ctx) ||
      /\b(inicia|se\s+inicia|se\s+empez[oó]|tras\s+iniciar|al\s+iniciar|comienza|se\s+pauta)\b/.test(ctx)
    ),
    /* EN: since/after/worsened/new/… | ES: nuevo/reciente/empeora/presenta/aparece/desde hace */
    symptomNewHint: (
      /\b(since|after|worsened|new|recent|developed|onset|appearing|presenting\s+with|new[- ]onset)\b/.test(ctx) ||
      /\b(nuevo|nueva|reciente|recientemente|empeora|presenta|aparece|desde\s+hace|de\s+nueva\s+aparici[oó]n)\b/.test(ctx)
    ),
    /* EN: added/given/prescribed/… | ES: se añade/se pauta/se prescribe/se inicia/a demanda/prn */
    treatmentAddedHint: (
      /\b(added|given|prescribed|initiated|started|commenced|prn\s+started|increased)\b/.test(ctx) ||
      /\b(se\s+a[nñ]ade|se\s+pauta|se\s+prescribe|se\s+inicia|a\s+demanda|prn)\b/.test(ctx)
    ),
    /* EN: chronic/long-term/… | ES: crónico/de base/habitual/desde hace años/largo tiempo */
    chronicHint: (
      /\b(chronic|long[- ]term|longstanding|long\s+standing|baseline|ongoing|persistent|established|years|months|pre[- ]existing)\b/.test(ctx) ||
      /\b(cr[oó]nic[oa]|de\s+base|habitual|desde\s+hace\s+a[nñ]os|de\s+a[nñ]os|largo\s+tiempo|de\s+larga\s+evoluci[oó]n)\b/.test(ctx)
    ),
    details: ctx.trim().slice(0, 80)
  };
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
 * Scan `noteText` against every loaded cascade entry (core + HIV modifiers).
 * A signal fires when at least one index_drug_example AND at least one
 * cascade_drug_example are both found in the note (case-insensitive whole-word
 * match via drugFoundInNote).
 *
 * Handles both KB field-name variants via getIndexExamples / getCascadeExamples.
 * Handles both confidence-field names: "confidence" (core) / "plausibility" (VIH).
 *
 * @param {string} noteText
 * @returns {Array<{
 *   cascade_id, cascade_name,
 *   index_drug, cascade_drug,
 *   confidence, risk_focus,
 *   ade_en, appropriateness,
 *   ddi_warning, clinical_hint
 * }>}
 */
function detectCascades(noteText) {
  if (!noteText || !noteText.trim()) return [];

  var allCascades = [].concat(
    (state.kb.coreCascades && state.kb.coreCascades.cascades) || [],
    (state.kb.vihModifiers && state.kb.vihModifiers.art_related_cascades) || []
  );

  var detected = [];

  allCascades.forEach(function (cascade) {
    var indexExamples   = getIndexExamples(cascade);
    var cascadeExamples = getCascadeExamples(cascade);

    var foundIndex   = indexExamples.find(function (d) { return drugFoundInNote(noteText, d); });
    var foundCascade = cascadeExamples.find(function (d) { return drugFoundInNote(noteText, d); });

    if (!foundIndex || !foundCascade) return;

    detected.push({
      cascade_id:    cascade.id,
      cascade_name:  cascade.name_en || cascade.id,
      signal_type:   'drug_drug',
      index_drug:    foundIndex,
      cascade_drug:  foundCascade,
      /* confidence: core uses "confidence", VIH uses "plausibility".
       * Fall back to 'low' rather than the ambiguous string 'unknown'. */
      confidence:    cascade.confidence || cascade.plausibility || 'low',
      risk_focus:    cascade.risk_focus || [],
      /* ade_en: the intermediate adverse effect that links the two drugs */
      ade_en:        cascade.ade_en || '',
      /* appropriateness: "often_inappropriate" | "often_appropriate" | "context_dependent" */
      appropriateness: cascade.appropriateness || '',
      /* ddi_warning kept separate so the UI can render it as a red alert */
      ddi_warning:   cascade.ddi_warning_en || '',
      clinical_hint: cascade.clinical_note_en || cascade.recommended_first_action_en || ''
    });
  });

  return detected.concat(detectSymptomCascades(noteText));
}

/**
 * Symptom-bridge cascade detection.
 * Fires when ALL THREE of these are present in `noteText`:
 *   1. A drug listed in a symptom's caused_by_drug_examples
 *   2. The symptom itself (detected via state.symptomsDetected)
 *   3. A drug listed in the same symptom's treated_by_drug_examples
 *
 * Uses state.symptomsDetected if already populated (e.g. by Step 2);
 * otherwise runs extractSymptoms() so Step 4 works independently.
 *
 * @param {string} noteText
 * @returns {Array} Same signal shape as detectCascades()
 */
function detectSymptomCascades(noteText) {
  if (!noteText || !noteText.trim()) return [];

  var symEntries = (state.kb.symptomDictionary && state.kb.symptomDictionary.symptoms) || [];
  if (!symEntries.length) return [];

  /* Use cached results from Step 2, or run fresh if not yet populated.
     Backward-compat: if saved state has old string-array format, re-extract. */
  var detectedSymptoms = state.symptomsDetected.length
    ? state.symptomsDetected
    : extractSymptoms(noteText);
  /* Migrate legacy format: array of strings → skip, just re-extract */
  if (detectedSymptoms.length && typeof detectedSymptoms[0] === 'string') {
    detectedSymptoms = extractSymptoms(noteText);
  }

  if (!detectedSymptoms.length) return [];

  var signals = [];

  detectedSymptoms.forEach(function (ds) {
    /* ── Gate 1: symptom must be contextually active ── */
    if (ds.active === false) return;

    var entry = symEntries.find(function (s) { return s.id === ds.id; });
    if (!entry) return;

    var causedBy  = entry.caused_by_drug_examples  || [];
    var treatedBy = entry.treated_by_drug_examples || [];
    if (!causedBy.length || !treatedBy.length) return;

    /* Find cause and treatment drugs and their positions */
    var foundCause = null; var causePos = null;
    for (var ci = 0; ci < causedBy.length; ci++) {
      var cp = findTermInNote(noteText, causedBy[ci]);
      if (cp) { foundCause = causedBy[ci]; causePos = cp; break; }
    }
    var foundTreatment = null; var treatPos = null;
    for (var ti = 0; ti < treatedBy.length; ti++) {
      var tp = findTermInNote(noteText, treatedBy[ti]);
      if (tp) { foundTreatment = treatedBy[ti]; treatPos = tp; break; }
    }
    if (!foundCause || !foundTreatment) return;

    /* ── Gate 2: temporality heuristics ── */
    var symIdx   = typeof ds.startIndex === 'number' ? ds.startIndex : 0;
    var timeSym   = detectTimeCues(noteText, symIdx);
    var timeCause = detectTimeCues(noteText, causePos.index);
    var timeTreat = detectTimeCues(noteText, treatPos.index);

    /* Determine confidence adjustment */
    var confidence = 'medium';
    var rationaleLines = [];

    /* Positive signals → upgrade */
    var supportive = (timeCause.drugStartHint || timeCause.treatmentAddedHint) &&
                     (timeSym.symptomNewHint  || timeTreat.treatmentAddedHint);
    if (supportive) {
      confidence = 'high';
      rationaleLines.push('Supportive temporality: index drug started + new symptom/treatment noted.');
    }

    /* Chronic/pre-existing signal → downgrade */
    var chronic = timeSym.chronicHint || timeTreat.chronicHint;
    if (chronic) {
      confidence = confidence === 'high' ? 'medium' : 'low';
      rationaleLines.push('Possible pre-existing condition (chronic/long-term cue detected).');
    }

    /* Unknown temporality — leave as-is, note it */
    if (!supportive && !chronic) {
      rationaleLines.push('Temporality unknown; confidence not adjusted.');
    }

    /* Capitalise first letter of symptom term for display */
    var symLabel = ds.term.charAt(0).toUpperCase() + ds.term.slice(1);

    signals.push({
      cascade_id:      ds.id + ':' + foundCause + ':' + foundTreatment,
      cascade_name:    foundCause + ' \u2192 ' + symLabel + ' \u2192 ' + foundTreatment,
      index_drug:      foundCause,
      cascade_drug:    foundTreatment,
      signal_type:     'symptom_bridge',
      confidence:      confidence,
      risk_focus:      [ds.category],
      ade_en:          ds.term,
      appropriateness: '',
      ddi_warning:     '',
      clinical_hint:   entry.cascade_relevance || '',
      /* Rationale for clinician transparency */
      rationale: {
        symptomActive:   true,
        negationReason:  ds.reason || '',
        timeHints: {
          symptom:   timeSym,
          causeDrug: timeCause,
          treatDrug: timeTreat
        },
        explanation: rationaleLines.join(' ')
      }
    });
  });

  return signals;
}

/**
 * Cached wrapper around detectCascades().
 * Returns the cached result if the note hasn't changed; otherwise calls
 * detectCascades() and stores the result in state.detectedCascades.
 * Call invalidateDetectedCascades() to force a re-run.
 */
function getDetectedCascades(noteText) {
  if (!state.detectedCascades) {
    state.detectedCascades = detectCascades(noteText);
  }
  return state.detectedCascades;
}

function invalidateDetectedCascades() {
  state.detectedCascades = null;
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
 * Scan `noteText` for symptom terms defined in kb_symptoms.json.
 * Uses the same drugFoundInNote() whole-word match as extractDrugs().
 * Each symptom's `term` and `synonyms` are all tested; the first match wins.
 *
 * Results are also cached in state.symptomsDetected so other steps can
 * read them without re-running extraction.
 *
 * @param {string} noteText
 * @returns {Array<{id, term, matched_term, category, cascade_relevance}>}
 */
function extractSymptoms(noteText) {
  if (!noteText || !noteText.trim()) {
    state.symptomsDetected = [];
    return [];
  }

  var symptoms = (state.kb.symptomDictionary && state.kb.symptomDictionary.symptoms) || [];
  var detected = [];

  symptoms.forEach(function (sym) {
    var allTerms = [sym.term].concat(sym.synonyms || []);

    /* Find the first matching term AND its position in the note */
    var matchResult = null;
    var matchedTerm = null;
    for (var ti = 0; ti < allTerms.length; ti++) {
      var pos = findTermInNote(noteText, allTerms[ti]);
      if (pos) { matchResult = pos; matchedTerm = allTerms[ti]; break; }
    }
    if (!matchResult) return; /* term not in note at all */

    /* Negation / historical context check */
    var negCheck = isNegatedSymptom(noteText, matchResult.index, matchResult.length);

    detected.push({
      id:                sym.id,
      term:              sym.term,
      matched_term:      matchedTerm,
      category:          sym.category          || '',
      cascade_relevance: sym.cascade_relevance || '',
      /* NEW reliability fields */
      active:            !negCheck.negated,
      reason:            negCheck.reason,
      startIndex:        matchResult.index
    });
  });

  state.symptomsDetected = detected;
  invalidateDetectedCascades();
  return detected;
}

/**
 * Map an array of drug names to their canonical drug classes using the KB.
 *
 * Two-pass priority: index-drug roles are resolved first (a drug acting as a
 * cascade trigger is labelled with its index class), then cascade-drug roles
 * fill in any drug not yet mapped.  This ensures, e.g., that amlodipine is
 * labelled "Calcium channel blocker" (its index role in CC004) rather than
 * the less specific "Antihypertensive" it receives as a cascade drug in CC001.
 *
 * Handles both KB field-name variants:
 *   index_drug_classes  (array)  — kb_core_cascades.json
 *   index_drug_class    (string) — kb_vih_modifiers.json
 *
 * @param {string[]} drugs  Output of extractDrugs()
 * @returns {Array<{drug: string, class: string}>} One entry per input drug
 */
function normalizeDrugs(drugs) {
  if (!drugs || !drugs.length) return [];

  var drugToClass = {};   // key: drug.toLowerCase() → first canonical class string

  var allCascades = [].concat(
    (state.kb.coreCascades && state.kb.coreCascades.cascades) || [],
    (state.kb.vihModifiers && state.kb.vihModifiers.art_related_cascades) || []
  );

  /* Pass 1 — index drugs get priority (causal / trigger role) */
  allCascades.forEach(function (cascade) {
    /* index_drug_classes is an array in core cascades;
       index_drug_class   is a string  in VIH modifiers  */
    var idxArr = cascade.index_drug_classes ||
                 (cascade.index_drug_class ? [cascade.index_drug_class] : []);
    var idxClass = idxArr.length ? idxArr[0] : '';

    getIndexExamples(cascade).forEach(function (drug) {
      var key = drug.toLowerCase();
      if (!drugToClass[key] && idxClass) drugToClass[key] = idxClass;
    });
  });

  /* Pass 2 — cascade drugs fill in anything not yet mapped */
  allCascades.forEach(function (cascade) {
    var casClass = cascade.cascade_drug_class || '';

    getCascadeExamples(cascade).forEach(function (drug) {
      var key = drug.toLowerCase();
      if (!drugToClass[key] && casClass) drugToClass[key] = casClass;
    });
  });

  return drugs.map(function (drug) {
    return {
      drug:  drug,
      class: drugToClass[drug.toLowerCase()] || ''
    };
  });
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
   Step 5 — clinician classification handler
   Called via inline onclick: classifyCascade(id, value)
   value: 'confirmed' | 'possible' | 'not_cascade'
   ============================================================ */
window.classifyCascade = function (cascadeId, value) {
  if (state.cascadeClassifications[cascadeId] === value) {
    /* clicking the active button again clears it */
    delete state.cascadeClassifications[cascadeId];
  } else {
    state.cascadeClassifications[cascadeId] = value;
  }
  saveState();
  renderStepContent(5);
};

/* ============================================================
   Step content — each step renders a minimal placeholder so
   the wizard is navigable from day one; richer logic can be
   layered in later without touching this file's structure.
   ============================================================ */
const STEP_CONTENT = {
  1: {
    title: '&#128203; Paso 1 &mdash; Datos del caso',
    body: function () {
      var onboarding = '';
      if (!state.clinicalNote || !state.clinicalNote.trim()) {
        onboarding = (
          '<div class="onboarding-panel" id="onboarding-panel">' +
            '<div class="onboarding-header">' +
              '<span class="onboarding-icon">&#128301;</span>' +
              '<strong>C&oacute;mo funciona el auditor &mdash; en 3 pasos</strong>' +
            '</div>' +
            '<div class="onboarding-steps">' +
              '<div class="onboarding-step">' +
                '<span class="onboarding-step-num">1</span>' +
                '<div class="onboarding-step-body">' +
                  '<strong>Introduzca la nota cl&iacute;nica</strong>' +
                  '<p>Pegue la nota cl&iacute;nica seudonimizada del paciente. El auditor extraer&aacute; autom&aacute;ticamente los medicamentos y problemas activos.</p>' +
                '</div>' +
              '</div>' +
              '<div class="onboarding-step">' +
                '<span class="onboarding-step-num">2</span>' +
                '<div class="onboarding-step-body">' +
                  '<strong>El auditor detecta posibles cascadas</strong>' +
                  '<p>Cruza los f&aacute;rmacos con la base de conocimiento: identifica si alg&uacute;n medicamento puede ser consecuencia de un efecto adverso de otro.</p>' +
                '</div>' +
              '</div>' +
              '<div class="onboarding-step">' +
                '<span class="onboarding-step-num">3</span>' +
                '<div class="onboarding-step-body">' +
                  '<strong>Obtenga un plan farmacoterap&eacute;utico</strong>' +
                  '<p>Clasifique cada hallazgo, a&ntilde;ada sus notas cl&iacute;nicas y exporte un informe estructurado para el equipo asistencial.</p>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="onboarding-actions">' +
              '<span class="onboarding-hint">&#8594; Pruebe con el caso demo &mdash; un paciente VIH en TAR con antihipertensivo que genera edema tratado con diur&eacute;tico.</span>' +
              '<button class="btn btn-outline btn-sm" onclick="loadDemoCase()" type="button">&#9654; Probar demo</button>' +
            '</div>' +
          '</div>'
        );
      }
      return (
        onboarding +
        '<div class="form-group">' +
          '<label class="form-label" for="note-input">Nota cl&iacute;nica del caso / Clinical note</label>' +
          '<textarea id="note-input" class="textarea-clinical" ' +
            'placeholder="Pegue aqu&iacute; la nota cl&iacute;nica seudonimizada&hellip;">' +
            escHtml(state.clinicalNote) +
          '</textarea>' +
          '<div class="form-hint">Sin identificadores reales de paciente. Los datos permanecen &uacute;nicamente en este navegador.</div>' +
        '</div>'
      );
    },
    onMount: function (el) {
      var ta = el.querySelector('#note-input');
      if (ta) {
        ta.addEventListener('input', function () {
          state.clinicalNote = ta.value;
          invalidateDetectedCascades();
          saveState();
        });
      }
    }
  },
  2: {
    title: '&#128138; Paso 2 &mdash; Medicaci&oacute;n y problemas activos',
    body: function () {
      var kbReady = state.kb.coreCascades && state.kb.vihModifiers;
      if (!kbReady) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; Base de conocimiento no disponible.</strong> ' +
            'Compruebe el estado KB en el pie de p&aacute;gina y recargue si es necesario.' +
          '</div>'
        );
      }
      if (!state.clinicalNote || !state.clinicalNote.trim()) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; Nota cl&iacute;nica vac&iacute;a.</strong> ' +
            'Introduzca la nota cl&iacute;nica en el Paso 1 antes de continuar.' +
          '</div>'
        );
      }

      /* ── Drug extraction ── */
      var drugs      = extractDrugs(state.clinicalNote);
      var normalized = normalizeDrugs(drugs);
      var classLookup = {};
      normalized.forEach(function (n) { classLookup[n.drug.toLowerCase()] = n.class; });

      var drugSection;
      if (drugs.length === 0) {
        drugSection = (
          '<div class="callout callout-success">' +
            '<strong>&#10003; Sin medicamentos identificados.</strong> ' +
            'La nota puede usar nombres comerciales, abreviaturas o f&aacute;rmacos no incluidos en la KB actual.' +
          '</div>'
        );
      } else {
        var drugTags = drugs.map(function (d) {
          var cls = classLookup[d.toLowerCase()] || '';
          var clsLabel = cls
            ? '<span style="display:block;font-size:.68rem;opacity:.85;margin-top:.1rem;font-weight:400;">' +
                escHtml(cls) + '</span>'
            : '';
          return (
            '<span style="display:inline-block;background:#1a6b9a;color:#fff;border-radius:4px;' +
              'padding:.28rem .65rem;margin:.25rem .18rem;font-size:.84rem;font-weight:600;' +
              'vertical-align:top;line-height:1.3;">' +
              escHtml(d) + clsLabel +
            '</span>'
          );
        }).join('');
        drugSection = (
          '<div class="callout callout-info" style="margin-bottom:.7rem;">' +
            '<strong>' + drugs.length + ' medicamento' + (drugs.length === 1 ? '' : 's') +
            ' detectado' + (drugs.length === 1 ? '' : 's') + '</strong> en la nota cl&iacute;nica.' +
          '</div>' +
          '<div style="padding:.2rem 0 .65rem;">' + drugTags + '</div>'
        );
      }

      /* ── Symptom extraction — uses extractSymptoms() which also caches in state ── */
      var symptoms    = extractSymptoms(state.clinicalNote);
      saveState();   /* persist state.symptomsDetected */

      var symCountLabel;
      var symptomSection;
      if (!state.kb.symptomDictionary) {
        symCountLabel = 'Problemas detectados &mdash; <em style="color:#e67e22;font-style:normal;">diccionario no cargado</em>';
        symptomSection = (
          '<div class="callout callout-warning" style="font-size:.84rem;">' +
            '&#9888;&nbsp;<strong>Diccionario de s&iacute;ntomas no disponible.</strong> ' +
            'Recargue la p&aacute;gina o compruebe el estado KB.' +
          '</div>'
        );
      } else if (symptoms.length === 0) {
        symCountLabel = 'Problemas activos detectados (0)';
        symptomSection = (
          '<div class="callout callout-success">' +
            '&#10003;&nbsp;No se han detectado problemas cl&iacute;nicos en la nota.' +
          '</div>'
        );
      } else {
        /* Split into active vs non-active (negated / historical) */
        var activeSyms   = symptoms.filter(function (s) { return s.active !== false; });
        var inactiveSyms = symptoms.filter(function (s) { return s.active === false; });
        symCountLabel = 'Problemas detectados (' + activeSyms.length + ' activo' + (activeSyms.length === 1 ? '' : 's') +
          (inactiveSyms.length ? ', ' + inactiveSyms.length + ' no activo' + (inactiveSyms.length === 1 ? '' : 's') : '') + ')';

        /* Category → colour mapping */
        var catColor = {
          gastrointestinal: '#7d6608',
          anticholinergic:  '#6c3483',
          neurological:     '#154360',
          safety:           '#922b21',
          cardiovascular:   '#1a5276',
          urological:       '#145a32'
        };

        var renderSymTag = function (s, inactive) {
          var bg    = inactive ? '#bdc3c7' : (catColor[s.category] || '#555');
          var color = inactive ? '#555'    : '#fff';
          var label = escHtml(s.term);
          if (s.matched_term && s.matched_term.toLowerCase() !== s.term.toLowerCase()) {
            label += ' <span style="font-size:.72rem;opacity:.8;">(' + escHtml(s.matched_term) + ')</span>';
          }
          var catLabel = s.category
            ? '<span style="display:block;font-size:.67rem;opacity:.82;margin-top:.1rem;font-weight:400;">' +
                escHtml(s.category) + '</span>'
            : '';
          var negBadge = inactive
            ? '<span style="display:block;font-size:.63rem;font-weight:400;margin-top:.08rem;' +
                'color:#777;font-style:italic;">' +
                escHtml(s.reason || 'non-active') + '</span>'
            : '';
          return (
            '<span style="display:inline-block;background:' + bg + ';color:' + color + ';' +
              'border-radius:4px;padding:.28rem .65rem;margin:.25rem .18rem;font-size:.84rem;' +
              'font-weight:600;vertical-align:top;line-height:1.3;' +
              (inactive ? 'opacity:.7;' : '') +
              '" title="' + escHtml(s.cascade_relevance || '') + '">' +
              label + catLabel + negBadge +
            '</span>'
          );
        };

        var symTagsActive   = activeSyms.map(function (s) { return renderSymTag(s, false); }).join('');
        var symTagsInactive = inactiveSyms.map(function (s) { return renderSymTag(s, true); }).join('');

        var inactiveRow = inactiveSyms.length
          ? '<div style="margin-top:.45rem;">' +
              '<span style="font-size:.72rem;color:#aaa;font-style:italic;">Menciones no activas ' +
                '(negadas o hist&oacute;ricas):</span>' +
              symTagsInactive +
            '</div>'
          : '';

        symptomSection = (
          '<div style="padding:.2rem 0 .65rem;">' +
            (activeSyms.length ? symTagsActive : '<span style="font-size:.83rem;color:#888;">Ninguno</span>') +
            inactiveRow +
          '</div>'
        );
      }

      var divider = '<hr style="border:none;border-top:1px solid #eee;margin:.9rem 0;">';

      return (
        '<div style="font-size:.8rem;font-weight:700;text-transform:uppercase;' +
          'letter-spacing:.06em;color:#888;margin-bottom:.5rem;">Medicamentos detectados</div>' +
        drugSection +
        divider +
        '<div style="font-size:.8rem;font-weight:700;text-transform:uppercase;' +
          'letter-spacing:.06em;color:#888;margin-bottom:.5rem;">' + symCountLabel + '</div>' +
        symptomSection +
        '<div class="callout callout-warning" style="margin-top:.75rem;font-size:.83rem;">' +
          '&#9888;&nbsp;La detecci&oacute;n es por palabras clave. Nombres comerciales, abreviaturas y t&eacute;rminos no incluidos en la KB pueden no identificarse.' +
        '</div>'
      );
    }
  },
  3: {
    title: '&#128230; Paso 3 &mdash; Clasificaci&oacute;n farmacol&oacute;gica',
    body: function () {
      var kbReady = state.kb.coreCascades && state.kb.vihModifiers;
      if (!kbReady) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; Base de conocimiento no disponible.</strong> ' +
            'Compruebe el estado KB en el pie de p&aacute;gina y recargue si es necesario.' +
          '</div>'
        );
      }
      if (!state.clinicalNote || !state.clinicalNote.trim()) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; Nota cl&iacute;nica vac&iacute;a.</strong> ' +
            'Introduzca la nota cl&iacute;nica en el Paso 1 antes de continuar.' +
          '</div>'
        );
      }

      var drugs      = extractDrugs(state.clinicalNote);
      var normalized = normalizeDrugs(drugs);

      if (drugs.length === 0) {
        return (
          '<div class="callout callout-success">' +
            '<strong>&#10003; Sin medicamentos a clasificar.</strong> ' +
            'No se detectaron medicamentos en la nota cl&iacute;nica (Paso 2).' +
          '</div>'
        );
      }

      var mappedCount   = normalized.filter(function (n) { return n.class; }).length;
      var unmappedCount = normalized.length - mappedCount;

      var rows = normalized.map(function (n) {
        var classCell = n.class
          ? '<span style="display:inline-block;background:#1e8449;color:#fff;border-radius:3px;' +
              'padding:.18rem .55rem;font-size:.82rem;font-weight:600;">' + escHtml(n.class) + '</span>'
          : '<span style="color:#999;font-size:.82rem;font-style:italic;">sin clasificar</span>';
        return (
          '<tr style="border-bottom:1px solid #eef1f4;">' +
            '<td style="padding:.45rem .6rem;font-size:.88rem;font-weight:600;white-space:nowrap;">' +
              escHtml(n.drug) +
            '</td>' +
            '<td style="padding:.45rem .4rem;color:#666;font-size:.82rem;text-align:center;">' +
              '&rarr;' +
            '</td>' +
            '<td style="padding:.45rem .6rem;">' + classCell + '</td>' +
          '</tr>'
        );
      }).join('');

      return (
        '<div class="callout callout-info" style="margin-bottom:.85rem;">' +
          '<strong>' + drugs.length + ' medicamento' + (drugs.length === 1 ? '' : 's') +
          ' &rarr; ' + mappedCount + ' grupo' + (mappedCount === 1 ? '' : 's') + ' farmacol&oacute;gico' + (mappedCount === 1 ? '' : 's') + ' identificado' + (mappedCount === 1 ? '' : 's') +
          (unmappedCount ? ', ' + unmappedCount + ' sin clasificar' : '') + '.</strong>' +
        '</div>' +
        '<div style="overflow-x:auto;">' +
          '<table style="width:100%;border-collapse:collapse;font-size:.88rem;' +
            'border:1px solid #d0d7de;border-radius:5px;background:#fff;">' +
            '<thead>' +
              '<tr style="background:#f6f8fa;border-bottom:2px solid #d0d7de;">' +
                '<th style="padding:.45rem .6rem;text-align:left;font-size:.8rem;' +
                  'color:#57606a;font-weight:600;text-transform:uppercase;letter-spacing:.04em;">Medicamento</th>' +
                '<th style="padding:.45rem .4rem;width:2rem;"></th>' +
                '<th style="padding:.45rem .6rem;text-align:left;font-size:.8rem;' +
                  'color:#57606a;font-weight:600;text-transform:uppercase;letter-spacing:.04em;">Grupo farmacol&oacute;gico</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>'
      );
    }
  },
  4: {
    title: '&#128269; Paso 4 &mdash; Posibles cascadas terap&eacute;uticas',
    body: function () {
      var kbReady = state.kb.coreCascades && state.kb.vihModifiers && state.kb.ddiWatchlist;
      if (!kbReady) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; Base de conocimiento no disponible.</strong> ' +
            'Compruebe el estado KB en el pie de p&aacute;gina y recargue si es necesario.' +
          '</div>'
        );
      }

      if (!state.clinicalNote || !state.clinicalNote.trim()) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; Nota cl&iacute;nica vac&iacute;a.</strong> ' +
            'Introduzca la nota cl&iacute;nica en el Paso 1 antes de continuar.' +
          '</div>'
        );
      }

      var cCount = (state.kb.coreCascades.cascades || []).length;
      var vCount = (state.kb.vihModifiers.art_related_cascades || []).length;
      var dCount = (state.kb.ddiWatchlist.interactions || []).length;

      var kbInfo = (
        '<div class="callout callout-info">' +
          '<strong>Base de conocimiento lista.</strong> ' +
          cCount + ' patrones de cascada &middot; ' +
          vCount + ' modificadores VIH &middot; ' +
          dCount + ' interacciones DDI.' +
        '</div>'
      );

      var detected = getDetectedCascades(state.clinicalNote);

      if (detected.length === 0) {
        return (
          kbInfo +
          '<div class="callout callout-success" style="margin-top:.75rem;">' +
            '<strong>&#10003; Sin se&ntilde;ales de cascada detectadas.</strong> ' +
            'No se han identificado patrones de cascada terap&eacute;utica en la nota cl&iacute;nica.' +
          '</div>'
        );
      }

      /* --- Badge helpers ------------------------------------------ */
      var confidenceBadge = function (conf) {
        var color = conf === 'high' ? '#27ae60' : conf === 'medium' ? '#e67e22' : '#7f8c8d';
        return (
          '<span style="font-size:.7rem;font-weight:700;color:#fff;background:' + color + ';' +
            'padding:.1rem .4rem;border-radius:3px;vertical-align:middle;margin-left:.4rem;' +
            'text-transform:uppercase;letter-spacing:.03em;">' +
            escHtml(conf) +
          '</span>'
        );
      };

      var appropriatenessBadge = function (val) {
        if (!val) return '';
        var label = val === 'often_inappropriate' ? 'often inappropriate'
                  : val === 'often_appropriate'   ? 'often appropriate'
                  : 'context-dependent';
        var color = val === 'often_inappropriate' ? '#c0392b'
                  : val === 'often_appropriate'   ? '#1e8449'
                  : '#7f8c8d';
        return (
          '<span style="font-size:.68rem;font-weight:600;color:' + color + ';' +
            'border:1px solid ' + color + ';border-radius:3px;padding:.08rem .38rem;' +
            'margin-left:.4rem;vertical-align:middle;white-space:nowrap;">' +
            escHtml(label) +
          '</span>'
        );
      };

      /* --- Signal cards ------------------------------------------- */
      var rows = detected.map(function (c) {
        /* Cascade chain: index drug → [ADE] → cascade drug */
        var adeLabel = c.ade_en
          ? '&nbsp;<span style="font-size:.78rem;color:#7f8c8d;font-style:italic;">' +
              '[' + escHtml(c.ade_en) + ']</span>&nbsp;'
          : '&nbsp;&rarr;&nbsp;';
        var chain = (
          '<div style="margin:.6rem 0 0;font-size:.9rem;display:flex;align-items:center;' +
            'flex-wrap:wrap;gap:.2rem;">' +
            '<span style="background:#eaf4fb;border:1px solid #aed6f1;border-radius:4px;' +
              'padding:.18rem .55rem;font-weight:700;font-size:.85rem;">' +
              escHtml(c.index_drug) +
            '</span>' +
            '<span style="color:#95a5a6;font-size:.8rem;">&rarr;</span>' +
            '<span style="background:#fef9e7;border:1px solid #f9e79f;border-radius:4px;' +
              'padding:.18rem .55rem;font-size:.82rem;color:#7d6608;">' +
              escHtml(c.ade_en || 'ADE') +
            '</span>' +
            '<span style="color:#95a5a6;font-size:.8rem;">&rarr;</span>' +
            '<span style="background:#eafaf1;border:1px solid #a9dfbf;border-radius:4px;' +
              'padding:.18rem .55rem;font-weight:700;font-size:.85rem;">' +
              escHtml(c.cascade_drug) +
            '</span>' +
          '</div>'
        );

        /* Risk focus chips */
        var riskTags = c.risk_focus.length
          ? '<div style="margin-top:.5rem;display:flex;flex-wrap:wrap;gap:.25rem;align-items:center;">' +
              '<span style="font-size:.72rem;color:#888;">Riesgo:</span>' +
              c.risk_focus.map(function (r) {
                return '<span style="font-size:.72rem;background:#f0f0f0;border-radius:3px;' +
                  'padding:.08rem .38rem;color:#555;">' + escHtml(r) + '</span>';
              }).join('') +
            '</div>'
          : '';

        /* DDI warning — red alert box */
        var ddiBox = c.ddi_warning
          ? '<div style="margin-top:.55rem;font-size:.83rem;color:#922b21;' +
              'border-left:3px solid #e74c3c;padding:.35rem .65rem;background:#fdedec;' +
              'border-radius:0 3px 3px 0;">' +
              '<strong>&#9888; Alerta de interacci&oacute;n:</strong>&nbsp;' + escHtml(c.ddi_warning) +
            '</div>'
          : '';

        /* Clinical hint — blue note box */
        var hintBox = c.clinical_hint
          ? '<div style="margin-top:.45rem;font-size:.83rem;color:#1a5276;' +
              'border-left:3px solid #2980b9;padding:.35rem .65rem;background:#eaf4fb;' +
              'border-radius:0 3px 3px 0;">' +
              '<strong>&#128203; Acci&oacute;n clínica:</strong>&nbsp;' + escHtml(c.clinical_hint) +
            '</div>'
          : '';

        /* Rationale box (symptom-bridge only) — grey/olive tint */
        var rationaleBox = '';
        if (c.rationale && c.rationale.explanation) {
          rationaleBox = (
            '<div style="margin-top:.42rem;font-size:.78rem;color:#5d6d7e;' +
              'border-left:3px solid #aab7b8;padding:.3rem .6rem;background:#f4f6f7;' +
              'border-radius:0 3px 3px 0;">' +
              '<strong>&#128269; Motivo de detecci&oacute;n:</strong>&nbsp;' +
              escHtml(c.rationale.explanation) +
            '</div>'
          );
        }

        return (
          '<div style="border:1px solid #d0d7de;border-radius:6px;padding:.85rem 1rem;' +
            'margin-bottom:.8rem;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.05);">' +

            /* Header row: name + badges + ID */
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;' +
              'flex-wrap:wrap;gap:.4rem;">' +
              '<span style="font-size:.92rem;font-weight:700;line-height:1.35;">' +
                escHtml(c.cascade_name) +
                confidenceBadge(c.confidence) +
                appropriatenessBadge(c.appropriateness) +
                (c.signal_type === 'symptom_bridge'
                  ? '<span style="font-size:.65rem;font-weight:600;color:#6c3483;' +
                      'border:1px solid #a569bd;border-radius:3px;padding:.08rem .38rem;' +
                      'margin-left:.4rem;vertical-align:middle;white-space:nowrap;">v&iacute;a s&iacute;ntoma</span>'
                  : '') +
              '</span>' +
              '<code style="font-size:.76rem;color:#aaa;white-space:nowrap;">' +
                escHtml(c.cascade_id) +
              '</code>' +
            '</div>' +

            chain + riskTags + ddiBox + hintBox + rationaleBox +
          '</div>'
        );
      });

      return (
        kbInfo +
        '<div style="margin-top:1rem;">' +
          '<h3 style="margin:0 0 .7rem;font-size:.97rem;color:#2c3e50;">' +
            '&#128204;&nbsp;' + detected.length +
            (detected.length === 1 ? ' posible cascada terap&eacute;utica detectada' : ' posibles cascadas terap&eacute;uticas detectadas') +
          '</h3>' +
          rows.join('') +
        '</div>' +
        '<div class="callout callout-warning" style="margin-top:.75rem;font-size:.84rem;">' +
          '&#9888;&nbsp;Solo para revisi&oacute;n farmac&eacute;utica y cl&iacute;nica. No sustituye el juicio cl&iacute;nico profesional.' +
        '</div>'
      );
    }
  },
  5: {
    title: '&#128221; Paso 5 &mdash; Verificaci&oacute;n cl&iacute;nica',
    body: function () {
      var kbReady = state.kb.coreCascades && state.kb.vihModifiers && state.kb.ddiWatchlist;
      if (!kbReady) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; Base de conocimiento no disponible.</strong> ' +
            'Compruebe el estado KB en el pie de p&aacute;gina y recargue si es necesario.' +
          '</div>'
        );
      }
      if (!state.clinicalNote || !state.clinicalNote.trim()) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; Nota cl&iacute;nica vac&iacute;a.</strong> ' +
            'Introduzca la nota cl&iacute;nica en el Paso 1 antes de continuar.' +
          '</div>'
        );
      }

      var detected = getDetectedCascades(state.clinicalNote);

      if (detected.length === 0) {
        return (
          '<div class="callout callout-success">' +
            '<strong>&#10003; Sin se&ntilde;ales de cascada.</strong> ' +
            'No se identificaron patrones de cascada terap&eacute;utica &mdash; no se requiere plan de actuaci&oacute;n.' +
          '</div>'
        );
      }

      /* ── Classification tally banner ── */
      var cls = state.cascadeClassifications;
      var nConfirmed  = detected.filter(function (c) { return cls[c.cascade_id] === 'confirmed';   }).length;
      var nPossible   = detected.filter(function (c) { return cls[c.cascade_id] === 'possible';    }).length;
      var nNot        = detected.filter(function (c) { return cls[c.cascade_id] === 'not_cascade'; }).length;
      var nUnreviewed = detected.length - nConfirmed - nPossible - nNot;

      var tallyHtml = (
        '<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:1rem;' +
          'padding:.65rem .9rem;background:#f8f9fa;border:1px solid #e0e0e0;border-radius:6px;' +
          'font-size:.83rem;align-items:center;">' +
          '<span style="color:#555;font-weight:600;margin-right:.2rem;">Revisi&oacute;n cl&iacute;nica:</span>' +
          '<span style="background:#1e8449;color:#fff;border-radius:4px;padding:.1rem .45rem;font-weight:700;">' +
            nConfirmed + ' confirmada' + (nConfirmed === 1 ? '' : 's') + '</span>' +
          '<span style="background:#e67e22;color:#fff;border-radius:4px;padding:.1rem .45rem;font-weight:700;">' +
            nPossible + ' posible' + (nPossible === 1 ? '' : 's') + '</span>' +
          '<span style="background:#7f8c8d;color:#fff;border-radius:4px;padding:.1rem .45rem;font-weight:700;">' +
            nNot + ' descartada' + (nNot === 1 ? '' : 's') + '</span>' +
          (nUnreviewed > 0
            ? '<span style="color:#888;margin-left:.15rem;">' + nUnreviewed + ' sin revisar</span>'
            : '<span style="color:#1e8449;margin-left:.15rem;">&#10003; Todas revisadas</span>') +
        '</div>'
      );

      /* ── Per-cascade detail cards ── */
      var rows = detected.map(function (c) {
        var entry       = findCascadeEntry(c.cascade_id);
        var recAction   = entry ? (entry.recommended_first_action_en || '') : '';
        var clinNote    = entry ? (entry.clinical_note_en            || '') : '';
        var ddiWarning  = entry ? (entry.ddi_warning_en              || '') : '';
        var diffHints   = (entry && Array.isArray(entry.differential_hints) && entry.differential_hints.length)
                          ? entry.differential_hints : [];

        /* Use the richer field; for core it's recAction, for VIH it's clinNote */
        var actionText  = recAction || clinNote;

        /* Confidence badge */
        var confColor   = c.confidence === 'high' ? '#27ae60' : c.confidence === 'medium' ? '#e67e22' : '#7f8c8d';
        var confBadge   = (
          '<span style="font-size:.7rem;font-weight:700;color:#fff;background:' + confColor + ';' +
            'padding:.1rem .4rem;border-radius:3px;vertical-align:middle;margin-left:.4rem;' +
            'text-transform:uppercase;">' + escHtml(c.confidence) + '</span>'
        );

        /* Cascade chain pill row */
        var chain = (
          '<div style="margin:.6rem 0;display:flex;align-items:center;flex-wrap:wrap;gap:.25rem;">' +
            '<span style="background:#eaf4fb;border:1px solid #aed6f1;border-radius:4px;' +
              'padding:.2rem .6rem;font-weight:700;font-size:.85rem;">' +
              escHtml(c.index_drug) + '</span>' +
            '<span style="color:#aaa;font-size:.8rem;">&rarr;</span>' +
            (c.ade_en
              ? '<span style="background:#fef9e7;border:1px solid #f9e79f;border-radius:4px;' +
                  'padding:.2rem .6rem;font-size:.82rem;color:#7d6608;">' +
                  escHtml(c.ade_en) + '</span>' +
                '<span style="color:#aaa;font-size:.8rem;">&rarr;</span>'
              : '') +
            '<span style="background:#eafaf1;border:1px solid #a9dfbf;border-radius:4px;' +
              'padding:.2rem .6rem;font-weight:700;font-size:.85rem;">' +
              escHtml(c.cascade_drug) + '</span>' +
          '</div>'
        );

        /* DDI warning */
        var ddiHtml = ddiWarning
          ? '<div style="background:#fdedec;border-left:3px solid #e74c3c;padding:.4rem .7rem;' +
              'margin-top:.45rem;font-size:.82rem;color:#922b21;border-radius:0 3px 3px 0;">' +
              '<strong>&#9888; Alerta de interacci&oacute;n:</strong>&nbsp;' + escHtml(ddiWarning) +
            '</div>'
          : '';

        /* Recommended action */
        var actionHtml = actionText
          ? '<div style="background:#eaf4fb;border-left:3px solid #2980b9;padding:.4rem .7rem;' +
              'margin-top:.45rem;font-size:.82rem;color:#1a5276;border-radius:0 3px 3px 0;">' +
              '<strong>&#128203; Acci&oacute;n recomendada:</strong>&nbsp;' + escHtml(actionText) +
            '</div>'
          : '';

        /* Differential hints */
        var diffHtml = diffHints.length
          ? '<div style="margin-top:.45rem;font-size:.81rem;color:#555;">' +
              '<strong>&#128270; Considerar tambi&eacute;n:</strong>&nbsp;' +
              escHtml(diffHints.join(' &bull; ')) +
            '</div>'
          : '';

        /* Classification buttons */
        var current = cls[c.cascade_id] || '';
        var id      = escHtml(c.cascade_id);   /* safe for HTML attr; IDs are alphanumeric */

        function classBtn(value, label, activeColor, activeText) {
          var isActive = current === value;
          return (
            '<button onclick="classifyCascade(\'' + id + '\',\'' + value + '\')" ' +
              'style="font-size:.78rem;padding:.28rem .75rem;border-radius:4px;cursor:pointer;' +
                'font-weight:' + (isActive ? '700' : '500') + ';' +
                'background:' + (isActive ? activeColor : '#f0f0f0') + ';' +
                'color:'      + (isActive ? activeText  : '#444')    + ';' +
                'border:1px solid ' + (isActive ? activeColor : '#ccc') + ';' +
                'transition:background .15s;">' +
              label +
            '</button>'
          );
        }

        var classButtons = (
          '<div style="display:flex;gap:.45rem;margin-top:.7rem;flex-wrap:wrap;align-items:center;">' +
            '<span style="font-size:.78rem;color:#888;margin-right:.1rem;">Clasificar:</span>' +
            classBtn('confirmed',   '&#10003;&nbsp;Cascada confirmada', '#1e8449', '#fff') +
            classBtn('possible',    '&#63;&nbsp;Cascada posible',       '#e67e22', '#fff') +
            classBtn('not_cascade', '&#10005;&nbsp;Descartar',          '#7f8c8d', '#fff') +
          '</div>'
        );

        /* Card border colour based on classification */
        var borderColor = current === 'confirmed'  ? '#1e8449'
                        : current === 'possible'   ? '#e67e22'
                        : current === 'not_cascade'? '#bdc3c7'
                        : '#d0d7de';

        return (
          '<div style="border:2px solid ' + borderColor + ';border-radius:6px;padding:.9rem 1rem;' +
            'margin-bottom:.85rem;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.05);">' +

            /* Header */
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;' +
              'flex-wrap:wrap;gap:.35rem;">' +
              '<span style="font-size:.93rem;font-weight:700;">' +
                escHtml(c.cascade_name) + confBadge +
              '</span>' +
              '<code style="font-size:.75rem;color:#aaa;">' + escHtml(c.cascade_id) + '</code>' +
            '</div>' +

            chain + ddiHtml + actionHtml + diffHtml + classButtons +
          '</div>'
        );
      });

      return (
        '<div class="callout callout-warning" style="margin-bottom:.85rem;font-size:.84rem;">' +
          '&#9888;&nbsp;Revise cada se&ntilde;al y clasif&iacute;quela. Para uso farmac&eacute;utico y cl&iacute;nico exclusivamente.' +
        '</div>' +
        tallyHtml +
        rows.join('')
      );
    }
  },
  6: {
    title: '&#128196; Paso 6 &mdash; Plan farmacoterap&eacute;utico e informe',
    body: function () {
      var kbReady = state.kb.coreCascades && state.kb.vihModifiers && state.kb.ddiWatchlist;
      if (!kbReady) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; Base de conocimiento no disponible.</strong> ' +
            'Compruebe el estado KB en el pie de p&aacute;gina y recargue si es necesario.' +
          '</div>'
        );
      }
      if (!state.clinicalNote || !state.clinicalNote.trim()) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>&#9888; Nota cl&iacute;nica vac&iacute;a.</strong> ' +
            'Introduzca la nota cl&iacute;nica en el Paso 1 para generar el informe.' +
          '</div>'
        );
      }

      var r   = buildReport();
      var now = r.generated_at.replace('T', ' ').split('.')[0] + ' UTC';

      /* ── Section helper ── */
      function section(title, content) {
        return (
          '<div style="margin-bottom:1.1rem;">' +
            '<div style="font-size:.78rem;font-weight:700;text-transform:uppercase;' +
              'letter-spacing:.06em;color:#888;border-bottom:1px solid #eee;' +
              'padding-bottom:.3rem;margin-bottom:.55rem;">' + title + '</div>' +
            content +
          '</div>'
        );
      }

      /* ── Drug chips ── */
      function chips(arr, bg, border, color) {
        if (!arr.length) return '<em style="color:#aaa;font-size:.85rem;">Ninguno detectado</em>';
        return arr.map(function (d) {
          return (
            '<span style="display:inline-block;background:' + bg + ';border:1px solid ' + border + ';' +
              'border-radius:4px;padding:.18rem .55rem;font-size:.82rem;color:' + color + ';' +
              'margin:.18rem .2rem .18rem 0;">' + escHtml(d) + '</span>'
          );
        }).join('');
      }

      /* ── Verification status badge ── */
      function verBadge(status) {
        var map = {
          confirmed:   { bg: '#1e8449', fg: '#fff', label: 'Confirmada'    },
          possible:    { bg: '#e67e22', fg: '#fff', label: 'Posible'       },
          not_cascade: { bg: '#bdc3c7', fg: '#555', label: 'Descartada'    },
          unreviewed:  { bg: '#f0f0f0', fg: '#888', label: 'Sin revisar'   }
        };
        var s = map[status] || map.unreviewed;
        return (
          '<span style="font-size:.72rem;font-weight:700;background:' + s.bg + ';color:' + s.fg + ';' +
            'border-radius:3px;padding:.1rem .42rem;white-space:nowrap;">' +
            escHtml(s.label) + '</span>'
        );
      }

      /* ── Clinical summary ── */
      var summary = r.clinical_summary || {
        total_cascades: r.cascade_count,
        high_priority_cascades: 0,
        top_interventions: [],
        validation_warning: 'Este informe requiere validación clínica-farmacéutica.'
      };

      function priorityBadge(priority) {
        var map = {
          'Alta prioridad': { bg: '#b71c1c', fg: '#fff' },
          'Prioridad intermedia': { bg: '#ef6c00', fg: '#fff' },
          'Baja prioridad': { bg: '#546e7a', fg: '#fff' }
        };
        var p = map[priority] || map['Baja prioridad'];
        return '<span style="font-size:.74rem;font-weight:700;background:' + p.bg + ';color:' + p.fg + ';' +
          'border-radius:4px;padding:.16rem .5rem;white-space:nowrap;">' + escHtml(priority) + '</span>';
      }

      function confidenceBadge(conf) {
        return '<span style="font-size:.74rem;font-weight:700;color:#fff;border-radius:4px;padding:.16rem .5rem;' +
          'background:' + (conf === 'high' ? '#1e8449' : conf === 'medium' ? '#e67e22' : '#7f8c8d') + ';">' + escHtml(conf) + '</span>';
      }

      var cascadeContent;
      if (r.cascades.length === 0) {
        cascadeContent = (
          '<p style="color:#1e8449;font-size:.88rem;margin:.2rem 0;">' +
            '&#10003;&nbsp;Sin se&ntilde;ales de cascada terap&eacute;utica detectadas.' +
          '</p>'
        );
      } else {
        function levelBadge(c) {
          var map = {
            plausible_cascade: { bg: '#1e8449', fg: '#fff' },
            preliminary_signal: { bg: '#7f8c8d', fg: '#fff' }
          };
          var s = map[c.finding_level] || map.preliminary_signal;
          return '<span style="font-size:.72rem;font-weight:700;background:' + s.bg + ';color:' + s.fg + ';border-radius:4px;padding:.14rem .45rem;">' + escHtml(c.finding_label || 'Señal') + '</span>';
        }

        function renderCards(items) {
          return items.map(function (c) {
            var factorsInFavor = (c.factors_in_favor || []).map(function (it) { return '<li>' + escHtml(it) + '</li>'; }).join('');
            var factorsToVerify = (c.factors_to_verify || []).map(function (it) { return '<li>' + escHtml(it) + '</li>'; }).join('');
            return (
              '<div style="border:1px solid #d0d7de;border-radius:6px;padding:.9rem 1rem;margin:.75rem 0;background:#fff;">' +
                '<div style="display:flex;justify-content:space-between;gap:.45rem;align-items:flex-start;flex-wrap:wrap;">' +
                  '<div>' +
                    '<div style="font-weight:700;color:#2c3e50;">' + escHtml(c.cascade_name) + '</div>' +
                    '<div style="font-size:.75rem;color:#8a8a8a;margin-top:.2rem;">ID t&eacute;cnico: ' + escHtml(c.cascade_id) + '</div>' +
                  '</div>' +
                  '<div style="display:flex;gap:.35rem;flex-wrap:wrap;">' +
                    levelBadge(c) + priorityBadge(c.pharmacy_priority) + confidenceBadge(c.confidence) + verBadge(c.verification_status) +
                  '</div>' +
                '</div>' +
                '<div style="margin-top:.55rem;font-size:.83rem;"><strong>Secuencia farmacol&oacute;gica:</strong> ' + escHtml(c.sequence) + '</div>' +
                '<div style="margin-top:.35rem;font-size:.82rem;"><strong>Qué lo apoya:</strong> ' + escHtml(c.support_summary || '—') + '</div>' +
                '<div style="margin-top:.3rem;font-size:.82rem;"><strong>Qué falta:</strong> ' + escHtml(c.missing_summary || '—') + '</div>' +
                '<div style="margin-top:.3rem;font-size:.82rem;"><strong>Nivel asignado:</strong> ' + escHtml(c.level_reason || '—') + '</div>' +
                '<div style="margin-top:.4rem;font-size:.83rem;"><strong>Interpretaci&oacute;n cl&iacute;nica:</strong> ' + escHtml(c.clinical_interpretation || '—') + '</div>' +
                '<div style="margin-top:.4rem;font-size:.83rem;"><strong>Se&ntilde;al activadora:</strong> ' + escHtml(c.trigger_explanation || '—') + '</div>' +
                '<div style="margin-top:.45rem;font-size:.82rem;">' +
                  '<strong>Factores a favor</strong><ul style="margin:.28rem 0 .2rem 1rem;">' + factorsInFavor + '</ul>' +
                '</div>' +
                '<div style="margin-top:.32rem;font-size:.82rem;">' +
                  '<strong>Factores a verificar</strong><ul style="margin:.28rem 0 .2rem 1rem;">' + factorsToVerify + '</ul>' +
                '</div>' +
                '<div style="margin-top:.45rem;font-size:.83rem;color:#1a5276;"><strong>Intervenci&oacute;n farmac&eacute;utica sugerida:</strong> ' +
                  escHtml(c.suggested_intervention || c.clinical_recommendation || '—') + '</div>' +
                '<div style="margin-top:.35rem;font-size:.8rem;color:#666;"><strong>Qu&eacute; falta para mayor certeza:</strong> ' + escHtml(c.certainty_gap || '—') + '</div>' +
              '</div>'
            );
          }).join('');
        }

        var plausible = r.cascades.filter(function (c) { return c.finding_level === 'plausible_cascade'; });
        var preliminary = r.cascades.filter(function (c) { return c.finding_level === 'preliminary_signal'; });
        cascadeContent =
          '<div style="margin-bottom:.8rem;"><strong>1) Cascadas terap&eacute;uticas plausibles (' + plausible.length + ')</strong></div>' +
          (plausible.length ? renderCards(plausible) : '<p style="font-size:.82rem;color:#7f8c8d;">Sin cascadas plausibles en esta nota.</p>') +
          '<div style="margin:.9rem 0 .8rem;"><strong>2) Se&ntilde;ales farmacol&oacute;gicas preliminares (' + preliminary.length + ')</strong></div>' +
          (preliminary.length ? renderCards(preliminary) : '<p style="font-size:.82rem;color:#7f8c8d;">Sin señales preliminares activas.</p>');
      }

      var summaryInterventions = (summary.top_interventions || []).length
        ? '<ul style="margin:.35rem 0 0 1rem;">' +
            summary.top_interventions.map(function (it) { return '<li>' + escHtml(it) + '</li>'; }).join('') +
          '</ul>'
        : '<p style="margin:.35rem 0 0;color:#6b7280;font-size:.82rem;">No hay intervenciones dominantes con los datos actuales.</p>';
      /* ── Export buttons ── */
      var exportRow = (
        '<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1rem;">' +
          '<button onclick="copyReportForClinicalRecord()" ' +
            'style="font-size:.82rem;padding:.35rem .85rem;border-radius:4px;cursor:pointer;' +
              'background:#34495e;color:#fff;border:none;font-weight:600;">' +
            '&#128203;&nbsp;Copiar para historia cl&iacute;nica' +
          '</button>' +
          '<button onclick="printReportAsPDF()" ' +
            'style="font-size:.82rem;padding:.35rem .85rem;border-radius:4px;cursor:pointer;' +
              'background:#8e44ad;color:#fff;border:none;font-weight:600;">' +
            '&#128438;&nbsp;Guardar como PDF' +
          '</button>' +
          '<button onclick="exportReport(\'json\')" ' +
            'style="font-size:.82rem;padding:.35rem .85rem;border-radius:4px;cursor:pointer;' +
              'background:#2c3e50;color:#fff;border:none;font-weight:600;">' +
            '&#8681;&nbsp;Exportar JSON' +
          '</button>' +
          '<button onclick="exportReport(\'csv\')" ' +
            'style="font-size:.82rem;padding:.35rem .85rem;border-radius:4px;cursor:pointer;' +
              'background:#1a7a4a;color:#fff;border:none;font-weight:600;">' +
            '&#8681;&nbsp;Exportar CSV' +
          '</button>' +
        '</div>'
      );

      return (
        '<div style="background:#fff;border:1px solid #d0d7de;border-radius:6px;' +
          'padding:1.15rem 1.3rem;">' +

          '<h3 style="margin:0 0 1rem;font-size:1rem;color:#2c3e50;">' +
            '&#128196;&nbsp;Informe de Auditor&iacute;a de Cascadas Terap&eacute;uticas' +
          '</h3>' +

          section('Datos del caso y auditor&iacute;a',
            '<table style="font-size:.87rem;border-collapse:collapse;width:auto;">' +
              '<tr><td style="padding:.28rem .5rem .28rem 0;color:#666;padding-right:1.5rem;">ID de paciente</td>' +
                  '<td style="padding:.28rem 0;font-weight:700;">' +
                    (r.patient_id ? escHtml(r.patient_id) : '<em style="color:#bbb;">No establecido</em>') +
                  '</td></tr>' +
              '<tr><td style="padding:.28rem .5rem .28rem 0;color:#666;padding-right:1.5rem;">Generado</td>' +
                  '<td style="padding:.28rem 0;">' + escHtml(now) + '</td></tr>' +
              '<tr><td style="padding:.28rem .5rem .28rem 0;color:#666;padding-right:1.5rem;">Versi&oacute;n KB</td>' +
                  '<td style="padding:.28rem 0;">' +
                    escHtml(r.kb_version) + '&nbsp;<span style="color:#bbb;font-size:.8rem;">(' + escHtml(r.kb_mode) + ')</span>' +
                  '</td></tr>' +
            '</table>'
          ) +

          section('Medicamentos detectados (' + r.drugs_detected.length + ')',
            (r.drugs_detected.length
              ? '<ul style="margin:.2rem 0 .2rem 1rem;font-size:.84rem;">' + r.drugs_detected.map(function (d) { return '<li>' + escHtml(d) + '</li>'; }).join('') + '</ul>'
              : '<em style="color:#aaa;font-size:.85rem;">Ninguno detectado</em>') +
            (r.diagnostics && r.diagnostics.inferredDrugsFromCascades
              ? '<p style="margin:.4rem 0 0;font-size:.75rem;color:#7f8c8d;">' +
                  '&#9432;&nbsp;' + r.diagnostics.inferredDrugCount + ' medicamento(s) inferido(s) a partir de las cascadas detectadas.' +
                '</p>'
              : '')
          ) +

          section('Grupos farmacol&oacute;gicos (' + r.drug_classes.length + ')',
            (r.drug_classes.length
              ? '<ul style="margin:.2rem 0 .2rem 1rem;font-size:.84rem;">' + r.drug_classes.map(function (g) { return '<li>' + escHtml(g) + '</li>'; }).join('') + '</ul>'
              : '<em style="color:#aaa;font-size:.85rem;">No clasificados</em>')
          ) +

          section('Resumen cl&iacute;nico',
            '<div style="font-size:.84rem;line-height:1.45;">' +
              '<div><strong>Total de hallazgos detectados:</strong> ' + summary.total_cascades + '</div>' +
              '<div><strong>Cascadas de alta prioridad:</strong> ' + summary.high_priority_cascades + '</div>' +
              '<div style="margin-top:.4rem;"><strong>Principales intervenciones sugeridas:</strong></div>' +
              summaryInterventions +
              '<div class="callout callout-warning" style="margin-top:.5rem;font-size:.8rem;">&#9888;&nbsp;' + escHtml(summary.validation_warning) + '</div>' +
            '</div>'
          ) +

          section('Hallazgos farmacoterap&eacute;uticos (' + r.cascade_count + ')', cascadeContent) +

          '<div class="callout callout-warning" style="margin-top:.85rem;font-size:.82rem;">' +
            '&#9888;&nbsp;Solo apoyo a la decisi&oacute;n cl&iacute;nica. No es un producto sanitario (MDR). ' +
            'No utilizar con identificadores reales de pacientes fuera de un contexto de investigaci&oacute;n seudonimizado.' +
          '</div>' +

          exportRow +
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
  if (next)    next.innerHTML = step === 6 ? '&#10003; Finalizar' : 'Siguiente &#8594;';
  if (counter) counter.textContent = 'Paso ' + step + ' de 6';
}

/* ============================================================
   Top-bar buttons
   ============================================================ */

/* Export JSON — serialises current state to a downloadable file */
function exportJSON() {
  try {
    var payload = {
      exportedAt: new Date().toISOString(),
      patientId: state.patientId,
      clinicalNote: state.clinicalNote,
      step: state.step,
      cascadeClassifications: state.cascadeClassifications
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
    showToast('Case exported successfully.', 'success');
  } catch (err) {
    console.error('[Export] exportJSON failed:', err);
    showToast('Export failed: ' + (err.message || 'unknown error'), 'error');
  }
}

/* ── reconcileDrugsWithCascades ────────────────────────────────────────────
 * Merges cascade index_drug / cascade_drug into the drugs array so that
 * drugs_detected can never be empty while cascades are shown.
 *
 * Why: extractDrugs() scans the note against KB example lists; the cascade
 * engine can match drugs via symptom-bridge or Spanish INN variants that
 * extractDrugs() misses.  This function is the single authoritative fix.
 *
 * Contract:
 *   - Returns a new string[] (original array not mutated).
 *   - Deduplication is case-insensitive; original casing is preserved.
 *   - Only index_drug and cascade_drug are used; ADE/symptom terms are never
 *     added (they live in detectedCascades[*].ade_en, not the drug fields).
 *   - detectedCascades entries with falsy drug fields are silently skipped.
 * ──────────────────────────────────────────────────────────────────────── */
function reconcileDrugsWithCascades(drugs, detectedCascades) {
  var result = drugs.slice();               /* copy — never mutate input */
  var seen   = {};
  result.forEach(function (d) { seen[d.toLowerCase()] = true; });

  (detectedCascades || []).forEach(function (c) {
    [c.index_drug, c.cascade_drug].forEach(function (drug) {
      if (!drug || typeof drug !== 'string') return;
      var key = drug.trim().toLowerCase();
      if (key && !seen[key]) {
        result.push(drug.trim());
        seen[key] = true;
      }
    });
  });

  return result;
}

function confidenceRank(conf) {
  return conf === 'high' ? 3 : conf === 'medium' ? 2 : 1;
}

function priorityRank(priority) {
  return priority === 'alta' ? 3 : priority === 'intermedia' ? 2 : 1;
}

function hasText(value) {
  return !!(value && String(value).trim());
}

function detectDrugPairTemporality(noteText, signal) {
  if (!hasText(noteText) || !signal) {
    return { status: 'unknown', detail: 'Sin datos temporales suficientes.' };
  }

  var idxPos = signal.index_drug ? findTermInNote(noteText, signal.index_drug) : null;
  var casPos = signal.cascade_drug ? findTermInNote(noteText, signal.cascade_drug) : null;
  if (!idxPos && !casPos) {
    return { status: 'unknown', detail: 'Sin pista temporal alrededor de los fármacos detectados.' };
  }

  var idxCue = idxPos ? detectTimeCues(noteText, idxPos.index) : {};
  var casCue = casPos ? detectTimeCues(noteText, casPos.index) : {};
  var supportive = !!(idxCue.drugStartHint || casCue.treatmentAddedHint || idxCue.treatmentAddedHint);
  var chronic = !!(idxCue.chronicHint || casCue.chronicHint);

  if (supportive) return { status: 'supportive', detail: 'Temporalidad compatible (inicio/cambio terapéutico detectado).' };
  if (chronic) return { status: 'weak', detail: 'Temporalidad débil por posible uso crónico/preexistente.' };
  return { status: 'unknown', detail: 'Temporalidad no demostrada en la nota.' };
}

function buildEvidenceProfile(signal, recommendationText, noteText) {
  var supports = [];
  var missing = [];
  var temporality = detectDrugPairTemporality(noteText, signal);
  var symptomMatch = false;
  var explicitKbIntervention = hasText(recommendationText) || signal.appropriateness === 'often_inappropriate';
  var explicitEvidence = hasText(signal.ddi_warning);

  if (signal.signal_type === 'symptom_bridge') {
    supports.push('Síntoma compatible detectado en la nota.');
  } else {
    var matchedSymptoms = (state.symptomsDetected || []).filter(function (s) {
      return hasText(signal.ade_en) && s && hasText(s.term) && s.term.toLowerCase() === signal.ade_en.toLowerCase();
    });
    symptomMatch = matchedSymptoms.length > 0;
    if (symptomMatch) supports.push('ADE/síntoma compatible detectado (' + signal.ade_en + ').');
  }

  if (temporality.status === 'supportive') supports.push(temporality.detail);
  else missing.push(temporality.detail);

  if (explicitKbIntervention) supports.push('KB aporta una recomendación/intervención clínica.');
  if (explicitEvidence) supports.push('Existe evidencia farmacológica explícita en KB (p. ej., alerta DDI).');

  var noteDrivenSupport = symptomMatch || temporality.status === 'supportive' || explicitEvidence;
  var hasClinicalSupport = signal.signal_type === 'symptom_bridge' || noteDrivenSupport;
  if (signal.signal_type === 'drug_drug' && !hasClinicalSupport) {
    missing.push('Falta soporte clínico adicional para elevarla a cascada plausible.');
  }

  return {
    level: signal.signal_type === 'drug_drug' && !hasClinicalSupport ? 'preliminary_signal' : 'plausible_cascade',
    label: signal.signal_type === 'drug_drug' && !hasClinicalSupport ? 'Señal farmacológica preliminar' : 'Cascada terapéutica plausible',
    levelReason: signal.signal_type === 'drug_drug' && !hasClinicalSupport
      ? 'Permanece preliminar: co-ocurrencia farmacológica sin soporte clínico suficiente.'
      : 'Clasificada como plausible por soporte clínico detectable.',
    supports: supports,
    missing: missing,
    hasClinicalSupport: hasClinicalSupport,
    temporality: temporality
  };
}

function derivePharmacyPriority(signal, recommendationText, evidence) {
  var score = 0;
  var reasons = [];

  var confScore = confidenceRank(signal.confidence);
  score += confScore;
  reasons.push('Probabilidad ' + (signal.confidence || 'low') + '.');

  var specificityScore = signal.signal_type === 'symptom_bridge' ? 2 : 1;
  if (signal.signal_type === 'drug_drug' && hasText(signal.ade_en)) specificityScore += 1;
  score += specificityScore;
  reasons.push(
    signal.signal_type === 'symptom_bridge'
      ? 'Puente sintomático con evidencia clínica directa.'
      : 'Señal farmacológica de especificidad variable.'
  );

  var hasClearIntervention = !!(recommendationText && recommendationText.trim()) ||
    signal.appropriateness === 'often_inappropriate';
  if (hasClearIntervention) {
    score += 1;
    reasons.push('Existe intervención farmacéutica accionable.');
  } else {
    reasons.push('Intervención menos definida con los datos actuales.');
  }

  if (evidence) {
    if (!evidence.hasClinicalSupport) {
      score -= 2;
      reasons.push('Penalización: señal sin soporte clínico adicional.');
    }
    if (evidence.temporality.status === 'supportive') {
      score += 1;
      reasons.push('Temporalidad compatible suma prioridad.');
    } else if (evidence.temporality.status === 'weak') {
      score -= 1;
      reasons.push('Temporalidad débil reduce prioridad.');
    } else {
      score -= 1;
      reasons.push('Sin soporte temporal claro: prioridad penalizada.');
    }
  }

  if (score >= 6) return { level: 'alta', label: 'Alta prioridad', score: score, reasons: reasons };
  if (score >= 4) return { level: 'intermedia', label: 'Prioridad intermedia', score: score, reasons: reasons };
  return { level: 'baja', label: 'Baja prioridad', score: score, reasons: reasons };
}

function buildVerificationItems(signal) {
  var items = [
    'Cronología clínica precisa: inicio del fármaco índice, aparición del síntoma/EAM e inicio del fármaco de cascada.',
    'Indicación primaria del fármaco de cascada: confirmar si fue prescrito para tratar el posible EAM y no por una enfermedad independiente.',
    'Evolución tras ajustes terapéuticos (dechallenge/rechallenge cuando sea clínicamente seguro).'
  ];

  if (signal.signal_type === 'symptom_bridge') {
    items.push('Validar si el síntoma estaba activo (no negado) y su gravedad actual en la entrevista clínica.');
  }

  if (!signal.ade_en) {
    items.push('Falta EAM explícito en la nota: revisar historia clínica para documentar manifestación adversa concreta.');
  }

  return items;
}

function buildSignalExplanation(signal) {
  if (signal.signal_type === 'symptom_bridge') {
    var temporal = signal.rationale && signal.rationale.explanation
      ? ' ' + signal.rationale.explanation
      : ' Temporalidad incompleta en el texto actual.';
    return 'Se activó por coincidencia de fármaco causal + síntoma detectado + fármaco usado para tratar ese síntoma.' + temporal;
  }

  return 'Se activó por presencia simultánea de fármaco índice y fármaco de cascada compatibles con el patrón de la KB.';
}

function buildClinicalInterpretation(signal, entry) {
  if (entry && entry.clinical_note_en) return entry.clinical_note_en;
  if (signal.clinical_hint) return signal.clinical_hint;
  return 'Posible cascada terapéutica a confirmar con revisión clínica individualizada.';
}

/* ── buildReport ──────────────────────────────────────────────────────────
   Assembles the full structured report object.
   Used by the Step 6 display, JSON export, and CSV export so that all
   three surfaces always show identical data.
   ──────────────────────────────────────────────────────────────────────── */
function buildReport() {
  var drugs      = extractDrugs(state.clinicalNote);
  var detected   = getDetectedCascades(state.clinicalNote);

  /* Reconcile before normalization so drug_classes also cover cascade drugs */
  var reconciledDrugs = reconcileDrugsWithCascades(drugs, detected);
  var inferredCount   = reconciledDrugs.length - drugs.length;
  var normalized      = normalizeDrugs(reconciledDrugs);

  /* Unique drug classes, preserving first-seen order */
  var uniqueClasses = [];
  var _seenCls = {};
  normalized.forEach(function (n) {
    if (n.class && !_seenCls[n.class]) { _seenCls[n.class] = true; uniqueClasses.push(n.class); }
  });

  var cascades = detected.map(function (c) {
    var entry = findCascadeEntry(c.cascade_id);
    var rec   = entry
      ? (entry.recommended_first_action_en || entry.clinical_note_en || '')
      : (c.clinical_hint || '');
    var evidence = buildEvidenceProfile(c, rec, state.clinicalNote);
    var priority = derivePharmacyPriority(c, rec, evidence);
    var clinicalInterpretation = buildClinicalInterpretation(c, entry);
    var factorsInFavor = [
      'Secuencia detectada: ' + c.index_drug + ' → ' + (c.ade_en || 'posible EAM') + ' → ' + c.cascade_drug + '.',
      buildSignalExplanation(c)
    ].concat(priority.reasons, evidence.supports);

    return {
      cascade_id:              c.cascade_id,
      cascade_name:            c.cascade_name,
      index_drug:              c.index_drug,
      cascade_drug:            c.cascade_drug,
      confidence:              c.confidence,
      ade_en:                  c.ade_en  || '',
      clinical_recommendation: rec,
      verification_status:     state.cascadeClassifications[c.cascade_id] || 'unreviewed',
      sequence:                c.index_drug + ' → ' + (c.ade_en || 'EAM potencial') + ' → ' + c.cascade_drug,
      clinical_interpretation: clinicalInterpretation,
      factors_in_favor:        factorsInFavor,
      factors_to_verify:       buildVerificationItems(c).concat(evidence.missing),
      suggested_intervention:  rec || 'No hay intervención específica en KB; revisar indicación, balance beneficio-riesgo y alternativas.',
      pharmacy_priority:       priority.label,
      pharmacy_priority_level: priority.level,
      trigger_explanation:     buildSignalExplanation(c),
      certainty_gap:           'Para aumentar certeza: confirmar temporalidad, causalidad alternativa y respuesta tras ajustes terapéuticos.',
      finding_level:           evidence.level,
      finding_label:           evidence.label,
      support_summary:         evidence.supports.length ? evidence.supports.join(' | ') : 'Sin apoyo clínico adicional detectado.',
      missing_summary:         evidence.missing.length ? evidence.missing.join(' | ') : 'Sin brechas críticas detectadas.',
      level_reason:            evidence.levelReason,
      temporal_support:        evidence.temporality.status
    };
  });

  cascades.sort(function (a, b) {
    var aLevel = a.finding_level === 'plausible_cascade' ? 1 : 0;
    var bLevel = b.finding_level === 'plausible_cascade' ? 1 : 0;
    if (bLevel !== aLevel) return bLevel - aLevel;
    var byPriority = priorityRank(b.pharmacy_priority_level) - priorityRank(a.pharmacy_priority_level);
    if (byPriority !== 0) return byPriority;
    return confidenceRank(b.confidence) - confidenceRank(a.confidence);
  });

  var highPriorityCount = cascades.filter(function (c) { return c.pharmacy_priority_level === 'alta'; }).length;
  var topInterventions = [];
  var seenInterventions = {};
  cascades.forEach(function (c) {
    var key = (c.suggested_intervention || '').trim().toLowerCase();
    if (!key || seenInterventions[key]) return;
    seenInterventions[key] = true;
    topInterventions.push(c.suggested_intervention);
  });

  return {
    patient_id:         state.patientId || '',
    generated_at:       new Date().toISOString(),
    kb_version:         getKBVersion(),
    kb_mode:            state.kbMode,
    drugs_detected:     reconciledDrugs,
    drug_classes:       uniqueClasses,
    diagnostics: {
      inferredDrugsFromCascades: inferredCount > 0,
      inferredDrugCount:         inferredCount
    },
    symptoms_detected:  state.symptomsDetected.map(function (s) {
      return { id: s.id, term: s.term, matched_term: s.matched_term, category: s.category };
    }),
    cascade_count:      detected.length,
    cascades:           cascades,
    clinical_summary: {
      total_cascades: detected.length,
      high_priority_cascades: highPriorityCount,
      top_interventions: topInterventions.slice(0, 3),
      validation_warning: 'Este informe requiere validación clínica-farmacéutica antes de cualquier cambio terapéutico.'
    }
  };
}

function formatReportForClinicalRecord(report) {
  var lines = [];
  lines.push('INFORME FARMACOTERAPÉUTICO — AUDITORÍA DE CASCADAS');
  lines.push('Paciente: ' + (report.patient_id || 'No establecido'));
  lines.push('Fecha informe: ' + report.generated_at);
  lines.push('KB: ' + report.kb_mode + (report.kb_version ? ' v' + report.kb_version : ''));
  lines.push('');
  lines.push('Resumen:');
  lines.push('- Cascadas detectadas: ' + report.cascade_count);
  lines.push('- Medicamentos detectados: ' + (report.drugs_detected.join(', ') || 'Ninguno'));
  lines.push('- Grupos farmacológicos: ' + (report.drug_classes.join(', ') || 'No clasificados'));
  lines.push('');

  if (!report.cascades.length) {
    lines.push('No se han detectado cascadas terapéuticas con los datos actuales.');
  } else {
    lines.push('Cascadas terapéuticas:');
    report.cascades.forEach(function (c, idx) {
      lines.push((idx + 1) + '. ' + c.cascade_name + ' [' + c.cascade_id + ']');
      lines.push('   - Secuencia: ' + c.sequence);
      lines.push('   - Estado de verificación: ' + c.verification_status);
      lines.push('   - Prioridad: ' + c.pharmacy_priority);
      lines.push('   - Recomendación: ' + (c.suggested_intervention || c.clinical_recommendation || 'Sin recomendación específica'));
    });
  }

  lines.push('');
  lines.push('Advertencia: Requiere validación clínica-farmacéutica antes de cualquier cambio terapéutico.');
  return lines.join('\n');
}

function copyTextToClipboard(text) {
  if (!text) return Promise.reject(new Error('No text to copy.'));

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text);
  }

  return new Promise(function (resolve, reject) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    try {
      var ok = document.execCommand('copy');
      document.body.removeChild(area);
      if (!ok) return reject(new Error('Clipboard copy command was rejected.'));
      resolve();
    } catch (err) {
      document.body.removeChild(area);
      reject(err);
    }
  });
}

window.copyReportForClinicalRecord = function () {
  var report;
  try {
    report = buildReport();
  } catch (err) {
    console.error('[Report] buildReport failed for clipboard export:', err);
    showToast('No se pudo generar el informe para copiar.', 'error');
    return;
  }

  copyTextToClipboard(formatReportForClinicalRecord(report))
    .then(function () {
      showToast('Informe copiado al portapapeles.', 'success');
    })
    .catch(function (err) {
      console.error('[Clipboard] Could not copy report:', err);
      showToast('No se pudo copiar automáticamente. Use Exportar JSON/CSV o Guardar como PDF.', 'error');
    });
};

window.printReportAsPDF = function () {
  showToast('Use "Guardar como PDF" en el diálogo de impresión.', 'success');
  window.print();
};

/* ── exportReport ─────────────────────────────────────────────────────────
   Inline export buttons in Step 6 call: exportReport('json') / ('csv')
   ──────────────────────────────────────────────────────────────────────── */
window.exportReport = function (format) {
  var report, filename;
  try {
    report   = buildReport();
    filename = 'cascade-report-' + (report.patient_id || 'case') + '-' + isoDate();
  } catch (err) {
    console.error('[Export] buildReport failed:', err);
    showToast('Could not generate report: ' + (err.message || 'unknown error'), 'error');
    return;
  }
  var blob, mime;

  if (format === 'csv') {
    /* One row per cascade; header + data rows */
    var csvCols = [
      'patient_id', 'generated_at', 'kb_version',
      'cascade_id', 'cascade_name',
      'index_drug', 'cascade_drug', 'confidence', 'ade_en',
      'clinical_recommendation', 'verification_status', 'finding_level', 'temporal_support'
    ];
    /* RFC 4180 cell quoting: wrap in " and double any inner " */
    function csvCell(v) {
      var s = v === null || v === undefined ? '' : String(v);
      return '"' + s.replace(/"/g, '""') + '"';
    }
    var rows = [csvCols.join(',')];
    if (report.cascades.length === 0) {
      /* Single data row indicating no cascades */
      rows.push([
        csvCell(report.patient_id), csvCell(report.generated_at), csvCell(report.kb_version),
        csvCell(''), csvCell('Sin cascadas detectadas'),
        csvCell(''), csvCell(''), csvCell(''), csvCell(''),
        csvCell(''), csvCell(''), csvCell(''), csvCell('')
      ].join(','));
    } else {
      report.cascades.forEach(function (c) {
        rows.push([
          csvCell(report.patient_id),
          csvCell(report.generated_at),
          csvCell(report.kb_version),
          csvCell(c.cascade_id),
          csvCell(c.cascade_name),
          csvCell(c.index_drug),
          csvCell(c.cascade_drug),
          csvCell(c.confidence),
          csvCell(c.ade_en),
          csvCell(c.clinical_recommendation),
          csvCell(c.verification_status),
          csvCell(c.finding_level),
          csvCell(c.temporal_support)
        ].join(','));
      });
    }
    blob = new Blob([rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    mime = 'text/csv';
    filename += '.csv';
  } else {
    blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    mime = 'application/json';
    filename += '.json';
  }

  try {
    var url = URL.createObjectURL(blob);
    var a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast('Report exported (' + (format || 'json').toUpperCase() + ').', 'success');
  } catch (err) {
    console.error('[Export] exportReport download failed:', err);
    showToast('Export failed: ' + (err.message || 'unknown error'), 'error');
  }
};

/* Import Case — reads a previously exported JSON and restores state */
function importCase(file) {
  if (!file) return;

  /* Basic file type guard — only accept files with .json extension or application/json MIME */
  if (file.type && file.type !== 'application/json' && !file.name.endsWith('.json')) {
    showToast('Import failed: file must be a .json export from this application.', 'error');
    return;
  }

  var reader = new FileReader();
  reader.onload = function (e) {
    try {
      var raw = e.target && e.target.result;
      if (!raw) throw new Error('File appears to be empty.');

      var data = JSON.parse(raw);
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new Error('File does not contain a valid JSON object.');
      }

      /* Restore fields with strict type guards to prevent state corruption */
      var imported = 0;
      if (typeof data.patientId === 'string' && data.patientId.length <= 200) {
        state.patientId = data.patientId;
        imported++;
      }
      if (typeof data.clinicalNote === 'string') {
        state.clinicalNote = data.clinicalNote;
        imported++;
      }
      /* Validate step is a safe integer in range */
      if (Number.isInteger(data.step) && data.step >= 1 && data.step <= 6) {
        state.step = data.step;
        imported++;
      } else if (data.step !== undefined) {
        /* Step present but invalid — reset to 1 rather than leaving a bad value */
        state.step = 1;
      }
      /* Restore cascade classifications if present */
      if (data.cascadeClassifications && typeof data.cascadeClassifications === 'object' &&
          !Array.isArray(data.cascadeClassifications)) {
        state.cascadeClassifications = data.cascadeClassifications;
        imported++;
      }

      if (imported === 0) {
        throw new Error('No recognizable case data found in this file. Make sure it was exported by this application.');
      }

      /* Reset derived state that depends on the imported note */
      state.symptomsDetected = [];
      state.detectedCascades = null;

      var pidEl = document.getElementById('patient-id');
      if (pidEl) pidEl.value = state.patientId;

      saveState();
      goTo(state.step);
      showToast('Case imported successfully.', 'success');
    } catch (err) {
      console.error('[Import] Could not parse imported file:', err);
      showToast('Import failed: ' + (err.message || 'invalid file'), 'error');
    }
  };
  reader.onerror = function () {
    console.error('[Import] FileReader error while reading import file.');
    showToast('Could not read the selected file.', 'error');
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

/* New Case — resets state and starts from step 1 */
function newCase() {
  if (state.clinicalNote && !confirm('Start a new case? Unsaved data will be lost.')) return;
  clearState();
  var pidEl = document.getElementById('patient-id');
  if (pidEl) pidEl.value = '';
  goTo(1);
}

/* Load Demo Case — populates a sample clinical note for demonstration.
 * Scenario: PLHIV on ART + amlodipine (antihypertensive) → ankle oedema
 * → furosemide (diuretic) prescribed = classic CCB→oedema→diuretic cascade (CC004).
 * Also includes ibuprofen PRN → hypertension context (CC001). */
function loadDemoCase() {
  if (state.clinicalNote && !confirm('¿Cargar el caso demo? Los datos actuales serán reemplazados.')) return;
  clearState();
  state.patientId = 'DEMO-001';
  state.clinicalNote = [
    'NOTA CLÍNICA — CASO PSEUDONIMIZADO (DEMO)',
    'Paciente ID: DEMO-001 | Fecha: 2024-03-15 | Servicio: VIH / Enfermedades Infecciosas',
    '',
    '=== RESUMEN DEL PACIENTE ===',
    'Varón de 58 años, persona que vive con el VIH (PVVIH) desde 2010.',
    'TAR estable: darunavir/cobicistat/emtricitabina/tenofovir alafenamida (Symtuza) desde 2019.',
    'CD4: 620 células/μL (ene 2024). Carga viral: indetectable (<50 copias/mL, ene 2024).',
    '',
    '=== COMORBILIDADES Y MEDICACIÓN ACTIVA ===',
    '1. Hipertensión arterial — amlodipine 5mg/día (desde jul 2021)',
    '2. Edema bilateral de tobillos — nuevo inicio sep 2022.',
    '   Tratado con furosemide 40mg/día desde feb 2023 (derivación a cardiología).',
    '   Ecocardiograma normal (nov 2022).',
    '3. Dislipemia — atorvastatin 20mg/noche (desde jun 2021)',
    '4. Diabetes mellitus tipo 2 — metformin 1g/12h (desde ene 2024; era 500mg/12h desde jun 2023)',
    '5. Artrosis lumbar crónica — ibuprofen 600mg/8h a demanda (último ciclo feb 2024, 5 días)',
    '6. Insomnio — zolpidem 5mg nocturno (desde abr 2023)',
    '',
    '=== SÍNTOMAS ACTUALES ===',
    '- Edema maleolar bilateral, con fóvea, moderado. Inicio sep 2022. Peor al final del día.',
    '  Sin disnea ni ortopnea. Eco normal.',
    '- Insomnio de inicio: dificultad para conciliar el sueño desde mar 2023.',
    '- Poliuria/polidipsia leve desde may 2023.',
    '',
    '=== ANALÍTICA (ene 2024) ===',
    'Creatinina: 98 μmol/L, FGe: 72 mL/min/1,73m². Potasio: 3,5 mmol/L (límite bajo).',
    'Colesterol total: 5,1 mmol/L. TG: 2,8 mmol/L (↑). CK: 180 UI/L.',
    'ALT: 28 UI/L. HbA1c: 6,9%.',
    '',
    '=== NOTAS DEL CLÍNICO ===',
    'Paciente con polimedicación creciente. Preocupa posible cascada de prescripción:',
    '¿es el edema de tobillo un efecto adverso del amlodipine tratado con furosemide?',
    '¿Podría reducirse o suspenderse el diurético si se modifica el antihipertensivo?',
    'Solicita revisión farmacoterapéutica completa e informe de cascadas.'
  ].join('\n');
  state.step = 1;
  saveState();
  var pidEl = document.getElementById('patient-id');
  if (pidEl) pidEl.value = state.patientId;
  goTo(1);
  showToast('Caso demo cargado — avance por los pasos para ver las cascadas detectadas.', 'info');
}

/* ============================================================
   NLP SELF-TESTS  (call runNlpSelfTest() from browser console)
   ============================================================ */
window.runNlpSelfTest = function () {
  var PASS = 0; var FAIL = 0;

  function assert(label, got, expected) {
    var ok = got === expected;
    console[ok ? 'log' : 'warn'](
      (ok ? '  PASS' : '  FAIL') + ' | ' + label +
      (ok ? '' : '  (got=' + JSON.stringify(got) + ' want=' + JSON.stringify(expected) + ')')
    );
    ok ? PASS++ : FAIL++;
  }

  /* Helper: run extractSymptoms on a scratch note without touching state */
  function probeSymptoms(note) {
    var savedNote   = state.clinicalNote;
    var savedSym    = state.symptomsDetected;
    var savedCache  = state.detectedCascades;
    state.clinicalNote    = note;
    state.symptomsDetected = [];
    var result = extractSymptoms(note);
    state.clinicalNote    = savedNote;
    state.symptomsDetected = savedSym;
    state.detectedCascades = savedCache;
    return result;
  }

  /* Helper: run detectSymptomCascades on a scratch note */
  function probeCascades(note) {
    var savedNote  = state.clinicalNote;
    var savedSym   = state.symptomsDetected;
    var savedCache = state.detectedCascades;
    state.clinicalNote     = note;
    state.symptomsDetected = [];
    state.detectedCascades = null;
    var syms = extractSymptoms(note);
    var sigs = detectSymptomCascades(note);
    state.clinicalNote     = savedNote;
    state.symptomsDetected = savedSym;
    state.detectedCascades = savedCache;
    return { syms: syms, sigs: sigs };
  }

  console.group('runNlpSelfTest — NLP reliability layer');

  /* ── Negation tests ── */
  console.group('A. Negation / historical');

  var t1 = probeSymptoms('Patient denies constipation and diarrhoea.');
  var t1c = t1.find(function (s) { return s.term === 'constipation'; });
  assert('T1: "denies constipation" → active=false',
         t1c ? t1c.active : null, false);

  var t2 = probeSymptoms('Constipation resolved on prior admission.');
  var t2c = t2.find(function (s) { return s.term === 'constipation'; });
  assert('T2: "constipation resolved" → active=false',
         t2c ? t2c.active : null, false);

  var t3 = probeSymptoms('History of constipation. No current complaint.');
  var t3c = t3.find(function (s) { return s.term === 'constipation'; });
  assert('T3: "history of constipation" → active=false',
         t3c ? t3c.active : null, false);

  var t6 = probeSymptoms('No urinary retention noted today.');
  var t6c = t6.find(function (s) { return s.term === 'urinary retention'; });
  assert('T6: "no urinary retention" → active=false',
         t6c ? t6c.active : null, false);

  var t8 = probeSymptoms('No falls reported since last visit.');
  var t8c = t8.find(function (s) { return s.term === 'falls'; });
  assert('T8: "no falls" → active=false',
         t8c ? t8c.active : null, false);

  console.groupEnd();

  /* ── Active detection tests ── */
  console.group('B. Active symptom detection');

  var t7 = probeSymptoms('Patient reports dry mouth and fatigue.');
  var t7c = t7.find(function (s) { return s.term === 'dry mouth'; });
  assert('T7: "dry mouth" → active=true',
         t7c ? t7c.active : null, true);

  console.groupEnd();

  /* ── Cascade firing tests ── */
  console.group('C. Cascade detection with temporality');

  var t4 = probeCascades(
    'After starting oxybutynin patient developed constipation. Lactulose was added.'
  );
  var t4s = t4.sigs.find(function (s) { return s.ade_en === 'constipation'; });
  assert('T4: oxybutynin→constipation→lactulose fires', !!t4s, true);
  assert('T4: confidence is high (supportive temporality)',
         t4s ? t4s.confidence : null, 'high');

  var t5 = probeCascades(
    'Chronic constipation on long-term lactulose. Started oxybutynin for incontinence.'
  );
  var t5s = t5.sigs.find(function (s) { return s.ade_en === 'constipation'; });
  /* Should either not fire OR fire with low confidence */
  if (!t5s) {
    assert('T5: chronic constipation+lactulose → no cascade (suppressed)', true, true);
  } else {
    assert('T5: chronic constipation+lactulose → low confidence',
           t5s.confidence, 'low');
  }

  /* Additional: amlodipine oedema furosemide */
  var tA = probeCascades(
    'New onset oedema noted after amlodipine was started. Furosemide prescribed.'
  );
  var tAs = tA.sigs.find(function (s) { return s.ade_en === 'oedema' || s.ade_en === 'peripheral oedema'; });
  assert('TA: amlodipine→oedema→furosemide fires', !!tAs, true);

  console.groupEnd();

  /* ── Spanish assertions ── */
  console.group('D. Spanish — negation / historical');

  var es1 = probeSymptoms('Niega estreñimiento. No caídas.');
  var es1con = es1.find(function (s) { return s.term === 'constipation'; });
  var es1fal = es1.find(function (s) { return s.term === 'falls'; });
  assert('ES1: "Niega estreñimiento" → constipation active=false',
         es1con ? es1con.active : null, false);
  assert('ES1: "No caídas" → falls active=false',
         es1fal ? es1fal.active : null, false);

  var es2 = probeSymptoms('Estreñimiento desde hace 2 semanas.');
  var es2c = es2.find(function (s) { return s.term === 'constipation'; });
  assert('ES2: "Estreñimiento desde hace 2 semanas" → active=true',
         es2c ? es2c.active : null, true);

  var es3 = probeSymptoms('Estreñimiento resuelto tras el alta.');
  var es3c = es3.find(function (s) { return s.term === 'constipation'; });
  assert('ES3: "Estreñimiento resuelto" → active=false',
         es3c ? es3c.active : null, false);

  var es4 = probeSymptoms('Antecedentes de estreñimiento en infancia.');
  var es4c = es4.find(function (s) { return s.term === 'constipation'; });
  assert('ES4: "Antecedentes de estreñimiento" → active=false',
         es4c ? es4c.active : null, false);

  console.groupEnd();

  console.group('E. Spanish — cascade detection with temporality');

  var es5 = probeCascades(
    'Tras iniciar oxibutinina el paciente presenta estreñimiento. Se pauta lactulosa.'
  );
  var es5s = es5.sigs.find(function (s) { return s.ade_en === 'constipation'; });
  assert('ES5: oxibutinina→estreñimiento→lactulosa fires', !!es5s, true);
  assert('ES5: confidence is high or medium (supportive temporality)',
         es5s ? (es5s.confidence === 'high' || es5s.confidence === 'medium') : null, true);

  var es6 = probeCascades(
    'Estreñimiento crónico con lactulosa desde hace años. Inicia oxibutinina para incontinencia.'
  );
  var es6s = es6.sigs.find(function (s) { return s.ade_en === 'constipation'; });
  if (!es6s) {
    assert('ES6: chronic ES estreñimiento+lactulosa → no cascade (suppressed)', true, true);
  } else {
    assert('ES6: chronic ES estreñimiento+lactulosa → low confidence',
           es6s.confidence, 'low');
  }

  console.groupEnd();

  /* ── Group F: strict/operational split, non-mutation, richer report ──── */
  console.group('F — Bilingual strict/operational + fallback report');
  (function () {
    /* Factory — each test gets a fresh source so mutations never bleed across */
    function makeMinimalKB() {
      return {
        version: '0.0.1-test',
        cascades: [
          {
            id: 'CC_T1',
            name_en: 'Drug A \u2192 ADE A \u2192 Treatment A',
            index_drug_classes: ['ClassA'],
            index_drug_examples: ['druga'],
            ade_en: 'Adverse effect alpha',
            cascade_drug_examples: ['treatmenta'],
            confidence: 'high', age_sensitivity: 'low',
            risk_focus: ['metabolic'],
            differential_hints: ['hint1','hint2','hint3'],
            appropriateness: 'context_dependent'
          },
          {
            id: 'CC_T2',
            name_en: 'Drug B \u2192 ADE B \u2192 Treatment B',
            /* name_es present, ade_es missing — partial translation */
            name_es: 'Fármaco B \u2192 EAM B \u2192 Tratamiento B',
            index_drug_classes: ['ClassB'],
            index_drug_examples: ['drugb'],
            ade_en: 'Adverse effect beta',
            cascade_drug_examples: ['treatmentb'],
            confidence: 'medium', age_sensitivity: 'medium',
            risk_focus: ['cardiovascular'],
            differential_hints: ['hint1','hint2','hint3'],
            appropriateness: 'often_appropriate'
          }
        ]
      };
    }

    if (typeof validateKBStrict !== 'function' || typeof validateKBOperational !== 'function') {
      assert('F0: validateKBStrict + validateKBOperational available', false, true);
      return;
    }

    /* F1 — strict fails when *_es missing */
    var strictR = validateKBStrict(makeMinimalKB());
    assert('F1: strict.ok = false (missing name_es/ade_es)', strictR.ok, false);
    assert('F1: strict errors mention _es fields',
      strictR.errors.some(function(e){ return /name_es|ade_es/.test(e); }), true);

    /* F2 — operational passes; richer fallback report */
    var opR = validateKBOperational(makeMinimalKB());
    assert('F2: operational.ok = true', opR.ok, true);
    /* CC_T1 needs both name_es + ade_es; CC_T2 already has name_es, needs only ade_es */
    assert('F2: fallbackCascadeCount = 2', opR.fallbackCascadeCount, 2);
    assert('F2: fallbackFieldCount = 3',   opR.fallbackFieldCount,   3);
    assert('F2: fallbackByField.name_es = 1 (only CC_T1 missing it)',
      opR.fallbackByField && opR.fallbackByField['name_es'], 1);
    assert('F2: fallbackByField.ade_es = 2 (both cascades missing it)',
      opR.fallbackByField && opR.fallbackByField['ade_es'], 2);
    assert('F2: fallbackByFieldIds.ade_es includes CC_T1',
      opR.fallbackByFieldIds && opR.fallbackByFieldIds['ade_es'] &&
      opR.fallbackByFieldIds['ade_es'].indexOf('CC_T1') !== -1, true);
    assert('F2: fallbackByFieldIds.ade_es includes CC_T2',
      opR.fallbackByFieldIds && opR.fallbackByFieldIds['ade_es'] &&
      opR.fallbackByFieldIds['ade_es'].indexOf('CC_T2') !== -1, true);

    /* F3 — non-mutating: source unchanged after operational */
    var srcKb = makeMinimalKB();
    validateKBOperational(srcKb);
    assert('F3: source name_es not filled', srcKb.cascades[0].name_es, undefined);
    assert('F3: source __i18n not set',     srcKb.cascades[0].__i18n,  undefined);

    /* F4 — idempotent: two calls on same source give identical results */
    var iKb = makeMinimalKB();
    var r4a = validateKBOperational(iKb);
    var r4b = validateKBOperational(iKb);
    assert('F4: idempotent ok',                r4a.ok,                 r4b.ok);
    assert('F4: idempotent fallbackCascadeCount', r4a.fallbackCascadeCount, r4b.fallbackCascadeCount);
    assert('F4: idempotent fallbackFieldCount',   r4a.fallbackFieldCount,   r4b.fallbackFieldCount);
    assert('F4: source clean after 2 calls',   iKb.cascades[0].__i18n, undefined);

    /* F5 — export: source has no __i18n after operational (safe to export as-is) */
    var eKb = makeMinimalKB();
    validateKBOperational(eKb);
    assert('F5: source exportable — no __i18n on entry', eKb.cascades[0].__i18n, undefined);

    /* F6 — structuredClone used when available */
    var usesStructuredClone = (typeof globalThis !== 'undefined' &&
                               typeof globalThis.structuredClone === 'function');
    var scKb = makeMinimalKB();
    validateKBOperational(scKb);
    assert('F6: clone path (structuredClone=' + usesStructuredClone + ') preserves non-mutation',
      scKb.cascades[0].__i18n, undefined);

    /* F7 — empty-string *_es triggers fill (missing-value semantics) */
    var f7Kb = makeMinimalKB();
    f7Kb.cascades[0].name_es = '';       /* explicit empty — should be treated as missing */
    f7Kb.cascades[1].ade_es  = '';
    var f7R = validateKBOperational(f7Kb);
    assert('F7: operational.ok = true with empty-string _es', f7R.ok, true);
    assert('F7: empty name_es filled (cascadeCount ≥ 1)', f7R.fallbackCascadeCount >= 1, true);
    assert('F7: fallbackByField.name_es counts empty-string entry',
      f7R.fallbackByField && (f7R.fallbackByField['name_es'] || 0) >= 1, true);

    /* F8 — whitespace-only *_es triggers fill */
    var f8Kb = makeMinimalKB();
    f8Kb.cascades[0].name_es = '   ';   /* whitespace-only — must be treated as missing */
    f8Kb.cascades[0].ade_es  = '\t';
    var f8R = validateKBOperational(f8Kb);
    assert('F8: operational.ok = true with whitespace _es', f8R.ok, true);
    assert('F8: whitespace name_es filled', f8R.fallbackByField && f8R.fallbackByField['name_es'] >= 1, true);
    assert('F8: whitespace ade_es filled',  f8R.fallbackByField && f8R.fallbackByField['ade_es']  >= 1, true);
    /* Confirm source is still whitespace (non-mutating) */
    assert('F8: source name_es still whitespace', f8Kb.cascades[0].name_es, '   ');

    /* F9 — fallbackByFieldIds are sorted deterministically */
    /* Build KB with IDs intentionally out of lexical order: ZZ before AA */
    var f9Kb = {
      version: '0.0.1-test',
      cascades: [
        { id: 'CC_ZZ', name_en: 'Z drug', index_drug_classes:['C'], index_drug_examples:['z'],
          ade_en:'Z ade', cascade_drug_examples:['zt'], confidence:'low', age_sensitivity:'low',
          risk_focus:['metabolic'], differential_hints:['h1','h2','h3'], appropriateness:'context_dependent' },
        { id: 'CC_AA', name_en: 'A drug', index_drug_classes:['C'], index_drug_examples:['a'],
          ade_en:'A ade', cascade_drug_examples:['at'], confidence:'low', age_sensitivity:'low',
          risk_focus:['metabolic'], differential_hints:['h1','h2','h3'], appropriateness:'context_dependent' }
      ]
    };
    var f9R = validateKBOperational(f9Kb);
    var f9Ids = f9R.fallbackByFieldIds && f9R.fallbackByFieldIds['name_es'];
    assert('F9: IDs sorted — CC_AA before CC_ZZ',
      f9Ids && f9Ids.length === 2 && f9Ids[0] === 'CC_AA' && f9Ids[1] === 'CC_ZZ', true);

    /* F10 — requireTranslations: true causes ok:false when fills applied */
    var f10R = validateKBOperational(makeMinimalKB(), { requireTranslations: true });
    assert('F10: requireTranslations + fills → ok = false', f10R.ok, false);
    assert('F10: errors mention requireTranslations',
      f10R.errors.some(function(e){ return e.indexOf('requireTranslations') === 0; }), true);
    assert('F10: error names the missing field',
      f10R.errors.some(function(e){ return /name_es|ade_es/.test(e); }), true);

    /* F11 — requireTranslations: true passes when all *_es present */
    var f11Kb = makeMinimalKB();
    /* Fill in all required ES fields explicitly */
    f11Kb.cascades[0].name_es = 'Fármaco A → EAM A → Tratamiento A';
    f11Kb.cascades[0].ade_es  = 'Efecto adverso alfa';
    f11Kb.cascades[1].ade_es  = 'Efecto adverso beta';
    var f11R = validateKBOperational(f11Kb, { requireTranslations: true });
    assert('F11: requireTranslations + no fills → ok = true', f11R.ok, true);
    assert('F11: fallbackFieldCount = 0 when all ES present', f11R.fallbackFieldCount, 0);
  })();
  console.groupEnd();

  /* ── Group G: reconcileDrugsWithCascades ─────────────────────────────── */
  console.group('G — Drug-cascade reconciliation');

  /* G1: drugs already present are NOT duplicated */
  var g1 = reconcileDrugsWithCascades(
    ['amlodipine'],
    [{ index_drug: 'Amlodipine', cascade_drug: 'furosemide' }]
  );
  assert('G1: existing drug not duplicated (case-insensitive)', g1.filter(function(d){
    return d.toLowerCase() === 'amlodipine';
  }).length, 1);
  assert('G1: cascade_drug added when missing', g1.indexOf('furosemide') >= 0, true);

  /* G2: empty drugs + cascade with both drugs → both back-filled */
  var g2 = reconcileDrugsWithCascades(
    [],
    [{ index_drug: 'amlodipino', cascade_drug: 'furosemida' }]
  );
  assert('G2: index_drug added when drugs empty', g2.indexOf('amlodipino') >= 0, true);
  assert('G2: cascade_drug added when drugs empty', g2.indexOf('furosemida') >= 0, true);
  assert('G2: length is 2', g2.length, 2);

  /* G3: ADE/symptom terms must NOT appear — cascade has no ADE field used */
  var g3 = reconcileDrugsWithCascades(
    [],
    [{ index_drug: 'amlodipino', cascade_drug: 'furosemida', ade_en: 'oedema' }]
  );
  assert('G3: ade_en "oedema" NOT in result', g3.indexOf('oedema'), -1);
  assert('G3: result length still 2',          g3.length, 2);

  /* G4: null / undefined drug fields are skipped gracefully */
  var g4 = reconcileDrugsWithCascades(
    [],
    [{ index_drug: null, cascade_drug: undefined }]
  );
  assert('G4: null/undefined drugs → empty result', g4.length, 0);

  /* G5: buildReport() diagnostics populated when cascades add drugs.
   * We use reconcileDrugsWithCascades directly (no live note needed). */
  var g5in  = [];
  var g5cas = [{ index_drug: 'metoprolol', cascade_drug: 'salbutamol' }];
  var g5out = reconcileDrugsWithCascades(g5in, g5cas);
  var g5cnt = g5out.length - g5in.length;
  assert('G5: inferredCount = 2 when both drugs back-filled', g5cnt, 2);

  /* G6: original input array is NOT mutated */
  var g6orig = ['atenolol'];
  var g6     = reconcileDrugsWithCascades(g6orig, [{ index_drug: 'bisoprolol', cascade_drug: 'furosemide' }]);
  assert('G6: original drugs array not mutated', g6orig.length, 1);
  assert('G6: returned array has all three',     g6.length,     3);

  console.groupEnd();

  console.log('─────────────────────────────────────');
  console.log('Results: ' + PASS + ' passed, ' + FAIL + ' failed out of ' + (PASS + FAIL));
  console.groupEnd();

  return { pass: PASS, fail: FAIL };
};

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

/* Simple toast notification */
function showToast(message, type) {
  var container = document.getElementById('toast-container');
  if (!container) return;
  var toast = document.createElement('div');
  toast.className = 'toast ' + (type || 'info');
  toast.innerHTML = escHtml(message) +
    '<button class="toast-close" aria-label="Dismiss">&times;</button>';
  toast.querySelector('.toast-close').addEventListener('click', function () {
    toast.classList.add('hiding');
    setTimeout(function () { toast.remove(); }, 350);
  });
  container.appendChild(toast);
  setTimeout(function () {
    toast.classList.add('hiding');
    setTimeout(function () { toast.remove(); }, 350);
  }, 4000);
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

  /* Export CSV */
  var btnExportCSV = document.getElementById('btn-export-csv');
  if (btnExportCSV) btnExportCSV.addEventListener('click', function () { window.exportReport('csv'); });

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

  /* New Case */
  var btnNewCase = document.getElementById('btn-new-case');
  if (btnNewCase) btnNewCase.addEventListener('click', newCase);

  /* Try Demo */
  var btnDemo = document.getElementById('btn-demo');
  if (btnDemo) btnDemo.addEventListener('click', loadDemoCase);

  /* Developer panel toggle */
  var devToggle = document.getElementById('dev-panel-toggle');
  var devPanel  = document.getElementById('dev-panel');
  if (devToggle && devPanel) {
    devToggle.addEventListener('click', function () {
      var open = devToggle.getAttribute('aria-expanded') === 'true';
      devToggle.setAttribute('aria-expanded', String(!open));
      if (open) { devPanel.hidden = true; } else { devPanel.hidden = false; }
    });
  }

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
        invalidateDetectedCascades();
        var statusEl = document.getElementById('kb-status');
        if (statusEl) statusEl.innerHTML = '<span class="kb-chip loading"><span class="spinner" style="width:12px;height:12px;border-width:2px;" aria-hidden="true"></span> ' + newMode + '&hellip;</span>';
        var ok = await loadKB(newMode);
        if (!ok) {
          console.error('[KB] Some files failed to load from ' + newMode + ' track.');
        }
        /* Re-render current step in case it depends on KB */
        renderStepContent(state.step);
      }
    });
  }

  /* Export KB bundle — source (unmodified) and operational (normalized) */
  var btnExportKB = document.getElementById('btn-export-kb');
  if (btnExportKB) btnExportKB.addEventListener('click', exportKBBundle);

  var btnExportKBOp = document.getElementById('btn-export-kb-operational');
  if (btnExportKBOp) btnExportKBOp.addEventListener('click', exportKBBundleOperational);
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

    /* Show loading state in footer before KB fetch begins */
    var kbStatusEl = document.getElementById('kb-status');
    if (kbStatusEl) {
      kbStatusEl.innerHTML =
        '<span class="kb-chip loading">' +
        '<span class="spinner" style="width:10px;height:10px;border-width:2px;vertical-align:middle;margin-right:.3rem;" aria-hidden="true"></span>' +
        'Loading KB&hellip;</span>';
    }

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
