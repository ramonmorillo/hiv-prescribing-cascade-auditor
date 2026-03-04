/* kb_validator.js — DEV KB schema validator
 *
 * Separates editorial quality control from operational robustness:
 *   validateKBStrict(kbSource)            — no normalization; missing *_es → errors
 *   validateKBOperational(kbSource, opts) — deep-clones source, normalises clone,
 *                                           validates clone; source NEVER mutated
 *   buildOperationalKB(kbSource)          — returns normalised KB + report for export
 *
 * Browser globals (always):  window.validateKBStrict, window.validateKBOperational,
 *                             window.buildOperationalKB
 * Browser global (DEV only): window.normalizeBilingualCascades
 *                             (set window.__KB_DEV_MODE = true before script load)
 * Node: module.exports = { validateKBStrict, validateKBOperational,
 *                           buildOperationalKB, normalizeBilingualFields }
 *
 * Missing-value semantics for bilingual fields
 * ─────────────────────────────────────────────
 * A field value is considered MISSING (and eligible for EN→ES fallback) when it is:
 *   - absent (undefined / not in entry)
 *   - null
 *   - empty string ""
 *   - whitespace-only string "  "
 * Any non-blank string is considered PRESENT and will NOT be overwritten.
 *
 * validateKBOperational options
 * ─────────────────────────────
 *   opts.requireTranslations {boolean} — default false
 *     When true, any ES fallback fill causes ok:false with per-field errors.
 *     Useful for pre-release lint, CI gates on translated KBs.
 *     No second validation pass — errors are appended from the fill report.
 *
 * validateKBOperational return shape
 * ────────────────────────────────────
 *   ok                   {boolean} — false for structural/EN errors;
 *                                    also false when requireTranslations and fills > 0
 *   errors               {string[]}
 *   warnings             {string[]}
 *   fallbackCascadeCount {number}  — cascades where ≥1 ES field was auto-filled
 *   fallbackFieldCount   {number}  — total individual field fills across all cascades
 *   fallbackByField      {Object}  — { fieldName: count }  e.g. { name_es: 40 }
 *   fallbackByFieldIds   {Object}  — { fieldName: string[] } sorted, unique cascade IDs
 *
 * buildOperationalKB return shape
 * ────────────────────────────────
 *   kbData {Object} — deep-cloned, normalised KB with __i18n markers stripped
 *   report {Object} — same shape as fallback* fields above
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.validateKBStrict      = api.validateKBStrict;
    root.validateKBOperational = api.validateKBOperational;
    root.buildOperationalKB    = api.buildOperationalKB;
    /* DEV-only utility — hidden in production to avoid misuse */
    if (root.__KB_DEV_MODE === true) {
      root.normalizeBilingualCascades = api.normalizeBilingualFields;
    }
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /* ── Schema constants ─────────────────────────────────────────────────── */

  /* All fields that must be present and non-blank in a fully translated entry */
  var REQUIRED_FIELDS = [
    'id', 'name_es', 'name_en',
    'index_drug_classes', 'index_drug_examples',
    'ade_es', 'ade_en',
    'cascade_drug_examples',
    'confidence', 'age_sensitivity',
    'risk_focus', 'differential_hints',
    'appropriateness'
  ];

  var ARRAY_FIELDS = [
    'index_drug_classes', 'index_drug_examples',
    'cascade_drug_examples', 'risk_focus', 'differential_hints'
  ];

  var OPTIONAL_ARRAY_FIELDS = ['references'];

  var VALID_CONFIDENCE      = ['high', 'medium', 'low'];
  var VALID_AGE_SENS        = ['high', 'medium', 'low'];
  var VALID_APPROPRIATENESS = ['often_appropriate', 'context_dependent', 'often_inappropriate'];

  /* Bilingual fill pairs — order: required fields first, optional last */
  var BILINGUAL_FILL_PAIRS = [
    ['name_es',                     'name_en'],
    ['ade_es',                      'ade_en'],
    ['ade_mechanism_es',            'ade_mechanism_en'],
    ['recommended_first_action_es', 'recommended_first_action_en']
  ];

  /* ── Missing-value predicate ──────────────────────────────────────────── */
  /* Returns true for undefined, null, "", or any whitespace-only string.
   * Used by the normaliser and by validateEntry for required-field checks.  */
  function isMissing(v) {
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  }

  /* ── Deep clone ───────────────────────────────────────────────────────── */
  /* Prefer structuredClone (native, faster, handles more types) with a
   * JSON round-trip fallback for older environments.  KB data is plain
   * JSON-serialisable so both paths are behaviourally identical here.      */
  var deepClone = (typeof globalThis !== 'undefined' && typeof globalThis.structuredClone === 'function')
    ? function (obj) { return globalThis.structuredClone(obj); }
    : function (obj) { return JSON.parse(JSON.stringify(obj)); };

  /* ── Bilingual normaliser ─────────────────────────────────────────────── */
  /* Fills missing _es fields from _en counterparts IN-PLACE and returns a
   * fill report.  MUST only be called on a deep clone of the source KB.
   *
   * A field is "missing" per isMissing() — undefined, null, "", or whitespace.
   *
   * Returns: { cascadeCount, fieldCount, byField, byFieldIds }
   *   cascadeCount — entries where ≥1 field was filled
   *   fieldCount   — total individual fills
   *   byField      — { fieldName: number }   count of entries filled per field
   *   byFieldIds   — { fieldName: string[] } sorted, unique cascade IDs per field */
  function normalizeBilingualFields(kbJson) {
    if (!kbJson || typeof kbJson !== 'object') {
      return { cascadeCount: 0, fieldCount: 0, byField: {}, byFieldIds: {} };
    }

    var byField = {}, byFieldIds = {};
    var cascadeCount = 0, fieldCount = 0;

    var allEntries = [];
    if (Array.isArray(kbJson.cascades)) {
      allEntries = allEntries.concat(kbJson.cascades);
    }
    if (Array.isArray(kbJson.non_cascade_iatrogenic)) {
      allEntries = allEntries.concat(kbJson.non_cascade_iatrogenic);
    }

    allEntries.forEach(function (entry) {
      if (!entry || typeof entry !== 'object') return;
      var filled = [];
      BILINGUAL_FILL_PAIRS.forEach(function (pair) {
        var esField = pair[0], enField = pair[1];
        if (!isMissing(entry[enField]) && isMissing(entry[esField])) {
          entry[esField] = entry[enField];
          filled.push(esField);
          byField[esField] = (byField[esField] || 0) + 1;
          if (entry.id) {
            (byFieldIds[esField] = byFieldIds[esField] || []).push(entry.id);
          }
        }
      });
      if (filled.length > 0) {
        entry.__i18n = { es_fallback: true, fields: filled };
        cascadeCount++;
        fieldCount += filled.length;
      }
    });

    /* Guarantee deterministic order and uniqueness for byFieldIds arrays */
    Object.keys(byFieldIds).forEach(function (field) {
      var seen = {};
      byFieldIds[field] = byFieldIds[field]
        .filter(function (id) { return seen[id] ? false : (seen[id] = true); })
        .sort();
    });

    return { cascadeCount: cascadeCount, fieldCount: fieldCount, byField: byField, byFieldIds: byFieldIds };
  }

  /* ── Strip __i18n markers ─────────────────────────────────────────────── */
  /* Removes __i18n provenance keys from all entries in a KB object.
   * Mutates in-place — only call on an already-cloned object.             */
  function stripI18nInPlace(kbJson) {
    ['cascades', 'non_cascade_iatrogenic'].forEach(function (key) {
      if (!Array.isArray(kbJson[key])) return;
      kbJson[key].forEach(function (entry) {
        if (entry && entry.__i18n) delete entry.__i18n;
      });
    });
  }

  /* ── Shared validation core ───────────────────────────────────────────── */
  /* Runs all structural checks.  Never modifies its argument.              */
  function runValidation(kbJson) {
    var errors = [], warnings = [];

    if (!kbJson || typeof kbJson !== 'object') {
      errors.push('KB root is not a valid object.');
      return { ok: false, errors: errors, warnings: warnings };
    }

    if (!kbJson.version) {
      warnings.push('KB missing top-level "version" field.');
    }
    if (!Array.isArray(kbJson.cascades)) {
      errors.push('KB missing "cascades" array at top level.');
      return { ok: false, errors: errors, warnings: warnings };
    }
    if (kbJson.cascades.length === 0) {
      warnings.push('KB "cascades" array is empty.');
    }

    if (kbJson.non_cascade_iatrogenic !== undefined) {
      if (!Array.isArray(kbJson.non_cascade_iatrogenic)) {
        errors.push('"non_cascade_iatrogenic" must be an array if present.');
      } else {
        kbJson.non_cascade_iatrogenic.forEach(function (entry, idx) {
          validateEntry(entry, 'non_cascade_iatrogenic[' + idx + ']', errors, warnings);
        });
      }
    }

    var seenIds = {};
    kbJson.cascades.forEach(function (entry, idx) {
      var label = entry && entry.id ? entry.id : 'cascades[' + idx + ']';
      if (entry && entry.id) {
        if (seenIds[entry.id]) {
          errors.push('[' + label + '] Duplicate id "' + entry.id + '".');
        }
        seenIds[entry.id] = true;
      }
      validateEntry(entry, label, errors, warnings);
    });

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  /* ── Per-entry validator ──────────────────────────────────────────────── */
  function validateEntry(entry, label, errors, warnings) {
    if (!entry || typeof entry !== 'object') {
      errors.push('[' + label + '] Entry is not a valid object.');
      return;
    }

    REQUIRED_FIELDS.forEach(function (field) {
      if (!(field in entry) || entry[field] === null || entry[field] === undefined) {
        errors.push('[' + label + '] Missing required field: "' + field + '".');
      } else if (typeof entry[field] === 'string' && entry[field].trim() === '') {
        /* Catches both "" and whitespace-only values */
        errors.push('[' + label + '] Required field "' + field + '" must not be blank.');
      }
    });

    ARRAY_FIELDS.forEach(function (field) {
      if (field in entry) {
        if (!Array.isArray(entry[field])) {
          errors.push('[' + label + '] Field "' + field + '" must be an array.');
        } else {
          if (entry[field].length === 0) {
            errors.push('[' + label + '] Array field "' + field + '" must not be empty.');
          }
          entry[field].forEach(function (item, i) {
            if (typeof item !== 'string') {
              errors.push('[' + label + '] "' + field + '[' + i + ']" must be a string.');
            }
          });
        }
      }
    });

    OPTIONAL_ARRAY_FIELDS.forEach(function (field) {
      if (field in entry && !Array.isArray(entry[field])) {
        errors.push('[' + label + '] Optional field "' + field + '" must be an array if present.');
      }
    });

    if (entry.confidence !== undefined && VALID_CONFIDENCE.indexOf(entry.confidence) === -1) {
      errors.push('[' + label + '] "confidence" must be one of: ' + VALID_CONFIDENCE.join(', ') + '. Got: "' + entry.confidence + '".');
    }
    if (entry.age_sensitivity !== undefined && VALID_AGE_SENS.indexOf(entry.age_sensitivity) === -1) {
      errors.push('[' + label + '] "age_sensitivity" must be one of: ' + VALID_AGE_SENS.join(', ') + '. Got: "' + entry.age_sensitivity + '".');
    }
    if (entry.appropriateness !== undefined) {
      if (VALID_APPROPRIATENESS.indexOf(entry.appropriateness) === -1) {
        errors.push('[' + label + '] "appropriateness" must be one of: ' + VALID_APPROPRIATENESS.join(', ') + '. Got: "' + entry.appropriateness + '".');
      }
    } else {
      warnings.push('[' + label + '] Missing "appropriateness" field.');
    }

    ['time_window_days_min', 'time_window_days_max'].forEach(function (f) {
      if (f in entry && typeof entry[f] !== 'number') {
        errors.push('[' + label + '] "' + f + '" must be a number if present.');
      }
    });

    if (Array.isArray(entry.differential_hints) && entry.differential_hints.length < 3) {
      warnings.push('[' + label + '] "differential_hints" has only ' + entry.differential_hints.length + ' item(s); recommended minimum is 3.');
    }

    ['id', 'name_es', 'name_en', 'ade_es', 'ade_en', 'confidence', 'age_sensitivity', 'appropriateness'].forEach(function (f) {
      if (f in entry && entry[f] !== null && typeof entry[f] !== 'string') {
        errors.push('[' + label + '] Field "' + f + '" must be a string.');
      }
    });
  }

  /* ── Public API ───────────────────────────────────────────────────────── */

  /**
   * validateKBStrict(kbSource)
   *
   * Editorial quality check — no normalization performed.
   * Missing *_es fields produce errors, making this suitable for CI lint and
   * authoring workflows where translations must be explicitly provided.
   * Whitespace-only fields are also reported as blank errors.
   *
   * Returns: { ok, errors, warnings }
   */
  function validateKBStrict(kbSource) {
    return runValidation(kbSource);
  }

  /**
   * validateKBOperational(kbSource [, opts])
   *
   * Operational robustness check:
   *   1. Deep-clones kbSource via structuredClone (or JSON fallback).
   *      Source is NEVER mutated.
   *   2. Normalises clone — fills isMissing() *_es fields from *_en counterparts,
   *      attaches __i18n provenance marker on each affected entry.
   *   3. Validates the normalised clone via runValidation.
   *
   * opts.requireTranslations {boolean} — default false
   *   When true, any ES fill causes ok:false with per-field errors appended
   *   (no second validation pass — derived directly from the fill report).
   *
   * Returns: { ok, errors, warnings,
   *            fallbackCascadeCount, fallbackFieldCount,
   *            fallbackByField, fallbackByFieldIds }
   */
  function validateKBOperational(kbSource, opts) {
    var options = opts || {};
    var clone = deepClone(kbSource);
    var fillReport = normalizeBilingualFields(clone);
    var result = runValidation(clone);

    /* requireTranslations: inject per-field errors without re-running runValidation */
    if (options.requireTranslations && fillReport.fieldCount > 0) {
      Object.keys(fillReport.byField).sort().forEach(function (field) {
        var count = fillReport.byField[field];
        var ids   = (fillReport.byFieldIds[field] || []).join(', ');
        result.errors.push(
          'requireTranslations: ' + count + ' cascade(s) missing "' + field + '": ' + ids
        );
      });
      result.ok = false;
    }

    result.fallbackCascadeCount = fillReport.cascadeCount;
    result.fallbackFieldCount   = fillReport.fieldCount;
    result.fallbackByField      = fillReport.byField;
    result.fallbackByFieldIds   = fillReport.byFieldIds;
    return result;
  }

  /**
   * buildOperationalKB(kbSource)
   *
   * Produces a ready-to-export operational KB:
   *   1. Deep-clones kbSource (source NEVER mutated).
   *   2. Normalises clone (fills isMissing *_es fields from *_en).
   *   3. Strips all __i18n provenance markers from the clone.
   *
   * Returns: { kbData, report }
   *   kbData {Object} — normalised KB, clean of any __i18n keys
   *   report {Object} — { cascadeCount, fieldCount, byField, byFieldIds }
   *
   * Callers should embed `report` in a top-level `normalization` block of
   * the exported bundle so consumers know which fields were auto-filled.
   */
  function buildOperationalKB(kbSource) {
    if (!kbSource || typeof kbSource !== 'object') {
      return { kbData: null, report: { cascadeCount: 0, fieldCount: 0, byField: {}, byFieldIds: {} } };
    }
    var clone = deepClone(kbSource);
    var report = normalizeBilingualFields(clone);
    stripI18nInPlace(clone);
    return { kbData: clone, report: report };
  }

  return {
    validateKBStrict:         validateKBStrict,
    validateKBOperational:    validateKBOperational,
    buildOperationalKB:       buildOperationalKB,
    normalizeBilingualFields: normalizeBilingualFields
  };
}));
