'use strict';

/* ============================================================
   HIV Prescribing Cascade Auditor — app.js
   Minimal working implementation
   - KB loading from /kb/
   - Wizard tab navigation
   - localStorage persistence
   - Export JSON / Import Case / Delete All Data
   ============================================================ */

const LS_KEY      = 'hiv_cascade_state';
const LS_LANG_KEY = 'hiv_cascade_lang';

/* ── Language ── */
var currentLanguage = 'es'; /* default: Spanish */

/**
 * Return the localized value for `baseField` from `obj`.
 * Tries `baseField + '_' + lang` first; falls back to the English field,
 * then to any bare `baseField` value.  Returns '' when nothing is found.
 *
 * @param {object} obj       - KB entry or signal object
 * @param {string} baseField - e.g. 'name', 'ade', 'recommended_first_action'
 * @param {string} lang      - 'es' or 'en'
 * @returns {string}
 */
function getLocalizedField(obj, baseField, lang) {
  if (!obj) return '';
  var preferred = obj[baseField + '_' + lang];
  if (preferred && typeof preferred === 'string' && preferred.trim()) return preferred;
  /* Fallback: English field */
  var en = obj[baseField + '_en'];
  if (en && typeof en === 'string' && en.trim()) return en;
  /* Last resort: bare base field */
  var base = obj[baseField];
  if (base && typeof base === 'string' && base.trim()) return base;
  return '';
}

/* ============================================================
   UI STRING DICTIONARY — centralized i18n for all UI/system text
   KB content uses getLocalizedField(); UI text uses tUI().
   ============================================================ */
const UI_STRINGS = {
  es: {
    /* Redesign (presentation only) */
    chain_index_lbl:   'F&aacute;rmaco &iacute;ndice',
    chain_ade_lbl:     'Problema intermedio',
    chain_cascade_lbl: 'F&aacute;rmaco posterior',
    rule_id_lbl:       'Regla',
    report_export_lbl: 'Exportar o compartir',
    saved_locally:     function (t) { return 'Guardado en este navegador · ' + t; },
    wf_pending:        'Pendiente',
    wf_waiting_kb:     'Esperando la KB',
    wf_note_chars:     function (n) { return n.toLocaleString('es-ES') + ' caracteres'; },
    wf_review_confirmed: 'Revisi&oacute;n confirmada',
    wf_review_draft:   'Revisi&oacute;n en borrador',
    wf_classified:     function (n, m) { return n + ' de ' + m + ' con clase'; },
    wf_signals:        function (n) { return n === 0 ? 'Sin se&ntilde;ales' : n + (n === 1 ? ' se&ntilde;al' : ' se&ntilde;ales'); },
    wf_reviewed:       function (n, m) { return n + ' de ' + m + ' verificadas'; },
    wf_report_ready:   'Disponible',
    kb_inv_title:      'Ficheros cargados',
    kb_inv_coreCascades:      'Cascadas generales',
    kb_inv_vihModifiers:      'Cascadas espec&iacute;ficas de VIH',
    kb_inv_ddiWatchlist:      'Interacciones vigiladas',
    kb_inv_symptomDictionary: 'Diccionario de s&iacute;ntomas',
    kb_inv_clinicalProblems:  'Problemas cl&iacute;nicos',
    kb_inv_clinicalModifiers: 'Modificadores cl&iacute;nicos',
    kb_inv_drugDictionary:    'Diccionario de f&aacute;rmacos',
    kb_inv_drugCombinations:  'Combinaciones a dosis fija',
    kb_inv_active_rules: 'reglas activas',
    kb_inv_entries:    'entradas',
    kb_inv_not_loaded: 'No cargado',
    kb_track_lbl:      function (m) { return 'Entorno ' + m; },
    kb_search_label:   'Buscar regla, f&aacute;rmaco o problema',
    kb_search_placeholder: 'p. ej., amlodipino, edema, CC004',
    kb_filter_source:  'Origen',
    kb_filter_status:  'Validaci&oacute;n del conocimiento',
    kb_filter_all:     'Todas',
    kb_source_core:    'Cascadas generales',
    kb_source_hiv:     'Espec&iacute;ficas de VIH',
    kb_results:        function (n, t) { return n + ' de ' + t + ' reglas'; },
    kb_no_results:     'Ninguna regla coincide con la b&uacute;squeda.',
    kb_mechanism:      'Mecanismo',
    kb_index_examples: 'Ejemplos de f&aacute;rmaco &iacute;ndice',
    kb_cascade_examples: 'Ejemplos de f&aacute;rmaco posterior',
    kb_action:         'Orientaci&oacute;n registrada en la KB',
    kb_references:     'Referencias',
    kb_no_references:  'Sin referencia bibliogr&aacute;fica registrada.',
    kb_unavailable:    'La base de conocimiento no est&aacute; cargada.',
    kb_catalog_note:   'Solo se muestran las reglas activas: las fusionadas durante la auditor&iacute;a de la KB no se ejecutan. Los f&aacute;rmacos figuran como DCI en ingl&eacute;s, tal como constan en la KB; la b&uacute;squeda admite tambi&eacute;n nombres en espa&ntilde;ol y marcas del diccionario.',
    /* Navigation */
    step_counter:     function (n) { return 'Paso ' + n + ' de 6'; },
    btn_prev:         'Anterior',
    btn_next:         'Siguiente',
    btn_finish:       'Finalizar',

    /* Step nav labels */
    nav_step1: 'Datos',
    nav_step2: 'Medicaci&oacute;n',
    nav_step3: 'Clasificaci&oacute;n',
    nav_step4: 'Cascadas',
    nav_step5: 'Plan',
    nav_step6: 'Informe',

    /* Step titles */
    step1_title: 'Datos del caso',
    step2_title: 'Medicaci&oacute;n y problemas activos',
    step3_title: 'Clasificaci&oacute;n farmacol&oacute;gica',
    step4_title: 'Posibles cascadas terap&eacute;uticas',
    step5_title: 'Verificaci&oacute;n cl&iacute;nica',
    step6_title: 'Plan farmacoterap&eacute;utico e informe',

    /* Onboarding */
    onboarding_title:       'C&oacute;mo funciona el auditor &mdash; en 3 pasos',
    onboarding_step1_title: 'Introduzca la nota cl&iacute;nica',
    onboarding_step1_body:  'Pegue la nota cl&iacute;nica seudonimizada del paciente. El auditor extraer&aacute; autom&aacute;ticamente los medicamentos y problemas activos.',
    onboarding_step2_title: 'El auditor detecta posibles cascadas',
    onboarding_step2_body:  'Cruza los f&aacute;rmacos con la base de conocimiento: identifica si alg&uacute;n medicamento puede ser consecuencia de un efecto adverso de otro.',
    onboarding_step3_title: 'Obtenga un plan farmacoterap&eacute;utico',
    onboarding_step3_body:  'Clasifique cada hallazgo, a&ntilde;ada sus notas cl&iacute;nicas y exporte un informe estructurado para el equipo asistencial.',
    onboarding_hint:        'Pruebe con el caso demo &mdash; un paciente VIH en TAR con antihipertensivo que genera edema tratado con diur&eacute;tico.',
    onboarding_demo_btn:    'Probar demo',

    /* Step 1 form */
    note_label:       'Nota cl&iacute;nica del caso',
    note_placeholder: 'Pegue aqu&iacute; la nota cl&iacute;nica seudonimizada&hellip;',
    note_hint:        'Sin identificadores reales de paciente. Los datos permanecen &uacute;nicamente en este navegador.',

    /* Common warnings */
    kb_unavailable_title:  'Base de conocimiento no disponible.',
    kb_unavailable_detail: 'Compruebe el estado KB en el pie de p&aacute;gina y recargue si es necesario.',
    note_empty_title:          'Nota cl&iacute;nica vac&iacute;a.',
    note_empty_detail:         'Introduzca la nota cl&iacute;nica en el Paso 1 antes de continuar.',
    note_empty_detail_report:  'Introduzca la nota cl&iacute;nica en el Paso 1 para generar el informe.',

    /* Step 2 */
    drugs_section_label:           'Medicamentos detectados',
    inactive_drugs_label:          'Medicamentos mencionados pero no activos',
    no_drugs_title:                'Sin medicamentos identificados.',
    no_drugs_detail:               'La nota puede usar nombres comerciales, abreviaturas o f&aacute;rmacos no incluidos en la KB actual.',
    drugs_detected:                function (n) { return '<strong>' + n + ' medicamento' + (n === 1 ? '' : 's') + ' detectado' + (n === 1 ? '' : 's') + '</strong> en la nota cl&iacute;nica.'; },
    med_review_title:              'Revisi&oacute;n farmac&eacute;utica de la medicaci&oacute;n',
    med_review_intro:              'Compruebe la lista extra&iacute;da, corrija nombres o grupos, excluya menciones no activas y a&ntilde;ada los medicamentos omitidos.',
    med_review_status_draft:       'Pendiente de confirmar',
    med_review_status_confirmed:   'Revisi&oacute;n confirmada',
    med_review_source_extracted:   'Extra&iacute;do',
    med_review_source_manual:      'A&ntilde;adido',
    med_review_include:            'Incluir',
    med_review_name:               'Medicamento',
    med_review_class:              'Grupo farmacol&oacute;gico',
    med_review_original:           function (name) { return 'Valor extra&iacute;do: ' + name; },
    med_review_add:                '+ A&ntilde;adir medicamento',
    med_review_remove:             'Eliminar',
    med_review_confirm:            'Confirmar revisi&oacute;n',
    med_review_reset:              'Restaurar extracci&oacute;n',
    med_review_empty:              'No hay medicamentos incluidos en la revisi&oacute;n.',
    med_review_validation_error:   'Revise los nombres vac&iacute;os o duplicados antes de confirmar.',
    med_review_confirmed_toast:    'Revisi&oacute;n de medicamentos confirmada.',
    med_review_reset_confirm:      'Se perder&aacute;n las correcciones de medicamentos realizadas. ¿Restaurar la extracci&oacute;n autom&aacute;tica?',
    med_review_boundary:           '<strong>Entrada cl&iacute;nica controlada:</strong> solo una revisi&oacute;n confirmada y vigente modifica el an&aacute;lisis. Cualquier cambio posterior vuelve a dejarla en borrador.',
    med_review_not_applied:        '<strong>Revisi&oacute;n de medicamentos pendiente:</strong> los cambios permanecer&aacute;n fuera del motor hasta que confirme la revisi&oacute;n.',
    med_review_applied:            '<strong>Revisi&oacute;n de medicamentos aplicada:</strong> el an&aacute;lisis utiliza la lista confirmada por el profesional.',
    problem_review_title:              'Revisi&oacute;n de problemas cl&iacute;nicos y temporalidad',
    problem_review_intro:              'Valide el problema, su estado actual, la relaci&oacute;n temporal y la fecha de inicio documentada.',
    problem_review_status_draft:       'Pendiente de confirmar',
    problem_review_status_confirmed:   'Revisi&oacute;n confirmada',
    problem_review_source_extracted:   'Extra&iacute;do',
    problem_review_source_manual:      'A&ntilde;adido',
    problem_review_include:            'Incluir',
    problem_review_concept:            'Problema cl&iacute;nico',
    problem_review_status:             'Estado',
    problem_review_temporality:        'Temporalidad',
    problem_review_onset:              'Inicio documentado',
    problem_review_onset_placeholder:  'Ej.: sep 2022',
    problem_review_evidence:           'Evidencia original:',
    problem_review_original:           function (concept) { return 'Valor extra&iacute;do: ' + concept; },
    problem_review_add:                '+ A&ntilde;adir problema',
    problem_review_remove:             'Eliminar',
    problem_review_confirm:            'Confirmar revisi&oacute;n',
    problem_review_reset:              'Restaurar extracci&oacute;n',
    problem_review_empty:              'No se han extra&iacute;do problemas. Puede a&ntilde;adir uno manualmente.',
    problem_review_validation_error:   'Revise los problemas vac&iacute;os o duplicados antes de confirmar.',
    problem_review_confirmed_toast:    'Revisi&oacute;n de problemas confirmada.',
    problem_review_reset_confirm:      'Se perder&aacute;n las correcciones de problemas realizadas. ¿Restaurar la extracci&oacute;n autom&aacute;tica?',
    problem_review_boundary:           '<strong>Entrada cl&iacute;nica controlada:</strong> solo una revisi&oacute;n confirmada y vigente modifica el an&aacute;lisis. Cualquier cambio posterior vuelve a dejarla en borrador.',
    problem_review_not_applied:        '<strong>Revisi&oacute;n de problemas pendiente:</strong> los cambios permanecer&aacute;n fuera del motor hasta que confirme la revisi&oacute;n.',
    problem_review_applied:            '<strong>Revisi&oacute;n de problemas aplicada:</strong> el an&aacute;lisis utiliza los problemas y la temporalidad confirmados por el profesional.',
    problem_review_status_active:      'Activo',
    problem_review_status_suspected:   'Sospechado',
    problem_review_status_resolved:    'Resuelto',
    problem_review_status_absent:      'Ausente / negado',
    problem_review_status_unknown:     'Desconocido',
    problem_review_temporality_current:      'Actual',
    problem_review_temporality_historical:   'Previo / cr&oacute;nico',
    problem_review_temporality_undetermined: 'No determinada',
    symptoms_dict_missing:         'Problemas detectados &mdash; <em style="color:#e67e22;font-style:normal;">diccionario no cargado</em>',
    symptoms_dict_unavailable_title:  '<strong>Diccionario de s&iacute;ntomas no disponible.</strong>',
    symptoms_dict_unavailable_detail: 'Recargue la p&aacute;gina o compruebe el estado KB.',
    symptoms_zero_label:           'Problemas activos detectados (0)',
    no_symptoms:                   'No se han detectado problemas cl&iacute;nicos en la nota.',
    symptoms_count:                function (a, i) { return 'Problemas detectados (' + a + ' activo' + (a === 1 ? '' : 's') + (i ? ', ' + i + ' no activo' + (i === 1 ? '' : 's') : '') + ')'; },
    inactive_mentions:             'Menciones no activas (negadas o hist&oacute;ricas):',
    none:                          'Ninguno',
    detection_warning:             'La detecci&oacute;n combina palabras clave, sin&oacute;nimos, marcas comerciales y reglas cl&iacute;nicas simples. Los problemas inferidos se muestran como sospecha/en estudio y requieren validaci&oacute;n profesional.',

    /* Step 2 — rule-based clinical problems (e.g. urologic/renal) */
    problem_category_lbl:          'Categor&iacute;a:',
    problem_certainty_lbl:         'Certeza:',
    problem_evidence_lbl:          'Evidencia:',
    problem_negated_lbl:           'Hallazgos negativos relevantes:',
    certainty_confirmed:           'Diagn&oacute;stico confirmado',
    certainty_suspected:           'Sospecha cl&iacute;nica / en estudio',
    certainty_symptom:             'S&iacute;ntoma/signo cl&iacute;nico',
    certainty_rule_out:            'A descartar',
    certainty_negated:             'Descartado (negado en la nota)',

    /* Step 3 */
    drug_class_none:   'sin clasificar',
    col_drug:          'Medicamento',
    col_class:         'Grupo farmacol&oacute;gico',
    class_summary:     function (drugs, mapped, groups, unmapped) {
      return '<strong>' + drugs + ' medicamento' + (drugs === 1 ? '' : 's') + ' identificado' + (drugs === 1 ? '' : 's') +
        ': ' + mapped + ' clasificado' + (mapped === 1 ? '' : 's') + ' en ' + groups + ' grupo' + (groups === 1 ? '' : 's') +
        ' farmacol&oacute;gico' + (groups === 1 ? '' : 's') + ', ' + unmapped + ' sin clasificar.</strong>';
    },
    no_drugs_to_classify:        'Sin medicamentos a clasificar.',
    no_drugs_to_classify_detail: 'No se detectaron medicamentos en la nota cl&iacute;nica (Paso 2).',

    /* Step 4 */
    kb_ready:             '<strong>Base de conocimiento lista.</strong>',
    kb_ready_detail:      function (c, v, d) { return c + ' patrones de cascada &middot; ' + v + ' modificadores VIH &middot; ' + d + ' interacciones DDI.'; },
    no_cascades_title:    'Sin se&ntilde;ales de cascada detectadas.',
    no_cascades_detail:   'No se han identificado patrones de cascada terap&eacute;utica en la nota cl&iacute;nica.',
    conf_high:            'alto',
    conf_medium:          'medio',
    conf_low:             'bajo',
    appr_often_inappropriate: 'frecuentemente inapropiado',
    appr_often_appropriate:   'frecuentemente apropiado',
    appr_context_dependent:   'dependiente del contexto',
    via_symptom:          'v&iacute;a s&iacute;ntoma',
    candidate_role_initial_response:         'Respuesta inicial',
    candidate_role_initial_response_title:   'Primer f&aacute;rmaco de esta clase iniciado, por orden cronol&oacute;gico, entre los candidatos evaluados para esta regla.',
    candidate_role_subsequent_intensification:       'Intensificaci&oacute;n posterior',
    candidate_role_subsequent_intensification_title: 'F&aacute;rmaco de la misma clase a&ntilde;adido m&aacute;s tarde junto al de "Respuesta inicial", para el mismo problema. No es un hallazgo repetido: son dos f&aacute;rmacos distintos evaluados de forma independiente.',
    risk_label:           'Riesgo:',
    ddi_alert:            'Alerta de interacci&oacute;n:',
    clinical_action:      'Acci&oacute;n cl&iacute;nica:',
    detection_reason:     '&#128269; Motivo de detecci&oacute;n:',
    cascade_count:        function (n) { return n + (n === 1 ? ' posible cascada terap&eacute;utica detectada' : ' posibles cascadas terap&eacute;uticas detectadas'); },
    pharmacist_only_warning: 'Solo para revisi&oacute;n farmac&eacute;utica y cl&iacute;nica. No sustituye el juicio cl&iacute;nico profesional.',

    /* Step 5 */
    clinical_review_label: 'Revisi&oacute;n cl&iacute;nica:',
    tally_confirmed:       function (n) { return n + ' confirmada' + (n === 1 ? '' : 's'); },
    tally_possible:        function (n) { return n + ' posible' + (n === 1 ? '' : 's'); },
    tally_discarded:       function (n) { return n + ' descartada' + (n === 1 ? '' : 's'); },
    tally_unreviewed:      function (n) { return n + ' sin revisar'; },
    all_reviewed:          'Todas revisadas',
    recommended_action:    'Acci&oacute;n recomendada:',
    consider_also:         'Considerar tambi&eacute;n:',
    classify_label:        'Clasificar:',
    btn_confirmed:         'Cascada confirmada',
    btn_possible:          'Cascada posible',
    btn_discard:           'Descartar',
    review_warning:        'Revise cada se&ntilde;al y clasif&iacute;quela. Para uso farmac&eacute;utico y cl&iacute;nico exclusivamente.',
    no_cascades_step5:        'Sin se&ntilde;ales de cascada.',
    no_cascades_step5_detail: 'No se identificaron patrones de cascada terap&eacute;utica &mdash; no se requiere plan de actuaci&oacute;n.',

    /* Step 6 — report display */
    report_title:           'Informe de Auditor&iacute;a de Cascadas Terap&eacute;uticas',
    section_case_data:      'Datos del caso y auditor&iacute;a',
    label_patient_id:       'ID de paciente',
    label_generated:        'Generado',
    label_kb_version:       'Versi&oacute;n KB',
    label_report_schema:    'Esquema del informe',
    section_input_review:   'Entrada cl&iacute;nica y revisi&oacute;n profesional',
    label_source_meds:      'Medicamentos extra&iacute;dos',
    label_effective_meds:   'Medicamentos utilizados por el motor',
    label_med_review:       'Revisi&oacute;n de medicamentos',
    label_problem_review:   'Revisi&oacute;n de problemas',
    review_applied_yes:     'Confirmada y aplicada',
    review_applied_no:      'No aplicada',
    section_prof_changes:   'Cambios y decisiones profesionales',
    med_changes_count:      function (n) { return 'Cambios/altas/exclusiones de medicamentos: ' + n; },
    problem_changes_count:  function (n) { return 'Cambios/altas/exclusiones de problemas: ' + n; },
    discarded_count:        function (n) { return 'Hallazgos descartados profesionalmente: ' + n; },
    section_limitations_report: 'Limitaciones e informaci&oacute;n ausente',
    no_report_limitations:  'Sin limitaciones estructuradas registradas.',
    not_set:                'No establecido',
    section_drugs:          function (n) { return 'Medicamentos detectados (' + n + ')'; },
    section_classes:        function (n) { return 'Grupos farmacol&oacute;gicos (' + n + ')'; },
    none_detected:          'Ninguno detectado',
    not_classified:         'No clasificados',
    inferred_drugs:         function (n) { return '&#9432;&nbsp;' + n + ' medicamento(s) inferido(s) a partir de las cascadas detectadas.'; },
    section_summary:        'Resumen cl&iacute;nico',
    total_findings:         'Total de hallazgos detectados:',
    label_plausible:        'Cascadas plausibles:',
    label_high_priority:    'Cascadas de alta prioridad:',
    main_interventions:     'Principales intervenciones sugeridas:',
    no_dominant_interventions: 'No hay intervenciones dominantes con los datos actuales.',
    section_findings:       function (n) { return 'Hallazgos farmacoterap&eacute;uticos (' + n + ')'; },
    no_cascades_report:     'Sin se&ntilde;ales de cascada terap&eacute;utica detectadas.',

    /* Verification status badges */
    ver_confirmed:   'Confirmada',
    ver_possible:    'Posible',
    ver_not_cascade: 'Descartada',
    ver_unreviewed:  'Sin revisar',

    /* Priority badges */
    prio_high:   'Alta prioridad',
    prio_medium: 'Prioridad intermedia',
    prio_low:    'Baja prioridad',

    /* Finding level */
    level_plausible_label:   'Cascada terap&eacute;utica plausible',
    level_preliminary_label: 'Se&ntilde;al farmacol&oacute;gica preliminar',

    /* Report card field labels */
    tech_id:                  'ID t&eacute;cnico:',
    pharmacological_sequence: 'Secuencia farmacol&oacute;gica:',
    finding_level_lbl:        'Nivel de hallazgo:',
    pharmacy_priority_lbl:    'Prioridad farmac&eacute;utica:',
    what_supports:            'Qu&eacute; lo apoya:',
    what_missing:             'Qu&eacute; falta:',
    level_assigned:           'Nivel asignado:',
    clinical_interpretation_lbl: 'Interpretaci&oacute;n cl&iacute;nica:',
    trigger_signal:           'Se&ntilde;al activadora:',
    factors_in_favor:         'Factores a favor',
    factors_to_verify:        'Factores a verificar',
    suggested_intervention_lbl: 'Intervenci&oacute;n farmac&eacute;utica sugerida:',
    brief_recommendation_lbl: 'Recomendaci&oacute;n cl&iacute;nica breve:',
    certainty_gap_lbl:        'Qu&eacute; falta para mayor certeza:',

    /* Cascade group headings */
    plausible_group:   function (n) { return '1) Cascadas terap&eacute;uticas plausibles (' + n + ')'; },
    no_plausible:      'Sin cascadas plausibles en esta nota.',
    preliminary_group: function (n) { return '2) Se&ntilde;ales farmacol&oacute;gicas preliminares (' + n + ')'; },
    no_preliminary:    'Sin se&ntilde;ales preliminares activas.',

    /* ── Cascade classification (5-level, never "confirmada") ──
       See clinical-engine.js classifyCascadeSignal() / KB_REFERENCE.md. */
    classification_supported_possible_cascade: 'Posible cascada con evidencia suficiente para revisión',
    classification_possible_but_incomplete:    'Posible cascada, información incompleta',
    classification_pharmacological_match_only: 'Coincidencia farmacológica de baja certeza',
    classification_not_evaluable:               'No evaluable por falta de cronología',
    classification_discarded:                   'Descartada por el sistema (evidencia incompatible)',
    classification_manual_discarded:            'Descartada tras validación profesional',
    classification_reason_lbl:                  'Motivo de la clasificación:',
    classification_group_count:                 function (n) { return n + ' señal' + (n === 1 ? '' : 'es'); },

    /* ── Four-dimension label system (Fase 7) ──
       Every possibleCascades signal carries FOUR independent judgments that
       must never be shown as bare, unlabeled badges next to each other —
       see docs/clinical-engine-fix-audit.md §1.4 for the "ALTO / Confirmada
       / Coincidencia farmacológica de baja certeza" contradiction this
       replaces. */
    dim_relevance_lbl:        'Relevancia clínica potencial (bibliografía/KB):',
    dim_knowledge_lbl:        'Estado de validación del conocimiento:',
    dim_assessment_lbl:       'Valoración automatizada de este caso:',
    dim_professional_lbl:     'Validación profesional:',
    dim_professional_pending: 'Pendiente de revisión por el profesional',
    knowledge_reviewed_source: 'Fuente bibliográfica revisada',
    knowledge_pending_review:  'Pendiente de revisión bibliográfica',
    dim_legend_title:         'Cómo leer estas etiquetas',
    dim_legend_text:          'Cada señal muestra cuatro juicios independientes que no deben confundirse entre sí: ' +
      '(1) la relevancia clínica potencial de la asociación según la bibliografía/KB, con independencia de este paciente; ' +
      '(2) si esa asociación de la KB cuenta con una fuente bibliográfica revisada; ' +
      '(3) la valoración automatizada que el sistema hace de ESTE caso concreto a partir de los datos de la nota; y ' +
      '(4) la validación profesional, el único juicio con valor clínico definitivo, que solo puede emitir un clínico.',

    /* Evidence / traceability detail list */
    evidence_details_toggle:        'Ver procedencia y evidencia de esta señal',
    evidence_index_drug:            function (d) { return 'Fármaco índice presente en la nota: ' + d + ' (explícito).'; },
    evidence_cascade_drug:          function (d) { return 'Fármaco posterior presente en la nota: ' + d + ' (explícito).'; },
    evidence_problem_unverifiable:  'No hay en la base de conocimiento un enlace que permita verificar el problema intermedio de esta regla.',
    evidence_problem_not_mentioned: 'El problema clínico intermedio no se menciona en la nota.',
    evidence_problem_status:        function (status, span) { return 'Problema intermedio: ' + status + (span ? ' (“' + span + '”)' : '') + '.'; },
    problem_status_active:          'activo / explícito',
    problem_status_history:         'antecedente / crónico',
    problem_status_negated:         'negado explícitamente',
    problem_status_suspected:       'solo sospechado',
    problem_status_none:            'no mencionado',
    evidence_measurement_discordant:  'La medición clínica disponible no alcanza el umbral diagnóstico habitual: discordancia entre el dato objetivo y el diagnóstico consignado.',
    evidence_measurement_supportive:  'La medición clínica disponible es compatible con el umbral diagnóstico habitual.',
    evidence_temporality_supportive:  'Cronología compatible con una posible cascada terapéutica; la relación causal requiere validación profesional.',
    evidence_temporality_weak:        'Cronología sugiere un problema preexistente/crónico.',
    evidence_temporality_unknown:     'La nota no aporta cronología suficiente.',
    evidence_alt_indication:          function (reason) { return 'Indicación alternativa documentada: ' + reason + '.'; },
    evidence_merged_rule:             function (ids) { return 'Regla consolidada en auditoría KB (fusionada con: ' + ids + ').'; },

    /* Global medication alerts / missing information (Fase 6) */
    section_global_alerts: 'Otros hallazgos relevantes de la medicación',
    no_global_alerts:      'Sin otros hallazgos relevantes de la medicación en esta nota.',
    missing_information_lbl: 'Información ausente que limita la valoración:',

    /* Export buttons */
    btn_copy_record:  'Copiar para historia cl&iacute;nica',
    btn_save_pdf:     'Guardar como PDF',
    btn_export_json:  'Exportar JSON',
    btn_export_csv:   'Exportar CSV',
    decision_support_warning: 'Solo apoyo a la decisi&oacute;n cl&iacute;nica. Su cualificaci&oacute;n y clasificaci&oacute;n regulatoria est&aacute;n pendientes de evaluaci&oacute;n formal; no dispone de marcado CE. No utilizar identificadores reales de pacientes.',

    /* Toast messages */
    toast_storage_full:        'Almacenamiento lleno &mdash; el autoguardado ha fallado. Exporte el caso ahora para no perder datos.',
    toast_report_copied:       'Informe copiado al portapapeles.',
    clipboard_no_text:         'No hay texto disponible para copiar.',
    toast_report_copy_failed:  'No se pudo generar el informe para copiar.',
    toast_clipboard_failed:    'No se pudo copiar autom&aacute;ticamente. Use Exportar JSON/CSV o Guardar como PDF.',
    toast_print_hint:          'Use &laquo;Guardar como PDF&raquo; en el di&aacute;logo de impresi&oacute;n.',
    toast_demo_loaded:         'Caso demo cargado &mdash; avance por los pasos para ver las cascadas detectadas.',
    toast_case_exported:       'Caso exportado correctamente.',
    toast_case_imported:       'Caso importado correctamente.',
    toast_import_type_error:   'Importaci&oacute;n fallida: el archivo debe ser un .json exportado por esta aplicaci&oacute;n.',
    toast_import_failed:       function (msg) { return 'Importaci&oacute;n fallida: ' + msg; },
    import_no_recognizable_data:'El archivo no contiene datos de caso reconocibles. Compruebe que fue exportado por esta aplicaci&oacute;n.',
    toast_file_read_error:     'No se pudo leer el archivo seleccionado.',
    toast_export_failed:       function (msg) { return 'Error al exportar: ' + msg; },
    toast_report_exported:     function (fmt) { return 'Informe exportado (' + fmt + ').'; },
    toast_kb_not_loaded:       'KB no cargada a&uacute;n &mdash; espere a que termine de cargarse antes de exportar.',
    toast_kb_validator_missing:'Validador KB no cargado &mdash; no se puede generar la exportaci&oacute;n operacional.',

    /* Confirm dialogs */
    confirm_load_demo: '\u00BFCargar el caso demo? Los datos actuales ser\u00E1n reemplazados.',
    confirm_delete_all: '\u00BFEliminar TODOS los datos locales? Esta acci\u00F3n no se puede deshacer.',
    confirm_new_case:   '\u00BFIniciar un nuevo caso? Los datos no guardados se perder\u00E1n.',

    /* Plain-text report (clinical record copy) */
    report_header:       'INFORME FARMACOTERAP\u00C9UTICO \u2014 AUDITOR\u00CDA DE CASCADAS',
    report_patient:      'Paciente: ',
    report_not_set:      'No establecido',
    report_date:         'Fecha informe: ',
    report_kb:           'KB: ',
    report_summary:      'Resumen:',
    report_total:        '- Cascadas detectadas: ',
    report_plausible_count: '- Cascadas plausibles: ',
    report_high_prio:    '- Cascadas de alta prioridad: ',
    report_drugs_list:   '- Medicamentos detectados: ',
    report_none:         'Ninguno',
    report_classes_list: '- Grupos farmacol\u00F3gicos: ',
    report_not_classified: 'No clasificados',
    report_no_cascades:  'No se han detectado cascadas terap\u00E9uticas con los datos actuales.',
    report_plausible_section:    function (n) { return 'Cascadas terap\u00E9uticas plausibles (' + n + '):'; },
    report_preliminary_section:  function (n) { return 'Se\u00F1ales farmacol\u00F3gicas preliminares (' + n + '):'; },
    report_seq:          '   - Secuencia: ',
    report_finding:      '   - Nivel de hallazgo: ',
    report_prio:         '   - Prioridad farmac\u00E9utica: ',
    report_evidence:     '   - Evidencia a favor: ',
    report_missing_conf: '   - Qu\u00E9 falta para confirmar: ',
    report_rec:          '   - Recomendaci\u00F3n cl\u00EDnica breve: ',
    report_no_rec:       'Sin recomendaci\u00F3n espec\u00EDfica',
    report_no_support:   'Sin apoyo cl\u00EDnico adicional detectado.',
    report_no_gaps:      'Sin brechas cr\u00EDticas detectadas.',
    report_actions:      'Principales acciones sugeridas:',
    report_warning:      'Advertencia: Requiere validaci\u00F3n cl\u00EDnica-farmac\u00E9utica antes de cualquier cambio terap\u00E9utico.',

    /* Narrative / buildReport strings */
    seq_potential_ade:        'posible EAM',
    temporality_no_data:      'Sin pista temporal alrededor de los f\u00E1rmacos detectados.',
    temporality_supportive:   'Temporalidad compatible (inicio/cambio terap\u00E9utico detectado).',
    temporality_weak:         'Temporalidad d\u00E9bil por posible uso cr\u00F3nico/preexistente.',
    temporality_unknown:      'Temporalidad no demostrada en la nota.',
    symptom_detected:         'S\u00EDntoma compatible detectado en la nota.',
    ade_detected:             function (term) { return 'ADE/s\u00EDntoma compatible detectado (' + term + ').'; },
    kb_has_recommendation:    'KB aporta una recomendaci\u00F3n/intervenci\u00F3n cl\u00EDnica.',
    explicit_kb_evidence:     'Existe evidencia farmacol\u00F3gica expl\u00EDcita en KB (p. ej., alerta DDI).',
    missing_clinical_support: 'Falta soporte cl\u00EDnico adicional para elevarla a cascada plausible.',
    level_plausible_reason:   'Clasificada como plausible por soporte cl\u00EDnico detectable.',
    level_preliminary_reason: 'Permanece preliminar: co-ocurrencia farmacol\u00F3gica sin soporte cl\u00EDnico suficiente.',
    default_interpretation:   'Posible cascada terap\u00E9utica a confirmar con revisi\u00F3n cl\u00EDnica individualizada.',
    no_kb_intervention:       'No hay intervenci\u00F3n espec\u00EDfica en KB; revisar indicaci\u00F3n, balance beneficio-riesgo y alternativas.',
    certainty_gap_text:       'Para aumentar certeza: confirmar temporalidad, causalidad alternativa y respuesta tras ajustes terap\u00E9uticos.',
    no_support_summary:       'Sin apoyo cl\u00EDnico adicional detectado.',
    no_missing_summary:       'Sin brechas cr\u00EDticas detectadas.',
    validation_warning:       'Este informe requiere validaci\u00F3n cl\u00EDnica-farmac\u00E9utica antes de cualquier cambio terap\u00E9utico.',

    /* Priority reasons */
    prio_reason_probability:    function (conf) { return 'Probabilidad ' + conf + '.'; },
    prio_reason_symptom_bridge: 'Puente sint\u00F3mico con evidencia cl\u00EDnica directa.',
    prio_reason_pharmacological:'Se\u00F1al farmacol\u00F3gica de especificidad variable.',
    prio_reason_actionable:     'Existe intervenci\u00F3n farmac\u00E9utica accionable.',
    prio_reason_less_defined:   'Intervenci\u00F3n menos definida con los datos actuales.',
    prio_reason_no_clinical:    'Penalizaci\u00F3n: se\u00F1al sin soporte cl\u00EDnico adicional.',
    prio_reason_temp_good:      'Temporalidad compatible suma prioridad.',
    prio_reason_temp_weak:      'Temporalidad d\u00E9bil reduce prioridad.',
    prio_reason_no_temporal:    'Sin soporte temporal claro: prioridad penalizada.',
    prio_reason_nonspecific:    'Penalizaci\u00F3n adicional: s\u00EDntoma inespec\u00EDfico sin soporte temporal/causal claro.',

    /* Verification items */
    verif_chronology:    'Cronolog\u00EDa cl\u00EDnica precisa: inicio del f\u00E1rmaco \u00EDndice, aparici\u00F3n del s\u00EDntoma/EAM e inicio del f\u00E1rmaco de cascada.',
    verif_indication:    'Indicaci\u00F3n primaria del f\u00E1rmaco de cascada: confirmar si fue prescrito para tratar el posible EAM y no por una enfermedad independiente.',
    verif_evolution:     'Evoluci\u00F3n tras ajustes terap\u00E9uticos (dechallenge/rechallenge cuando sea cl\u00EDnicamente seguro).',
    verif_symptom_active:'Validar si el s\u00EDntoma estaba activo (no negado) y su gravedad actual en la entrevista cl\u00EDnica.',
    verif_no_ade:        'Falta EAM expl\u00EDcito en la nota: revisar historia cl\u00EDnica para documentar manifestaci\u00F3n adversa concreta.',

    /* Signal explanation */
    signal_bridge_base:       'Se activ\u00F3 por coincidencia de f\u00E1rmaco causal + s\u00EDntoma detectado + f\u00E1rmaco usado para tratar ese s\u00EDntoma.',
    signal_bridge_incomplete: ' Temporalidad incompleta en el texto actual.',
    signal_drug_drug:         'Se activ\u00F3 por presencia simult\u00E1nea de f\u00E1rmaco \u00EDndice y f\u00E1rmaco de cascada compatibles con el patr\u00F3n de la KB.',

    /* Alternative-indication penalty — shown when a known diagnosis could independently explain the cascade drug */
    alt_indication_note:          function (reason) { return 'Existe una posible indicaci\u00F3n alternativa independiente para el f\u00E1rmaco de tratamiento (' + reason + '). Verifique si fue prescrito por la cascada o por esta condici\u00F3n preexistente.'; },
    prio_reason_alt_indication:   'Penalizaci\u00F3n: posible indicaci\u00F3n alternativa reduce la confianza en la cascada.',

    /* HIV modifier-only signal — drug_drug signal upgraded only by HIV context, no direct ADE in note */
    hiv_modifier_only_note:       'Se\u00F1al impulsada principalmente por modificador de contexto VIH; falta evidencia directa del EAM en la nota cl\u00EDnica.',
    prio_reason_hiv_modifier_only: 'Penalizaci\u00F3n: modificador VIH sin apoyo directo de EAM en el texto.',

    /* Unknown step */
    unknown_step: 'Paso desconocido.'
  },

  en: {
    /* Redesign (presentation only) */
    chain_index_lbl:   'Index drug',
    chain_ade_lbl:     'Intermediate problem',
    chain_cascade_lbl: 'Subsequent drug',
    rule_id_lbl:       'Rule',
    report_export_lbl: 'Export or share',
    saved_locally:     function (t) { return 'Saved in this browser · ' + t; },
    wf_pending:        'Pending',
    wf_waiting_kb:     'Waiting for KB',
    wf_note_chars:     function (n) { return n.toLocaleString('en-GB') + ' characters'; },
    wf_review_confirmed: 'Review confirmed',
    wf_review_draft:   'Review in draft',
    wf_classified:     function (n, m) { return n + ' of ' + m + ' classified'; },
    wf_signals:        function (n) { return n === 0 ? 'No signals' : n + (n === 1 ? ' signal' : ' signals'); },
    wf_reviewed:       function (n, m) { return n + ' of ' + m + ' verified'; },
    wf_report_ready:   'Available',
    kb_inv_title:      'Loaded files',
    kb_inv_coreCascades:      'General cascades',
    kb_inv_vihModifiers:      'HIV-specific cascades',
    kb_inv_ddiWatchlist:      'Monitored interactions',
    kb_inv_symptomDictionary: 'Symptom dictionary',
    kb_inv_clinicalProblems:  'Clinical problems',
    kb_inv_clinicalModifiers: 'Clinical modifiers',
    kb_inv_drugDictionary:    'Drug dictionary',
    kb_inv_drugCombinations:  'Fixed-dose combinations',
    kb_inv_active_rules: 'active rules',
    kb_inv_entries:    'entries',
    kb_inv_not_loaded: 'Not loaded',
    kb_track_lbl:      function (m) { return m + ' environment'; },
    kb_search_label:   'Search rule, drug or problem',
    kb_search_placeholder: 'e.g. amlodipine, oedema, CC004',
    kb_filter_source:  'Source',
    kb_filter_status:  'Knowledge validation',
    kb_filter_all:     'All',
    kb_source_core:    'General cascades',
    kb_source_hiv:     'HIV-specific',
    kb_results:        function (n, t) { return n + ' of ' + t + ' rules'; },
    kb_no_results:     'No rule matches the search.',
    kb_mechanism:      'Mechanism',
    kb_index_examples: 'Index drug examples',
    kb_cascade_examples: 'Subsequent drug examples',
    kb_action:         'Guidance recorded in the KB',
    kb_references:     'References',
    kb_no_references:  'No bibliographic reference recorded.',
    kb_unavailable:    'The knowledge base is not loaded.',
    kb_catalog_note:   'Only active rules are shown: rules merged during the KB audit are not executed. Drugs are listed by English INN, as recorded in the KB; search also accepts Spanish names and brands from the dictionary.',
    /* Navigation */
    step_counter:     function (n) { return 'Step ' + n + ' of 6'; },
    btn_prev:         'Previous',
    btn_next:         'Next',
    btn_finish:       'Finish',

    /* Step nav labels */
    nav_step1: 'Data',
    nav_step2: 'Medication',
    nav_step3: 'Classification',
    nav_step4: 'Cascades',
    nav_step5: 'Plan',
    nav_step6: 'Report',

    /* Step titles */
    step1_title: 'Case data',
    step2_title: 'Medications &amp; active problems',
    step3_title: 'Pharmacological classification',
    step4_title: 'Possible therapeutic cascades',
    step5_title: 'Clinical verification',
    step6_title: 'Pharmacotherapy plan &amp; report',

    /* Onboarding */
    onboarding_title:       'How the auditor works &mdash; in 3 steps',
    onboarding_step1_title: 'Enter the clinical note',
    onboarding_step1_body:  'Paste the pseudonymised patient clinical note. The auditor will automatically extract medications and active problems.',
    onboarding_step2_title: 'The auditor detects possible cascades',
    onboarding_step2_body:  'It cross-references drugs against the knowledge base: identifies whether any medication may be a consequence of an adverse effect of another.',
    onboarding_step3_title: 'Get a pharmacotherapy plan',
    onboarding_step3_body:  'Classify each finding, add your clinical notes, and export a structured report for the care team.',
    onboarding_hint:        'Try the demo case &mdash; an HIV patient on ART with an antihypertensive causing oedema treated with a diuretic.',
    onboarding_demo_btn:    'Try demo',

    /* Step 1 form */
    note_label:       'Clinical note',
    note_placeholder: 'Paste the pseudonymised clinical note here&hellip;',
    note_hint:        'No real patient identifiers. Data is stored only in this browser.',

    /* Common warnings */
    kb_unavailable_title:  'Knowledge base unavailable.',
    kb_unavailable_detail: 'Check KB status in the footer and reload if necessary.',
    note_empty_title:          'Clinical note is empty.',
    note_empty_detail:         'Enter the clinical note in Step 1 before continuing.',
    note_empty_detail_report:  'Enter the clinical note in Step 1 to generate the report.',

    /* Step 2 */
    drugs_section_label:           'Detected medications',
    inactive_drugs_label:          'Medications mentioned but not active',
    no_drugs_title:                'No medications identified.',
    no_drugs_detail:               'The note may use brand names, abbreviations or drugs not included in the current KB.',
    drugs_detected:                function (n) { return '<strong>' + n + ' medication' + (n === 1 ? '' : 's') + ' detected</strong> in the clinical note.'; },
    med_review_title:              'Pharmacist medication review',
    med_review_intro:              'Check the extracted list, correct names or groups, exclude inactive mentions, and add omitted medications.',
    med_review_status_draft:       'Awaiting confirmation',
    med_review_status_confirmed:   'Review confirmed',
    med_review_source_extracted:   'Extracted',
    med_review_source_manual:      'Added',
    med_review_include:            'Include',
    med_review_name:               'Medication',
    med_review_class:              'Pharmacological group',
    med_review_original:           function (name) { return 'Extracted value: ' + name; },
    med_review_add:                '+ Add medication',
    med_review_remove:             'Remove',
    med_review_confirm:            'Confirm review',
    med_review_reset:              'Restore extraction',
    med_review_empty:              'No medications are included in the review.',
    med_review_validation_error:   'Resolve blank or duplicate medication names before confirming.',
    med_review_confirmed_toast:    'Medication review confirmed.',
    med_review_reset_confirm:      'Medication corrections will be lost. Restore the automatic extraction?',
    med_review_boundary:           '<strong>Controlled clinical input:</strong> only a confirmed, current review changes the analysis. Any later edit returns it to draft status.',
    med_review_not_applied:        '<strong>Medication review pending:</strong> changes remain outside the engine until the review is confirmed.',
    med_review_applied:            '<strong>Medication review applied:</strong> the analysis uses the professionally confirmed list.',
    problem_review_title:              'Clinical problem and temporality review',
    problem_review_intro:              'Validate the problem, its current status, temporal relationship, and documented onset date.',
    problem_review_status_draft:       'Awaiting confirmation',
    problem_review_status_confirmed:   'Review confirmed',
    problem_review_source_extracted:   'Extracted',
    problem_review_source_manual:      'Added',
    problem_review_include:            'Include',
    problem_review_concept:            'Clinical problem',
    problem_review_status:             'Status',
    problem_review_temporality:        'Temporality',
    problem_review_onset:              'Documented onset',
    problem_review_onset_placeholder:  'E.g. Sep 2022',
    problem_review_evidence:           'Original evidence:',
    problem_review_original:           function (concept) { return 'Extracted value: ' + concept; },
    problem_review_add:                '+ Add problem',
    problem_review_remove:             'Remove',
    problem_review_confirm:            'Confirm review',
    problem_review_reset:              'Restore extraction',
    problem_review_empty:              'No problems were extracted. You may add one manually.',
    problem_review_validation_error:   'Resolve blank or duplicate problems before confirming.',
    problem_review_confirmed_toast:    'Problem review confirmed.',
    problem_review_reset_confirm:      'Problem corrections will be lost. Restore the automatic extraction?',
    problem_review_boundary:           '<strong>Controlled clinical input:</strong> only a confirmed, current review changes the analysis. Any later edit returns it to draft status.',
    problem_review_not_applied:        '<strong>Problem review pending:</strong> changes remain outside the engine until the review is confirmed.',
    problem_review_applied:            '<strong>Problem review applied:</strong> the analysis uses the professionally confirmed problems and temporality.',
    problem_review_status_active:      'Active',
    problem_review_status_suspected:   'Suspected',
    problem_review_status_resolved:    'Resolved',
    problem_review_status_absent:      'Absent / negated',
    problem_review_status_unknown:     'Unknown',
    problem_review_temporality_current:      'Current',
    problem_review_temporality_historical:   'Previous / chronic',
    problem_review_temporality_undetermined: 'Undetermined',
    symptoms_dict_missing:         'Active problems &mdash; <em style="color:#e67e22;font-style:normal;">dictionary not loaded</em>',
    symptoms_dict_unavailable_title:  '<strong>Symptom dictionary unavailable.</strong>',
    symptoms_dict_unavailable_detail: 'Reload the page or check KB status.',
    symptoms_zero_label:           'Active problems detected (0)',
    no_symptoms:                   'No clinical problems detected in the note.',
    symptoms_count:                function (a, i) { return 'Problems detected (' + a + ' active' + (i ? ', ' + i + ' inactive' : '') + ')'; },
    inactive_mentions:             'Inactive mentions (negated or historical):',
    none:                          'None',
    detection_warning:             'Detection combines keywords, synonyms, brand names, and simple clinical rules. Inferred problems are shown as suspected/under study and require professional validation.',

    /* Step 2 — rule-based clinical problems (e.g. urologic/renal) */
    problem_category_lbl:          'Category:',
    problem_certainty_lbl:         'Certainty:',
    problem_evidence_lbl:          'Evidence:',
    problem_negated_lbl:           'Relevant negative findings:',
    certainty_confirmed:           'Confirmed diagnosis',
    certainty_suspected:           'Clinical suspicion / under study',
    certainty_symptom:             'Clinical symptom/sign',
    certainty_rule_out:            'To rule out',
    certainty_negated:             'Ruled out (negated in note)',

    /* Step 3 */
    drug_class_none:   'unclassified',
    col_drug:          'Medication',
    col_class:         'Pharmacological group',
    class_summary:     function (drugs, mapped, groups, unmapped) {
      return '<strong>' + drugs + ' medication' + (drugs === 1 ? '' : 's') + ' identified: ' +
        mapped + ' classified into ' + groups + ' pharmacological group' + (groups === 1 ? '' : 's') +
        ', ' + unmapped + ' unclassified.</strong>';
    },
    no_drugs_to_classify:        'No medications to classify.',
    no_drugs_to_classify_detail: 'No medications were detected in the clinical note (Step 2).',

    /* Step 4 */
    kb_ready:             '<strong>Knowledge base ready.</strong>',
    kb_ready_detail:      function (c, v, d) { return c + ' cascade patterns &middot; ' + v + ' HIV modifiers &middot; ' + d + ' DDI interactions.'; },
    no_cascades_title:    'No cascade signals detected.',
    no_cascades_detail:   'No therapeutic cascade patterns identified in the clinical note.',
    conf_high:            'high',
    conf_medium:          'medium',
    conf_low:             'low',
    appr_often_inappropriate: 'often inappropriate',
    appr_often_appropriate:   'often appropriate',
    appr_context_dependent:   'context-dependent',
    via_symptom:          'via symptom',
    candidate_role_initial_response:         'Initial response',
    candidate_role_initial_response_title:   'First drug of this class started, in chronological order, among the candidates evaluated for this rule.',
    candidate_role_subsequent_intensification:       'Later intensification',
    candidate_role_subsequent_intensification_title: 'A drug of the same class added later alongside the "Initial response" one, for the same problem. This is not a repeated finding: they are two distinct drugs evaluated independently.',
    risk_label:           'Risk:',
    ddi_alert:            'Interaction alert:',
    clinical_action:      'Clinical action:',
    detection_reason:     '&#128269; Detection reason:',
    cascade_count:        function (n) { return n + ' possible therapeutic cascade' + (n === 1 ? '' : 's') + ' detected'; },
    pharmacist_only_warning: 'For pharmaceutical and clinical review only. Does not replace professional clinical judgement.',

    /* Step 5 */
    clinical_review_label: 'Clinical review:',
    tally_confirmed:       function (n) { return n + ' confirmed'; },
    tally_possible:        function (n) { return n + ' possible'; },
    tally_discarded:       function (n) { return n + ' discarded'; },
    tally_unreviewed:      function (n) { return n + ' unreviewed'; },
    all_reviewed:          'All reviewed',
    recommended_action:    'Recommended action:',
    consider_also:         'Also consider:',
    classify_label:        'Classify:',
    btn_confirmed:         'Confirmed cascade',
    btn_possible:          'Possible cascade',
    btn_discard:           'Discard',
    review_warning:        'Review and classify each signal. For pharmaceutical and clinical use only.',
    no_cascades_step5:        'No cascade signals.',
    no_cascades_step5_detail: 'No therapeutic cascade patterns identified &mdash; no action plan required.',

    /* Step 6 — report display */
    report_title:           'Therapeutic Cascade Audit Report',
    section_case_data:      'Case data &amp; audit',
    label_patient_id:       'Patient ID',
    label_generated:        'Generated',
    label_kb_version:       'KB version',
    label_report_schema:    'Report schema',
    section_input_review:   'Clinical input and professional review',
    label_source_meds:      'Extracted medications',
    label_effective_meds:   'Medications used by the engine',
    label_med_review:       'Medication review',
    label_problem_review:   'Problem review',
    review_applied_yes:     'Confirmed and applied',
    review_applied_no:      'Not applied',
    section_prof_changes:   'Professional changes and decisions',
    med_changes_count:      function (n) { return 'Medication changes/additions/exclusions: ' + n; },
    problem_changes_count:  function (n) { return 'Problem changes/additions/exclusions: ' + n; },
    discarded_count:        function (n) { return 'Professionally discarded findings: ' + n; },
    section_limitations_report: 'Limitations and missing information',
    no_report_limitations:  'No structured limitations recorded.',
    not_set:                'Not set',
    section_drugs:          function (n) { return 'Medications detected (' + n + ')'; },
    section_classes:        function (n) { return 'Pharmacological groups (' + n + ')'; },
    none_detected:          'None detected',
    not_classified:         'Not classified',
    inferred_drugs:         function (n) { return '&#9432;&nbsp;' + n + ' drug(s) inferred from detected cascades.'; },
    section_summary:        'Clinical summary',
    total_findings:         'Total findings detected:',
    label_plausible:        'Plausible cascades:',
    label_high_priority:    'High-priority cascades:',
    main_interventions:     'Main suggested interventions:',
    no_dominant_interventions: 'No dominant interventions with current data.',
    section_findings:       function (n) { return 'Pharmacotherapy findings (' + n + ')'; },
    no_cascades_report:     'No therapeutic cascade signals detected.',

    /* Verification status badges */
    ver_confirmed:   'Confirmed',
    ver_possible:    'Possible',
    ver_not_cascade: 'Discarded',
    ver_unreviewed:  'Unreviewed',

    /* Priority badges */
    prio_high:   'High priority',
    prio_medium: 'Intermediate priority',
    prio_low:    'Low priority',

    /* Finding level */
    level_plausible_label:   'Plausible therapeutic cascade',
    level_preliminary_label: 'Preliminary pharmacological signal',

    /* Report card field labels */
    tech_id:                  'Technical ID:',
    pharmacological_sequence: 'Pharmacological sequence:',
    finding_level_lbl:        'Finding level:',
    pharmacy_priority_lbl:    'Pharmacy priority:',
    what_supports:            'What supports it:',
    what_missing:             'What is missing:',
    level_assigned:           'Level assigned:',
    clinical_interpretation_lbl: 'Clinical interpretation:',
    trigger_signal:           'Trigger signal:',
    factors_in_favor:         'Factors in favour',
    factors_to_verify:        'Factors to verify',
    suggested_intervention_lbl: 'Suggested pharmaceutical intervention:',
    brief_recommendation_lbl: 'Brief clinical recommendation:',
    certainty_gap_lbl:        'What is needed for greater certainty:',

    /* Cascade group headings */
    plausible_group:   function (n) { return '1) Plausible therapeutic cascades (' + n + ')'; },
    no_plausible:      'No plausible cascades in this note.',
    preliminary_group: function (n) { return '2) Preliminary pharmacological signals (' + n + ')'; },
    no_preliminary:    'No active preliminary signals.',

    /* ── Cascade classification (5-level, never "confirmed") ── */
    classification_supported_possible_cascade: 'Possible cascade with sufficient evidence for review',
    classification_possible_but_incomplete:    'Possible cascade, incomplete information',
    classification_pharmacological_match_only: 'Low-certainty pharmacological coincidence',
    classification_not_evaluable:               'Not evaluable due to missing chronology',
    classification_discarded:                   'Discarded by the system (incompatible evidence)',
    classification_manual_discarded:            'Discarded after professional validation',
    classification_reason_lbl:                  'Reason for this classification:',
    classification_group_count:                 function (n) { return n + ' signal' + (n === 1 ? '' : 's'); },

    /* ── Four-dimension label system (Fase 7) ── */
    dim_relevance_lbl:        'Potential clinical relevance (literature/KB):',
    dim_knowledge_lbl:        'Knowledge validation status:',
    dim_assessment_lbl:       'Automated assessment of this case:',
    dim_professional_lbl:     'Professional validation:',
    dim_professional_pending: 'Pending professional review',
    knowledge_reviewed_source: 'Reviewed literature source',
    knowledge_pending_review:  'Pending literature review',
    dim_legend_title:         'How to read these labels',
    dim_legend_text:          'Each signal shows four independent judgments that must not be conflated: ' +
      '(1) the potential clinical relevance of the association per the literature/KB, independent of this patient; ' +
      '(2) whether that KB association has a reviewed literature source; ' +
      '(3) the system’s automated assessment of THIS specific case based on the note’s data; and ' +
      '(4) professional validation, the only judgment with definitive clinical value, which only a clinician can issue.',

    evidence_details_toggle:        'View provenance and evidence for this signal',
    evidence_index_drug:            function (d) { return 'Index drug present in the note: ' + d + ' (explicit).'; },
    evidence_cascade_drug:          function (d) { return 'Later drug present in the note: ' + d + ' (explicit).'; },
    evidence_problem_unverifiable:  'The knowledge base has no link allowing this rule’s intermediate problem to be verified.',
    evidence_problem_not_mentioned: 'The intermediate clinical problem is not mentioned in the note.',
    evidence_problem_status:        function (status, span) { return 'Intermediate problem: ' + status + (span ? ' (“' + span + '”)' : '') + '.'; },
    problem_status_active:          'active / explicit',
    problem_status_history:         'prior / chronic',
    problem_status_negated:         'explicitly negated',
    problem_status_suspected:       'only suspected',
    problem_status_none:            'not mentioned',
    evidence_measurement_discordant:  'The available clinical measurement does not reach the usual diagnostic threshold: discordance between the objective data point and the recorded diagnosis.',
    evidence_measurement_supportive:  'The available clinical measurement is compatible with the usual diagnostic threshold.',
    evidence_temporality_supportive:  'Chronology compatible with a possible prescribing cascade; the causal relationship requires professional validation.',
    evidence_temporality_weak:        'Chronology suggests a pre-existing/chronic problem.',
    evidence_temporality_unknown:     'The note does not provide enough chronology.',
    evidence_alt_indication:          function (reason) { return 'Documented alternative indication: ' + reason + '.'; },
    evidence_merged_rule:             function (ids) { return 'Rule consolidated in KB audit (merged with: ' + ids + ').'; },

    section_global_alerts: 'Other relevant medication findings',
    no_global_alerts:      'No other relevant medication findings in this note.',
    missing_information_lbl: 'Missing information that limits assessment:',

    /* Export buttons */
    btn_copy_record:  'Copy to medical record',
    btn_save_pdf:     'Save as PDF',
    btn_export_json:  'Export JSON',
    btn_export_csv:   'Export CSV',
    decision_support_warning: 'Decision support only. Regulatory qualification and classification remain subject to formal assessment; the tool does not bear CE marking. Do not use real patient identifiers.',

    /* Toast messages */
    toast_storage_full:        'Storage full &mdash; auto-save failed. Export your case now to avoid data loss.',
    toast_report_copied:       'Report copied to clipboard.',
    clipboard_no_text:         'There is no text available to copy.',
    toast_report_copy_failed:  'Could not generate the report for copying.',
    toast_clipboard_failed:    'Could not copy automatically. Use Export JSON/CSV or Save as PDF.',
    toast_print_hint:          'Use \u201CSave as PDF\u201D in the print dialog.',
    toast_demo_loaded:         'Demo case loaded &mdash; go through the steps to see the detected cascades.',
    toast_case_exported:       'Case exported successfully.',
    toast_case_imported:       'Case imported successfully.',
    toast_import_type_error:   'Import failed: file must be a .json export from this application.',
    toast_import_failed:       function (msg) { return 'Import failed: ' + msg; },
    import_no_recognizable_data:'The file contains no recognisable case data. Make sure it was exported by this application.',
    toast_file_read_error:     'Could not read the selected file.',
    toast_export_failed:       function (msg) { return 'Export failed: ' + msg; },
    toast_report_exported:     function (fmt) { return 'Report exported (' + fmt + ').'; },
    toast_kb_not_loaded:       'KB not loaded yet \u2014 wait for the KB to finish loading before exporting.',
    toast_kb_validator_missing:'KB validator not loaded \u2014 cannot build operational export.',

    /* Confirm dialogs */
    confirm_load_demo:  'Load the demo case? Current data will be replaced.',
    confirm_delete_all: 'Delete ALL local data? This cannot be undone.',
    confirm_new_case:   'Start a new case? Unsaved data will be lost.',

    /* Plain-text report (clinical record copy) */
    report_header:       'PHARMACOTHERAPY REPORT \u2014 CASCADE AUDIT',
    report_patient:      'Patient: ',
    report_not_set:      'Not set',
    report_date:         'Report date: ',
    report_kb:           'KB: ',
    report_summary:      'Summary:',
    report_total:        '- Cascades detected: ',
    report_plausible_count: '- Plausible cascades: ',
    report_high_prio:    '- High-priority cascades: ',
    report_drugs_list:   '- Medications detected: ',
    report_none:         'None',
    report_classes_list: '- Pharmacological groups: ',
    report_not_classified: 'Not classified',
    report_no_cascades:  'No therapeutic cascades detected with current data.',
    report_plausible_section:    function (n) { return 'Plausible therapeutic cascades (' + n + '):'; },
    report_preliminary_section:  function (n) { return 'Preliminary pharmacological signals (' + n + '):'; },
    report_seq:          '   - Sequence: ',
    report_finding:      '   - Finding level: ',
    report_prio:         '   - Pharmacy priority: ',
    report_evidence:     '   - Evidence in favour: ',
    report_missing_conf: '   - What is missing to confirm: ',
    report_rec:          '   - Brief clinical recommendation: ',
    report_no_rec:       'No specific recommendation',
    report_no_support:   'No additional clinical support detected.',
    report_no_gaps:      'No critical gaps detected.',
    report_actions:      'Main suggested actions:',
    report_warning:      'Warning: Requires clinical-pharmacist validation before any therapeutic change.',

    /* Narrative / buildReport strings */
    seq_potential_ade:        'potential ADE',
    temporality_no_data:      'No temporal data around the detected drugs.',
    temporality_supportive:   'Compatible temporality (drug start / therapeutic change detected).',
    temporality_weak:         'Weak temporality \u2014 possible chronic or pre-existing use.',
    temporality_unknown:      'Temporality not demonstrated in the note.',
    symptom_detected:         'Compatible symptom detected in the note.',
    ade_detected:             function (term) { return 'Compatible ADE/symptom detected (' + term + ').'; },
    kb_has_recommendation:    'KB provides a clinical recommendation/intervention.',
    explicit_kb_evidence:     'Explicit pharmacological evidence in KB (e.g. DDI alert).',
    missing_clinical_support: 'Additional clinical support needed to elevate to plausible cascade.',
    level_plausible_reason:   'Classified as plausible due to detectable clinical support.',
    level_preliminary_reason: 'Remains preliminary: pharmacological co-occurrence without sufficient clinical support.',
    default_interpretation:   'Possible therapeutic cascade to confirm with individualised clinical review.',
    no_kb_intervention:       'No specific KB intervention; review indication, benefit-risk balance and alternatives.',
    certainty_gap_text:       'To increase certainty: confirm temporality, alternative causality and response after therapeutic adjustments.',
    no_support_summary:       'No additional clinical support detected.',
    no_missing_summary:       'No critical gaps detected.',
    validation_warning:       'This report requires clinical-pharmacist validation before any therapeutic change.',

    /* Priority reasons */
    prio_reason_probability:    function (conf) { return 'Probability: ' + conf + '.'; },
    prio_reason_symptom_bridge: 'Symptom bridge with direct clinical evidence.',
    prio_reason_pharmacological:'Pharmacological signal of variable specificity.',
    prio_reason_actionable:     'Actionable pharmaceutical intervention exists.',
    prio_reason_less_defined:   'Intervention less defined with current data.',
    prio_reason_no_clinical:    'Penalty: signal without additional clinical support.',
    prio_reason_temp_good:      'Compatible temporality adds priority.',
    prio_reason_temp_weak:      'Weak temporality reduces priority.',
    prio_reason_no_temporal:    'No clear temporal support: priority penalised.',
    prio_reason_nonspecific:    'Additional penalty: non-specific symptom without clear temporal/causal support.',

    /* Verification items */
    verif_chronology:    'Precise clinical timeline: start of index drug, onset of symptom/ADE and start of cascade drug.',
    verif_indication:    'Primary indication of cascade drug: confirm whether it was prescribed to treat the possible ADE rather than an independent condition.',
    verif_evolution:     'Evolution after therapeutic adjustments (dechallenge/rechallenge when clinically safe).',
    verif_symptom_active:'Validate whether the symptom was active (not negated) and its current severity in the clinical interview.',
    verif_no_ade:        'Missing explicit ADE in the note: review medical history to document the specific adverse manifestation.',

    /* Signal explanation */
    signal_bridge_base:       'Triggered by coincidence of causal drug + detected symptom + drug used to treat that symptom.',
    signal_bridge_incomplete: ' Incomplete temporality in the current text.',
    signal_drug_drug:         'Triggered by simultaneous presence of index drug and cascade drug compatible with the KB pattern.',

    /* Alternative-indication penalty — shown when a known diagnosis could independently explain the cascade drug */
    alt_indication_note:          function (reason) { return 'There is a possible independent alternative indication for the treatment drug (' + reason + '). Verify whether it was prescribed for the cascade or for this pre-existing condition.'; },
    prio_reason_alt_indication:   'Penalty: possible alternative indication reduces cascade confidence.',

    /* HIV modifier-only signal — drug_drug signal upgraded only by HIV context, no direct ADE in note */
    hiv_modifier_only_note:       'Signal driven mainly by HIV clinical context modifier; direct ADE evidence is lacking in the clinical note.',
    prio_reason_hiv_modifier_only: 'Penalty: HIV context modifier without direct ADE support in the text.',

    /* Unknown step */
    unknown_step: 'Unknown step.'
  }
};

/**
 * Look up a UI string for the current language.
 * Falls back to Spanish (default language) if key is missing in EN dictionary.
 * Supports function-valued entries: extra arguments are forwarded to the function.
 *
 * @param {string} key
 * @param {...*}   args  Optional arguments forwarded to function-valued entries
 * @returns {string}
 */
function tUI(key) {
  var args = Array.prototype.slice.call(arguments, 1);
  var dict = UI_STRINGS[currentLanguage] || UI_STRINGS.es;
  var val  = dict[key];
  /* Fallback to Spanish when key missing in EN dict */
  if (val === undefined) val = UI_STRINGS.es[key];
  if (typeof val === 'function') return val.apply(null, args);
  return val !== undefined ? String(val) : key;
}

/** Return a translated string for persistent HTML chrome. */
function tStatic(key) {
  var args = Array.prototype.slice.call(arguments, 1);
  var strings = (typeof window !== 'undefined' && window.STATIC_UI_STRINGS) || {};
  var dict = strings[currentLanguage] || strings.es || {};
  var val = dict[key];
  if (val === undefined && strings.es) val = strings.es[key];
  if (typeof val === 'function') return val.apply(null, args);
  return val !== undefined ? String(val) : key;
}

/* ── State ── */
const state = {
  step: 1,
  patientId: '',
  clinicalNote: '',
  kbMode: 'PROD',
  kb: { coreCascades: null, vihModifiers: null, ddiWatchlist: null, symptomDictionary: null, clinicalModifiers: null, adeTreatmentMap: null, clinicalProblems: null, drugDictionary: null, drugCombinations: null, anticholinergicBurdenScale: null },
  /* Cached CaseModel from ClinicalEngine.buildCaseModel() — invalidated
     whenever the note or KB changes. This is now the single source of
     truth for medications/activeProblems/possibleCascades/globalMedicationAlerts;
     Step 2-6 all read from it instead of re-deriving their own view. */
  caseModel: null,
  /* Pharmacist-reviewed medication list. Only a confirmed, current review
     enters caseModel through ReviewedInputAdapter. */
  medicationReview: null,
  /* Pharmacist-reviewed clinical problems and temporality. Only a confirmed,
     current review enters caseModel through ReviewedInputAdapter. */
  problemReview: null,
  /* Step 2 — symptoms found in the clinical note */
  symptomsDetected: [],
  /* Step 2 — rule-based clinical problems (e.g. urologic/renal) found in the
     clinical note; separate from symptomsDetected (ADE symptom dictionary)
     so its richer shape (category/certainty/evidence) never has to be
     reconciled with the existing symptomsDetected export/state contract. */
  clinicalProblemsDetected: [],
  /* Step 5 clinician classifications, keyed by cascade_id.
     Values: 'confirmed' | 'possible' | 'not_cascade' */
  cascadeClassifications: {},
  /* Cache for detectCascades() — invalidated when note or KB changes */
  detectedCascades: null,
  /* Drug mention resolver cache (rebuilt when KB changes) */
  drugResolver: null
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
      medicationReview: state.medicationReview,
      problemReview: state.problemReview,
      symptomsDetected: state.symptomsDetected,
      cascadeClassifications: state.cascadeClassifications
    };
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
    localStorage.setItem(LS_LANG_KEY, currentLanguage);
    markSaved();
  } catch (err) {
    console.error('[Storage] Could not save state:', err);
    /* QuotaExceededError means browser storage is full — surface this to the user
     * so they know their work is at risk, rather than losing it silently. */
    if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      showToast(tUI('toast_storage_full'), 'error');
    }
  }
}

/* Visible confirmation that the case was persisted locally (HAL-12): the
 * indicator previously existed in the DOM but was never updated. */
function markSaved() {
  if (typeof document === 'undefined') return;
  var el = document.getElementById('save-indicator');
  if (!el) return;
  var now = new Date();
  var hh = String(now.getHours()).padStart(2, '0');
  var mm = String(now.getMinutes()).padStart(2, '0');
  el.innerHTML = tUI('saved_locally', hh + ':' + mm);
  el.classList.add('is-visible');
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    /* No saved case: fall through so the language preference below is still
       restored (an early return here used to skip it). */
    const saved = raw ? JSON.parse(raw) : {};
    if (typeof saved.patientId === 'string')    state.patientId    = saved.patientId;
    if (typeof saved.clinicalNote === 'string') state.clinicalNote = saved.clinicalNote;
    if (window.MedicationReview) state.medicationReview = window.MedicationReview.sanitize(saved.medicationReview);
    if (window.ProblemReview) state.problemReview = window.ProblemReview.sanitize(saved.problemReview);
    /* Guard against corrupted or out-of-range step values */
    if (Number.isInteger(saved.step) && saved.step >= 1 && saved.step <= 6) state.step = saved.step;
    if (Array.isArray(saved.symptomsDetected))                 state.symptomsDetected       = saved.symptomsDetected;
    if (saved.cascadeClassifications && typeof saved.cascadeClassifications === 'object' &&
        !Array.isArray(saved.cascadeClassifications))          state.cascadeClassifications = saved.cascadeClassifications;
    /* Migrate clinician verdicts recorded against a cascade id that the
       2026-09-14 KB audit merged into another (CC061→CC001, CC050→CC033;
       see kb/CHANGELOG.md). Without this, a verdict a clinician already
       recorded would silently stop applying because the merged id no
       longer appears in possibleCascades. */
    var CASCADE_ID_MIGRATIONS = { CC061: 'CC001', CC050: 'CC033' };
    Object.keys(CASCADE_ID_MIGRATIONS).forEach(function (oldId) {
      if (state.cascadeClassifications[oldId] && !state.cascadeClassifications[CASCADE_ID_MIGRATIONS[oldId]]) {
        state.cascadeClassifications[CASCADE_ID_MIGRATIONS[oldId]] = state.cascadeClassifications[oldId];
      }
    });
  } catch (err) {
    console.error('[Storage] Could not load state:', err);
  }
  /* Restore language preference */
  try {
    var savedLang = localStorage.getItem(LS_LANG_KEY);
    if (savedLang === 'es' || savedLang === 'en') currentLanguage = savedLang;
  } catch (err) {
    console.error('[Storage] Could not load language preference:', err);
  }
}

function clearState() {
  try {
    localStorage.removeItem(LS_KEY);
    state.step = 1;
    state.patientId = '';
    state.clinicalNote = '';
    state.medicationReview = null;
    state.problemReview = null;
    state.symptomsDetected = [];
    state.cascadeClassifications = {};
    state.detectedCascades = null;
    state.caseModel = null;
    state.drugResolver = null;
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
    symptomDictionary: folder + '/kb_symptoms.json',
    clinicalModifiers:  folder + '/kb_clinical_modifiers.json',
    adeTreatmentMap:    folder + '/ade_treatment_map.json',
    /* Active clinical problems (diagnoses/comorbidities) dictionary — added
     * in the clinical-engine audit; drives CaseModel.activeProblems,
     * cascade intermediate-problem verification, and alternative-indication
     * detection (previously a hardcoded ALTERNATIVE_INDICATION_MAP in this
     * file — see kb/CHANGELOG.md). */
    clinicalProblems:  folder + '/clinical_problems.json',
    /* Shared drug name dictionary — lives at kb/ root, not inside a track
     * subfolder, because variant/brand-name mappings are track-independent. */
    drugDictionary:    'kb/drug_dictionary.json',
    /* Fixed-dose combination products (brand → active ingredients), also
     * track-independent — see kb/drug_combinations.json for rationale. */
    drugCombinations:  'kb/drug_combinations.json',
    /* Sourced ACB (Anticholinergic Cognitive Burden) scale used by
     * ClinicalEngine.scoreAnticholinergicBurden — replaces the old
     * CM006 keyword-trigger alert (see kb/CHANGELOG.md, Fase 6). Also
     * track-independent: the scale itself doesn't vary by KB track. */
    anticholinergicBurdenScale: 'kb/anticholinergic_burden_scale.json'
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
  invalidateDrugResolver();
  invalidateDetectedCascades();

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

var lastKBLoadStatus = { loaded: 0, failed: 0 };

function updateKBStatus(loaded, failed) {
  lastKBLoadStatus = { loaded: loaded, failed: failed };
  var mode = state.kbMode;
  var version = getKBVersion();

  var statusEl = document.getElementById('kb-status');
  if (statusEl) {
    if (failed === 0) {
      statusEl.innerHTML = '<span class="kb-chip ok">&#10003; KB ' + mode + (version ? ' v' + version : '') + '</span>';
    } else if (loaded === 0) {
      /* Total failure — all files unavailable */
      statusEl.innerHTML = '<span class="kb-chip fail">&#10007; ' + tStatic('kb_status_unavailable', failed) + '</span>';
    } else {
      /* Partial failure — some files loaded, some failed */
      statusEl.innerHTML =
        '<span class="kb-chip ok">&#10003; ' + tStatic('kb_status_loaded', loaded) + '</span> ' +
        '<span class="kb-chip fail">&#10007; ' + tStatic('kb_status_failed', failed) + '</span> ' +
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

  /* Production keeps validation diagnostics out of the public DOM.  The
   * validator still runs above on every KB load; its full output remains
   * available to maintainers through the browser console. */
  if (state.kbMode === 'PROD') {
    (opResult.warnings || []).forEach(function (warning) {
      console.warn('[KB validation warning]', warning);
    });
    (opResult.errors || []).forEach(function (error) {
      console.error('[KB validation error]', error);
    });

    var prodBanner = document.getElementById('kb-validation-banner');
    if (opResult.ok || !opResult.errors || opResult.errors.length === 0) {
      if (prodBanner && prodBanner.parentNode) prodBanner.parentNode.removeChild(prodBanner);
      return;
    }

    if (!prodBanner) {
      prodBanner = document.createElement('div');
      prodBanner.id = 'kb-validation-banner';
      prodBanner.style.cssText = 'position:relative;z-index:100;font-size:.8rem;font-family:inherit;padding:0';
      var prodMain = document.querySelector('main.app-main') || document.body;
      prodMain.insertBefore(prodBanner, prodMain.firstChild);
    }
    prodBanner.innerHTML =
      '<div style="background:#c0392b;color:#fff;padding:.6rem 1rem;">' +
        '<strong>&#9888; ' + escHtml(tStatic('kb_validation_failed_generic')) + '</strong>' +
      '</div>';
    return;
  }

  var byField    = opResult.fallbackByField    || {};
  var byFieldIds = opResult.fallbackByFieldIds || {};
  var hasFallback = opResult.fallbackCascadeCount > 0;

  /* i18n detail rows — shown only inside the expandable panel, never in the headline */
  var i18nDetailItems = Object.keys(byField).sort().map(function (field) {
    var count = byField[field];
    var ids   = byFieldIds[field] || [];
    return '<li><code>' + escHtml(field) + '</code>: ' + escHtml(tStatic('kb_fallback_field', count)) +
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
      '<strong>' + tStatic('kb_errors_label') + '</strong><ul style="margin:.4rem 0 0 1.2rem;padding:0;">' +
        opResult.errors.map(function(e){ return '<li>' + escHtml(e) + '</li>'; }).join('') +
      '</ul>' +
      (structuralItems.length ?
        '<strong>' + tStatic('kb_warnings_label') + '</strong><ul style="margin:.4rem 0 0 1.2rem;padding:0;">' +
          structuralItems.join('') + '</ul>' : '') +
      /* i18n note inside error detail, not as a separate banner */
      (hasFallback ?
        '<details style="margin-top:.5rem"><summary style="cursor:pointer;font-size:.75rem;">' +
          escHtml(tStatic('kb_translation_details', opResult.fallbackCascadeCount, opResult.fallbackFieldCount)) + '</summary>' +
          '<ul style="margin:.3rem 0 0 1.2rem;padding:0;">' + i18nDetailItems.join('') + '</ul>' +
        '</details>' : '');
    banner.innerHTML =
      '<div style="background:#c0392b;color:#fff;padding:.6rem 1rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;">' +
        '<strong>&#9888; ' + escHtml(tStatic('kb_load_error', opResult.errors.length)) + '</strong>' +
        '<button type="button" data-action="toggle-kb-validation" aria-expanded="false" aria-controls="kb-val-detail" ' +
          'style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.5);color:#fff;padding:.2rem .5rem;cursor:pointer;border-radius:3px;font-size:.75rem;">' + escHtml(tStatic('kb_view_errors')) + '</button>' +
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
      ? tStatic('kb_language_mixed', opResult.fallbackCascadeCount, opResult.fallbackFieldCount)
      : tStatic('kb_notices', structuralItems.length);

    /* Detail panel: structural warnings first, then i18n per-field breakdown */
    var amberDetailParts = [];
    if (structuralItems.length > 0) {
      amberDetailParts.push(
        '<strong style="display:block;margin-bottom:.2rem">' + tStatic('kb_structural_notices') + '</strong>' +
        '<ul style="margin:.2rem 0 .5rem 1.2rem;padding:0;">' + structuralItems.join('') + '</ul>'
      );
    }
    if (hasFallback) {
      amberDetailParts.push(
        '<ul style="margin:.2rem 0 0 1.2rem;padding:0;">' + i18nDetailItems.join('') + '</ul>'
      );
    }

    var detailBtnLabel = hasFallback ? tStatic('kb_show_translation_details') : tStatic('kb_view_notices');

    banner.innerHTML =
      '<div style="background:#f39c12;color:#fff;padding:.4rem 1rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;">' +
        '<span>&#9888; ' + headlineText + '</span>' +
        '<button type="button" data-action="toggle-kb-validation" aria-expanded="false" aria-controls="kb-val-detail" ' +
          'style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.5);color:#fff;padding:.15rem .45rem;cursor:pointer;border-radius:3px;font-size:.75rem;">' +
          escHtml(detailBtnLabel) + '</button>' +
        '<button type="button" data-action="dismiss-kb-validation" ' +
          'style="margin-left:auto;background:transparent;border:none;color:#fff;cursor:pointer;font-size:1rem;line-height:1;" title="' + escHtml(tStatic('dismiss')) + '">&times;</button>' +
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
    showToast(tUI('toast_kb_not_loaded'), 'warning');
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
    showToast(tUI('toast_kb_not_loaded'), 'warning');
    return;
  }
  if (typeof buildOperationalKB !== 'function') {
    showToast(tUI('toast_kb_validator_missing'), 'error');
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
    showToast(tUI('toast_export_failed', err.message || 'unknown error'), 'error');
  }
}

/* ============================================================
   Cascade Detection Engine — thin UI-layer bridge to clinical-engine.js
   ============================================================
   All clinical logic (normalization, drug resolution, active-problem
   extraction, cascade evaluation and classification, global medication
   alerts) now lives in clinical-engine.js as pure, DOM-free functions —
   see that file for the full documentation and kb/CHANGELOG.md /
   KB_REFERENCE.md for the audit that produced this split.

   This section keeps the small set of function NAMES the rest of this
   file (Step 2-6 rendering, self-tests, export) already calls, but each
   is now a thin wrapper that delegates to window.ClinicalEngine and/or
   caches the result on `state`. Nothing below this comment block
   re-implements clinical logic; it only adapts calling conventions
   (e.g. supplying `state.kb` / the cached drug resolver implicitly, so
   existing single-argument call sites keep working unchanged) and caches
   expensive results on `state`.
   ============================================================ */

var CE = window.ClinicalEngine;
var MR = window.MedicationReview;
var ProblemReview = window.ProblemReview;
var ReviewedInputAdapter = window.ReviewedInputAdapter;
var ReportContract = window.ReportContract;

function normalizeClinicalText(text) { return CE.normalizeClinicalText(text); }
function normalizeDrugText(text) { return CE.normalizeDrugText(text); }
function normalizeSymptomText(text) { return CE.normalizeSymptomText(text); }
function findTermInNote(noteText, term) { return CE.findTermInNote(noteText, term); }
function isNegatedSymptom(noteText, matchIndex, matchLength) { return CE.isNegatedSymptom(noteText, matchIndex, matchLength); }
function extractSentenceSnippet(text, index, length) { return CE.extractSentenceSnippet(text, index, length); }
function findClinicalFinding(originalText, normalizedText, term) { return CE.findClinicalFinding(originalText, normalizedText, term); }
function detectTimeCues(noteText, matchIndex) { return CE.detectTimeCues(noteText, matchIndex); }
function getIndexExamples(cascade) { return CE.getIndexExamples(cascade); }
function getCascadeExamples(cascade) { return CE.getCascadeExamples(cascade); }

function invalidateDrugResolver() { state.drugResolver = null; }
function invalidateDetectedCascades() { state.detectedCascades = null; state.caseModel = null; }
function invalidateReviewedClinicalInput() {
  invalidateDetectedCascades();
  /* A verdict belongs to the exact candidate set that was reviewed. Once a
     medication/problem input changes, retaining old verdicts could silently
     attach them to a clinically different analysis. */
  state.cascadeClassifications = {};
}

function getDrugResolver() {
  if (!state.drugResolver) state.drugResolver = CE.buildDrugResolver(state.kb);
  return state.drugResolver;
}

function resolveDrugMentions(noteText) { return CE.resolveDrugMentions(noteText, getDrugResolver()); }
function drugFoundInNote(noteText, drug) { return CE.drugFoundInNote(noteText, drug, getDrugResolver()); }
function extractDrugs(noteText) { return CE.extractDrugs(noteText, getDrugResolver()); }

function extractSymptoms(noteText) {
  var result = CE.extractSymptoms(noteText, state.kb);
  state.symptomsDetected = result;
  return result;
}

function detectClinicalProblems(noteText) {
  var result = CE.detectActiveProblems(noteText, state.kb, currentLanguage, getDrugResolver());
  state.clinicalProblemsDetected = result;
  return result;
}

function detectUrologicRenalProblem(noteText) {
  return CE.detectUrologicRenalProblem(noteText, currentLanguage, getDrugResolver());
}

/**
 * Preserve CaseModel's dictionary-backed classification. Cascade-role classes
 * are consulted only for legacy medicines absent from the dictionary.
 *
 * @param {Array<object|string>} medications
 * @returns {Array<{drug: string, class: string}>}
 */
function normalizeDrugs(medications) {
  if (!medications || !medications.length) return [];
  var fallbackClass = {};
  var allCascades = [].concat(
    (state.kb.coreCascades && state.kb.coreCascades.cascades) || [],
    (state.kb.vihModifiers && state.kb.vihModifiers.art_related_cascades) || []
  ).filter(function (c) { return c.status !== 'merged'; });

  allCascades.forEach(function (cascade) {
    var idxArr = cascade.index_drug_classes || (cascade.index_drug_class ? [cascade.index_drug_class] : []);
    CE.getIndexExamples(cascade).forEach(function (drug) {
      if (!fallbackClass[drug.toLowerCase()] && idxArr[0]) fallbackClass[drug.toLowerCase()] = idxArr[0];
    });
    CE.getCascadeExamples(cascade).forEach(function (drug) {
      if (!fallbackClass[drug.toLowerCase()] && cascade.cascade_drug_class) fallbackClass[drug.toLowerCase()] = cascade.cascade_drug_class;
    });
  });

  return medications.map(function (medication) {
    var drug = typeof medication === 'string' ? medication : medication.normalized_name;
    var authoritativeClass = typeof medication === 'string' ? '' : (medication.drug_class || '');
    return { drug: drug, class: authoritativeClass || fallbackClass[drug.toLowerCase()] || '' };
  });
}

function findCascadeEntry(cascadeId) { return CE.findCascadeEntry(cascadeId, state.kb); }
function findCascadeEntryForSignal(signal) { return CE.findCascadeEntryForSignal(signal, state.kb); }

/**
 * Cached wrapper around ClinicalEngine.buildCaseModel() — the single
 * source of truth for medications / activeProblems / clinicalMeasurements
 * / possibleCascades / globalMedicationAlerts / missingInformation.
 * Invalidated (state.caseModel = null) whenever the note or KB changes —
 * see invalidateDetectedCascades(), called from every place that used to
 * invalidate the old detectedCascades cache.
 */
function getCaseModel(noteText) {
  if (!state.caseModel) {
    var extractedModel = CE.buildCaseModel(noteText, state.kb, { lang: currentLanguage });
    var reviewedInput = ReviewedInputAdapter
      ? ReviewedInputAdapter.build(extractedModel, state.medicationReview, state.problemReview, state.kb)
      : null;
    var reviewApplied = reviewedInput && (
      reviewedInput.application.medications.applied || reviewedInput.application.problems.applied
    );
    state.caseModel = reviewApplied
      ? CE.buildCaseModel(noteText, state.kb, { lang: currentLanguage, reviewedInput: reviewedInput })
      : extractedModel;
    state.caseModel.reviewedInputApplication = reviewedInput ? reviewedInput.application : null;
    state.caseModel.reviewAudit = reviewedInput ? reviewedInput.audit : null;
    /* Step 2 must always compare the professional review against the source
       extraction, never against its own already-corrected output. */
    state.caseModel.extractedClinicalInput = {
      medications: extractedModel.medications,
      activeProblems: extractedModel.activeProblems
    };
    migrateClassificationsToCandidateId(state.caseModel.possibleCascades);
  }
  return state.caseModel;
}

function ensureMedicationReview(medications) {
  if (!MR) return null;
  var next = MR.ensureCurrent(state.medicationReview, medications || []);
  if (JSON.stringify(next) !== JSON.stringify(state.medicationReview)) {
    state.medicationReview = next;
    saveState();
  }
  return state.medicationReview;
}

function renderMedicationReview(medications) {
  var review = ensureMedicationReview(medications);
  if (!review) return '';
  var includedCount = MR.reviewedMedications(review).length;
  var statusKey = review.status === 'confirmed' ? 'med_review_status_confirmed' : 'med_review_status_draft';
  var statusClass = review.status === 'confirmed' ? 'is-confirmed' : 'is-draft';
  var rows = review.items.map(function (item) {
    var inputId = 'med-review-name-' + item.id;
    var classId = 'med-review-class-' + item.id;
    var sourceKey = item.source === 'manual' ? 'med_review_source_manual' : 'med_review_source_extracted';
    var original = item.source === 'extracted'
      ? '<div class="med-review-original">' + tUI('med_review_original', escHtml(item.original_name)) + '</div>'
      : '';
    var removeButton = item.source === 'manual'
      ? '<button type="button" class="btn btn-ghost btn-sm med-review-remove" data-action="remove-medication-row" data-medication-id="' + escHtml(item.id) + '">' + tUI('med_review_remove') + '</button>'
      : '';
    return (
      '<div class="med-review-row' + (item.included ? '' : ' is-excluded') + '">' +
        '<div class="med-review-row-head">' +
          '<span class="med-review-source ' + (item.source === 'manual' ? 'is-manual' : '') + '">' + tUI(sourceKey) + '</span>' +
          '<label class="med-review-include"><input type="checkbox" data-medication-field="included" data-medication-id="' + escHtml(item.id) + '"' + (item.included ? ' checked' : '') + '> ' + tUI('med_review_include') + '</label>' +
          removeButton +
        '</div>' +
        '<div class="med-review-fields">' +
          '<label for="' + inputId + '"><span>' + tUI('med_review_name') + '</span>' +
            '<input id="' + inputId + '" type="text" maxlength="200" autocomplete="off" data-medication-field="normalized_name" data-medication-id="' + escHtml(item.id) + '" value="' + escHtml(item.normalized_name) + '">' +
            original +
          '</label>' +
          '<label for="' + classId + '"><span>' + tUI('med_review_class') + '</span>' +
            '<input id="' + classId + '" type="text" maxlength="200" autocomplete="off" data-medication-field="drug_class" data-medication-id="' + escHtml(item.id) + '" value="' + escHtml(item.drug_class) + '">' +
          '</label>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  if (!rows) rows = '<p class="med-review-empty">' + tUI('med_review_empty') + '</p>';
  return (
    '<section class="med-review-panel" aria-labelledby="med-review-title">' +
      '<div class="med-review-heading">' +
        '<div><h3 id="med-review-title">' + tUI('med_review_title') + '</h3><p>' + tUI('med_review_intro') + '</p></div>' +
        '<span class="med-review-status ' + statusClass + '">' + tUI(statusKey) + ' · ' + includedCount + '</span>' +
      '</div>' +
      '<div class="med-review-list">' + rows + '</div>' +
      '<div class="med-review-actions">' +
        '<button type="button" class="btn btn-outline btn-sm" data-action="add-medication-row">' + tUI('med_review_add') + '</button>' +
        '<button type="button" class="btn btn-primary btn-sm" data-action="confirm-medication-review">' + tUI('med_review_confirm') + '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="reset-medication-review">' + tUI('med_review_reset') + '</button>' +
      '</div>' +
      '<div class="callout callout-warning med-review-boundary">' + tUI('med_review_boundary') + '</div>' +
    '</section>'
  );
}

function ensureProblemReview(problems) {
  if (!ProblemReview) return null;
  var next = ProblemReview.ensureCurrent(state.problemReview, problems || []);
  if (JSON.stringify(next) !== JSON.stringify(state.problemReview)) {
    state.problemReview = next;
    saveState();
  }
  return state.problemReview;
}

function reviewOption(value, current, labelKey) {
  return '<option value="' + value + '"' + (value === current ? ' selected' : '') + '>' + tUI(labelKey) + '</option>';
}

function renderProblemReview(problems) {
  var review = ensureProblemReview(problems);
  if (!review) return '';
  var includedCount = ProblemReview.reviewedProblems(review).length;
  var statusKey = review.status === 'confirmed' ? 'problem_review_status_confirmed' : 'problem_review_status_draft';
  var statusClass = review.status === 'confirmed' ? 'is-confirmed' : 'is-draft';
  var rows = review.items.map(function (item) {
    var prefix = 'problem-review-' + item.id;
    var sourceKey = item.source === 'manual' ? 'problem_review_source_manual' : 'problem_review_source_extracted';
    var removeButton = item.source === 'manual'
      ? '<button type="button" class="btn btn-ghost btn-sm problem-review-remove" data-action="remove-problem-row" data-problem-id="' + escHtml(item.id) + '">' + tUI('problem_review_remove') + '</button>'
      : '';
    var original = item.source === 'extracted'
      ? '<div class="problem-review-original">' + tUI('problem_review_original', escHtml(item.original_concept)) + '</div>'
      : '';
    var evidence = item.evidence_span
      ? '<div class="problem-review-evidence"><strong>' + tUI('problem_review_evidence') + '</strong> “' + escHtml(item.evidence_span) + '”</div>'
      : '';
    var statusOptions = [
      reviewOption('active', item.status, 'problem_review_status_active'),
      reviewOption('suspected', item.status, 'problem_review_status_suspected'),
      reviewOption('resolved', item.status, 'problem_review_status_resolved'),
      reviewOption('absent', item.status, 'problem_review_status_absent'),
      reviewOption('unknown', item.status, 'problem_review_status_unknown')
    ].join('');
    var temporalityOptions = [
      reviewOption('current', item.temporality, 'problem_review_temporality_current'),
      reviewOption('historical', item.temporality, 'problem_review_temporality_historical'),
      reviewOption('undetermined', item.temporality, 'problem_review_temporality_undetermined')
    ].join('');
    return (
      '<div class="problem-review-row' + (item.included ? '' : ' is-excluded') + '">' +
        '<div class="problem-review-row-head">' +
          '<span class="problem-review-source ' + (item.source === 'manual' ? 'is-manual' : '') + '">' + tUI(sourceKey) + '</span>' +
          '<label class="problem-review-include"><input type="checkbox" data-problem-field="included" data-problem-id="' + escHtml(item.id) + '"' + (item.included ? ' checked' : '') + '> ' + tUI('problem_review_include') + '</label>' +
          removeButton +
        '</div>' +
        '<div class="problem-review-fields">' +
          '<label class="problem-review-concept" for="' + prefix + '-concept"><span>' + tUI('problem_review_concept') + '</span>' +
            '<input id="' + prefix + '-concept" type="text" maxlength="300" autocomplete="off" data-problem-field="concept" data-problem-id="' + escHtml(item.id) + '" value="' + escHtml(item.concept) + '">' + original +
          '</label>' +
          '<label for="' + prefix + '-status"><span>' + tUI('problem_review_status') + '</span>' +
            '<select id="' + prefix + '-status" data-problem-field="status" data-problem-id="' + escHtml(item.id) + '">' + statusOptions + '</select>' +
          '</label>' +
          '<label for="' + prefix + '-temporality"><span>' + tUI('problem_review_temporality') + '</span>' +
            '<select id="' + prefix + '-temporality" data-problem-field="temporality" data-problem-id="' + escHtml(item.id) + '">' + temporalityOptions + '</select>' +
          '</label>' +
          '<label for="' + prefix + '-onset"><span>' + tUI('problem_review_onset') + '</span>' +
            '<input id="' + prefix + '-onset" type="text" maxlength="80" autocomplete="off" placeholder="' + tUI('problem_review_onset_placeholder') + '" data-problem-field="onset_date" data-problem-id="' + escHtml(item.id) + '" value="' + escHtml(item.onset_date) + '">' +
          '</label>' +
        '</div>' + evidence +
      '</div>'
    );
  }).join('');

  if (!rows) rows = '<p class="problem-review-empty">' + tUI('problem_review_empty') + '</p>';
  return (
    '<section class="problem-review-panel" aria-labelledby="problem-review-title">' +
      '<div class="problem-review-heading">' +
        '<div><h3 id="problem-review-title">' + tUI('problem_review_title') + '</h3><p>' + tUI('problem_review_intro') + '</p></div>' +
        '<span class="problem-review-review-status ' + statusClass + '">' + tUI(statusKey) + ' · ' + includedCount + '</span>' +
      '</div>' +
      '<div class="problem-review-list">' + rows + '</div>' +
      '<div class="problem-review-actions">' +
        '<button type="button" class="btn btn-outline btn-sm" data-action="add-problem-row">' + tUI('problem_review_add') + '</button>' +
        '<button type="button" class="btn btn-primary btn-sm" data-action="confirm-problem-review">' + tUI('problem_review_confirm') + '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="reset-problem-review">' + tUI('problem_review_reset') + '</button>' +
      '</div>' +
      '<div class="callout callout-warning problem-review-boundary">' + tUI('problem_review_boundary') + '</div>' +
    '</section>'
  );
}

/** One-time migration for clinician verdicts recorded before candidate_id
 * existed, when Step 5's buttons were keyed by the bare cascade_id (the KB
 * rule id). That collided whenever one rule produced more than one
 * candidate (e.g. VIH003 for both metformin and atorvastatin): classifying
 * either card silently overwrote the same shared key. Now that each
 * candidate has its own candidate_id, an old flat verdict is carried
 * forward only when it is unambiguous — i.e. this note's rule produced
 * exactly one candidate — since with two or more candidates there is no
 * way to know which one the old verdict was actually about. */
function migrateClassificationsToCandidateId(possibleCascades) {
  var byRule = {};
  (possibleCascades || []).forEach(function (c) {
    (byRule[c.cascade_id] = byRule[c.cascade_id] || []).push(c);
  });
  Object.keys(byRule).forEach(function (ruleId) {
    var group = byRule[ruleId];
    var oldVerdict = state.cascadeClassifications[ruleId];
    if (group.length === 1 && oldVerdict && !state.cascadeClassifications[group[0].candidate_id]) {
      state.cascadeClassifications[group[0].candidate_id] = oldVerdict;
    }
  });
}

/** Back-compat name: Step 4/6 and the self-test call getDetectedCascades()
 * expecting the flat signal array (possibleCascades). */
function getDetectedCascades(noteText) {
  return getCaseModel(noteText).possibleCascades;
}
/* ============================================================
   Step 5 — clinician classification handler
   Called by the delegated classify-cascade action.
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
    title: function () { return tUI('step1_title'); },
    body: function () {
      var onboarding = '';
      if (!state.clinicalNote || !state.clinicalNote.trim()) {
        onboarding = (
          '<div class="onboarding-panel" id="onboarding-panel">' +
            '<div class="onboarding-header">' +
              '<span class="onboarding-icon" aria-hidden="true">' + ICONS.compass + '</span>' +
              '<strong>' + tUI('onboarding_title') + '</strong>' +
            '</div>' +
            '<div class="onboarding-steps">' +
              '<div class="onboarding-step">' +
                '<span class="onboarding-step-num">1</span>' +
                '<div class="onboarding-step-body">' +
                  '<strong>' + tUI('onboarding_step1_title') + '</strong>' +
                  '<p>' + tUI('onboarding_step1_body') + '</p>' +
                '</div>' +
              '</div>' +
              '<div class="onboarding-step">' +
                '<span class="onboarding-step-num">2</span>' +
                '<div class="onboarding-step-body">' +
                  '<strong>' + tUI('onboarding_step2_title') + '</strong>' +
                  '<p>' + tUI('onboarding_step2_body') + '</p>' +
                '</div>' +
              '</div>' +
              '<div class="onboarding-step">' +
                '<span class="onboarding-step-num">3</span>' +
                '<div class="onboarding-step-body">' +
                  '<strong>' + tUI('onboarding_step3_title') + '</strong>' +
                  '<p>' + tUI('onboarding_step3_body') + '</p>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="onboarding-actions">' +
              '<span class="onboarding-hint">' + tUI('onboarding_hint') + '</span>' +
              '<button class="btn btn-outline btn-sm" data-action="load-demo" type="button">' + tUI('onboarding_demo_btn') + '</button>' +
            '</div>' +
          '</div>'
        );
      }
      return (
        onboarding +
        '<div class="form-group">' +
          '<label class="form-label" for="note-input">' + tUI('note_label') + '</label>' +
          '<textarea id="note-input" class="textarea-clinical" spellcheck="false" aria-describedby="note-hint note-meta" ' +
            'placeholder="' + tUI('note_placeholder') + '">' +
            escHtml(state.clinicalNote) +
          '</textarea>' +
          '<div class="form-foot">' +
            '<div class="form-hint" id="note-hint">' + tUI('note_hint') + '</div>' +
            '<div class="form-meta" id="note-meta" aria-live="off">' + tUI('wf_note_chars', (state.clinicalNote || '').length) + '</div>' +
          '</div>' +
        '</div>'
      );
    },
    onMount: function (el) {
      var ta = el.querySelector('#note-input');
      if (ta) {
        ta.addEventListener('input', function () {
          state.clinicalNote = ta.value;
          state.medicationReview = null;
          state.problemReview = null;
          invalidateDetectedCascades();
          invalidateDrugResolver();
          saveState();
          var meta = el.querySelector('#note-meta');
          if (meta) meta.innerHTML = tUI('wf_note_chars', ta.value.length);
          updateWorkflowStatus({ lightweight: true });
        });
      }
    }
  },
  2: {
    title: function () { return tUI('step2_title'); },
    body: function () {
      var kbReady = state.kb.coreCascades && state.kb.vihModifiers;
      if (!kbReady) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>' + tUI('kb_unavailable_title') + '</strong> ' +
            tUI('kb_unavailable_detail') +
          '</div>'
        );
      }
      if (!state.clinicalNote || !state.clinicalNote.trim()) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>' + tUI('note_empty_title') + '</strong> ' +
            tUI('note_empty_detail') +
          '</div>'
        );
      }

      /* ── Drug extraction ──────────────────────────────────────────────────
       * 1. extractDrugs() calls resolveDrugMentions(), which:
       *    a) applies normalizeDrugText() to the free-text note (strips
       *       diacritics, lowercases, collapses punctuation), and
       *    b) runs the compiled variant-regex built by buildDrugResolver()
       *       against the normalised text.  The regex covers KB cascade
       *       drug examples, manual aliases (AZT, TDF …) and all entries
       *       from kb/drug_dictionary.json (Spanish INNs, brand names, etc.)
       * 2. Each matched surface form is looked up in resolver.byVariant to
       *    retrieve its canonical English INN (e.g. "amlodipino" → "amlodipine").
       * 3. Unique canonical names are returned for display and forwarded to
       *    the cascade detection engine. */
      var medicationModel = getCaseModel(state.clinicalNote);
      var extractedMedications = medicationModel.extractedClinicalInput
        ? medicationModel.extractedClinicalInput.medications : medicationModel.medications;
      var drugs = extractedMedications.map(function (m) { return m.normalized_name; });

      var drugSection;
      if (drugs.length === 0) {
        drugSection = (
          '<div class="callout callout-success">' +
            '<strong>' + tUI('no_drugs_title') + '</strong> ' +
            tUI('no_drugs_detail') +
          '</div>'
        );
      } else {
        drugSection = (
          '<div class="callout callout-info">' +
            tUI('drugs_detected', drugs.length) +
          '</div>'
        );
      }

      drugSection += renderMedicationReview(extractedMedications);

      var inactiveRows = medicationModel.inactiveOrNegatedMedications || [];
      if (inactiveRows.length) {
        drugSection += '<details class="disclosure"><summary>' +
          escHtml(tUI('inactive_drugs_label')) + ' (' + inactiveRows.length + ')</summary><ul>' +
          inactiveRows.map(function (m) { return '<li><strong>' + escHtml(m.normalized_name) + '</strong> — ' +
            escHtml(m.status) + (m.condition ? ' (' + escHtml(m.condition) + ')' : '') +
            ': “' + escHtml(m.evidence_span) + '”</li>'; }).join('') + '</ul></details>';
      }

      /* ── Combination-brand traceability ──────────────────────────────────
       * Brands like Biktarvy or Gibiter Easyhaler are shown above as their
       * individual active ingredients (so classification/cascade logic can
       * use each one) — this line preserves the link back to the brand the
       * clinician actually prescribed, e.g.
       * "Biktarvy → bictegravir + emtricitabina + tenofovir alafenamida". */
      var comboBrands = {};
      resolveDrugMentions(state.clinicalNote).forEach(function (m) {
        if (m.brand && !comboBrands[m.brand]) {
          comboBrands[m.brand] = { ingredients: m.brand_ingredients || [], cls: m.brand_therapeutic_class || '' };
        }
      });
      var comboBrandNames = Object.keys(comboBrands);
      if (comboBrandNames.length) {
        var comboRows = comboBrandNames.map(function (brand) {
          var info = comboBrands[brand];
          var clsSuffix = info.cls ? ' &mdash; ' + escHtml(info.cls) : '';
          return (
            '<li>' +
              '<strong>' + escHtml(brand) + '</strong> &rarr; ' +
              escHtml(info.ingredients.join(' + ')) + clsSuffix +
            '</li>'
          );
        }).join('');
        drugSection += '<ul class="combo-list">' + comboRows + '</ul>';
      }

      /* ── Symptom extraction — uses extractSymptoms() which also caches in state ── */
      var symptoms    = extractSymptoms(state.clinicalNote);
      saveState();   /* persist state.symptomsDetected */

      /* ── Clinical-problem extraction — separate rule-based module (see
       * detectClinicalProblems / detectUrologicRenalProblem) covering active/
       * suspected problems inferred from complaint + work-up patterns, not
       * just the ADE symptom dictionary above. Counted together with the ADE
       * symptoms in the same "active problems" heading since both answer the
       * same clinical question for the reviewer: what looks clinically active
       * in this note? */
      var clinicalProblems = detectClinicalProblems(state.clinicalNote);

      var clinicalProblemsHtml = renderProblemReview(clinicalProblems);

      var symCountLabel;
      var symptomSection;
      if (!state.kb.symptomDictionary) {
        symCountLabel = tUI('symptoms_dict_missing');
        symptomSection = (
          '<div class="callout callout-warning">' +
            tUI('symptoms_dict_unavailable_title') + ' ' +
            tUI('symptoms_dict_unavailable_detail') +
          '</div>' + clinicalProblemsHtml
        );
      } else if (symptoms.length === 0 && clinicalProblems.length === 0) {
        symCountLabel = tUI('symptoms_zero_label');
        symptomSection = (
          '<div class="callout callout-success">' +
            tUI('no_symptoms') +
          '</div>' + clinicalProblemsHtml
        );
      } else if (symptoms.length === 0) {
        symCountLabel = tUI('symptoms_count', clinicalProblems.length, 0);
        symptomSection = clinicalProblemsHtml;
      } else {
        /* Split into active vs non-active (negated / historical) */
        var activeSyms   = symptoms.filter(function (s) { return s.active !== false; });
        var inactiveSyms = symptoms.filter(function (s) { return s.active === false; });
        symCountLabel = tUI('symptoms_count', activeSyms.length + clinicalProblems.length, inactiveSyms.length);

        /* Category is shown as text inside each tag; the tint only
           reinforces it (never colour alone). Inactive mentions are
           rendered separately and visibly muted. */
        var renderSymTag = function (s, inactive) {
          var category = String(s.category || '').toLowerCase().replace(/[^a-z_-]/g, '');
          var label = escHtml(s.term);
          if (s.matched_term && s.matched_term.toLowerCase() !== s.term.toLowerCase()) {
            label += ' <span class="sym-tag__matched">(' + escHtml(s.matched_term) + ')</span>';
          }
          var catLabel = s.category
            ? '<span class="sym-tag__meta">' + escHtml(s.category) + '</span>'
            : '';
          var negBadge = inactive
            ? '<span class="sym-tag__meta sym-tag__meta--reason">' + escHtml(s.reason || 'non-active') + '</span>'
            : '';
          return (
            '<span class="sym-tag' + (inactive ? ' is-inactive' : ' sym-tag--' + category) + '"' +
              ' title="' + escHtml(s.cascade_relevance || '') + '">' +
              '<span class="sym-tag__term">' + label + '</span>' + catLabel + negBadge +
            '</span>'
          );
        };

        var symTagsActive   = activeSyms.map(function (s) { return renderSymTag(s, false); }).join('');
        var symTagsInactive = inactiveSyms.map(function (s) { return renderSymTag(s, true); }).join('');

        var inactiveRow = inactiveSyms.length
          ? '<div class="sym-tags sym-tags--inactive">' +
              '<span class="sym-tags__label">' + tUI('inactive_mentions') + '</span>' +
              symTagsInactive +
            '</div>'
          : '';

        symptomSection = (
          clinicalProblemsHtml +
          '<div class="sym-tags">' +
            (activeSyms.length ? symTagsActive : '<span class="text-muted">' + tUI('none') + '</span>') +
          '</div>' +
          inactiveRow
        );
      }

      return (
        '<section class="content-block">' +
          '<h3 class="section-label">' + tUI('drugs_section_label') + '</h3>' +
          drugSection +
        '</section>' +
        '<section class="content-block">' +
          '<h3 class="section-label">' + symCountLabel + '</h3>' +
          symptomSection +
        '</section>' +
        '<div class="callout callout-warning">' +
          tUI('detection_warning') +
        '</div>'
      );
    },
    onMount: function (container) {
      container.querySelectorAll('[data-medication-field]').forEach(function (input) {
        input.addEventListener('change', function () {
          if (!MR || !state.medicationReview) return;
          var field = input.getAttribute('data-medication-field');
          var id = input.getAttribute('data-medication-id');
          var patch = {};
          patch[field] = field === 'included' ? input.checked : input.value;
          state.medicationReview = MR.updateItem(state.medicationReview, id, patch);
          invalidateReviewedClinicalInput();
          saveState();
          if (field === 'included') {
            renderStepContent(2);
          } else {
            var status = container.querySelector('.med-review-status');
            if (status) {
              status.classList.remove('is-confirmed');
              status.classList.add('is-draft');
              status.textContent = tUI('med_review_status_draft') + ' · ' + MR.reviewedMedications(state.medicationReview).length;
            }
          }
        });
      });
      container.querySelectorAll('[data-problem-field]').forEach(function (input) {
        input.addEventListener('change', function () {
          if (!ProblemReview || !state.problemReview) return;
          var field = input.getAttribute('data-problem-field');
          var id = input.getAttribute('data-problem-id');
          var patch = {};
          patch[field] = field === 'included' ? input.checked : input.value;
          state.problemReview = ProblemReview.updateItem(state.problemReview, id, patch);
          invalidateReviewedClinicalInput();
          saveState();
          if (field === 'included') {
            renderStepContent(2);
          } else {
            var status = container.querySelector('.problem-review-status');
            if (status) {
              status.classList.remove('is-confirmed');
              status.classList.add('is-draft');
              status.textContent = tUI('problem_review_status_draft') + ' · ' + ProblemReview.reviewedProblems(state.problemReview).length;
            }
          }
        });
      });
    }
  },
  3: {
    title: function () { return tUI('step3_title'); },
    body: function () {
      var kbReady = state.kb.coreCascades && state.kb.vihModifiers;
      if (!kbReady) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>' + tUI('kb_unavailable_title') + '</strong> ' +
            tUI('kb_unavailable_detail') +
          '</div>'
        );
      }
      if (!state.clinicalNote || !state.clinicalNote.trim()) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>' + tUI('note_empty_title') + '</strong> ' +
            tUI('note_empty_detail') +
          '</div>'
        );
      }

      var medications = getCaseModel(state.clinicalNote).medications;
      var normalized = normalizeDrugs(medications);

      if (medications.length === 0) {
        return (
          '<div class="callout callout-success">' +
            '<strong>' + tUI('no_drugs_to_classify') + '</strong> ' +
            tUI('no_drugs_to_classify_detail') +
          '</div>'
        );
      }

      var mappedCount   = normalized.filter(function (n) { return n.class; }).length;
      var unmappedCount = normalized.length - mappedCount;
      var groupCount = normalized.map(function (n) { return n.class; }).filter(function (value, index, values) {
        return value && values.indexOf(value) === index;
      }).length;

      var rows = normalized.map(function (n) {
        var classCell = n.class
          ? '<span class="class-pill">' + escHtml(n.class) + '</span>'
          : '<span class="text-muted"><em>' + tUI('drug_class_none') + '</em></span>';
        return (
          '<tr>' +
            '<th scope="row" class="data-table__drug">' + escHtml(n.drug) + '</th>' +
            '<td>' + classCell + '</td>' +
          '</tr>'
        );
      }).join('');

      return (
        '<div class="callout callout-info">' +
          tUI('class_summary', medications.length, mappedCount, groupCount, unmappedCount) +
        '</div>' +
        '<div class="table-scroll">' +
          '<table class="data-table">' +
            '<thead>' +
              '<tr>' +
                '<th scope="col">' + tUI('col_drug') + '</th>' +
                '<th scope="col">' + tUI('col_class') + '</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>'
      );
    }
  },
  4: {
    title: function () { return tUI('step4_title'); },
    body: function () {
      var kbReady = state.kb.coreCascades && state.kb.vihModifiers && state.kb.ddiWatchlist;
      if (!kbReady) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>' + tUI('kb_unavailable_title') + '</strong> ' +
            tUI('kb_unavailable_detail') +
          '</div>'
        );
      }

      if (!state.clinicalNote || !state.clinicalNote.trim()) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>' + tUI('note_empty_title') + '</strong> ' +
            tUI('note_empty_detail') +
          '</div>'
        );
      }

      /* Count only rules the engine actually executes: entries merged
         during the KB audit stay in the file for traceability but never
         fire (ClinicalEngine.isActiveCascadeEntry), so they are not shown
         as available patterns. Display-only; detection is unaffected. */
      var isActiveRule = function (entry) { return entry && entry.status !== 'merged'; };
      var cCount = (state.kb.coreCascades.cascades || []).filter(isActiveRule).length;
      var vCount = (state.kb.vihModifiers.art_related_cascades || []).filter(isActiveRule).length;
      var dCount = (state.kb.ddiWatchlist.interactions || []).length;

      var kbInfo = (
        '<div class="callout callout-info">' +
          tUI('kb_ready') + ' ' + tUI('kb_ready_detail', cCount, vCount, dCount) +
        '</div>'
      );

      var model = getCaseModel(state.clinicalNote);
      var detected = model.possibleCascades;

      /* ── Otros hallazgos relevantes de la medicación (Fase 6) ──
         Always shown, even with zero cascades — these are independent of
         cascade detection (e.g. anticholinergic burden, NSAID duplicity). */
      var globalAlertsHtml = (
        '<section class="content-block">' +
          '<h3 class="section-title">' + tUI('section_global_alerts') + '</h3>' +
          renderGlobalAlertsSection(model.globalMedicationAlerts) +
        '</section>'
      );
      var missingInfoHtml = renderMissingInformationSection(model.missingInformation);

      if (detected.length === 0) {
        return (
          kbInfo +
          '<div class="callout callout-success">' +
            '<strong>' + tUI('no_cascades_title') + '</strong> ' +
            tUI('no_cascades_detail') +
          '</div>' +
          globalAlertsHtml + missingInfoHtml
        );
      }

      /* Grouped by classification, most-actionable first — never a single
         flat "7 cascades" list with no distinction between them. */
      var groups = CLASSIFICATION_ORDER.map(function (level) {
        return { level: level, items: detected.filter(function (c) { return c.classification === level; }) };
      }).filter(function (g) { return g.items.length > 0; });

      var groupsHtml = groups.map(function (g) {
        return (
          classificationGroupHeaderHtml(g.level, g.items.length) +
          g.items.map(function (c) { return renderCascadeCardHtml(c, { siblings: detected }); }).join('')
        );
      }).join('');

      return (
        kbInfo +
        '<section class="content-block">' +
          '<div class="results-head">' +
            '<h3 class="section-title">' + tUI('cascade_count', detected.length) + '</h3>' +
            renderClassificationSummaryHtml(detected) +
          '</div>' +
          renderDimensionLegendHtml() +
          groupsHtml +
        '</section>' +
        '<div class="callout callout-warning">' +
          tUI('pharmacist_only_warning') +
        '</div>' +
        globalAlertsHtml + missingInfoHtml
      );
    }
  },
  5: {
    title: function () { return tUI('step5_title'); },
    body: function () {
      var kbReady = state.kb.coreCascades && state.kb.vihModifiers && state.kb.ddiWatchlist;
      if (!kbReady) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>' + tUI('kb_unavailable_title') + '</strong> ' +
            tUI('kb_unavailable_detail') +
          '</div>'
        );
      }
      if (!state.clinicalNote || !state.clinicalNote.trim()) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>' + tUI('note_empty_title') + '</strong> ' +
            tUI('note_empty_detail') +
          '</div>'
        );
      }

      var detected = getDetectedCascades(state.clinicalNote);

      if (detected.length === 0) {
        return (
          '<div class="callout callout-success">' +
            '<strong>' + tUI('no_cascades_step5') + '</strong> ' +
            tUI('no_cascades_step5_detail') +
          '</div>'
        );
      }

      /* ── Classification tally ── */
      var cls = state.cascadeClassifications;
      var nConfirmed  = detected.filter(function (c) { return cls[c.candidate_id] === 'confirmed';   }).length;
      var nPossible   = detected.filter(function (c) { return cls[c.candidate_id] === 'possible';    }).length;
      var nNot        = detected.filter(function (c) { return cls[c.candidate_id] === 'not_cascade'; }).length;
      var nUnreviewed = detected.length - nConfirmed - nPossible - nNot;
      var reviewedPct = detected.length ? Math.round(100 * (detected.length - nUnreviewed) / detected.length) : 0;

      var tallyHtml = (
        '<div class="tally" role="group" aria-label="' + escHtml(tUI('clinical_review_label')) + '">' +
          '<div class="tally__head">' +
            '<span class="tally__title">' + tUI('clinical_review_label') + '</span>' +
            (nUnreviewed > 0
              ? '<span class="tally__state">' + tUI('tally_unreviewed', nUnreviewed) + '</span>'
              : '<span class="tally__state is-done">' + tUI('all_reviewed') + '</span>') +
          '</div>' +
          '<div class="progress" aria-hidden="true"><span class="progress__bar" style="width:' + reviewedPct + '%"></span></div>' +
          '<div class="tally__counts">' +
            '<span class="verdict-count verdict-count--confirmed">' + tUI('tally_confirmed', nConfirmed) + '</span>' +
            '<span class="verdict-count verdict-count--possible">' + tUI('tally_possible', nPossible) + '</span>' +
            '<span class="verdict-count verdict-count--discarded">' + tUI('tally_discarded', nNot) + '</span>' +
          '</div>' +
        '</div>'
      );

      /* ── Per-cascade detail cards ── */
      var rows = detected.map(function (c) {
        var entry       = findCascadeEntry(c.cascade_id);
        var ddiWarning  = currentLanguage === 'es' ? c.ddi_warning_es : c.ddi_warning;
        var diffHints   = (entry && Array.isArray(entry.differential_hints) && entry.differential_hints.length)
                          ? entry.differential_hints : [];

        /* Use the richer field; for core it's recAction, for VIH it's clinNote */
        var presentation = CE.getRecommendationPresentation(c.classification, entry || {}, cls[c.candidate_id]);
        var actionText = currentLanguage === 'es' ? presentation.action_es : presentation.action_en;

        /* Resolve localized display name and ADE for Step 5 */
        var step5DisplayName = (currentLanguage === 'es' && c.cascade_name_es)
          ? c.cascade_name_es : c.cascade_name;
        var step5AdeDisplay = (currentLanguage === 'es' && c.ade_es)
          ? c.ade_es : (c.ade_en || '');

        var ddiHtml = ddiWarning
          ? '<div class="note note--danger"><strong>' + tUI('ddi_alert') + '</strong> ' + escHtml(ddiWarning) + '</div>'
          : '';
        var actionHtml = actionText
          ? '<div class="note note--action"><strong>' + tUI('recommended_action') + '</strong> ' + escHtml(actionText) + '</div>'
          : '';
        var diffHtml = diffHints.length
          ? '<div class="note note--neutral"><strong>' + tUI('consider_also') + '</strong> ' +
              escHtml(diffHints.join(' • ')) + '</div>'
          : '';

        /* Classification buttons — keyed by candidate_id, not cascade_id: a
           single rule (cascade_id) can produce several independent
           candidates, one per (index_drug, cascade_drug) pair (e.g. VIH003
           for both metformin and atorvastatin), and keying this off the
           shared rule id would make classifying one candidate silently
           overwrite every other candidate from the same rule. */
        var current = cls[c.candidate_id] || '';
        var id      = escHtml(c.candidate_id);   /* safe for HTML attr; IDs are alphanumeric/colon */
        var groupLabelId = 'verdict-lbl-' + id.replace(/[^A-Za-z0-9_-]/g, '-');

        function classBtn(value, label) {
          var isActive = current === value;
          return (
            '<button type="button" class="verdict-btn verdict-btn--' + value + (isActive ? ' is-active' : '') + '" ' +
              'data-action="classify-cascade" data-cascade-id="' + id + '" data-classification="' + value + '" ' +
              'aria-pressed="' + (isActive ? 'true' : 'false') + '">' +
              '<span class="verdict-btn__mark" aria-hidden="true"></span>' + label +
            '</button>'
          );
        }

        var classButtons = (
          '<div class="verdict" role="group" aria-labelledby="' + groupLabelId + '">' +
            '<span class="verdict__label" id="' + groupLabelId + '">' + tUI('classify_label') + '</span>' +
            '<div class="verdict__options">' +
              classBtn('confirmed',   tUI('btn_confirmed')) +
              classBtn('possible',    tUI('btn_possible')) +
              classBtn('not_cascade', tUI('btn_discard')) +
            '</div>' +
          '</div>'
        );

        return (
          '<article class="finding finding--review' + (current ? ' is-' + current : '') + '">' +
            '<header class="finding__head">' +
              '<h4 class="finding__title">' + escHtml(step5DisplayName) + '</h4>' +
              '<div class="finding__meta">' +
                confidenceBadgeHtml(c.confidence) +
                '<code class="rule-id" title="' + escHtml(tUI('rule_id_lbl')) + '">' + escHtml(c.cascade_id) + '</code>' +
              '</div>' +
            '</header>' +
            chainHtml(c.index_drug, step5AdeDisplay, c.cascade_drug) +
            ddiHtml + actionHtml + diffHtml + classButtons +
          '</article>'
        );
      });

      return (
        '<div class="callout callout-warning">' +
          tUI('review_warning') +
        '</div>' +
        tallyHtml +
        rows.join('')
      );
    }
  },
  6: {
    title: function () { return tUI('step6_title'); },
    body: function () {
      var kbReady = state.kb.coreCascades && state.kb.vihModifiers && state.kb.ddiWatchlist;
      if (!kbReady) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>' + tUI('kb_unavailable_title') + '</strong> ' +
            tUI('kb_unavailable_detail') +
          '</div>'
        );
      }
      if (!state.clinicalNote || !state.clinicalNote.trim()) {
        return (
          '<div class="callout callout-warning">' +
            '<strong>' + tUI('note_empty_title') + '</strong> ' +
            tUI('note_empty_detail_report') +
          '</div>'
        );
      }

      var r   = buildReport();
      var now = r.generated_at.replace('T', ' ').split('.')[0] + ' UTC';

      /* ── Section helper ── */
      function section(title, content, modifier) {
        return (
          '<section class="report__section' + (modifier ? ' report__section--' + modifier : '') + '">' +
            '<h4 class="report__section-title">' + title + '</h4>' +
            content +
          '</section>'
        );
      }

      var summary = r.clinical_summary || {
        total_cascades: r.cascade_count, supported_cascades: 0, incomplete_cascades: 0,
        top_interventions: [], validation_warning: tUI('validation_warning')
      };

      /* ── Cascade findings, grouped by classification (never a flat, undifferentiated list) ── */
      var cascadeContent;
      if (r.cascades.length === 0) {
        cascadeContent = (
          '<p class="report__empty">' + tUI('no_cascades_report') + '</p>'
        );
      } else {
        var groups = CLASSIFICATION_ORDER.map(function (level) {
          return { level: level, items: r.cascades.filter(function (c) { return c.classification === level; }) };
        }).filter(function (g) { return g.items.length > 0; });

        cascadeContent = renderDimensionLegendHtml() + groups.map(function (g) {
          return (
            classificationGroupHeaderHtml(g.level, g.items.length) +
            g.items.map(function (c) { return renderCascadeCardHtml(c, { siblings: r.cascades }); }).join('')
          );
        }).join('');
      }

      var summaryInterventions = (summary.top_interventions || []).length
        ? '<ul class="report__list">' +
            summary.top_interventions.map(function (it) { return '<li>' + escHtml(it) + '</li>'; }).join('') +
          '</ul>'
        : '<p class="text-muted">' + tUI('no_dominant_interventions') + '</p>';

      var provenance = r.input_provenance || {};
      var medReviewState = provenance.medication_review || {};
      var problemReviewState = provenance.problem_review || {};
      var professionalChanges = r.professional_changes || {};
      var medChangeCount = professionalChanges.medications && professionalChanges.medications.counts
        ? professionalChanges.medications.counts.total : 0;
      var problemChangeCount = professionalChanges.problems && professionalChanges.problems.counts
        ? professionalChanges.problems.counts.total : 0;
      var inputReviewHtml = (
        '<dl class="report__dl">' +
          '<dt>' + tUI('label_source_meds') + '</dt><dd>' +
            escHtml((provenance.source_medications || []).join(', ') || tUI('none_detected')) + '</dd>' +
          '<dt>' + tUI('label_effective_meds') + '</dt><dd>' +
            escHtml((provenance.effective_medications || []).join(', ') || tUI('none_detected')) + '</dd>' +
          '<dt>' + tUI('label_med_review') + '</dt><dd>' +
            (medReviewState.applied ? tUI('review_applied_yes') : tUI('review_applied_no')) + '</dd>' +
          '<dt>' + tUI('label_problem_review') + '</dt><dd>' +
            (problemReviewState.applied ? tUI('review_applied_yes') : tUI('review_applied_no')) + '</dd>' +
        '</dl>'
      );
      var professionalChangesHtml = (
        '<ul class="report__list">' +
          '<li>' + tUI('med_changes_count', medChangeCount) + '</li>' +
          '<li>' + tUI('problem_changes_count', problemChangeCount) + '</li>' +
          '<li>' + tUI('discarded_count', (r.discarded_findings || []).length) + '</li>' +
        '</ul>'
      );
      var limitationsHtml = (r.limitations || []).length
        ? '<ul class="report__list">' +
            r.limitations.map(function (item) {
              var message = currentLanguage === 'en' ? item.message_en : item.message_es;
              return '<li>' + escHtml(message || item.message_es || '') + '</li>';
            }).join('') + '</ul>'
        : '<p class="text-muted">' + tUI('no_report_limitations') + '</p>';

      /* ── Export actions ── */
      var exportRow = (
        '<div class="report-actions" role="group" aria-label="' + escHtml(tUI('report_export_lbl')) + '">' +
          '<span class="report-actions__label">' + tUI('report_export_lbl') + '</span>' +
          '<div class="report-actions__buttons">' +
            '<button type="button" class="btn btn-primary btn-sm" data-action="copy-report">' + ICONS.copy + tUI('btn_copy_record') + '</button>' +
            '<button type="button" class="btn btn-secondary btn-sm" data-action="print-report">' + ICONS.print + tUI('btn_save_pdf') + '</button>' +
            '<button type="button" class="btn btn-secondary btn-sm" data-action="export-report" data-format="json">' + ICONS.download + tUI('btn_export_json') + '</button>' +
            '<button type="button" class="btn btn-secondary btn-sm" data-action="export-report" data-format="csv">' + ICONS.download + tUI('btn_export_csv') + '</button>' +
          '</div>' +
        '</div>'
      );

      var listOrEmpty = function (items, emptyKey) {
        return items.length
          ? '<ul class="report__list report__list--cols">' + items.map(function (d) { return '<li>' + escHtml(d) + '</li>'; }).join('') + '</ul>'
          : '<p class="text-muted"><em>' + tUI(emptyKey) + '</em></p>';
      };

      return (
        exportRow +
        '<article class="report" aria-labelledby="report-title">' +
          '<header class="report__header">' +
            '<div class="report__brand" aria-hidden="true">' + ICONS.mark + '</div>' +
            '<div>' +
              '<p class="report__eyebrow">HIV Prescribing Cascade Auditor</p>' +
              '<h3 class="report__title" id="report-title">' + tUI('report_title') + '</h3>' +
            '</div>' +
          '</header>' +

          '<dl class="report__meta">' +
            '<div><dt>' + tUI('label_patient_id') + '</dt><dd>' +
              (r.patient_id ? escHtml(r.patient_id) : '<em class="text-muted">' + tUI('not_set') + '</em>') + '</dd></div>' +
            '<div><dt>' + tUI('label_generated') + '</dt><dd>' + escHtml(now) + '</dd></div>' +
            '<div><dt>' + tUI('label_kb_version') + '</dt><dd>' + escHtml(r.kb_version) +
              ' <span class="text-muted">(' + escHtml(r.kb_mode) + ')</span></dd></div>' +
            '<div><dt>' + tUI('label_report_schema') + '</dt><dd>v' + escHtml(r.report_schema_version) + ' · ' + escHtml(r.language) + '</dd></div>' +
          '</dl>' +

          section(tUI('section_summary'),
            '<div class="report-summary">' +
              '<div class="stat"><span class="stat__value">' + summary.total_cascades + '</span><span class="stat__label">' + tUI('total_findings') + '</span></div>' +
              '<div class="stat"><span class="stat__value">' + (summary.supported_cascades || 0) + '</span><span class="stat__label">' + tUI('label_plausible') + '</span></div>' +
              '<div class="report-summary__interventions"><strong>' + tUI('main_interventions') + '</strong>' + summaryInterventions + '</div>' +
            '</div>' +
            '<div class="callout callout-warning">' + escHtml(summary.validation_warning) + '</div>',
            'summary'
          ) +

          section(tUI('section_input_review'), inputReviewHtml) +

          '<div class="report__two-col">' +
            section(tUI('section_drugs', r.drugs_detected.length), listOrEmpty(r.drugs_detected, 'none_detected')) +
            section(tUI('section_classes', r.drug_classes.length), listOrEmpty(r.drug_classes, 'not_classified')) +
          '</div>' +

          section(tUI('section_findings', r.cascade_count), cascadeContent) +

          section(tUI('section_global_alerts'), renderGlobalAlertsSection(r.globalMedicationAlerts)) +

          section(tUI('section_prof_changes'), professionalChangesHtml) +

          section(tUI('section_limitations_report'), limitationsHtml) +

          '<footer class="report__footer">' +
            '<div class="callout callout-warning">' + tUI('decision_support_warning') + '</div>' +
          '</footer>' +
        '</article>'
      );
    }
  }
};

/* ============================================================
   Wizard navigation
   ============================================================ */
function goTo(step) {
  if (step < 1 || step > 6) return;
  var changed = state.step !== step;
  state.step = step;
  saveState();
  showView('analysis');
  renderStepContent(step);
  updateStepNav(step);
  updateNavButtons(step);
  if (changed && appReady) {
    var heading = document.querySelector('#step-content .step-header h2');
    if (heading) heading.focus({ preventScroll: true });
    var main = document.getElementById('main-content');
    if (main && main.getBoundingClientRect().top < 0) main.scrollIntoView({ block: 'start' });
  }
}

function renderStepContent(step) {
  var container = document.getElementById('step-content');
  if (!container) return;

  var cfg = STEP_CONTENT[step];
  if (!cfg) {
    container.innerHTML = '<div class="loading-placeholder">' + tUI('unknown_step') + '</div>';
    return;
  }

  var titleText = typeof cfg.title === 'function' ? cfg.title() : cfg.title;
  var reviewBoundary = '';
  if (step >= 3 && MR && MR.hasChanges(state.medicationReview)) {
    reviewBoundary += '<div class="callout ' + (state.medicationReview.status === 'confirmed' ? 'callout-success' : 'callout-warning') +
      ' med-review-downstream-warning">' + tUI(state.medicationReview.status === 'confirmed' ? 'med_review_applied' : 'med_review_not_applied') + '</div>';
  }
  if (step >= 3 && ProblemReview && ProblemReview.hasChanges(state.problemReview)) {
    reviewBoundary += '<div class="callout ' + (state.problemReview.status === 'confirmed' ? 'callout-success' : 'callout-warning') +
      ' problem-review-downstream-warning">' + tUI(state.problemReview.status === 'confirmed' ? 'problem_review_applied' : 'problem_review_not_applied') + '</div>';
  }
  container.innerHTML =
    '<div class="step-header">' +
      '<p class="step-eyebrow">' + tUI('step_counter', step) + '</p>' +
      '<h2 tabindex="-1">' + titleText + '</h2>' +
    '</div>' +
    '<div class="step-section">' + reviewBoundary + cfg.body() + '</div>';

  if (typeof cfg.onMount === 'function') {
    cfg.onMount(container);
  }
  updateWorkflowStatus();
}

/* ============================================================
   Workflow status (sidebar) — read-only summary of where the case
   stands. Derives everything from state and the cached CaseModel
   (the same getCaseModel() call Steps 2–6 use); never mutates
   clinical state beyond what those steps already do.
   ============================================================ */
function setStepStatus(step, html, tone) {
  var el = document.querySelector('[data-step-status="' + step + '"]');
  if (!el) return;
  el.innerHTML = html || '';
  el.className = 'step-status' + (tone ? ' is-' + tone : '');
}

function updateWorkflowStatus(opts) {
  if (typeof document === 'undefined') return;
  opts = opts || {};
  var hasNote = !!(state.clinicalNote && state.clinicalNote.trim());
  var kbReady = !!(state.kb.coreCascades && state.kb.vihModifiers && state.kb.ddiWatchlist);
  setStepStatus(1, hasNote ? tUI('wf_note_chars', state.clinicalNote.length) : tUI('wf_pending'), hasNote ? 'done' : '');
  if (!hasNote || !kbReady || opts.lightweight) {
    var waiting = hasNote && !kbReady ? tUI('wf_waiting_kb') : '';
    [2, 3, 4, 5, 6].forEach(function (n) { setStepStatus(n, opts.lightweight && hasNote ? '' : waiting, ''); });
    return;
  }
  try {
    var model = getCaseModel(state.clinicalNote);
    var medConfirmed = state.medicationReview && state.medicationReview.status === 'confirmed';
    var probConfirmed = state.problemReview && state.problemReview.status === 'confirmed';
    var reviewStarted = state.medicationReview || state.problemReview;
    setStepStatus(2, reviewStarted
      ? (medConfirmed && probConfirmed ? tUI('wf_review_confirmed') : tUI('wf_review_draft'))
      : tUI('wf_pending'), medConfirmed && probConfirmed ? 'done' : '');
    var meds = model.medications || [];
    var classified = meds.filter(function (m) { return m.drug_class; }).length;
    setStepStatus(3, meds.length ? tUI('wf_classified', classified, meds.length) : '', meds.length ? 'done' : '');
    var signals = model.possibleCascades || [];
    setStepStatus(4, tUI('wf_signals', signals.length), signals.length ? 'attention' : 'done');
    var reviewed = signals.filter(function (c) { return !!state.cascadeClassifications[c.candidate_id]; }).length;
    setStepStatus(5, signals.length ? tUI('wf_reviewed', reviewed, signals.length) : '',
      signals.length && reviewed === signals.length ? 'done' : (signals.length ? 'attention' : ''));
    setStepStatus(6, tUI('wf_report_ready'), '');
  } catch (err) {
    console.error('[Workflow] status could not be computed:', err);
  }
}

/* ============================================================
   Views — analysis / knowledge / about. Hash routes carry only a
   view name (never clinical data), work on any static host and
   survive reloads and direct links.
   ============================================================ */
var VIEWS = ['analysis', 'knowledge', 'about'];
var appReady = false;
var currentView = 'analysis';

function showView(view) {
  if (VIEWS.indexOf(view) === -1) view = 'analysis';
  currentView = view;
  if (typeof document === 'undefined') return;
  VIEWS.forEach(function (v) {
    var el = document.getElementById('view-' + v);
    if (el) el.hidden = v !== view;
  });
  document.querySelectorAll('[data-view-link]').forEach(function (link) {
    if (link.getAttribute('data-view-link') === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.body.setAttribute('data-active-view', view);
  if (view === 'knowledge') renderKnowledgeView();
  var wantedHash = '#' + view;
  if (appReady && location.hash !== wantedHash && !(view === 'analysis' && !location.hash)) {
    history.replaceState(null, '', wantedHash);
  }
}

function routeFromHash() {
  var view = (location.hash || '').replace('#', '');
  if (view === 'main-content') return;
  showView(VIEWS.indexOf(view) !== -1 ? view : 'analysis');
}

/* ============================================================
   Knowledge-base view — read-only catalogue (kb-catalog.js)
   ============================================================ */
var kbViewState = { query: '', source: 'all', status: 'all' };

function renderKnowledgeView() {
  var body = document.getElementById('kb-view-body');
  if (!body) return;
  var Catalog = typeof window !== 'undefined' ? window.KBCatalog : null;
  if (!Catalog || !state.kb.coreCascades) {
    body.innerHTML = '<div class="callout callout-warning">' + tUI('kb_unavailable') + '</div>';
    return;
  }
  var inventory = Catalog.inventory(state.kb).map(function (f) {
    var unit = (f.key === 'coreCascades' || f.key === 'vihModifiers') ? tUI('kb_inv_active_rules') : tUI('kb_inv_entries');
    return (
      '<li class="inv-card' + (f.loaded ? '' : ' is-missing') + '">' +
        '<span class="inv-card__label">' + tUI('kb_inv_' + f.key) + '</span>' +
        (f.loaded
          ? '<span class="inv-card__value">' + (f.count === null ? '—' : f.count) + ' <small>' + unit + '</small></span>' +
            (f.version ? '<span class="inv-card__version">v' + escHtml(f.version) + '</span>' : '')
          : '<span class="inv-card__value">' + tUI('kb_inv_not_loaded') + '</span>') +
      '</li>'
    );
  }).join('');

  var option = function (value, current, label) {
    return '<option value="' + value + '"' + (value === current ? ' selected' : '') + '>' + label + '</option>';
  };

  body.innerHTML = (
    '<section class="content-block">' +
      '<div class="results-head">' +
        '<h3 class="section-title">' + tUI('kb_inv_title') + '</h3>' +
        '<span class="chip">' + escHtml(tUI('kb_track_lbl', state.kbMode)) + '</span>' +
      '</div>' +
      '<ul class="inv-grid">' + inventory + '</ul>' +
    '</section>' +
    '<section class="content-block">' +
      '<div class="catalog-tools">' +
        '<div class="field field--grow">' +
          '<label class="field-label" for="kb-search">' + tUI('kb_search_label') + '</label>' +
          '<input id="kb-search" class="input" type="search" autocomplete="off" spellcheck="false" ' +
            'placeholder="' + tUI('kb_search_placeholder') + '" value="' + escHtml(kbViewState.query) + '">' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label" for="kb-filter-source">' + tUI('kb_filter_source') + '</label>' +
          '<select id="kb-filter-source" class="input">' +
            option('all', kbViewState.source, tUI('kb_filter_all')) +
            option('core', kbViewState.source, tUI('kb_source_core')) +
            option('hiv', kbViewState.source, tUI('kb_source_hiv')) +
          '</select>' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label" for="kb-filter-status">' + tUI('kb_filter_status') + '</label>' +
          '<select id="kb-filter-status" class="input">' +
            option('all', kbViewState.status, tUI('kb_filter_all')) +
            option('reviewed_source', kbViewState.status, tUI('knowledge_reviewed_source')) +
            option('pending_review', kbViewState.status, tUI('knowledge_pending_review')) +
          '</select>' +
        '</div>' +
      '</div>' +
      '<p class="catalog-count" id="kb-results-count" role="status" aria-live="polite"></p>' +
      '<div id="kb-results" class="catalog-list"></div>' +
      '<p class="field-hint">' + tUI('kb_catalog_note') + '</p>' +
    '</section>'
  );

  var rows = Catalog.buildRows(state.kb, currentLanguage);
  var draw = function () {
    var filtered = Catalog.filterRows(rows, kbViewState.query, { source: kbViewState.source, status: kbViewState.status });
    var count = document.getElementById('kb-results-count');
    if (count) count.innerHTML = tUI('kb_results', filtered.length, rows.length);
    var list = document.getElementById('kb-results');
    if (!list) return;
    list.innerHTML = filtered.length ? filtered.map(renderCatalogRowHtml).join('')
      : '<p class="empty-state">' + tUI('kb_no_results') + '</p>';
  };
  draw();

  var search = document.getElementById('kb-search');
  if (search) search.addEventListener('input', function () { kbViewState.query = search.value; draw(); });
  var src = document.getElementById('kb-filter-source');
  if (src) src.addEventListener('change', function () { kbViewState.source = src.value; draw(); });
  var st = document.getElementById('kb-filter-status');
  if (st) st.addEventListener('change', function () { kbViewState.status = st.value; draw(); });
}

function renderCatalogRowHtml(row) {
  var examples = function (items) {
    return items.length ? '<ul class="token-list">' + items.map(function (d) { return '<li>' + escHtml(d) + '</li>'; }).join('') + '</ul>' : '—';
  };
  return (
    '<details class="catalog-item">' +
      '<summary>' +
        '<span class="catalog-item__id">' + escHtml(row.id) + '</span>' +
        '<span class="catalog-item__name">' + escHtml(row.name) + '</span>' +
        '<span class="catalog-item__tags">' +
          '<span class="chip">' + tUI(row.source === 'hiv' ? 'kb_source_hiv' : 'kb_source_core') + '</span>' +
          knowledgeValidationBadgeHtml(row.knowledge_validation_status) +
        '</span>' +
      '</summary>' +
      '<div class="catalog-item__body">' +
        chainHtml(row.index_class, row.ade, row.cascade_class) +
        '<dl class="catalog-item__dl">' +
          (row.mechanism ? '<dt>' + tUI('kb_mechanism') + '</dt><dd>' + escHtml(row.mechanism) + '</dd>' : '') +
          '<dt>' + tUI('kb_index_examples') + '</dt><dd>' + examples(row.index_examples) + '</dd>' +
          '<dt>' + tUI('kb_cascade_examples') + '</dt><dd>' + examples(row.cascade_examples) + '</dd>' +
          (row.action ? '<dt>' + tUI('kb_action') + '</dt><dd>' + escHtml(row.action) + '</dd>' : '') +
          (row.ddi_warning ? '<dt>' + tUI('ddi_alert') + '</dt><dd>' + escHtml(row.ddi_warning) + '</dd>' : '') +
          '<dt>' + tUI('kb_references') + '</dt><dd>' + (row.references.length
            ? '<ul class="report__list">' + row.references.map(function (r) { return '<li>' + escHtml(r) + '</li>'; }).join('') + '</ul>'
            : '<span class="text-muted">' + tUI('kb_no_references') + '</span>') + '</dd>' +
        '</dl>' +
      '</div>' +
    '</details>'
  );
}

function updateStepNav(active) {
  document.querySelectorAll('.step-btn').forEach(function (btn) {
    var s = parseInt(btn.dataset.step, 10);
    btn.classList.remove('active', 'completed');
    if (s === active)   btn.classList.add('active');
    else if (s < active) btn.classList.add('completed');
    if (s === active) btn.setAttribute('aria-current', 'step');
    else btn.removeAttribute('aria-current');
  });
}

function updateNavButtons(step) {
  var prev    = document.getElementById('btn-prev');
  var next    = document.getElementById('btn-next');
  var counter = document.getElementById('step-counter');
  if (prev) {
    prev.disabled  = step === 1;
    prev.innerHTML = '<span aria-hidden="true">&larr;</span> ' + tUI('btn_prev');
  }
  if (next) {
    /* Step 6 is the end of the workflow; "Finalizar" previously called
       goTo(7), which is a no-op — hide it instead of offering a dead end. */
    next.hidden = step === 6;
    next.innerHTML = tUI('btn_next') + ' <span aria-hidden="true">&rarr;</span>';
  }
  if (counter) counter.textContent = tUI('step_counter', step);
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
      medicationReview: state.medicationReview,
      problemReview: state.problemReview,
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
    showToast(tUI('toast_case_exported'), 'success');
  } catch (err) {
    console.error('[Export] exportJSON failed:', err);
    showToast(tUI('toast_export_failed', err.message || 'unknown error'), 'error');
  }
}

function hasText(value) { return !!(value && String(value).trim()); }
function confidenceRank(conf) { return CE.confidenceRank(conf); }
function priorityRank(priority) { return CE.priorityRank(priority); }

/* ============================================================
   Shared cascade-signal card renderer
   ------------------------------------------------------------
   Used by BOTH Step 4 (preview, before clinician review) and Step 6
   (final report) so the two screens can never again show inconsistent
   or cross-contaminated content for the same signal — see kb/CHANGELOG.md
   for the pre-audit defect this fixes (anticholinergic/CNS-depressant
   burden text leaking into an unrelated cardiovascular cascade card).

   Every recommendation shown here comes from EITHER:
     (a) the cascade's OWN KB entry (recommended_action_es/en), or
     (b) the signal's own classification_reason (why the system graded it
         the way it did),
   and NEVER from a patient-level or drug-burden alert — those are always
   rendered separately via renderGlobalAlertsSection().
   ============================================================ */

/* Presentation token per classification level. The visible label always
   carries the meaning (WCAG 1.4.1); tone and marker shape only reinforce
   it. Levels are exactly the engine's own five — none is added here. */
var CLASSIFICATION_STYLE = {
  supported_possible_cascade: { tone: 'supported' },
  possible_but_incomplete:    { tone: 'incomplete' },
  pharmacological_match_only: { tone: 'match' },
  not_evaluable:              { tone: 'noteval' },
  discarded:                  { tone: 'discarded' }
};

/* Inline SVG icons (decorative; aria-hidden). Kept in code so no external
   asset request is needed and CSP stays 'self'. */
var ICONS = {
  compass: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m15.5 8.5-2 5-5 2 2-5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  copy: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="7" y="7" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  print: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M6 8V3h8v5M6 14H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M6 12h8v5H6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  download: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 3v10m0 0-4-4m4 4 4-4M4 16h12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrow: '<svg viewBox="0 0 24 12" aria-hidden="true" focusable="false"><path d="M1 6h20m0 0-4-4m4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mark: '<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><rect width="40" height="40" rx="10" fill="#102A43"/><path d="M10 11.5h9.5v9h9.5v9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/><circle cx="10" cy="11.5" r="3" fill="#fff"/><circle cx="19.5" cy="20.5" r="4.6" fill="#102A43" stroke="#5EEAD4" stroke-width="2.2"/><circle cx="19.5" cy="20.5" r="1.3" fill="#5EEAD4"/><circle cx="29" cy="29.5" r="3" fill="#5EEAD4"/></svg>'
};

/** Prudent, non-diagnostic Spanish/English label for each classification
 * level — see tUI() keys classification_* in UI_STRINGS. Never uses the
 * word "confirmada"/"confirmed" for anything the system itself proposed;
 * that word is reserved for the clinician's own manual verdict
 * (state.cascadeClassifications[id] === 'confirmed', set via Step 5). */
function classificationLabel(classification) {
  return tUI('classification_' + classification) || classification;
}

function tagHtml(modifier, label) {
  return '<span class="tag tag--' + modifier + '"><span class="tag__mark" aria-hidden="true"></span>' +
    escHtml(label) + '</span>';
}

function classificationBadgeHtml(classification) {
  var s = CLASSIFICATION_STYLE[classification] || CLASSIFICATION_STYLE.not_evaluable;
  return tagHtml('cls-' + s.tone, classificationLabel(classification));
}

/* ── Four-dimension label system (Fase 7) ──────────────────────────────────
   Each possibleCascades signal carries four INDEPENDENT judgments that must
   never be collapsed into one bare badge (see docs/clinical-engine-fix-
   audit.md §1.4): potentialClinicalRelevance (KB/literature-level, this
   association in general), knowledgeValidationStatus (does the KB entry
   have a reviewed source), automatedCaseAssessment (this system's read of
   THIS patient's note = c.classification), and professionalValidation (the
   clinician's own verdict, state.cascadeClassifications). Every renderer
   below carries a tUI dimension label alongside its value so none of the
   four is ever shown as an unlabeled, potentially contradictory badge. ── */

/** potentialClinicalRelevance text label — keyed off c.potential_clinical_relevance
 * ('alta' / 'moderada' / 'baja') reusing the existing conf_high/medium/low
 * strings (same underlying scale as c.confidence) so the label vocabulary
 * stays in one place. Used by both the HTML badge and the plain-text report. */
function relevanceLabel(relevance) {
  var key = relevance === 'alta' ? 'conf_high' : relevance === 'moderada' ? 'conf_medium' : 'conf_low';
  return tUI(key);
}

/** Three-step meter + text label: the number of filled steps mirrors the
 * same mapping relevanceLabel() already uses, so shape and text agree. */
function relevanceBadgeHtml(relevance) {
  var level = relevance === 'alta' ? 3 : relevance === 'moderada' ? 2 : 1;
  return '<span class="meter meter--' + level + '">' +
    '<span class="meter__bars" aria-hidden="true"><i></i><i></i><i></i></span>' +
    escHtml(relevanceLabel(relevance)) + '</span>';
}

/** Step 5 KB-confidence chip: shows the engine's own c.confidence value
 * through the same conf_* vocabulary; an unexpected value is shown as-is
 * rather than being coerced onto the scale. */
function confidenceBadgeHtml(confidence) {
  var known = { high: 3, medium: 2, low: 1 }[confidence];
  if (!known) return '<span class="meter">' + escHtml(confidence || '') + '</span>';
  return '<span class="meter meter--' + known + '">' +
    '<span class="meter__bars" aria-hidden="true"><i></i><i></i><i></i></span>' +
    escHtml(tUI('conf_' + confidence)) + '</span>';
}

/** knowledgeValidationStatus text label — whether the KB entry backing this
 * signal has a reviewed bibliographic source or is still pending review;
 * independent of whether THIS patient's case is a good match for it. */
function knowledgeValidationLabel(status) {
  return status === 'reviewed_source' ? tUI('knowledge_reviewed_source') : tUI('knowledge_pending_review');
}

function knowledgeValidationBadgeHtml(status) {
  return tagHtml(status === 'reviewed_source' ? 'kb-reviewed' : 'kb-pending', knowledgeValidationLabel(status));
}

/** professionalValidation badge — the clinician's own recorded verdict for
 * this cascade_id (state.cascadeClassifications), or an explicit "pending"
 * state when no clinician has reviewed it yet — never silently omitted, so
 * a missing professional verdict can't be mistaken for an implicit one. */
function professionalValidationBadgeHtml(manualVerdict) {
  var label = manualVerdict === 'confirmed' ? tUI('ver_confirmed')
    : manualVerdict === 'possible' ? tUI('ver_possible')
    : manualVerdict === 'not_cascade' ? tUI('classification_manual_discarded')
    : tUI('dim_professional_pending');
  var modifier = manualVerdict === 'confirmed' ? 'prof-confirmed'
    : manualVerdict === 'possible' ? 'prof-possible'
    : manualVerdict === 'not_cascade' ? 'prof-discarded'
    : 'prof-pending';
  return tagHtml(modifier, label);
}

/** One labeled cell: "<dimension label> <badge>" — the pattern every one of
 * the four dimensions uses, so a reader always sees which judgment a badge
 * represents instead of a bare color chip. */
function dimensionRowHtml(labelKey, badgeHtml) {
  return '<div class="dims__item"><dt>' + escHtml(tUI(labelKey)) + '</dt><dd>' + badgeHtml + '</dd></div>';
}

/** Compact legend explaining the four dimensions — rendered once above the
 * cascade list (Step 4 preview and Step 6 report), not per-card, per the
 * Fase 7 "Leyendas" requirement. */
function renderDimensionLegendHtml() {
  return (
    '<details class="legend">' +
      '<summary>' + escHtml(tUI('dim_legend_title')) + '</summary>' +
      '<p>' + escHtml(tUI('dim_legend_text')) + '</p>' +
    '</details>'
  );
}

/** Group-header badge for the classification (automatedCaseAssessment)
 * grouping used in Step 4 and Step 6 — labeled explicitly so a section
 * header is never read as an unqualified verdict. */
function classificationGroupHeaderHtml(level, count) {
  return (
    '<div class="group-header group-header--' + ((CLASSIFICATION_STYLE[level] || CLASSIFICATION_STYLE.not_evaluable).tone) + '">' +
      '<span class="group-header__dim">' + escHtml(tUI('dim_assessment_lbl')) + '</span>' +
      classificationBadgeHtml(level) +
      '<strong class="group-header__count">' + tUI('classification_group_count', count) + '</strong>' +
    '</div>'
  );
}

/** At-a-glance distribution of signals per automated classification level
 * (Step 4 header). Purely a count of c.classification values. */
function renderClassificationSummaryHtml(signals) {
  var items = CLASSIFICATION_ORDER.map(function (level) {
    var n = signals.filter(function (c) { return c.classification === level; }).length;
    if (!n) return '';
    return '<li>' + classificationBadgeHtml(level) + '<span class="cls-summary__n">' + n + '</span></li>';
  }).join('');
  return items ? '<ul class="cls-summary">' + items + '</ul>' : '';
}

/** Index drug → intermediate problem → subsequent drug, with each node
 * labelled so the relationship is readable without relying on colour. */
function chainHtml(indexDrug, ade, cascadeDrug) {
  return (
    '<ol class="chain">' +
      '<li class="chain__node chain__node--index"><span class="chain__lbl">' + tUI('chain_index_lbl') + '</span>' +
        '<span class="chain__val">' + escHtml(indexDrug) + '</span></li>' +
      '<li class="chain__arrow" aria-hidden="true">' + ICONS.arrow + '</li>' +
      '<li class="chain__node chain__node--ade"><span class="chain__lbl">' + tUI('chain_ade_lbl') + '</span>' +
        '<span class="chain__val">' + escHtml(ade || tUI('seq_potential_ade')) + '</span></li>' +
      '<li class="chain__arrow" aria-hidden="true">' + ICONS.arrow + '</li>' +
      '<li class="chain__node chain__node--cascade"><span class="chain__lbl">' + tUI('chain_cascade_lbl') + '</span>' +
        '<span class="chain__val">' + escHtml(cascadeDrug) + '</span></li>' +
    '</ol>'
  );
}

/** Itemized, traceable evidence list: what's explicit, what's inferred,
 * what's missing, and why — the Fase 5 "procedencia y trazabilidad"
 * requirement. Every line maps directly to a field on c.evidence. */
function buildEvidenceListHtml(c) {
  var lang = currentLanguage;
  var items = [];
  var ev = c.evidence || {};

  items.push(tUI('evidence_index_drug', c.index_drug));
  items.push(tUI('evidence_cascade_drug', c.cascade_drug));

  if (ev.intermediate_problem) {
    var ip = ev.intermediate_problem;
    if (!ip.checked) {
      items.push(tUI('evidence_problem_unverifiable'));
    } else if (ip.status === 'none') {
      items.push(tUI('evidence_problem_not_mentioned'));
    } else {
      var statusLabel = tUI('problem_status_' + ip.status) || ip.status;
      items.push(tUI('evidence_problem_status', statusLabel, ip.evidence_span || ''));
    }
    if (ip.diagnostic_note_es && lang === 'es') items.push(ip.diagnostic_note_es);
    if (ip.diagnostic_note_en && lang === 'en') items.push(ip.diagnostic_note_en);
  }

  if (ev.measurement_discordance && ev.measurement_discordance.applicable) {
    items.push(ev.measurement_discordance.discordant
      ? tUI('evidence_measurement_discordant')
      : tUI('evidence_measurement_supportive'));
  }

  if (ev.temporal_order) {
    items.push(tUI('evidence_temporality_' + (ev.temporal_order.status || 'unknown')));
  }

  if (ev.alternative_indication && ev.alternative_indication.found) {
    var reason = lang === 'es' ? ev.alternative_indication.reason_es : ev.alternative_indication.reason_en;
    items.push(tUI('evidence_alt_indication', reason));
  }

  if (c.merged_from && c.merged_from.length) {
    items.push(tUI('evidence_merged_rule', c.merged_from.map(function (m) { return m.id; }).join(', ')));
  }

  return items;
}

/**
 * Render one cascade-signal card as an HTML string. Shared by Step 4 and
 * Step 6 — see module comment above.
 * @param {object} c  a possibleCascades[] entry from ClinicalEngine.buildCaseModel()
 * @param {object} [opts]
 * @param {object[]} [opts.siblings]  The full list of cascade signals
 *   currently on screen (possibleCascades or the report's cascades). Used
 *   only to detect whether `c` is one of several independent candidates the
 *   engine produced for the same rule + index drug (ClinicalEngine.
 *   prioritizeCascadeCandidates already labels each such candidate's
 *   `candidate_role`) — two different drugs genuinely evaluated in
 *   sequence, not a duplicate finding. When there is no sibling, the role
 *   label is omitted: a single "Respuesta inicial" badge on its own would
 *   be noise, not information.
 */
function renderCascadeCardHtml(c, opts) {
  opts = opts || {};
  var siblingCount = (opts.siblings || []).filter(function (x) {
    return x.rule_id === c.rule_id && normalizeDrugText(x.index_drug || '') === normalizeDrugText(c.index_drug || '');
  }).length;
  var roleKey = siblingCount > 1 && c.candidate_role ? 'candidate_role_' + c.candidate_role : null;
  var lang = currentLanguage;
  var displayName = (lang === 'es' && c.cascade_name_es) ? c.cascade_name_es : c.cascade_name;
  var adeDisplay = (lang === 'es' && c.ade_es) ? c.ade_es : (c.ade_en || '');
  var ddiDisplay = (lang === 'es' && c.ddi_warning_es) ? c.ddi_warning_es : c.ddi_warning;
  var manualVerdict = state.cascadeClassifications[c.candidate_id];
  var presentation = CE.getRecommendationPresentation(c.classification, findCascadeEntryForSignal(c), manualVerdict);
  var recDisplay = (lang === 'es' ? presentation.action_es : presentation.action_en) || '';
  var reasonDisplay = (lang === 'es' ? c.classification_reason_es : c.classification_reason_en) || '';
  var tone = (CLASSIFICATION_STYLE[c.classification] || CLASSIFICATION_STYLE.not_evaluable).tone;

  var ddiBox = ddiDisplay
    ? '<div class="note note--danger"><strong>' + tUI('ddi_alert') + '</strong> ' + escHtml(ddiDisplay) + '</div>'
    : '';

  var recBox = recDisplay
    ? '<div class="note note--action"><strong>' + tUI('clinical_action') + '</strong> ' + escHtml(recDisplay) + '</div>'
    : '';

  var reasonBox = (
    '<div class="note note--neutral"><strong>' + tUI('classification_reason_lbl') + '</strong> ' + escHtml(reasonDisplay) + '</div>'
  );

  var evidenceItems = buildEvidenceListHtml(c).map(function (it) { return '<li>' + escHtml(it) + '</li>'; }).join('');
  var evidenceBox = (
    '<details class="finding__evidence">' +
      '<summary>' + tUI('evidence_details_toggle') + '</summary>' +
      '<ul>' + evidenceItems + '</ul>' +
    '</details>'
  );

  /* The four dimensions, each on its own labeled cell — never combined into
     one bare badge cluster (the exact defect documented in
     docs/clinical-engine-fix-audit.md §1.4). */
  var dimensionsBox = (
    '<dl class="dims">' +
      dimensionRowHtml('dim_relevance_lbl', relevanceBadgeHtml(c.potential_clinical_relevance)) +
      dimensionRowHtml('dim_knowledge_lbl', knowledgeValidationBadgeHtml(c.knowledge_validation_status)) +
      dimensionRowHtml('dim_assessment_lbl', classificationBadgeHtml(c.classification)) +
      dimensionRowHtml('dim_professional_lbl', professionalValidationBadgeHtml(manualVerdict)) +
    '</dl>'
  );

  return (
    '<article class="finding finding--' + tone + '">' +
      '<header class="finding__head">' +
        '<h4 class="finding__title">' +
          escHtml(displayName) +
          (c.signal_type === 'symptom_bridge'
            ? ' <span class="chip chip--symptom">' + tUI('via_symptom') + '</span>'
            : '') +
          (roleKey
            ? ' <span class="chip chip--role-' + (c.candidate_role === 'initial_response' ? 'initial' : 'later') + '" title="' +
                escHtml(tUI(roleKey + '_title')) + '">' + tUI(roleKey) + '</span>'
            : '') +
        '</h4>' +
        '<code class="rule-id" title="' + escHtml(tUI('rule_id_lbl')) + '">' + escHtml(c.cascade_id) + '</code>' +
      '</header>' +
      chainHtml(c.index_drug, adeDisplay, c.cascade_drug) +
      dimensionsBox +
      ddiBox + recBox + reasonBox + evidenceBox +
    '</article>'
  );
}

/**
 * Otros hallazgos relevantes de la medicación (Fase 6): patient/drug-burden
 * alerts and therapeutic duplicities. Structurally separate from
 * possibleCascades — never merged into a cascade card's text.
 */
function renderGlobalAlertsSection(alerts) {
  if (!alerts || !alerts.length) {
    return '<p class="text-muted">' + tUI('no_global_alerts') + '</p>';
  }
  var lang = currentLanguage;
  return alerts.map(function (a) {
    var msg = (lang === 'es' ? a.message_es : a.message_en) || a.message_es || '';
    var name = (lang === 'es' ? a.name_es : a.name_en) || a.name_es || '';
    return (
      '<div class="alert-card">' +
        '<div class="alert-card__title">' + escHtml(name) + '</div>' +
        '<div class="alert-card__body">' + escHtml(msg) + '</div>' +
        (a.drugs_involved && a.drugs_involved.length
          ? '<div class="alert-card__drugs">' + escHtml(a.drugs_involved.join(', ')) + '</div>'
          : '') +
      '</div>'
    );
  }).join('');
}

function renderMissingInformationSection(missing) {
  if (!missing || !missing.length) return '';
  var lang = currentLanguage;
  var items = missing.map(function (m) {
    var msg = (lang === 'es' ? m.message_es : m.message_en) || m.message_es || '';
    return '<li>' + escHtml(msg) + '</li>';
  }).join('');
  return (
    '<div class="info-panel">' +
      '<strong>' + tUI('missing_information_lbl') + '</strong>' +
      '<ul>' + items + '</ul>' +
    '</div>'
  );
}

/* ── buildReport ──────────────────────────────────────────────────────────
   Assembles the report object shown in Step 6 and used by JSON/CSV export.
   Delegates ALL clinical logic to ClinicalEngine.buildCaseModel(); this
   function only adds display-oriented derived fields (localized labels,
   clinician verification status) on top of the CaseModel.
   ──────────────────────────────────────────────────────────────────────── */
function buildReport() {
  var model = getCaseModel(state.clinicalNote);

  /* Step 5's clinician review (confirmed / possible / discarded via
     classifyCascade) is the pharmacist's own verdict on each signal and
     must be respected downstream: a cascade explicitly discarded in Step 5
     ("Descartar") is never carried into the final report — on screen, in
     the copy-to-record text, nor in the JSON/CSV export — even though the
     system's own automated classification may still list it. A cascade the
     clinician has not yet reviewed is kept (never silently dropped) so an
     incomplete review is visible in the report rather than hidden. */
  var possibleCascades = model.possibleCascades.filter(function (c) {
    return state.cascadeClassifications[c.candidate_id] !== 'not_cascade';
  });

  var cascades = possibleCascades.map(function (c) {
    var adeDisplay = (currentLanguage === 'es' && c.ade_es) ? c.ade_es : (c.ade_en || tUI('seq_potential_ade'));
    return Object.assign({}, c, {
      verification_status: state.cascadeClassifications[c.candidate_id] || 'unreviewed',
      /* Aliases for the plain-text/CSV export surfaces, which pre-date the
         classification system and speak in terms of a single "recommendation"
         / "temporal support" string rather than the richer evidence object. */
      recommendation_presentation: CE.getRecommendationPresentation(
        c.classification, findCascadeEntryForSignal(c), state.cascadeClassifications[c.candidate_id]),
      clinical_recommendation: (function () {
        var p = CE.getRecommendationPresentation(c.classification, findCascadeEntryForSignal(c), state.cascadeClassifications[c.candidate_id]);
        return currentLanguage === 'es' ? p.action_es : p.action_en;
      }()),
      temporal_support: (c.evidence && c.evidence.temporal_order && c.evidence.temporal_order.status) || 'unknown',
      sequence: c.index_drug + ' → ' + adeDisplay + ' → ' + c.cascade_drug
    });
  });

  cascades.sort(function (a, b) {
    return CE.classificationRank(b.classification) - CE.classificationRank(a.classification) ||
      confidenceRank(b.confidence) - confidenceRank(a.confidence);
  });

  var supportedCount = cascades.filter(function (c) { return c.classification === 'supported_possible_cascade'; }).length;
  var incompleteCount = cascades.filter(function (c) { return c.classification === 'possible_but_incomplete'; }).length;

  /* Fase 8 — explicit, non-hardcoded priority criteria, in clinical-engine.js
     (CE.selectTopInterventions) so it's a testable, DOM-free rule rather than
     inline UI code: only classifications the system itself still stands
     behind for THIS case are eligible — never a pharmacological-coincidence-
     only, not-evaluable, or discarded signal (see that function's docstring
     for the exact bug — VIH003 — this replaced). Cascades are already sorted
     above by classification rank, so the highest-priority ones come first. */
  var topInterventions = CE.selectTopInterventions(cascades, currentLanguage, 3);

  var baseReport = {
    patient_id: state.patientId || '',
    generated_at: new Date().toISOString(),
    kb_version: getKBVersion(),
    kb_mode: state.kbMode,
    drugs_detected: model.medications.map(function (m) { return m.normalized_name; }),
    medication_review: state.medicationReview && MR ? {
      status: state.medicationReview.status,
      confirmed_at: state.medicationReview.confirmed_at,
      applied_to_engine: !!(model.reviewedInputApplication && model.reviewedInputApplication.medications.applied),
      reviewed_medications: MR.reviewedMedications(state.medicationReview),
      audit_items: MR.sanitize(state.medicationReview).items
    } : null,
    problem_review: state.problemReview && ProblemReview ? {
      status: state.problemReview.status,
      confirmed_at: state.problemReview.confirmed_at,
      applied_to_engine: !!(model.reviewedInputApplication && model.reviewedInputApplication.problems.applied),
      reviewed_problems: ProblemReview.reviewedProblems(state.problemReview),
      audit_items: ProblemReview.sanitize(state.problemReview).items
    } : null,
    medication_mentions: model.allMedicationMentions,
    inactive_or_negated_medications: model.inactiveOrNegatedMedications,
    current_interactions: model.currentInteractions,
    drug_classes: model.drug_classes,
    activeProblems: model.activeProblems,
    clinicalMeasurements: model.clinicalMeasurements,
    globalMedicationAlerts: model.globalMedicationAlerts,
    missingInformation: model.missingInformation,
    reviewed_input_application: model.reviewedInputApplication,
    review_audit: model.reviewAudit,
    diagnostics: { inferredDrugsFromCascades: false, inferredDrugCount: 0 },
    symptoms_detected: model.symptomsDetected.map(function (s) {
      return { id: s.id, term: s.term, matched_term: s.matched_term, category: s.category };
    }),
    cascade_count: cascades.length,
    cascades: cascades,
    clinical_summary: {
      total_cascades: cascades.length,
      supported_cascades: supportedCount,
      incomplete_cascades: incompleteCount,
      top_interventions: topInterventions,
      validation_warning: tUI('validation_warning')
    }
  };
  return ReportContract ? ReportContract.enrich(baseReport, {
    language: currentLanguage,
    softwareVersion: '1.0.0',
    extractedClinicalInput: model.extractedClinicalInput,
    allCandidates: model.possibleCascades,
    professionalVerdicts: state.cascadeClassifications
  }) : baseReport;
}

var CLASSIFICATION_ORDER = [
  'supported_possible_cascade', 'possible_but_incomplete',
  'pharmacological_match_only', 'not_evaluable', 'discarded'
];

function formatReportForClinicalRecord(report) {
  if (ReportContract) return ReportContract.toClinicalText(report, currentLanguage);
  var lines = [];
  lines.push(tUI('report_header'));
  lines.push(tUI('report_patient') + (report.patient_id || tUI('report_not_set')));
  lines.push(tUI('report_date') + report.generated_at);
  lines.push(tUI('report_kb') + report.kb_mode + (report.kb_version ? ' v' + report.kb_version : ''));
  lines.push('');
  lines.push(tUI('report_summary'));
  lines.push(tUI('report_total') + report.cascade_count);
  lines.push(tUI('report_plausible_count') + (report.clinical_summary && report.clinical_summary.supported_cascades ? report.clinical_summary.supported_cascades : 0));
  lines.push(tUI('report_drugs_list') + (report.drugs_detected.join(', ') || tUI('report_none')));
  lines.push(tUI('report_classes_list') + (report.drug_classes.join(', ') || tUI('report_not_classified')));
  lines.push('');

  if (!report.cascades.length) {
    lines.push(tUI('report_no_cascades'));
  } else {
    CLASSIFICATION_ORDER.forEach(function (level) {
      var group = report.cascades.filter(function (c) { return c.classification === level; });
      if (!group.length) return;
      lines.push(tUI('classification_' + level) + ' (' + group.length + ')');
      group.forEach(function (c, idx) {
        lines.push((idx + 1) + '. ' + c.cascade_name + ' [' + c.cascade_id + ']');
        lines.push(tUI('report_seq') + c.sequence);
        /* Four-dimension label system (Fase 7) — same four independent
           judgments shown on screen, each explicitly named so none reads
           as a bare, potentially contradictory value. */
        lines.push(tUI('dim_relevance_lbl') + ' ' + relevanceLabel(c.potential_clinical_relevance));
        lines.push(tUI('dim_knowledge_lbl') + ' ' + knowledgeValidationLabel(c.knowledge_validation_status));
        lines.push(tUI('dim_assessment_lbl') + ' ' + classificationLabel(c.classification));
        lines.push(tUI('classification_reason_lbl') + ' ' +
          ((currentLanguage === 'es' ? c.classification_reason_es : c.classification_reason_en) || ''));
        lines.push(tUI('dim_professional_lbl') + ' ' + (tUI('ver_' + c.verification_status) || c.verification_status));
        lines.push(tUI('report_rec') + (c.clinical_recommendation || tUI('report_no_rec')));
      });
      lines.push('');
    });
  }

  if (report.globalMedicationAlerts && report.globalMedicationAlerts.length) {
    lines.push(tUI('section_global_alerts'));
    report.globalMedicationAlerts.forEach(function (a, idx) {
      var msg = (currentLanguage === 'es' ? a.message_es : a.message_en) || a.message_es || '';
      lines.push('  ' + (idx + 1) + ') ' + msg);
    });
    lines.push('');
  }

  if (report.clinical_summary && report.clinical_summary.top_interventions && report.clinical_summary.top_interventions.length) {
    lines.push(tUI('report_actions'));
    report.clinical_summary.top_interventions.forEach(function (action, idx) {
      lines.push('  ' + (idx + 1) + ') ' + action);
    });
  }

  lines.push('');
  lines.push(tUI('report_warning'));
  return lines.join('\n');
}

function copyTextToClipboard(text) {
  if (!text) return Promise.reject(new Error(tUI('clipboard_no_text')));

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
    showToast(tUI('toast_report_copy_failed'), 'error');
    return;
  }

  copyTextToClipboard(formatReportForClinicalRecord(report))
    .then(function () {
      showToast(tUI('toast_report_copied'), 'success');
    })
    .catch(function (err) {
      console.error('[Clipboard] Could not copy report:', err);
      showToast(tUI('toast_clipboard_failed'), 'error');
    });
};

window.printReportAsPDF = function () {
  showToast(tUI('toast_print_hint'), 'success');
  /* Expand the per-signal evidence so the printed/PDF report carries the
     same traceability as the screen; restore the reader's view afterwards. */
  var closed = Array.prototype.slice.call(document.querySelectorAll('.report details:not([open])'));
  closed.forEach(function (d) { d.open = true; });
  var restore = function () {
    closed.forEach(function (d) { d.open = false; });
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
};

/* ── exportReport ─────────────────────────────────────────────────────────
   Delegated Step 6 actions call: exportReport('json') / ('csv')
   ──────────────────────────────────────────────────────────────────────── */
window.exportReport = function (format) {
  var report, filename;
  try {
    report   = buildReport();
    filename = 'cascade-report-' + (report.patient_id || 'case') + '-' + isoDate();
  } catch (err) {
    console.error('[Export] buildReport failed:', err);
    showToast(tUI('toast_export_failed', err.message || 'unknown error'), 'error');
    return;
  }
  var blob, mime;

  if (format === 'csv') {
    var csvText = ReportContract ? ReportContract.toCsv(report, currentLanguage) : '';
    blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
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
    showToast(tUI('toast_report_exported', (format || 'json').toUpperCase()), 'success');
  } catch (err) {
    console.error('[Export] exportReport download failed:', err);
    showToast(tUI('toast_export_failed', err.message || 'unknown error'), 'error');
  }
};

/* Import Case — reads a previously exported JSON and restores state */
function importCase(file) {
  if (!file) return;

  /* Basic file type guard — only accept files with .json extension or application/json MIME */
  if (file.type && file.type !== 'application/json' && !file.name.endsWith('.json')) {
    showToast(tUI('toast_import_type_error'), 'error');
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
      state.medicationReview = null;
      state.problemReview = null;
      if (typeof data.patientId === 'string' && data.patientId.length <= 200) {
        state.patientId = data.patientId;
        imported++;
      }
      if (typeof data.clinicalNote === 'string') {
        state.clinicalNote = data.clinicalNote;
        imported++;
      }
      if (data.medicationReview !== undefined && MR) {
        var importedReview = MR.sanitize(data.medicationReview);
        if (importedReview) {
          state.medicationReview = importedReview;
          imported++;
        }
      }
      if (data.problemReview !== undefined && ProblemReview) {
        var importedProblemReview = ProblemReview.sanitize(data.problemReview);
        if (importedProblemReview) {
          state.problemReview = importedProblemReview;
          imported++;
        }
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
        throw new Error(tUI('import_no_recognizable_data'));
      }

      /* Reset derived state that depends on the imported note */
      state.symptomsDetected = [];
      state.detectedCascades = null;
      state.caseModel = null;

      var pidEl = document.getElementById('patient-id');
      if (pidEl) pidEl.value = state.patientId;

      saveState();
      goTo(state.step);
      showToast(tUI('toast_case_imported'), 'success');
    } catch (err) {
      console.error('[Import] Could not parse imported file:', err);
      showToast(tUI('toast_import_failed', err.message || 'invalid file'), 'error');
    }
  };
  reader.onerror = function () {
    console.error('[Import] FileReader error while reading import file.');
    showToast(tUI('toast_file_read_error'), 'error');
  };
  reader.readAsText(file);
}

/* Delete All Data — clears localStorage and resets the UI */
function deleteAllData() {
  if (!confirm(tUI('confirm_delete_all'))) return;
  clearState();
  var pidEl = document.getElementById('patient-id');
  if (pidEl) pidEl.value = '';
  goTo(1);
}

/* New Case — resets state and starts from step 1 */
function newCase() {
  if (state.clinicalNote && !confirm(tUI('confirm_new_case'))) return;
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
  if (state.clinicalNote && !confirm(tUI('confirm_load_demo'))) return;
  clearState();
  state.patientId = 'DEMO-001';
  state.medicationReview = null;
  state.problemReview = null;
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
  showToast(tUI('toast_demo_loaded'), 'info');
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

  /* symptom_bridge-only view over getCaseModel(), for the probes below. */
  function detectSymptomCascades(noteText) {
    return getCaseModel(noteText).possibleCascades.filter(function (s) { return s.signal_type === 'symptom_bridge'; });
  }

  /* Helper: run extractSymptoms on a scratch note without touching state */
  function probeSymptoms(note) {
    var savedNote   = state.clinicalNote;
    var savedSym    = state.symptomsDetected;
    var savedCache  = state.caseModel;
    state.clinicalNote    = note;
    state.symptomsDetected = [];
    var result = extractSymptoms(note);
    state.clinicalNote    = savedNote;
    state.symptomsDetected = savedSym;
    state.caseModel = savedCache;
    return result;
  }

  /* Helper: run detectSymptomCascades on a scratch note */
  function probeCascades(note) {
    var savedNote  = state.clinicalNote;
    var savedSym   = state.symptomsDetected;
    var savedCache = state.caseModel;
    state.clinicalNote     = note;
    state.symptomsDetected = [];
    state.caseModel = null;
    var syms = extractSymptoms(note);
    var sigs = detectSymptomCascades(note);
    state.clinicalNote     = savedNote;
    state.symptomsDetected = savedSym;
    state.caseModel = savedCache;
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

  console.group('H — Drug resolver (alias/brand/abbr/combo/normalized)');

  var h1 = resolveDrugMentions('Paciente en Kaletra por TAR.').map(function (m) { return m.canonical; });
  assert('H1: brand name Kaletra → lopinavir/ritonavir', h1.indexOf('lopinavir/ritonavir') >= 0, true);

  var h2 = resolveDrugMentions('Se inicia AZT por disponibilidad.');
  var h2m = h2.find(function (m) { return m.canonical === 'zidovudine'; });
  assert('H2: abbreviation AZT resolved to zidovudine', !!h2m, true);
  assert('H2: abbreviation match_type = alias', h2m ? h2m.match_type : null, 'alias');

  var h3 = resolveDrugMentions('Regimen actual: atazanavir / ritonavir.').map(function (m) { return m.canonical; });
  assert('H3: slash combination resolved', h3.indexOf('atazanavir/ritonavir') >= 0, true);

  var h4 = resolveDrugMentions('Paciente con oxibutinína y estreñimiento.').map(function (m) { return m.canonical; });
  assert('H4: orthographic variant (accent) resolves to oxybutynin', h4.indexOf('oxybutynin') >= 0, true);

  console.groupEnd();

  /* ── I. normalizeClinicalText() — conservative typo correction ── */
  console.group('I. normalizeClinicalText — typo correction');

  assert('I1: "vral" → "viral"',
         normalizeClinicalText('carga vral indetectable').indexOf('viral') >= 0, true);
  assert('I2: "izqueirdo" → "izquierdo"',
         normalizeClinicalText('flanco izqueirdo').indexOf('izquierdo') >= 0, true);
  assert('I3: "izuqierdo" → "izquierdo"',
         normalizeClinicalText('flanco izuqierdo').indexOf('izquierdo') >= 0, true);
  assert('I4: "dolro" → "dolor"',
         normalizeClinicalText('dolro a la palapcion').indexOf('dolor') >= 0, true);
  assert('I5: "palapcion" → "palpacion"',
         normalizeClinicalText('dolro a la palapcion').indexOf('palapcion') >= 0, false);
  assert('I6: "q comp" → "1 comp"',
         normalizeClinicalText('enalapril 20 mg q comp al dia').indexOf('1 comp') >= 0, true);
  assert('I7: idempotent — correcting twice = correcting once',
         normalizeClinicalText(normalizeClinicalText('vral izqueirdo dolro')),
         normalizeClinicalText('vral izqueirdo dolro'));
  assert('I8: does not touch unrelated words',
         normalizeClinicalText('paciente estable sin cambios').indexOf('paciente estable sin cambios') >= 0, true);

  console.groupEnd();

  /* ── J. Combination-product resolution (Biktarvy, Gibiter Easyhaler) ── */
  console.group('J. Drug combination resolution');

  var j1 = resolveDrugMentions('Biktarvy 1 comp al dia desde 2019.').map(function (m) { return m.canonical; });
  assert('J1: Biktarvy → bictegravir present', j1.indexOf('bictegravir') >= 0, true);
  assert('J2: Biktarvy → emtricitabine present', j1.indexOf('emtricitabine') >= 0, true);
  assert('J3: Biktarvy → tenofovir alafenamide present', j1.indexOf('tenofovir alafenamide') >= 0, true);

  var j2m = resolveDrugMentions('Biktarvy 1 comp al dia.').find(function (m) { return m.canonical === 'bictegravir'; });
  assert('J4: Biktarvy mention carries brand traceability', j2m ? j2m.brand : null, 'Biktarvy');

  var j3 = resolveDrugMentions('GIBITER EASYHALER 1 inhalacion al dia.').map(function (m) { return m.canonical; });
  assert('J5: Gibiter Easyhaler → budesonide present', j3.indexOf('budesonide') >= 0, true);
  assert('J6: Gibiter Easyhaler → formoterol present', j3.indexOf('formoterol') >= 0, true);

  /* Ingredient-level class comes from drug_dictionary.json (via the mention
     metadata). Step 3 consumes the same CaseModel classification rather than
     rebuilding a second taxonomy from cascade-rule roles. */
  var j5mentions   = resolveDrugMentions('GIBITER EASYHALER 1 inhalacion al dia.');
  var j5budesonide = j5mentions.find(function (m) { return m.canonical === 'budesonide'; });
  var j5formoterol = j5mentions.find(function (m) { return m.canonical === 'formoterol'; });
  assert('J7: budesonide ingredient classified (from drug_dictionary.json)',
         j5budesonide ? j5budesonide.drug_class : null, 'Corticosteroid / Inhaled');
  assert('J8: formoterol ingredient classified (from drug_dictionary.json)',
         j5formoterol ? j5formoterol.drug_class : null, 'Bronchodilator / LABA');
  assert('J9: combo brand therapeutic class shown at brand level',
         j5budesonide ? j5budesonide.brand_therapeutic_class : null,
         'Corticoide inhalado + broncodilatador de acción prolongada (ICS/LABA)');

  console.groupEnd();

  /* ── K. Clinical problem detection (urologic/renal rule) ── */
  console.group('K. Clinical problem detection — urologic/renal');

  /* K1 — full real-case regression (see task report): flank pain + urine
     work-up + tamsulosin, with three negated findings that must NOT create
     false-positive UTI/miccional-syndrome/GI-bleed signals. */
  var REAL_CASE_NOTE = [
    'Mujer de 54 años VIH en tratamiento con Biktarvy y carga vral indetectable.',
    'Tratamiento habitual de la paciente:',
    '- Biktarvy 1 comp al dia desde 2019',
    '- Omeprazol 1 capo al dia desde 2022',
    '- Enalapril 20 mg q comp al día desde 2019',
    '- Metamizol y paracetamol si precisa por dolores',
    '- Loratadina 10 mg 1 comprimido si precisa',
    '- GIBITER EASYHALER 1 inhalacion al día desde 2018',
    '',
    'Consulta por dolor intermitente de flanco izqueirdo desde hace varios meses. No sintomatologia miccional, no lo relaciona con las comidas. No rectorragia, no melenas.',
    'Exploración: Abdomen blando, depresible, dolro a la palapcion de flanco izuqierdo, puñopercusión renal negativa.',
    'Solicitud de urocultivo y sistematico y ecografia abdominal.',
    'Exploracion: Buen estado general. Eupneica. Bien hidratada y perfundida. Abdomen blando, depresible, dolro a la palapcion de flanco izuqierdo, puñopercusión renal negativa.',
    '',
    'Tira de orina: NEGATIVO.',
    '',
    'Tratamiento prescrito: tamsulosina 400 mcg 1 comprimido al día.'
  ].join('\n');

  var k1drugs = extractDrugs(REAL_CASE_NOTE);
  ['bictegravir', 'emtricitabine', 'tenofovir alafenamide', 'omeprazole', 'enalapril',
   'metamizole', 'paracetamol', 'loratadine', 'budesonide', 'formoterol', 'tamsulosin'
  ].forEach(function (drug) {
    assert('K1: real case detects "' + drug + '"', k1drugs.indexOf(drug) >= 0, true);
  });

  var k1problems = detectClinicalProblems(REAL_CASE_NOTE);
  assert('K2: real case detects exactly one clinical problem', k1problems.length, 1);
  assert('K3: category = urologic_renal_problem', k1problems[0] ? k1problems[0].category : null, 'urologic_renal_problem');
  assert('K4: certainty = suspected (flank pain + urine work-up + tamsulosin)',
         k1problems[0] ? k1problems[0].certainty : null, 'suspected');
  assert('K5: evidence mentions flank pain ("flanco")',
         k1problems[0] && k1problems[0].evidence.some(function (e) { return /flanco/i.test(e); }), true);
  assert('K6: evidence mentions tamsulosin as context',
         k1problems[0] && k1problems[0].evidence.some(function (e) { return /tamsulosina/i.test(e); }), true);
  assert('K7: negated findings include miccional symptoms (not a false-positive UTI)',
         k1problems[0] && k1problems[0].negatedFindings.some(function (e) { return /miccional/i.test(e); }), true);
  assert('K8: negated findings include the negative dipstick ("Tira de orina")',
         k1problems[0] && k1problems[0].negatedFindings.some(function (e) { return /tira de orina/i.test(e); }), true);
  assert('K9: negated findings include the negative punch sign ("puñopercusión")',
         k1problems[0] && k1problems[0].negatedFindings.some(function (e) { return /pu.opercusi.n/i.test(e); }), true);
  assert('K10: no finding text leaks "no rectorragia" (unrelated negated GI symptom)',
         k1problems[0] && k1problems[0].evidence.concat(k1problems[0].negatedFindings)
           .some(function (e) { return /rectorragia/i.test(e); }), false);

  /* K11-13 — Test 2: pure negation note must yield no problem at all */
  var k2problems = detectClinicalProblems('Paciente sin disuria, sin polaquiuria, tira de orina negativa.');
  assert('K11: negation-only note detects zero clinical problems', k2problems.length, 0);

  /* K12-13 — Test 3: flank pain + imaging order, no tamsulosin → still suspected/symptom */
  var k3problems = detectClinicalProblems('Consulta por dolor de flanco derecho. Se solicita ecografía renal.');
  assert('K12: flank pain + imaging order detects a urologic/renal problem', k3problems.length, 1);
  assert('K13: certainty is "symptom" or "suspected" (never "confirmed")',
         k3problems[0] && (k3problems[0].certainty === 'symptom' || k3problems[0].certainty === 'suspected'), true);

  /* K14 — Test 4: tamsulosin prescribed alone must NEVER auto-create a diagnosis */
  var k4problems = detectClinicalProblems('Tratamiento habitual: tamsulosina 400 mcg al día.');
  assert('K14: tamsulosin alone creates NO clinical problem', k4problems.length, 0);

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

function decodeEntities(str) {
  var decoder = document.createElement('textarea');
  decoder.innerHTML = String(str || '');
  return decoder.value;
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
  if (type === 'error') toast.setAttribute('role', 'alert');
  /* UI strings carry HTML entities (e.g. "Revisi&oacute;n"). They used to be
     escaped a second time and shown literally; decode them as text instead.
     A detached <textarea> parses its content as RCDATA, so markup inside a
     message (e.g. from an error string) is never interpreted. */
  var decoder = document.createElement('textarea');
  decoder.innerHTML = String(message || '');
  var text = document.createElement('span');
  text.className = 'toast__text';
  text.textContent = decoder.value;
  var close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', decodeEntities(tStatic('dismiss')));
  close.innerHTML = '&times;';
  toast.appendChild(text);
  toast.appendChild(close);
  /* Keep at most three toasts on screen so repeated actions never bury
     the workspace (HAL-05). */
  while (container.children.length >= 3) container.removeChild(container.firstChild);
  var dismiss = function () {
    toast.classList.add('hiding');
    setTimeout(function () { toast.remove(); }, 250);
  };
  close.addEventListener('click', dismiss);
  container.appendChild(toast);
  /* Errors stay until dismissed; confirmations leave after 6 s. Hover or
     focus pauses the timer so the message can be read (WCAG 2.2.1). */
  if (type !== 'error') {
    var timer = setTimeout(dismiss, 6000);
    var pause = function () { clearTimeout(timer); };
    var resume = function () { clearTimeout(timer); timer = setTimeout(dismiss, 3000); };
    toast.addEventListener('mouseenter', pause);
    toast.addEventListener('focusin', pause);
    toast.addEventListener('mouseleave', resume);
    toast.addEventListener('focusout', resume);
  }
}

/* ============================================================
   Static UI string updater — refreshes HTML elements that are
   not part of the dynamically rendered step content when the
   language changes.
   ============================================================ */
function updateStaticUI() {
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    el.innerHTML = tStatic(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
    el.setAttribute('title', tStatic(el.getAttribute('data-i18n-title')));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
    el.setAttribute('placeholder', tStatic(el.getAttribute('data-i18n-placeholder')));
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) {
    el.setAttribute('aria-label', tStatic(el.getAttribute('data-i18n-aria-label')));
  });
  document.querySelectorAll('[data-i18n-content]').forEach(function (el) {
    el.setAttribute('content', tStatic(el.getAttribute('data-i18n-content')));
  });

  /* Step nav labels */
  var stepLabels = [
    [1, 'nav_step1'], [2, 'nav_step2'], [3, 'nav_step3'],
    [4, 'nav_step4'], [5, 'nav_step5'], [6, 'nav_step6']
  ];
  stepLabels.forEach(function (pair) {
    var btn = document.querySelector('.step-btn[data-step="' + pair[0] + '"] .step-label');
    if (btn) btn.innerHTML = tUI(pair[1]);
  });
}

/* ============================================================
   Event wiring
   ============================================================ */
function handleDelegatedAction(event) {
  var trigger = event.target.closest('[data-action]');
  if (!trigger) return;
  var action = trigger.getAttribute('data-action');

  if (action === 'toggle-kb-validation') {
    var detail = document.getElementById('kb-val-detail');
    if (!detail) return;
    var detailOpen = detail.style.display !== 'none';
    detail.style.display = detailOpen ? 'none' : 'block';
    trigger.setAttribute('aria-expanded', String(!detailOpen));
    return;
  }

  if (action === 'dismiss-kb-validation') {
    var banner = trigger.closest('#kb-validation-banner');
    if (banner) banner.style.display = 'none';
    return;
  }

  if (action === 'load-demo') {
    loadDemoCase();
    return;
  }

  if (action === 'classify-cascade') {
    var classification = trigger.getAttribute('data-classification');
    var cascadeId = trigger.getAttribute('data-cascade-id');
    if (cascadeId && ['confirmed', 'possible', 'not_cascade'].indexOf(classification) !== -1) {
      classifyCascade(cascadeId, classification);
    }
    return;
  }

  if (action === 'add-medication-row') {
    if (!MR || !state.medicationReview) return;
    state.medicationReview = MR.addManualItem(state.medicationReview);
    invalidateReviewedClinicalInput();
    saveState();
    renderStepContent(2);
    var manualInputs = document.querySelectorAll('.med-review-row .med-review-fields input[data-medication-field="normalized_name"]');
    if (manualInputs.length) manualInputs[manualInputs.length - 1].focus();
    return;
  }

  if (action === 'remove-medication-row') {
    if (!MR || !state.medicationReview) return;
    state.medicationReview = MR.removeManualItem(state.medicationReview, trigger.getAttribute('data-medication-id'));
    invalidateReviewedClinicalInput();
    saveState();
    renderStepContent(2);
    return;
  }

  if (action === 'confirm-medication-review') {
    if (!MR || !state.medicationReview) return;
    var confirmation = MR.confirm(state.medicationReview);
    if (!confirmation.ok) {
      showToast(tUI('med_review_validation_error'), 'error');
      return;
    }
    state.medicationReview = confirmation.review;
    invalidateReviewedClinicalInput();
    saveState();
    renderStepContent(2);
    showToast(tUI('med_review_confirmed_toast'), 'success');
    return;
  }

  if (action === 'reset-medication-review') {
    if (!MR || !confirm(tUI('med_review_reset_confirm'))) return;
    var medicationSource = getCaseModel(state.clinicalNote).extractedClinicalInput;
    state.medicationReview = MR.create(medicationSource ? medicationSource.medications : []);
    invalidateReviewedClinicalInput();
    saveState();
    renderStepContent(2);
    return;
  }

  if (action === 'add-problem-row') {
    if (!ProblemReview || !state.problemReview) return;
    state.problemReview = ProblemReview.addManualItem(state.problemReview);
    invalidateReviewedClinicalInput();
    saveState();
    renderStepContent(2);
    var problemInputs = document.querySelectorAll('.problem-review-row input[data-problem-field="concept"]');
    if (problemInputs.length) problemInputs[problemInputs.length - 1].focus();
    return;
  }

  if (action === 'remove-problem-row') {
    if (!ProblemReview || !state.problemReview) return;
    state.problemReview = ProblemReview.removeManualItem(state.problemReview, trigger.getAttribute('data-problem-id'));
    invalidateReviewedClinicalInput();
    saveState();
    renderStepContent(2);
    return;
  }

  if (action === 'confirm-problem-review') {
    if (!ProblemReview || !state.problemReview) return;
    var problemConfirmation = ProblemReview.confirm(state.problemReview);
    if (!problemConfirmation.ok) {
      showToast(tUI('problem_review_validation_error'), 'error');
      return;
    }
    state.problemReview = problemConfirmation.review;
    invalidateReviewedClinicalInput();
    saveState();
    renderStepContent(2);
    showToast(tUI('problem_review_confirmed_toast'), 'success');
    return;
  }

  if (action === 'reset-problem-review') {
    if (!ProblemReview || !confirm(tUI('problem_review_reset_confirm'))) return;
    var problemSource = getCaseModel(state.clinicalNote).extractedClinicalInput;
    state.problemReview = ProblemReview.create(problemSource ? problemSource.activeProblems : []);
    invalidateReviewedClinicalInput();
    saveState();
    renderStepContent(2);
    return;
  }

  if (action === 'copy-report') {
    copyReportForClinicalRecord();
    return;
  }

  if (action === 'print-report') {
    printReportAsPDF();
    return;
  }

  if (action === 'export-report') {
    var format = trigger.getAttribute('data-format');
    if (format === 'json' || format === 'csv') exportReport(format);
  }
}

function wireEvents() {
  document.addEventListener('click', handleDelegatedAction);

  /* View navigation (hash routes) */
  window.addEventListener('hashchange', routeFromHash);
  document.querySelectorAll('[data-view-link]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      var view = link.getAttribute('data-view-link');
      showView(view);
      if (view === 'analysis') renderStepContent(state.step);
      var main = document.getElementById('main-content');
      if (main) main.focus({ preventScroll: true });
    });
  });

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
        state.medicationReview = null;
        state.problemReview = null;
        state.kb.coreCascades = null;
        state.kb.vihModifiers = null;
        state.kb.ddiWatchlist = null;
        state.kb.clinicalModifiers = null;
        invalidateDetectedCascades();
        var statusEl = document.getElementById('kb-status');
        if (statusEl) statusEl.innerHTML = '<span class="kb-chip loading"><span class="spinner" style="width:12px;height:12px;border-width:2px;" aria-hidden="true"></span> ' + escHtml(tStatic('kb_status_loading')) + ' ' + newMode + '</span>';
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

  /* Language selector */
  var btnLangEs = document.getElementById('lang-es');
  var btnLangEn = document.getElementById('lang-en');

  function applyLanguage(lang) {
    currentLanguage = lang;
    document.documentElement.lang = lang;
    try { localStorage.setItem(LS_LANG_KEY, lang); } catch (e) { /* ignore */ }
    /* Re-run detection so language-specific free-text fields (e.g. the
       urologic/renal problem label) reflect the new language too. */
    invalidateDetectedCascades();
    /* Update button active states */
    if (btnLangEs) {
      btnLangEs.setAttribute('aria-pressed', String(lang === 'es'));
      btnLangEs.classList.toggle('lang-btn-active', lang === 'es');
    }
    if (btnLangEn) {
      btnLangEn.setAttribute('aria-pressed', String(lang === 'en'));
      btnLangEn.classList.toggle('lang-btn-active', lang === 'en');
    }
    /* Update static HTML strings (step nav labels, nav buttons) */
    updateStaticUI();
    if (state.kb.coreCascades) {
      updateKBStatus(lastKBLoadStatus.loaded, lastKBLoadStatus.failed);
      runKBValidation();
    }
    /* Update step counter / prev-next buttons */
    updateNavButtons(state.step);
    /* Re-render the current step so all text reflects the new language */
    renderStepContent(state.step);
    if (currentView === 'knowledge') renderKnowledgeView();
    var saved = document.getElementById('save-indicator');
    if (saved) saved.innerHTML = '';
  }

  if (btnLangEs) btnLangEs.addEventListener('click', function () { applyLanguage('es'); });
  if (btnLangEn) btnLangEn.addEventListener('click', function () { applyLanguage('en'); });

  /* Reflect persisted language on startup */
  applyLanguage(currentLanguage);
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
        escHtml(tStatic('kb_status_loading')) + '</span>';
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

    /* Optional link to an official award announcement (site.config.js);
       hidden while unset. Only http(s) URLs are accepted. */
    var cfg = (typeof window !== 'undefined' && window.SITE_CONFIG) || {};
    var awardLink = document.getElementById('award-link');
    if (awardLink && /^https:\/\//i.test(cfg.awardUrl || '')) {
      awardLink.href = cfg.awardUrl;
      awardLink.rel = 'noopener noreferrer';
      awardLink.target = '_blank';
      awardLink.hidden = false;
    }

    appReady = true;
    routeFromHash();

  } catch (err) {
    console.error('[App] Initialization failed:', err);

    /* Show visible error in the step content area */
    var container = document.getElementById('step-content');
    if (container) {
      container.innerHTML =
        '<div class="callout callout-danger">' +
          '<strong>&#9888; ' + escHtml(tStatic('app_init_error_title')) + '</strong> ' +
          'Error: ' + escHtml(err.message) + '. ' +
          escHtml(tStatic('app_init_error_detail')) +
        '</div>';
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
