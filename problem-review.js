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

  /* Only an explicitly documented onset fills the editable onset field. A
     treatment start date (problem.first_active_date with semantics
     'treatment_start') is shown as context, never relabelled as onset. */
  function problemOnset(problem) {
    if (Object.prototype.hasOwnProperty.call(problem, 'documented_onset')) {
      return problem.documented_onset && typeof problem.documented_onset.raw === 'string'
        ? cleanText(problem.documented_onset.raw, 80) : cleanText(problem.onset_date, 80);
    }
    if (problem.first_active_date && typeof problem.first_active_date.raw === 'string') {
      return cleanText(problem.first_active_date.raw, 80);
    }
    return cleanText(problem.onset_date, 80);
  }

  var EVIDENCE_TYPES = ['explicit_mention', 'documented_indication', 'contextual_inference', 'pharmacological_inference', 'manual_entry'];
  var CERTAINTY = ['high', 'medium', 'low'];

  /* Read-only traceability carried from the extraction into the review, so
     the professional sees WHY each problem appeared before validating it. */
  function traceability(problem) {
    var meds = Array.isArray(problem.related_medications) ? problem.related_medications : [];
    var events = Array.isArray(problem.events) ? problem.events : [];
    var firstDate = problem.first_active_date && typeof problem.first_active_date.raw === 'string' ? problem.first_active_date : null;
    var norm = problem.normalization || {};
    return {
      concept_id: cleanText(problem.concept_id, 100),
      evidence_types: (problem.evidence_types || []).filter(function (t) { return EVIDENCE_TYPES.indexOf(t) !== -1; }),
      certainty_level: CERTAINTY.indexOf(problem.certainty_level) !== -1 ? problem.certainty_level : '',
      related_medications: meds.slice(0, 20).map(function (m) {
        return { drug: cleanText(m.drug, 120), relation: EVIDENCE_TYPES.indexOf(m.relation) !== -1 ? m.relation : '',
          start_date: cleanText(m.start_date, 80) };
      }),
      evidence_spans: events.slice(0, 20).map(function (e) {
        return { type: EVIDENCE_TYPES.indexOf(e.type) !== -1 ? e.type : '', text: cleanText(e.evidenceSpan, 400),
          status: safeStatus(e.status), date: cleanText(e.date, 80), date_semantics: cleanText(e.date_semantics, 40) };
      }).filter(function (e) { return e.text; }),
      first_documented_date: firstDate ? cleanText(firstDate.raw, 80) : '',
      first_documented_semantics: firstDate ? cleanText(firstDate.semantics, 40) : '',
      code: problem.code && problem.code.code ? cleanText(problem.code.system + ' ' + problem.code.code, 60) : '',
      normalization_notes: [].concat(norm.relation_notes_es || [], norm.concept_note_es ? [norm.concept_note_es] : [])
        .slice(0, 5).map(function (n) { return cleanText(n, 400); }),
      match_types: (norm.match_types || []).slice(0, 8).map(function (t) { return cleanText(t, 40); }),
      contradiction: problem.contradiction === true
    };
  }

  function sanitizeTraceability(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return traceability({
      concept_id: value.concept_id, evidence_types: value.evidence_types, certainty_level: value.certainty_level,
      related_medications: value.related_medications,
      events: (value.evidence_spans || []).map(function (e) {
        return e && typeof e === 'object' ? { type: e.type, evidenceSpan: e.text, status: e.status, date: e.date, date_semantics: e.date_semantics } : {};
      }),
      first_active_date: value.first_documented_date ? { raw: value.first_documented_date, semantics: value.first_documented_semantics } : null,
      code: null,
      normalization: { relation_notes_es: value.normalization_notes || [], match_types: value.match_types || [] },
      contradiction: value.contradiction
    });
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
          traceability: traceability(problem),
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
        traceability: source === 'extracted' ? (function () {
          var t = sanitizeTraceability(item.traceability);
          if (t && item.traceability && typeof item.traceability.code === 'string') t.code = cleanText(item.traceability.code, 60);
          return t;
        }()) : null,
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
