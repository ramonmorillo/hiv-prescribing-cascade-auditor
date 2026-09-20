'use strict';

/*
 * Pure boundary between pharmacist review and clinical reasoning.
 *
 * This module does not invoke ClinicalEngine and does not mutate the extracted
 * CaseModel. It converts confirmed, current reviews into engine-ready clinical
 * inputs and an explicit audit trail. Draft, invalid, or stale reviews fall
 * back to the extracted inputs.
 */
(function (root, factory) {
  var api = factory(
    typeof module === 'object' && module.exports ? require('./medication-review.js') : root.MedicationReview,
    typeof module === 'object' && module.exports ? require('./problem-review.js') : root.ProblemReview
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviewedInputAdapter = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (MedicationReview, ProblemReview) {
  var VERSION = 1;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function normalize(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function slug(value) {
    return normalize(value).replace(/\s+/g, '-');
  }

  function unchangedResult(items, reason) {
    return {
      applied: false,
      reason: reason,
      confirmed_at: null,
      items: clone(items || []),
      audit: { changed: [], added: [], excluded: [] }
    };
  }

  function reviewIsApplicable(review, sourceItems, moduleApi) {
    if (!moduleApi) return { ok: false, reason: 'review_module_unavailable', review: null };
    var safe = moduleApi.sanitize(review);
    if (!safe) return { ok: false, reason: 'invalid_review', review: null };
    if (safe.status !== 'confirmed') return { ok: false, reason: 'review_not_confirmed', review: safe };
    if (safe.source_signature !== moduleApi.sourceSignature(sourceItems || [])) {
      return { ok: false, reason: 'stale_source', review: safe };
    }
    var validation = moduleApi.validate(safe);
    if (!validation.valid) return { ok: false, reason: 'invalid_review', review: safe };
    return { ok: true, reason: 'confirmed_current_review', review: safe };
  }

  function findMedication(source, item) {
    var name = normalize(item.original_name);
    var drugClass = normalize(item.original_class);
    return (source || []).find(function (candidate) {
      return normalize(candidate.normalized_name) === name && normalize(candidate.drug_class) === drugClass;
    }) || (source || []).find(function (candidate) {
      return normalize(candidate.normalized_name) === name;
    }) || null;
  }

  function medicationFromItem(sourceMedication, item) {
    var changed = item.source === 'manual' || !sourceMedication ||
      normalize(item.normalized_name) !== normalize(item.original_name) ||
      normalize(item.drug_class) !== normalize(item.original_class);
    var result = sourceMedication ? clone(sourceMedication) : {
      original_text: item.normalized_name,
      brand: null,
      dose: null,
      frequency: null,
      route: null,
      start_date: null,
      prn: false,
      assertion: 'affirmed',
      status: 'active',
      current_status: 'active',
      temporality: 'undetermined',
      end_date: null,
      explicit_indication: null,
      confidence: 'professional_review',
      evidence_span: ''
    };
    result.normalized_name = item.normalized_name;
    result.drug_class = item.drug_class;
    result.ingredient_id = slug(item.normalized_name);
    if (!sourceMedication || normalize(item.normalized_name) !== normalize(item.original_name)) {
      result.active_ingredients = [item.normalized_name];
      result.brand = null;
    }
    result.source = item.source === 'manual' ? 'professional_manual' : (changed ? 'professional_correction' : result.source);
    result.review_provenance = {
      review_item_id: item.id,
      source: item.source,
      changed: changed,
      original_name: item.original_name || null,
      original_class: item.original_class || null
    };
    return result;
  }

  function adaptMedications(sourceMedications, review) {
    var applicability = reviewIsApplicable(review, sourceMedications, MedicationReview);
    if (!applicability.ok) return unchangedResult(sourceMedications, applicability.reason);
    var safe = applicability.review;
    var items = [];
    var audit = { changed: [], added: [], excluded: [] };

    safe.items.forEach(function (item) {
      var sourceMedication = item.source === 'extracted' ? findMedication(sourceMedications, item) : null;
      if (!item.included) {
        audit.excluded.push({
          review_item_id: item.id,
          source: item.source,
          original_name: item.original_name || null,
          reviewed_name: item.normalized_name || null
        });
        return;
      }
      var adapted = medicationFromItem(sourceMedication, item);
      items.push(adapted);
      if (item.source === 'manual') audit.added.push(clone(adapted.review_provenance));
      else if (adapted.review_provenance.changed) audit.changed.push(clone(adapted.review_provenance));
    });

    return {
      applied: true,
      reason: applicability.reason,
      confirmed_at: safe.confirmed_at,
      items: items,
      audit: audit
    };
  }

  function findProblem(source, item) {
    if (item.problem_id) {
      var byId = (source || []).find(function (candidate) { return candidate.id === item.problem_id; });
      if (byId) return byId;
    }
    var concept = normalize(item.original_concept);
    return (source || []).find(function (candidate) {
      return [candidate.problem, candidate.concept_es, candidate.concept_en].some(function (value) {
        return normalize(value) === concept;
      });
    }) || null;
  }

  function findProblemDefinition(item, kb) {
    var definitions = (kb && kb.clinicalProblems && kb.clinicalProblems.problems) || [];
    var concept = normalize(item.concept);
    return definitions.find(function (definition) {
      return [definition.id, definition.concept_es, definition.concept_en]
        .concat(definition.keywords_es || [], definition.keywords_en || [])
        .some(function (value) { return normalize(value) === concept; });
    }) || null;
  }

  function parseReviewedDate(value) {
    var raw = String(value || '').trim();
    if (!raw) return null;
    var match = /^(19|20|21)(\d{2})(?:[-\/]?(0?[1-9]|1[0-2]))?$/.exec(raw);
    if (!match) return null;
    var year = parseInt(match[1] + match[2], 10);
    var month = match[3] ? parseInt(match[3], 10) : null;
    return { year: year, month: month, value: year * 100 + (month || 0), raw: raw, source: 'professional_review' };
  }

  function statusAssertion(status) {
    if (status === 'active') return 'affirmed';
    if (status === 'suspected') return 'suspected';
    if (status === 'absent') return 'negated';
    if (status === 'resolved') return 'affirmed';
    return 'unknown';
  }

  function displayCertainty(status) {
    if (status === 'active') return 'confirmed';
    if (status === 'absent' || status === 'resolved') return 'negated';
    return 'suspected';
  }

  function problemFromItem(sourceProblem, item, kb) {
    var definition = findProblemDefinition(item, kb);
    var conceptChanged = normalize(item.concept) !== normalize(item.original_concept);
    var changed = item.source === 'manual' || !sourceProblem ||
      normalize(item.concept) !== normalize(item.original_concept) ||
      item.status !== item.original_status || item.temporality !== item.original_temporality ||
      String(item.onset_date || '') !== String(item.original_onset_date || '');
    var result = sourceProblem ? clone(sourceProblem) : {};
    /* A renamed problem must never retain the clinical identifier of the
       original extraction. It is re-linked only when the reviewed concept
       exactly matches a KB definition; otherwise it receives a neutral
       review-only id that cannot activate a different KB rule by accident. */
    var problemId = (!conceptChanged && item.problem_id) || (definition && definition.id) ||
      ('REVIEW_' + item.id.toUpperCase().replace(/[^A-Z0-9]+/g, '_'));
    var parsedDate = parseReviewedDate(item.onset_date);

    result.id = problemId;
    result.problem = item.concept;
    result.concept_es = definition ? definition.concept_es : (result.concept_es || item.concept);
    result.concept_en = definition ? definition.concept_en : (result.concept_en || item.concept);
    result.category = definition ? (definition.category || '') : (result.category || 'professional_review');
    result.category_label = result.category_label || result.category;
    result.status = item.status;
    result.assertion = statusAssertion(item.status);
    result.temporality = item.temporality;
    result.contradiction = false;
    result.certainty = displayCertainty(item.status);
    result.first_active_date = parsedDate || (sourceProblem && item.onset_date === item.original_onset_date
      ? clone(sourceProblem.first_active_date || null) : null);
    result.evidence_span = sourceProblem ? (sourceProblem.evidence_span || '') : '';
    result.evidence = sourceProblem ? clone(sourceProblem.evidence || []) : [];
    result.negatedFindings = sourceProblem ? clone(sourceProblem.negatedFindings || []) : [];
    result.measurement_type = definition ? (definition.measurement_type || null) : (result.measurement_type || null);
    result.diagnostic_note_es = definition ? (definition.diagnostic_note_es || '') : (result.diagnostic_note_es || '');
    result.diagnostic_note_en = definition ? (definition.diagnostic_note_en || '') : (result.diagnostic_note_en || '');
    result.alternative_indication_for_drug_examples = definition
      ? clone(definition.alternative_indication_for_drug_examples || [])
      : clone(result.alternative_indication_for_drug_examples || []);
    result.source_cascade_ids = definition ? clone(definition.source_cascade_ids || []) : clone(result.source_cascade_ids || []);
    result.references = definition ? clone(definition.references || []) : clone(result.references || []);
    result.source = item.source === 'manual' ? 'professional_manual' : (changed ? 'professional_correction' : result.source);
    result.review_provenance = {
      review_item_id: item.id,
      source: item.source,
      changed: changed,
      matched_definition_id: definition ? definition.id : null,
      original_concept: item.original_concept || null,
      original_status: item.original_status || null,
      original_temporality: item.original_temporality || null,
      original_onset_date: item.original_onset_date || null
    };
    return result;
  }

  function adaptProblems(sourceProblems, review, kb) {
    var applicability = reviewIsApplicable(review, sourceProblems, ProblemReview);
    if (!applicability.ok) return unchangedResult(sourceProblems, applicability.reason);
    var safe = applicability.review;
    var items = [];
    var audit = { changed: [], added: [], excluded: [] };

    safe.items.forEach(function (item) {
      var sourceProblem = item.source === 'extracted' ? findProblem(sourceProblems, item) : null;
      if (!item.included) {
        audit.excluded.push({
          review_item_id: item.id,
          source: item.source,
          problem_id: item.problem_id || null,
          original_concept: item.original_concept || null,
          reviewed_concept: item.concept || null
        });
        return;
      }
      var adapted = problemFromItem(sourceProblem, item, kb);
      items.push(adapted);
      if (item.source === 'manual') audit.added.push(clone(adapted.review_provenance));
      else if (adapted.review_provenance.changed) audit.changed.push(clone(adapted.review_provenance));
    });

    var seenProblemIds = {};
    var duplicateIdentity = items.some(function (item) {
      if (!item.id || seenProblemIds[item.id]) return true;
      seenProblemIds[item.id] = true;
      return false;
    });
    if (duplicateIdentity) return unchangedResult(sourceProblems, 'duplicate_problem_identity');

    return {
      applied: true,
      reason: applicability.reason,
      confirmed_at: safe.confirmed_at,
      items: items,
      audit: audit
    };
  }

  function build(extractedModel, medicationReview, problemReview, kb) {
    var source = extractedModel || {};
    var medications = adaptMedications(source.medications || [], medicationReview);
    var problems = adaptProblems(source.activeProblems || [], problemReview, kb || {});
    return {
      version: VERSION,
      medications: medications.items,
      activeProblems: problems.items,
      application: {
        medications: {
          applied: medications.applied,
          reason: medications.reason,
          confirmed_at: medications.confirmed_at
        },
        problems: {
          applied: problems.applied,
          reason: problems.reason,
          confirmed_at: problems.confirmed_at
        }
      },
      audit: { medications: medications.audit, problems: problems.audit }
    };
  }

  return {
    VERSION: VERSION,
    adaptMedications: adaptMedications,
    adaptProblems: adaptProblems,
    build: build,
    parseReviewedDate: parseReviewedDate
  };
}));
