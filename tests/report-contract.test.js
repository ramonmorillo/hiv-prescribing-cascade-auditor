'use strict';

const RC = require('../report-contract.js');
const { assert, assertEqual, reset, summary } = require('./helpers');

function parseCsvLine(line) {
  const cells = [];
  let value = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(value); value = '';
    } else value += char;
  }
  cells.push(value);
  return cells;
}

function candidate(id, cascadeDrug, classification) {
  return {
    candidate_id: id,
    cascade_id: 'CC001',
    cascade_name: 'NSAID → hypertension → antihypertensive',
    index_drug: 'naproxen', cascade_drug: cascadeDrug,
    ade_es: 'hipertensión', ade_en: 'hypertension',
    classification: classification,
    verification_status: id === 'kept' ? 'confirmed' : 'not_cascade',
    classification_reason_es: 'Cronología compatible.',
    classification_reason_en: 'Compatible chronology.',
    temporal_support: 'supportive',
    clinical_recommendation: 'Revisar necesidad del AINE.',
    potential_clinical_relevance: 'alta',
    knowledge_validation_status: 'reviewed_source',
    sequence: 'naproxen → hypertension → ' + cascadeDrug,
    drug_resolution: {
      index: { review_provenance: { source: 'extracted', changed: false, review_item_id: 'extracted-1' } },
      cascade: { review_provenance: { source: 'manual', changed: true, review_item_id: 'manual-1' } }
    },
    evidence: { intermediate_problem: { source: 'professional_correction' } }
  };
}

function run() {
  reset(); console.log('== report-contract.test.js ==');
  const kept = candidate('kept', 'enalapril', 'supported_possible_cascade');
  const discarded = candidate('discarded', 'amlodipine', 'possible_but_incomplete');
  const base = {
    patient_id: 'CASE-001', generated_at: '2026-09-20T12:00:00.000Z',
    kb_version: '2.0.0', kb_mode: 'PROD',
    drugs_detected: ['naproxen', 'enalapril'], drug_classes: ['NSAID', 'ACE inhibitor'],
    medication_review: { status: 'confirmed', confirmed_at: '2026-09-20T11:00:00.000Z' },
    problem_review: { status: 'draft', confirmed_at: null },
    reviewed_input_application: {
      medications: { applied: true, reason: 'confirmed_current_review' },
      problems: { applied: false, reason: 'review_not_confirmed' }
    },
    review_audit: {
      medications: { changed: [], added: [{ review_item_id: 'manual-1' }], excluded: [] },
      problems: { changed: [{ review_item_id: 'extracted-1' }], added: [], excluded: [] }
    },
    activeProblems: [{ id: 'CPB001', problem: 'Hipertensión arterial' }],
    missingInformation: [{ type: 'missing_measurement', message_es: 'Falta una medición.', message_en: 'A measurement is missing.' }],
    globalMedicationAlerts: [], cascades: [kept], cascade_count: 1
  };
  const source = {
    medications: [{ normalized_name: 'naproxen' }],
    activeProblems: [{ id: 'CPB001' }]
  };
  const report = RC.enrich(base, {
    language: 'es', softwareVersion: '1.0.0', extractedClinicalInput: source,
    allCandidates: [kept, discarded],
    professionalVerdicts: { kept: 'confirmed', discarded: 'not_cascade' }
  });

  assert('report contract is explicitly versioned', report.report_schema_version === 2);
  assert('software, KB and language metadata are explicit',
    report.software_version === '1.0.0' && report.kb_version === '2.0.0' && report.language === 'es');
  assertEqual('source and effective medication lists remain separate',
    [report.input_provenance.source_medications, report.input_provenance.effective_medications],
    [['naproxen'], ['naproxen', 'enalapril']]);
  assert('domain application states remain independent',
    report.input_provenance.medication_review.applied && !report.input_provenance.problem_review.applied);
  assert('professional changes are counted by domain',
    report.professional_changes.medications.counts.total === 1 && report.professional_changes.problems.counts.total === 1);
  assert('manual-information flag reflects real corrections', report.manual_information_modified === true);
  assert('retained finding carries item-level input provenance',
    report.cascades[0].input_provenance.cascade_drug.source === 'manual');
  assert('professional summary distinguishes included and discarded candidates',
    report.professional_review_summary.included_findings === 1 &&
    report.professional_review_summary.professionally_discarded === 1);
  assert('discarded candidate is audit-only and absent from clinical findings',
    report.discarded_findings[0].candidate_id === 'discarded' &&
    !report.cascades.some((item) => item.candidate_id === 'discarded'));
  assert('draft problem review and missing data become explicit limitations',
    report.limitations.some((item) => item.code === 'problem_review_draft') &&
    report.limitations.some((item) => item.code === 'missing_measurement'));

  const csv = RC.toCsv(report, 'es');
  const rows = csv.split('\r\n').map(parseCsvLine);
  assert('CSV has one header and one retained-finding row', rows.length === 2);
  assert('every CSV row has the declared column count', rows.every((row) => row.length === RC.CSV_COLUMNS.length));
  assert('CSV identifies automated and professional judgments separately',
    rows[0].includes('automated_classification') && rows[0].includes('professional_validation'));
  assert('CSV contains the retained candidate and excludes the discarded candidate',
    csv.includes('kept') && !csv.includes('discarded"'));
  assert('CSV carries application flags and structured limitations',
    rows[0].includes('medication_review_applied') && rows[0].includes('limitations_json'));

  const esText = RC.toClinicalText(report, 'es');
  const enText = RC.toClinicalText(Object.assign({}, report, { language: 'en' }), 'en');
  assert('Spanish clinical text contains executive summary, audit and limitations',
    /RESUMEN EJECUTIVO/.test(esText) && /TRAZABILIDAD PROFESIONAL/.test(esText) && /LIMITACIONES/.test(esText));
  assert('English clinical text contains the same structural sections',
    /EXECUTIVE SUMMARY/.test(enText) && /PROFESSIONAL AUDIT TRAIL/.test(enText) && /LIMITATIONS/.test(enText));
  assert('discarded finding never appears as a clinical recommendation',
    !esText.includes('amlodipine') && esText.includes('Excluido de los hallazgos clínicos: discarded'));
  assert('clinical text identifies applied review domains',
    /Revisión de medicamentos aplicada: Sí/.test(esText) && /Revisión de problemas aplicada: No/.test(esText));

  const empty = RC.enrich(Object.assign({}, base, { cascades: [], missingInformation: [] }), {
    language: 'en', allCandidates: [], professionalVerdicts: {}, extractedClinicalInput: source
  });
  const emptyRows = RC.toCsv(empty, 'en').split('\r\n').map(parseCsvLine);
  assert('zero-finding CSV still contains one well-formed data row',
    emptyRows.length === 2 && emptyRows.every((row) => row.length === RC.CSV_COLUMNS.length));

  const r = summary(); console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`); return r.fail === 0;
}

module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
