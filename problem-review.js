'use strict';

/* Professional review of clinical problems and their temporality.
 * Kept independent from the clinical engine until the reviewed-input
 * integration milestone, so extraction and professional corrections remain
 * separately auditable. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProblemReview = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var VERSION = 1;
  var MAX_ITEMS = 200;
  var MAX_TEXT = 300;
  var STATUSES = ['active', 'suspected', 'resolved', 'absent', 'unknown'];
  var TEMPORALITIES = ['current', 'historical', 'undetermined'];

  function cleanText(value, limit) {
    return typeof value === 'string'
      ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit || MAX_TEXT)
      : '';
  }

  function normalizedKey(value) {
    return cleanText(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en');
  }

  function safeStatus(value) {
    return STATUSES.indexOf(value) !== -1 ? value : 'unknown';
  }

  function safeTemporality(value) {
    return TEMPORALITIES.indexOf(value) !== -1 ? value : 'undetermined';
  }

  function problemConcept(problem) {
    return cleanText(problem.problem || problem.concept_es || problem.concept_en);
  }

  function problemOnset(problem) {
    if (problem.first_active_date && typeof problem.first_active_date.raw === 'string') {
      return cleanText(problem.first_active_date.raw, 80);
    }
    return cleanText(problem.onset_date, 80);
  }

  function sourceSignature(problems) {
    return (problems || []).map(function (problem) {
      return [
        cleanText(problem.id, 100),
        safeStatus(problem.status), safeTemporality(problem.temporality), normalizedKey(problemOnset(problem))
      ].join('|');
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

  function create(problems, now) {
    return {
      version: VERSION,
      source_signature: sourceSignature(problems),
      status: 'draft',
      confirmed_at: null,
      updated_at: now || null,
      items: (problems || []).slice(0, MAX_ITEMS).map(function (problem, index) {
        var concept = problemConcept(problem);
        var status = safeStatus(problem.status);
        var temporality = safeTemporality(problem.temporality);
        var onset = problemOnset(problem);
        return {
          id: 'extracted-' + (index + 1),
          source: 'extracted',
          extraction_source: cleanText(problem.source, 40),
          problem_id: cleanText(problem.id, 100),
          original_concept: concept,
          original_status: status,
          original_temporality: temporality,
          original_onset_date: onset,
          concept: concept,
          status: status,
          temporality: temporality,
          onset_date: onset,
          evidence_span: cleanText(problem.evidence_span || (problem.evidence || []).join(' / '), 1000),
          included: true
        };
      })
    };
  }

  function sanitize(review) {
    if (!review || typeof review !== 'object' || Array.isArray(review)) return null;
    if (review.version !== VERSION || typeof review.source_signature !== 'string' || !Array.isArray(review.items)) return null;
    var seen = {};
    var items = [];
    review.items.slice(0, MAX_ITEMS).forEach(function (item) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      var id = cleanText(item.id, 100);
      var source = item.source === 'manual' ? 'manual' : (item.source === 'extracted' ? 'extracted' : '');
      if (!id || !source || seen[id]) return;
      seen[id] = true;
      items.push({
        id: id,
        source: source,
        extraction_source: source === 'extracted' ? cleanText(item.extraction_source, 40) : '',
        problem_id: source === 'extracted' ? cleanText(item.problem_id, 100) : '',
        original_concept: source === 'extracted' ? cleanText(item.original_concept) : '',
        original_status: source === 'extracted' ? safeStatus(item.original_status) : 'unknown',
        original_temporality: source === 'extracted' ? safeTemporality(item.original_temporality) : 'undetermined',
        original_onset_date: source === 'extracted' ? cleanText(item.original_onset_date, 80) : '',
        concept: cleanText(item.concept),
        status: safeStatus(item.status),
        temporality: safeTemporality(item.temporality),
        onset_date: cleanText(item.onset_date, 80),
        evidence_span: source === 'extracted' ? cleanText(item.evidence_span, 1000) : '',
        included: item.included !== false
      });
    });
    var confirmedAt = typeof review.confirmed_at === 'string' ? review.confirmed_at.slice(0, 40) : null;
    return {
      version: VERSION,
      source_signature: review.source_signature.slice(0, 100000),
      status: review.status === 'confirmed' && confirmedAt ? 'confirmed' : 'draft',
      confirmed_at: review.status === 'confirmed' && confirmedAt ? confirmedAt : null,
      updated_at: typeof review.updated_at === 'string' ? review.updated_at.slice(0, 40) : null,
      items: items
    };
  }

  function ensureCurrent(review, problems, now) {
    var safe = sanitize(review);
    if (!safe || safe.source_signature !== sourceSignature(problems)) return create(problems, now);
    return safe;
  }

  function updateItem(review, id, patch, now) {
    var next = sanitize(review);
    if (!next) return null;
    var item = next.items.find(function (candidate) { return candidate.id === id; });
    if (!item) return next;
    if (Object.prototype.hasOwnProperty.call(patch, 'concept')) item.concept = cleanText(patch.concept);
    if (Object.prototype.hasOwnProperty.call(patch, 'status')) item.status = safeStatus(patch.status);
    if (Object.prototype.hasOwnProperty.call(patch, 'temporality')) item.temporality = safeTemporality(patch.temporality);
    if (Object.prototype.hasOwnProperty.call(patch, 'onset_date')) item.onset_date = cleanText(patch.onset_date, 80);
    if (Object.prototype.hasOwnProperty.call(patch, 'included')) item.included = patch.included === true;
    return touchDraft(next, now);
  }

  function addManualItem(review, now) {
    var next = sanitize(review);
    if (!next || next.items.length >= MAX_ITEMS) return next;
    next.items.push({
      id: nextManualId(next.items), source: 'manual', extraction_source: '', problem_id: '',
      original_concept: '', original_status: 'unknown', original_temporality: 'undetermined', original_onset_date: '',
      concept: '', status: 'active', temporality: 'current', onset_date: '', evidence_span: '', included: true
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
    var concepts = {};
    safe.items.filter(function (item) { return item.included; }).forEach(function (item) {
      var key = normalizedKey(item.concept);
      if (!key) errors.push('missing_concept:' + item.id);
      else if (concepts[key]) errors.push('duplicate_concept:' + item.id);
      else concepts[key] = true;
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
      return (item.source === 'manual' && item.included) || (item.source === 'extracted' && (
        !item.included || item.concept !== item.original_concept || item.status !== item.original_status ||
        item.temporality !== item.original_temporality || item.onset_date !== item.original_onset_date
      ));
    });
  }

  function reviewedProblems(review) {
    var safe = sanitize(review);
    if (!safe) return [];
    return safe.items.filter(function (item) { return item.included && cleanText(item.concept); }).map(function (item) {
      return {
        problem_id: item.problem_id || null, concept: item.concept, status: item.status,
        temporality: item.temporality, onset_date: item.onset_date || null, source: item.source
      };
    });
  }

  return {
    VERSION: VERSION, STATUSES: STATUSES.slice(), TEMPORALITIES: TEMPORALITIES.slice(),
    create: create, sanitize: sanitize, ensureCurrent: ensureCurrent, sourceSignature: sourceSignature,
    updateItem: updateItem, addManualItem: addManualItem, removeManualItem: removeManualItem,
    validate: validate, confirm: confirmReview, hasChanges: hasChanges, reviewedProblems: reviewedProblems
  };
}));
