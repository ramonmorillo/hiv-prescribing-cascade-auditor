'use strict';

/* Versioned, DOM-free report contract shared by screen, clinical text, JSON
 * and CSV. It never performs clinical reasoning; it only presents the final
 * CaseModel and the professional audit trail consistently. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReportContract = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var VERSION = 2;
  var CSV_COLUMNS = [
    'report_schema_version', 'software_version', 'language',
    'patient_id', 'generated_at', 'kb_version', 'kb_mode',
    'medication_review_applied', 'problem_review_applied',
    'medication_changes', 'problem_changes', 'professionally_discarded_count',
    'candidate_id', 'cascade_id', 'cascade_name', 'index_drug', 'cascade_drug', 'ade',
    'potential_clinical_relevance', 'knowledge_validation_status',
    'automated_classification', 'professional_validation',
    'classification_reason', 'temporal_support', 'clinical_recommendation',
    'input_provenance_json', 'limitations_json'
  ];

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function list(value) { return Array.isArray(value) ? value : []; }

  function localized(value, lang) {
    if (!value) return '';
    return (lang === 'en' ? value.message_en : value.message_es) || value.message_es || value.message_en || '';
  }

  function auditCounts(audit) {
    audit = audit || {};
    return {
      changed: list(audit.changed).length,
      added: list(audit.added).length,
      excluded: list(audit.excluded).length,
      total: list(audit.changed).length + list(audit.added).length + list(audit.excluded).length
    };
  }

  function reviewState(report, domain) {
    var review = report[domain + '_review'];
    var application = report.reviewed_input_application && report.reviewed_input_application[domain === 'medication' ? 'medications' : 'problems'];
    return {
      status: review ? review.status : 'not_started',
      confirmed_at: review ? review.confirmed_at : null,
      applied: !!(application && application.applied),
      reason: application ? application.reason : 'review_not_available'
    };
  }

  function medicationProvenance(signal, side) {
    var resolution = signal && signal.drug_resolution && signal.drug_resolution[side];
    var review = resolution && resolution.review_provenance;
    if (review) return clone(review);
    return {
      source: resolution && resolution.match_type === 'professional_review' ? 'manual' : 'extracted',
      changed: false,
      review_item_id: null
    };
  }

  function buildLimitations(report, summary) {
    var out = [];
    if (summary.unreviewed > 0) {
      out.push({
        code: 'professional_validation_pending', count: summary.unreviewed,
        message_es: summary.unreviewed + ' hallazgo(s) continúan sin validación profesional.',
        message_en: summary.unreviewed + ' finding(s) remain without professional validation.'
      });
    }
    list(report.missingInformation).forEach(function (item) {
      out.push({
        code: item.type || 'missing_information', count: 1,
        message_es: item.message_es || '', message_en: item.message_en || item.message_es || ''
      });
    });
    ['medication', 'problem'].forEach(function (domain) {
      var state = reviewState(report, domain);
      if (state.status === 'draft') {
        out.push({
          code: domain + '_review_draft', count: 1,
          message_es: domain === 'medication'
            ? 'La revisión de medicamentos está en borrador y no se ha aplicado al motor.'
            : 'La revisión de problemas clínicos está en borrador y no se ha aplicado al motor.',
          message_en: domain === 'medication'
            ? 'The medication review is a draft and was not applied to the engine.'
            : 'The clinical-problem review is a draft and was not applied to the engine.'
        });
      }
    });
    return out;
  }

  function enrich(baseReport, context) {
    var report = clone(baseReport || {});
    context = context || {};
    var verdicts = context.professionalVerdicts || {};
    var allCandidates = list(context.allCandidates);
    var lang = context.language === 'en' ? 'en' : 'es';
    var sourceInput = context.extractedClinicalInput || {};
    var medicationAudit = report.review_audit && report.review_audit.medications;
    var problemAudit = report.review_audit && report.review_audit.problems;

    report.report_schema_version = VERSION;
    report.software_version = context.softwareVersion || '1.0.0';
    report.language = lang;
    report.input_provenance = {
      source_medications: list(sourceInput.medications).map(function (item) { return item.normalized_name; }),
      effective_medications: list(report.drugs_detected),
      source_problems: list(sourceInput.activeProblems).map(function (item) { return item.id || item.problem; }),
      effective_problems: list(report.activeProblems).map(function (item) { return item.id || item.problem; }),
      medication_review: reviewState(report, 'medication'),
      problem_review: reviewState(report, 'problem')
    };
    report.professional_changes = {
      medications: { counts: auditCounts(medicationAudit), items: clone(medicationAudit || { changed: [], added: [], excluded: [] }) },
      problems: { counts: auditCounts(problemAudit), items: clone(problemAudit || { changed: [], added: [], excluded: [] }) }
    };
    report.cascades = list(report.cascades).map(function (candidate) {
      var next = clone(candidate);
      next.input_provenance = {
        index_drug: medicationProvenance(candidate, 'index'),
        cascade_drug: medicationProvenance(candidate, 'cascade'),
        intermediate_problem: candidate.evidence && candidate.evidence.intermediate_problem
          ? candidate.evidence.intermediate_problem.source || 'unknown' : 'unknown'
      };
      return next;
    });

    report.discarded_findings = allCandidates.filter(function (candidate) {
      return verdicts[candidate.candidate_id] === 'not_cascade';
    }).map(function (candidate) {
      return {
        candidate_id: candidate.candidate_id,
        cascade_id: candidate.cascade_id,
        sequence: candidate.index_drug + ' → ' + ((lang === 'es' ? candidate.ade_es : candidate.ade_en) || '') + ' → ' + candidate.cascade_drug,
        automated_classification: candidate.classification,
        professional_decision: 'not_cascade',
        automated_reason: (lang === 'es' ? candidate.classification_reason_es : candidate.classification_reason_en) || ''
      };
    });

    var summary = {
      total_candidates: allCandidates.length,
      included_findings: report.cascades.length,
      professionally_confirmed: report.cascades.filter(function (c) { return c.verification_status === 'confirmed'; }).length,
      professionally_possible: report.cascades.filter(function (c) { return c.verification_status === 'possible'; }).length,
      unreviewed: report.cascades.filter(function (c) { return c.verification_status === 'unreviewed'; }).length,
      professionally_discarded: report.discarded_findings.length
    };
    report.professional_review_summary = summary;
    report.limitations = buildLimitations(report, summary);
    report.manual_information_modified =
      report.professional_changes.medications.counts.total + report.professional_changes.problems.counts.total > 0;
    return report;
  }

  function csvCell(value) {
    var text = value === null || value === undefined ? '' : String(value);
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function toCsv(report, language) {
    var lang = language === 'en' ? 'en' : 'es';
    var changes = report.professional_changes || {};
    var medicationChanges = changes.medications && changes.medications.counts ? changes.medications.counts.total : 0;
    var problemChanges = changes.problems && changes.problems.counts ? changes.problems.counts.total : 0;
    var application = report.input_provenance || {};
    var common = [
      report.report_schema_version, report.software_version, report.language,
      report.patient_id, report.generated_at, report.kb_version, report.kb_mode,
      application.medication_review && application.medication_review.applied,
      application.problem_review && application.problem_review.applied,
      medicationChanges, problemChanges,
      report.professional_review_summary && report.professional_review_summary.professionally_discarded
    ];
    var candidates = list(report.cascades);
    if (!candidates.length) candidates = [null];
    var rows = [CSV_COLUMNS.join(',')];
    candidates.forEach(function (candidate) {
      var specific = candidate ? [
        candidate.candidate_id, candidate.cascade_id, candidate.cascade_name,
        candidate.index_drug, candidate.cascade_drug,
        (lang === 'en' ? candidate.ade_en : candidate.ade_es) || candidate.ade_en || candidate.ade_es || '',
        candidate.potential_clinical_relevance, candidate.knowledge_validation_status,
        candidate.classification, candidate.verification_status,
        (lang === 'en' ? candidate.classification_reason_en : candidate.classification_reason_es) || '',
        candidate.temporal_support, candidate.clinical_recommendation,
        JSON.stringify(candidate.input_provenance || {})
      ] : ['', '', '', '', '', '', '', '', '', '', '', '', '', ''];
      rows.push(common.concat(specific, [JSON.stringify(report.limitations || [])]).map(csvCell).join(','));
    });
    return rows.join('\r\n');
  }

  function toClinicalText(report, language) {
    var lang = language === 'en' ? 'en' : 'es';
    var en = lang === 'en';
    var lines = [];
    var summary = report.professional_review_summary || {};
    var provenance = report.input_provenance || {};
    var changes = report.professional_changes || {};
    lines.push(en ? 'PRESCRIBING CASCADE AUDIT REPORT' : 'INFORME DE AUDITORÍA DE CASCADAS TERAPÉUTICAS');
    lines.push((en ? 'Patient ID: ' : 'ID de paciente: ') + (report.patient_id || (en ? 'Not set' : 'No establecido')));
    lines.push((en ? 'Generated: ' : 'Generado: ') + (report.generated_at || ''));
    lines.push((en ? 'Software / KB: ' : 'Software / KB: ') + (report.software_version || '') + ' / ' + (report.kb_version || '') + ' (' + (report.kb_mode || '') + ')');
    lines.push((en ? 'Language: English' : 'Idioma: español'));
    lines.push('');
    lines.push(en ? 'EXECUTIVE SUMMARY' : 'RESUMEN EJECUTIVO');
    lines.push((en ? '- Findings included: ' : '- Hallazgos incluidos: ') + (summary.included_findings || 0));
    lines.push((en ? '- Professionally validated: ' : '- Validados profesionalmente: ') + (summary.professionally_confirmed || 0));
    lines.push((en ? '- Pending professional review: ' : '- Pendientes de revisión profesional: ') + (summary.unreviewed || 0));
    lines.push((en ? '- Professionally discarded: ' : '- Descartados profesionalmente: ') + (summary.professionally_discarded || 0));
    lines.push((en ? '- Effective medications: ' : '- Medicación efectiva: ') + (list(report.drugs_detected).join(', ') || (en ? 'None' : 'Ninguna')));
    lines.push((en ? '- Medication review applied: ' : '- Revisión de medicamentos aplicada: ') + ((provenance.medication_review && provenance.medication_review.applied) ? (en ? 'Yes' : 'Sí') : 'No'));
    lines.push((en ? '- Problem review applied: ' : '- Revisión de problemas aplicada: ') + ((provenance.problem_review && provenance.problem_review.applied) ? (en ? 'Yes' : 'Sí') : 'No'));
    lines.push('');

    lines.push(en ? 'CLINICAL FINDINGS' : 'HALLAZGOS CLÍNICOS');
    if (!list(report.cascades).length) lines.push(en ? 'No cascade signals included.' : 'No se incluyen señales de cascada.');
    list(report.cascades).forEach(function (candidate, index) {
      lines.push((index + 1) + '. ' + candidate.sequence + ' [' + candidate.candidate_id + ']');
      lines.push((en ? '   Automated assessment: ' : '   Evaluación automática: ') + candidate.classification);
      lines.push((en ? '   Professional decision: ' : '   Decisión profesional: ') + candidate.verification_status);
      lines.push((en ? '   Rationale: ' : '   Justificación: ') + ((en ? candidate.classification_reason_en : candidate.classification_reason_es) || ''));
      lines.push((en ? '   Temporal support: ' : '   Soporte temporal: ') + (candidate.temporal_support || 'unknown'));
      lines.push((en ? '   Suggested action: ' : '   Actuación sugerida: ') + (candidate.clinical_recommendation || (en ? 'None' : 'Ninguna')));
    });
    lines.push('');

    if (list(report.globalMedicationAlerts).length) {
      lines.push(en ? 'OTHER MEDICATION FINDINGS' : 'OTROS HALLAZGOS DE MEDICACIÓN');
      list(report.globalMedicationAlerts).forEach(function (alert, index) {
        lines.push((index + 1) + '. ' + ((en ? alert.message_en : alert.message_es) || alert.message_es || ''));
      });
      lines.push('');
    }

    lines.push(en ? 'PROFESSIONAL AUDIT TRAIL' : 'TRAZABILIDAD PROFESIONAL');
    lines.push((en ? '- Medication changes/additions/exclusions: ' : '- Cambios/altas/exclusiones de medicamentos: ') +
      ((changes.medications && changes.medications.counts && changes.medications.counts.total) || 0));
    lines.push((en ? '- Problem changes/additions/exclusions: ' : '- Cambios/altas/exclusiones de problemas: ') +
      ((changes.problems && changes.problems.counts && changes.problems.counts.total) || 0));
    list(report.discarded_findings).forEach(function (item) {
      lines.push((en ? '- Excluded from clinical findings: ' : '- Excluido de los hallazgos clínicos: ') + item.candidate_id);
    });
    lines.push('');

    lines.push(en ? 'LIMITATIONS / MISSING INFORMATION' : 'LIMITACIONES / INFORMACIÓN AUSENTE');
    if (!list(report.limitations).length) lines.push(en ? 'No structured limitations recorded.' : 'Sin limitaciones estructuradas registradas.');
    list(report.limitations).forEach(function (item) { lines.push('- ' + localized(item, lang)); });
    lines.push('');
    lines.push(en
      ? 'Decision-support output. It does not replace individual clinical judgement.'
      : 'Resultado de apoyo a la decisión. No sustituye el juicio clínico individual.');
    return lines.join('\n');
  }

  return { VERSION: VERSION, CSV_COLUMNS: CSV_COLUMNS.slice(), enrich: enrich, toCsv: toCsv, toClinicalText: toClinicalText };
}));
