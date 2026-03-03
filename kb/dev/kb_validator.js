/* kb_validator.js — DEV KB schema validator
 * Exported as window.validateKB (browser) or module.exports.validateKB (Node).
 * Usage: var result = validateKB(kbJson);  // { ok, errors, warnings }
 */
(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validateKB: factory() };
  } else {
    root.validateKB = factory();
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /* ── Canonical schema definition ─────────────────────────────────────── */
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

  var VALID_CONFIDENCE    = ['high', 'medium', 'low'];
  var VALID_AGE_SENS      = ['high', 'medium', 'low'];
  var VALID_APPROPRIATENESS = ['often_appropriate', 'context_dependent', 'often_inappropriate'];

  /* Bilingual optional pairs — warn if one side exists without the other */
  var BILINGUAL_OPTIONAL_PAIRS = [
    ['ade_mechanism_es',            'ade_mechanism_en'],
    ['recommended_first_action_es', 'recommended_first_action_en']
  ];

  /* ── Main validator ───────────────────────────────────────────────────── */
  function validateKB(kbJson) {
    var errors   = [];
    var warnings = [];

    if (!kbJson || typeof kbJson !== 'object') {
      errors.push('KB root is not a valid object.');
      return { ok: false, errors: errors, warnings: warnings };
    }

    /* Top-level structure */
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

    /* Optional non_cascade_iatrogenic array */
    if (kbJson.non_cascade_iatrogenic !== undefined) {
      if (!Array.isArray(kbJson.non_cascade_iatrogenic)) {
        errors.push('"non_cascade_iatrogenic" must be an array if present.');
      } else {
        kbJson.non_cascade_iatrogenic.forEach(function (entry, idx) {
          validateEntry(entry, 'non_cascade_iatrogenic[' + idx + ']', errors, warnings, true);
        });
      }
    }

    /* Validate each cascade entry */
    var seenIds = {};
    kbJson.cascades.forEach(function (entry, idx) {
      var label = entry && entry.id ? entry.id : 'cascades[' + idx + ']';

      /* Duplicate ID check */
      if (entry && entry.id) {
        if (seenIds[entry.id]) {
          errors.push('[' + label + '] Duplicate id "' + entry.id + '".');
        }
        seenIds[entry.id] = true;
      }

      validateEntry(entry, label, errors, warnings, false);
    });

    return {
      ok: errors.length === 0,
      errors: errors,
      warnings: warnings
    };
  }

  /* ── Per-entry validator ──────────────────────────────────────────────── */
  function validateEntry(entry, label, errors, warnings, isIatrogenic) {
    if (!entry || typeof entry !== 'object') {
      errors.push('[' + label + '] Entry is not a valid object.');
      return;
    }

    /* Required fields */
    REQUIRED_FIELDS.forEach(function (field) {
      if (!(field in entry) || entry[field] === null || entry[field] === undefined) {
        errors.push('[' + label + '] Missing required field: "' + field + '".');
      } else if (entry[field] === '') {
        errors.push('[' + label + '] Required field "' + field + '" must not be empty string.');
      }
    });

    /* Array fields must be non-empty arrays of strings */
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

    /* Optional array fields type check */
    OPTIONAL_ARRAY_FIELDS.forEach(function (field) {
      if (field in entry && !Array.isArray(entry[field])) {
        errors.push('[' + label + '] Optional field "' + field + '" must be an array if present.');
      }
    });

    /* Enum checks */
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

    /* Numeric field types */
    ['time_window_days_min', 'time_window_days_max'].forEach(function (f) {
      if (f in entry && typeof entry[f] !== 'number') {
        errors.push('[' + label + '] "' + f + '" must be a number if present.');
      }
    });

    /* differential_hints length warning */
    if (Array.isArray(entry.differential_hints) && entry.differential_hints.length < 3) {
      warnings.push('[' + label + '] "differential_hints" has only ' + entry.differential_hints.length + ' item(s); recommended minimum is 3.');
    }

    /* Bilingual optional pair consistency */
    BILINGUAL_OPTIONAL_PAIRS.forEach(function (pair) {
      var hasA = pair[0] in entry && entry[pair[0]];
      var hasB = pair[1] in entry && entry[pair[1]];
      if (hasA && !hasB) {
        warnings.push('[' + label + '] Has "' + pair[0] + '" but missing bilingual counterpart "' + pair[1] + '".');
      }
      if (hasB && !hasA) {
        warnings.push('[' + label + '] Has "' + pair[1] + '" but missing bilingual counterpart "' + pair[0] + '".');
      }
    });

    /* String type checks for required string fields */
    ['id', 'name_es', 'name_en', 'ade_es', 'ade_en', 'confidence', 'age_sensitivity', 'appropriateness'].forEach(function (f) {
      if (f in entry && entry[f] !== null && typeof entry[f] !== 'string') {
        errors.push('[' + label + '] Field "' + f + '" must be a string.');
      }
    });
  }

  return validateKB;
}));
