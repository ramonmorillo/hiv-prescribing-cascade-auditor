/* kb_validator.js — DEV KB schema validator
 *
 * Separates editorial quality control from operational robustness:
 *   validateKBStrict(kbSource)      — no normalization; missing *_es → errors
 *   validateKBOperational(kbSource) — deep-clones source, normalises clone,
 *                                     validates clone; source NEVER mutated
 *
 * Browser globals (always):  window.validateKBStrict, window.validateKBOperational
 * Browser global (DEV only): window.normalizeBilingualCascades
 *                             (set window.__KB_DEV_MODE = true before script load)
 * Node: module.exports = { validateKBStrict, validateKBOperational,
 *                           normalizeBilingualFields }
 *
 * Export convention (see exportKBBundle in app.js):
 *   Exports contain the SOURCE KB — never the normalised clone.
 *   Translations must be added directly to the JSON files for them to persist.
 *
 * validateKBOperational return shape:
 *   ok                  {boolean} — false only for structural / EN-field errors
 *   errors              {string[]}
 *   warnings            {string[]}
 *   fallbackCascadeCount {number} — cascades where ≥1 ES field was auto-filled
 *   fallbackFieldCount   {number} — total individual field fills across all cascades
 *   fallbackByField      {Object} — { fieldName: count }  e.g. { name_es: 40 }
 *   fallbackByFieldIds   {Object} — { fieldName: string[] } cascade IDs per field
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.validateKBStrict      = api.validateKBStrict;
    root.validateKBOperational = api.validateKBOperational;
    /* DEV-only utility — hidden in production to avoid misuse */
    if (root.__KB_DEV_MODE === true) {
      root.normalizeBilingualCascades = api.normalizeBilingualFields;
    }
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /* ── Schema constants ─────────────────────────────────────────────────── */

  /* All fields that must be present and non-empty in a fully translated entry */
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
   * Returns: { cascadeCount, fieldCount, byField, byFieldIds }
   *   cascadeCount — entries where ≥1 field was filled
   *   fieldCount   — total individual fills
   *   byField      — { fieldName: number } count of entries filled per field
   *   byFieldIds   — { fieldName: string[] } cascade IDs filled per field    */
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
        if (entry[enField] && (!entry[esField] || entry[esField] === '')) {
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

    return { cascadeCount: cascadeCount, fieldCount: fieldCount, byField: byField, byFieldIds: byFieldIds };
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
      } else if (entry[field] === '') {
        errors.push('[' + label + '] Required field "' + field + '" must not be empty string.');
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
   *
   * Returns: { ok, errors, warnings }
   */
  function validateKBStrict(kbSource) {
    return runValidation(kbSource);
  }

  /**
   * validateKBOperational(kbSource)
   *
   * Operational robustness check:
   *   1. Deep-clones kbSource via structuredClone (or JSON fallback).
   *      Source is NEVER mutated.
   *   2. Normalises clone — fills missing *_es fields from *_en counterparts,
   *      attaches __i18n provenance marker on each affected entry.
   *   3. Validates the normalised clone via runValidation.
   *
   * ok:false only when English fields are missing or structurally broken.
   * Missing *_es alone never causes ok:false.
   *
   * Returns: { ok, errors, warnings,
   *            fallbackCascadeCount, fallbackFieldCount,
   *            fallbackByField, fallbackByFieldIds }
   */
  function validateKBOperational(kbSource) {
    var clone = deepClone(kbSource);
    var fillReport = normalizeBilingualFields(clone);
    var result = runValidation(clone);
    result.fallbackCascadeCount = fillReport.cascadeCount;
    result.fallbackFieldCount   = fillReport.fieldCount;
    result.fallbackByField      = fillReport.byField;
    result.fallbackByFieldIds   = fillReport.byFieldIds;
    return result;
  }

  return {
    validateKBStrict:         validateKBStrict,
    validateKBOperational:    validateKBOperational,
    normalizeBilingualFields: normalizeBilingualFields
  };
}));
