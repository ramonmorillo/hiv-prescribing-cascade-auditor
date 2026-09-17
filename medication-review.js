'use strict';

/* Medication review is intentionally independent from the clinical engine.
 * It records the pharmacist's review without changing cascade detection yet;
 * that integration belongs to the later reviewed-input engine milestone. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MedicationReview = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var VERSION = 1;
  var MAX_ITEMS = 200;
  var MAX_TEXT = 200;

  function cleanText(value) {
    return typeof value === 'string'
      ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
      : '';
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizedKey(value) {
    return cleanText(value).toLocaleLowerCase('en');
  }

  function sourceSignature(medications) {
    return (medications || []).map(function (medication) {
      return normalizedKey(medication.normalized_name) + '|' + normalizedKey(medication.drug_class);
    }).sort().join('||');
  }

  function nextManualId(items) {
    var used = {};
    (items || []).forEach(function (item) { used[item.id] = true; });
    var number = 1;
    while (used['manual-' + number]) number++;
    return 'manual-' + number;
  }

  function touchDraft(review, now) {
    review.status = 'draft';
    review.confirmed_at = null;
    review.updated_at = now || new Date().toISOString();
    return review;
  }

  function create(medications, now) {
    var items = (medications || []).slice(0, MAX_ITEMS).map(function (medication, index) {
      var name = cleanText(medication.normalized_name);
      var drugClass = cleanText(medication.drug_class);
      return {
        id: 'extracted-' + (index + 1),
        source: 'extracted',
        original_name: name,
        original_class: drugClass,
        normalized_name: name,
        drug_class: drugClass,
        included: true
      };
    });
    return {
      version: VERSION,
      source_signature: sourceSignature(medications),
      status: 'draft',
      confirmed_at: null,
      updated_at: now || null,
      items: items
    };
  }

  function sanitize(review) {
    if (!review || typeof review !== 'object' || Array.isArray(review)) return null;
    if (review.version !== VERSION || typeof review.source_signature !== 'string' || !Array.isArray(review.items)) return null;
    var seen = {};
    var items = [];
    review.items.slice(0, MAX_ITEMS).forEach(function (item) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      var id = cleanText(item.id);
      var source = item.source === 'manual' ? 'manual' : (item.source === 'extracted' ? 'extracted' : '');
      if (!id || !source || seen[id]) return;
      seen[id] = true;
      items.push({
        id: id,
        source: source,
        original_name: source === 'extracted' ? cleanText(item.original_name) : '',
        original_class: source === 'extracted' ? cleanText(item.original_class) : '',
        normalized_name: cleanText(item.normalized_name),
        drug_class: cleanText(item.drug_class),
        included: item.included !== false
      });
    });
    var confirmedAt = typeof review.confirmed_at === 'string' ? review.confirmed_at.slice(0, 40) : null;
    return {
      version: VERSION,
      source_signature: review.source_signature.slice(0, 20000),
      status: review.status === 'confirmed' && confirmedAt ? 'confirmed' : 'draft',
      confirmed_at: review.status === 'confirmed' && confirmedAt ? confirmedAt : null,
      updated_at: typeof review.updated_at === 'string' ? review.updated_at.slice(0, 40) : null,
      items: items
    };
  }

  function ensureCurrent(review, medications, now) {
    var safe = sanitize(review);
    if (!safe || safe.source_signature !== sourceSignature(medications)) return create(medications, now);
    return safe;
  }

  function updateItem(review, id, patch, now) {
    var next = sanitize(review);
    if (!next) return null;
    var item = next.items.find(function (candidate) { return candidate.id === id; });
    if (!item) return next;
    if (Object.prototype.hasOwnProperty.call(patch, 'normalized_name')) item.normalized_name = cleanText(patch.normalized_name);
    if (Object.prototype.hasOwnProperty.call(patch, 'drug_class')) item.drug_class = cleanText(patch.drug_class);
    if (Object.prototype.hasOwnProperty.call(patch, 'included')) item.included = patch.included === true;
    return touchDraft(next, now);
  }

  function addManualItem(review, now) {
    var next = sanitize(review);
    if (!next || next.items.length >= MAX_ITEMS) return next;
    next.items.push({
      id: nextManualId(next.items),
      source: 'manual',
      original_name: '',
      original_class: '',
      normalized_name: '',
      drug_class: '',
      included: true
    });
    return touchDraft(next, now);
  }

  function removeManualItem(review, id, now) {
    var next = sanitize(review);
    if (!next) return null;
    next.items = next.items.filter(function (item) { return !(item.id === id && item.source === 'manual'); });
    return touchDraft(next, now);
  }

  function validate(review) {
    var safe = sanitize(review);
    if (!safe) return { valid: false, errors: ['invalid_review'] };
    var errors = [];
    var names = {};
    safe.items.filter(function (item) { return item.included; }).forEach(function (item) {
      var key = normalizedKey(item.normalized_name);
      if (!key) errors.push('missing_name:' + item.id);
      else if (names[key]) errors.push('duplicate_name:' + item.id);
      else names[key] = true;
    });
    return { valid: errors.length === 0, errors: errors };
  }

  function confirmReview(review, now) {
    var result = validate(review);
    if (!result.valid) return { ok: false, errors: result.errors, review: sanitize(review) };
    var next = sanitize(review);
    next.status = 'confirmed';
    next.confirmed_at = now || new Date().toISOString();
    next.updated_at = next.confirmed_at;
    return { ok: true, errors: [], review: next };
  }

  function hasChanges(review) {
    var safe = sanitize(review);
    if (!safe) return false;
    return safe.items.some(function (item) {
      return (item.source === 'manual' && item.included) ||
        (item.source === 'extracted' && (!item.included || item.normalized_name !== item.original_name || item.drug_class !== item.original_class));
    });
  }

  function reviewedMedications(review) {
    var safe = sanitize(review);
    if (!safe) return [];
    return safe.items.filter(function (item) { return item.included && cleanText(item.normalized_name); }).map(function (item) {
      return { normalized_name: item.normalized_name, drug_class: item.drug_class, source: item.source };
    });
  }

  return {
    VERSION: VERSION,
    create: create,
    sanitize: sanitize,
    ensureCurrent: ensureCurrent,
    sourceSignature: sourceSignature,
    updateItem: updateItem,
    addManualItem: addManualItem,
    removeManualItem: removeManualItem,
    validate: validate,
    confirm: confirmReview,
    hasChanges: hasChanges,
    reviewedMedications: reviewedMedications,
    clone: clone
  };
}));
