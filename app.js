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
    /* Navigation */
    step_counter:     function (n) { return 'Paso ' + n + ' de 6'; },
    btn_prev:         '&#8592; Anterior',
    btn_next:         'Siguiente &#8594;',
    btn_finish:       '&#10003; Finalizar',

    /* Step nav labels */
    nav_step1: 'Datos',
    nav_step2: 'Medicaci&oacute;n',
    nav_step3: 'Clasificaci&oacute;n',
    nav_step4: 'Cascadas',
    nav_step5: 'Plan',
    nav_step6: 'Informe',

    /* Step titles */
    step1_title: '&#128203; Paso 1 &mdash; Datos del caso',
    step2_title: '&#128138; Paso 2 &mdash; Medicaci&oacute;n y problemas activos',
    step3_title: '&#128230; Paso 3 &mdash; Clasificaci&oacute;n farmacol&oacute;gica',
    step4_title: '&#128269; Paso 4 &mdash; Posibles cascadas terap&eacute;uticas',
    step5_title: '&#128221; Paso 5 &mdash; Verificaci&oacute;n cl&iacute;nica',
    step6_title: '&#128196; Paso 6 &mdash; Plan farmacoterap&eacute;utico e informe',

    /* Onboarding */
    onboarding_title:       'C&oacute;mo funciona el auditor &mdash; en 3 pasos',
    onboarding_step1_title: 'Introduzca la nota cl&iacute;nica',
    onboarding_step1_body:  'Pegue la nota cl&iacute;nica seudonimizada del paciente. El auditor extraer&aacute; autom&aacute;ticamente los medicamentos y problemas activos.',
    onboarding_step2_title: 'El auditor detecta posibles cascadas',
    onboarding_step2_body:  'Cruza los f&aacute;rmacos con la base de conocimiento: identifica si alg&uacute;n medicamento puede ser consecuencia de un efecto adverso de otro.',
    onboarding_step3_title: 'Obtenga un plan farmacoterap&eacute;utico',
    onboarding_step3_body:  'Clasifique cada hallazgo, a&ntilde;ada sus notas cl&iacute;nicas y exporte un informe estructurado para el equipo asistencial.',
    onboarding_hint:        '&#8594; Pruebe con el caso demo &mdash; un paciente VIH en TAR con antihipertensivo que genera edema tratado con diur&eacute;tico.',
    onboarding_demo_btn:    '&#9654; Probar demo',

    /* Step 1 form */
    note_label:       'Nota cl&iacute;nica del caso',
    note_placeholder: 'Pegue aqu&iacute; la nota cl&iacute;nica seudonimizada&hellip;',
    note_hint:        'Sin identificadores reales de paciente. Los datos permanecen &uacute;nicamente en este navegador.',

    /* Common warnings */
    kb_unavailable_title:  '&#9888; Base de conocimiento no disponible.',
    kb_unavailable_detail: 'Compruebe el estado KB en el pie de p&aacute;gina y recargue si es necesario.',
    note_empty_title:          '&#9888; Nota cl&iacute;nica vac&iacute;a.',
    note_empty_detail:         'Introduzca la nota cl&iacute;nica en el Paso 1 antes de continuar.',
    note_empty_detail_report:  'Introduzca la nota cl&iacute;nica en el Paso 1 para generar el informe.',

    /* Step 2 */
    drugs_section_label:           'Medicamentos detectados',
    no_drugs_title:                '&#10003; Sin medicamentos identificados.',
    no_drugs_detail:               'La nota puede usar nombres comerciales, abreviaturas o f&aacute;rmacos no incluidos en la KB actual.',
    drugs_detected:                function (n) { return '<strong>' + n + ' medicamento' + (n === 1 ? '' : 's') + ' detectado' + (n === 1 ? '' : 's') + '</strong> en la nota cl&iacute;nica.'; },
    symptoms_dict_missing:         'Problemas detectados &mdash; <em style="color:#e67e22;font-style:normal;">diccionario no cargado</em>',
    symptoms_dict_unavailable_title:  '&#9888;&nbsp;<strong>Diccionario de s&iacute;ntomas no disponible.</strong>',
    symptoms_dict_unavailable_detail: 'Recargue la p&aacute;gina o compruebe el estado KB.',
    symptoms_zero_label:           'Problemas activos detectados (0)',
    no_symptoms:                   '&#10003;&nbsp;No se han detectado problemas cl&iacute;nicos en la nota.',
    symptoms_count:                function (a, i) { return 'Problemas detectados (' + a + ' activo' + (a === 1 ? '' : 's') + (i ? ', ' + i + ' no activo' + (i === 1 ? '' : 's') : '') + ')'; },
    inactive_mentions:             'Menciones no activas (negadas o hist&oacute;ricas):',
    none:                          'Ninguno',
    detection_warning:             '&#9888;&nbsp;La detecci&oacute;n es por palabras clave. Nombres comerciales, abreviaturas y t&eacute;rminos no incluidos en la KB pueden no identificarse.',

    /* Step 3 */
    drug_class_none:   'sin clasificar',
    col_drug:          'Medicamento',
    col_class:         'Grupo farmacol&oacute;gico',
    class_summary:     function (drugs, mapped, unmapped) {
      return '<strong>' + drugs + ' medicamento' + (drugs === 1 ? '' : 's') +
        ' &rarr; ' + mapped + ' grupo' + (mapped === 1 ? '' : 's') + ' farmacol&oacute;gico' + (mapped === 1 ? '' : 's') +
        ' identificado' + (mapped === 1 ? '' : 's') + (unmapped ? ', ' + unmapped + ' sin clasificar' : '') + '.</strong>';
    },
    no_drugs_to_classify:        '&#10003; Sin medicamentos a clasificar.',
    no_drugs_to_classify_detail: 'No se detectaron medicamentos en la nota cl&iacute;nica (Paso 2).',

    /* Step 4 */
    kb_ready:             '<strong>Base de conocimiento lista.</strong>',
    kb_ready_detail:      function (c, v, d) { return c + ' patrones de cascada &middot; ' + v + ' modificadores VIH &middot; ' + d + ' interacciones DDI.'; },
    no_cascades_title:    '&#10003; Sin se&ntilde;ales de cascada detectadas.',
    no_cascades_detail:   'No se han identificado patrones de cascada terap&eacute;utica en la nota cl&iacute;nica.',
    conf_high:            'alto',
    conf_medium:          'medio',
    conf_low:             'bajo',
    appr_often_inappropriate: 'frecuentemente inapropiado',
    appr_often_appropriate:   'frecuentemente apropiado',
    appr_context_dependent:   'dependiente del contexto',
    via_symptom:          'v&iacute;a s&iacute;ntoma',
    risk_label:           'Riesgo:',
    ddi_alert:            '&#9888; Alerta de interacci&oacute;n:',
    clinical_action:      '&#128203; Acci&oacute;n cl&iacute;nica:',
    detection_reason:     '&#128269; Motivo de detecci&oacute;n:',
    cascade_count:        function (n) { return '&#128204;&nbsp;' + n + (n === 1 ? ' posible cascada terap&eacute;utica detectada' : ' posibles cascadas terap&eacute;uticas detectadas'); },
    pharmacist_only_warning: '&#9888;&nbsp;Solo para revisi&oacute;n farmac&eacute;utica y cl&iacute;nica. No sustituye el juicio cl&iacute;nico profesional.',

    /* Step 5 */
    clinical_review_label: 'Revisi&oacute;n cl&iacute;nica:',
    tally_confirmed:       function (n) { return n + ' confirmada' + (n === 1 ? '' : 's'); },
    tally_possible:        function (n) { return n + ' posible' + (n === 1 ? '' : 's'); },
    tally_discarded:       function (n) { return n + ' descartada' + (n === 1 ? '' : 's'); },
    tally_unreviewed:      function (n) { return n + ' sin revisar'; },
    all_reviewed:          '&#10003; Todas revisadas',
    recommended_action:    '&#128203; Acci&oacute;n recomendada:',
    consider_also:         '&#128270; Considerar tambi&eacute;n:',
    classify_label:        'Clasificar:',
    btn_confirmed:         '&#10003;&nbsp;Cascada confirmada',
    btn_possible:          '&#63;&nbsp;Cascada posible',
    btn_discard:           '&#10005;&nbsp;Descartar',
    review_warning:        '&#9888;&nbsp;Revise cada se&ntilde;al y clasif&iacute;quela. Para uso farmac&eacute;utico y cl&iacute;nico exclusivamente.',
    no_cascades_step5:        '&#10003; Sin se&ntilde;ales de cascada.',
    no_cascades_step5_detail: 'No se identificaron patrones de cascada terap&eacute;utica &mdash; no se requiere plan de actuaci&oacute;n.',

    /* Step 6 — report display */
    report_title:           '&#128196;&nbsp;Informe de Auditor&iacute;a de Cascadas Terap&eacute;uticas',
    section_case_data:      'Datos del caso y auditor&iacute;a',
    label_patient_id:       'ID de paciente',
    label_generated:        'Generado',
    label_kb_version:       'Versi&oacute;n KB',
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
    no_cascades_report:     '&#10003;&nbsp;Sin se&ntilde;ales de cascada terap&eacute;utica detectadas.',

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

    /* Export buttons */
    btn_copy_record:  '&#128203;&nbsp;Copiar para historia cl&iacute;nica',
    btn_save_pdf:     '&#128438;&nbsp;Guardar como PDF',
    btn_export_json:  '&#8681;&nbsp;Exportar JSON',
    btn_export_csv:   '&#8681;&nbsp;Exportar CSV',
    decision_support_warning: '&#9888;&nbsp;Solo apoyo a la decisi&oacute;n cl&iacute;nica. No es un producto sanitario (MDR). No utilizar con identificadores reales de pacientes fuera de un contexto de investigaci&oacute;n seudonimizado.',

    /* Toast messages */
    toast_storage_full:        'Almacenamiento lleno &mdash; el autoguardado ha fallado. Exporte el caso ahora para no perder datos.',
    toast_report_copied:       'Informe copiado al portapapeles.',
    toast_report_copy_failed:  'No se pudo generar el informe para copiar.',
    toast_clipboard_failed:    'No se pudo copiar autom&aacute;ticamente. Use Exportar JSON/CSV o Guardar como PDF.',
    toast_print_hint:          'Use &laquo;Guardar como PDF&raquo; en el di&aacute;logo de impresi&oacute;n.',
    toast_demo_loaded:         'Caso demo cargado &mdash; avance por los pasos para ver las cascadas detectadas.',
    toast_case_exported:       'Caso exportado correctamente.',
    toast_case_imported:       'Caso importado correctamente.',
    toast_import_type_error:   'Importaci&oacute;n fallida: el archivo debe ser un .json exportado por esta aplicaci&oacute;n.',
    toast_import_failed:       function (msg) { return 'Importaci&oacute;n fallida: ' + msg; },
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
    report_verif:        '   - Estado de verificaci\u00F3n: ',
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
    /* Navigation */
    step_counter:     function (n) { return 'Step ' + n + ' of 6'; },
    btn_prev:         '&#8592; Previous',
    btn_next:         'Next &#8594;',
    btn_finish:       '&#10003; Finish',

    /* Step nav labels */
    nav_step1: 'Data',
    nav_step2: 'Medication',
    nav_step3: 'Classification',
    nav_step4: 'Cascades',
    nav_step5: 'Plan',
    nav_step6: 'Report',

    /* Step titles */
    step1_title: '&#128203; Step 1 &mdash; Case Data',
    step2_title: '&#128138; Step 2 &mdash; Medications &amp; Active Problems',
    step3_title: '&#128230; Step 3 &mdash; Pharmacological Classification',
    step4_title: '&#128269; Step 4 &mdash; Possible Therapeutic Cascades',
    step5_title: '&#128221; Step 5 &mdash; Clinical Verification',
    step6_title: '&#128196; Step 6 &mdash; Pharmacotherapy Plan &amp; Report',

    /* Onboarding */
    onboarding_title:       'How the auditor works &mdash; in 3 steps',
    onboarding_step1_title: 'Enter the clinical note',
    onboarding_step1_body:  'Paste the pseudonymised patient clinical note. The auditor will automatically extract medications and active problems.',
    onboarding_step2_title: 'The auditor detects possible cascades',
    onboarding_step2_body:  'It cross-references drugs against the knowledge base: identifies whether any medication may be a consequence of an adverse effect of another.',
    onboarding_step3_title: 'Get a pharmacotherapy plan',
    onboarding_step3_body:  'Classify each finding, add your clinical notes, and export a structured report for the care team.',
    onboarding_hint:        '&#8594; Try the demo case &mdash; an HIV patient on ART with an antihypertensive causing oedema treated with a diuretic.',
    onboarding_demo_btn:    '&#9654; Try demo',

    /* Step 1 form */
    note_label:       'Clinical note',
    note_placeholder: 'Paste the pseudonymised clinical note here&hellip;',
    note_hint:        'No real patient identifiers. Data is stored only in this browser.',

    /* Common warnings */
    kb_unavailable_title:  '&#9888; Knowledge base unavailable.',
    kb_unavailable_detail: 'Check KB status in the footer and reload if necessary.',
    note_empty_title:          '&#9888; Clinical note is empty.',
    note_empty_detail:         'Enter the clinical note in Step 1 before continuing.',
    note_empty_detail_report:  'Enter the clinical note in Step 1 to generate the report.',

    /* Step 2 */
    drugs_section_label:           'Detected medications',
    no_drugs_title:                '&#10003; No medications identified.',
    no_drugs_detail:               'The note may use brand names, abbreviations or drugs not included in the current KB.',
    drugs_detected:                function (n) { return '<strong>' + n + ' medication' + (n === 1 ? '' : 's') + ' detected</strong> in the clinical note.'; },
    symptoms_dict_missing:         'Active problems &mdash; <em style="color:#e67e22;font-style:normal;">dictionary not loaded</em>',
    symptoms_dict_unavailable_title:  '&#9888;&nbsp;<strong>Symptom dictionary unavailable.</strong>',
    symptoms_dict_unavailable_detail: 'Reload the page or check KB status.',
    symptoms_zero_label:           'Active problems detected (0)',
    no_symptoms:                   '&#10003;&nbsp;No clinical problems detected in the note.',
    symptoms_count:                function (a, i) { return 'Problems detected (' + a + ' active' + (i ? ', ' + i + ' inactive' : '') + ')'; },
    inactive_mentions:             'Inactive mentions (negated or historical):',
    none:                          'None',
    detection_warning:             '&#9888;&nbsp;Detection is keyword-based. Brand names, abbreviations and terms not in the KB may not be identified.',

    /* Step 3 */
    drug_class_none:   'unclassified',
    col_drug:          'Medication',
    col_class:         'Pharmacological group',
    class_summary:     function (drugs, mapped, unmapped) {
      return '<strong>' + drugs + ' medication' + (drugs === 1 ? '' : 's') +
        ' &rarr; ' + mapped + ' pharmacological group' + (mapped === 1 ? '' : 's') + ' identified' +
        (unmapped ? ', ' + unmapped + ' unclassified' : '') + '.</strong>';
    },
    no_drugs_to_classify:        '&#10003; No medications to classify.',
    no_drugs_to_classify_detail: 'No medications were detected in the clinical note (Step 2).',

    /* Step 4 */
    kb_ready:             '<strong>Knowledge base ready.</strong>',
    kb_ready_detail:      function (c, v, d) { return c + ' cascade patterns &middot; ' + v + ' HIV modifiers &middot; ' + d + ' DDI interactions.'; },
    no_cascades_title:    '&#10003; No cascade signals detected.',
    no_cascades_detail:   'No therapeutic cascade patterns identified in the clinical note.',
    conf_high:            'high',
    conf_medium:          'medium',
    conf_low:             'low',
    appr_often_inappropriate: 'often inappropriate',
    appr_often_appropriate:   'often appropriate',
    appr_context_dependent:   'context-dependent',
    via_symptom:          'via symptom',
    risk_label:           'Risk:',
    ddi_alert:            '&#9888; Interaction alert:',
    clinical_action:      '&#128203; Clinical action:',
    detection_reason:     '&#128269; Detection reason:',
    cascade_count:        function (n) { return '&#128204;&nbsp;' + n + ' possible therapeutic cascade' + (n === 1 ? '' : 's') + ' detected'; },
    pharmacist_only_warning: '&#9888;&nbsp;For pharmaceutical and clinical review only. Does not replace professional clinical judgement.',

    /* Step 5 */
    clinical_review_label: 'Clinical review:',
    tally_confirmed:       function (n) { return n + ' confirmed'; },
    tally_possible:        function (n) { return n + ' possible'; },
    tally_discarded:       function (n) { return n + ' discarded'; },
    tally_unreviewed:      function (n) { return n + ' unreviewed'; },
    all_reviewed:          '&#10003; All reviewed',
    recommended_action:    '&#128203; Recommended action:',
    consider_also:         '&#128270; Also consider:',
    classify_label:        'Classify:',
    btn_confirmed:         '&#10003;&nbsp;Confirmed cascade',
    btn_possible:          '&#63;&nbsp;Possible cascade',
    btn_discard:           '&#10005;&nbsp;Discard',
    review_warning:        '&#9888;&nbsp;Review and classify each signal. For pharmaceutical and clinical use only.',
    no_cascades_step5:        '&#10003; No cascade signals.',
    no_cascades_step5_detail: 'No therapeutic cascade patterns identified &mdash; no action plan required.',

    /* Step 6 — report display */
    report_title:           '&#128196;&nbsp;Therapeutic Cascade Audit Report',
    section_case_data:      'Case data &amp; audit',
    label_patient_id:       'Patient ID',
    label_generated:        'Generated',
    label_kb_version:       'KB version',
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
    no_cascades_report:     '&#10003;&nbsp;No therapeutic cascade signals detected.',

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

    /* Export buttons */
    btn_copy_record:  '&#128203;&nbsp;Copy to medical record',
    btn_save_pdf:     '&#128438;&nbsp;Save as PDF',
    btn_export_json:  '&#8681;&nbsp;Export JSON',
    btn_export_csv:   '&#8681;&nbsp;Export CSV',
    decision_support_warning: '&#9888;&nbsp;Decision support only. Not a medical device (MDR). Do not use with real patient identifiers outside a pseudonymised research context.',

    /* Toast messages */
    toast_storage_full:        'Storage full &mdash; auto-save failed. Export your case now to avoid data loss.',
    toast_report_copied:       'Report copied to clipboard.',
    toast_report_copy_failed:  'Could not generate the report for copying.',
    toast_clipboard_failed:    'Could not copy automatically. Use Export JSON/CSV or Save as PDF.',
    toast_print_hint:          'Use \u201CSave as PDF\u201D in the print dialog.',
    toast_demo_loaded:         'Demo case loaded &mdash; go through the steps to see the detected cascades.',
    toast_case_exported:       'Case exported successfully.',
    toast_case_imported:       'Case imported successfully.',
    toast_import_type_error:   'Import failed: file must be a .json export from this application.',
    toast_import_failed:       function (msg) { return 'Import failed: ' + msg; },
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
    report_verif:        '   - Verification status: ',
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

/* ── State ── */
const state = {
  step: 1,
  patientId: '',
  clinicalNote: '',
  kbMode: 'PROD',
  kb: { coreCascades: null, vihModifiers: null, ddiWatchlist: null, symptomDictionary: null, clinicalModifiers: null },
  /* Step 2 — symptoms found in the clinical note */
  symptomsDetected: [],
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
      symptomsDetected: state.symptomsDetected,
      cascadeClassifications: state.cascadeClassifications
    };
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
    localStorage.setItem(LS_LANG_KEY, currentLanguage);
  } catch (err) {
    console.error('[Storage] Could not save state:', err);
    /* QuotaExceededError means browser storage is full — surface this to the user
     * so they know their work is at risk, rather than losing it silently. */
    if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      showToast(tUI('toast_storage_full'), 'error');
    }
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (typeof saved.patientId === 'string')    state.patientId    = saved.patientId;
    if (typeof saved.clinicalNote === 'string') state.clinicalNote = saved.clinicalNote;
    /* Guard against corrupted or out-of-range step values */
    if (Number.isInteger(saved.step) && saved.step >= 1 && saved.step <= 6) state.step = saved.step;
    if (Array.isArray(saved.symptomsDetected))                 state.symptomsDetected       = saved.symptomsDetected;
    if (saved.cascadeClassifications && typeof saved.cascadeClassifications === 'object' &&
        !Array.isArray(saved.cascadeClassifications))          state.cascadeClassifications = saved.cascadeClassifications;
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
    state.symptomsDetected = [];
    state.cascadeClassifications = {};
    state.detectedCascades = null;
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
    clinicalModifiers: folder + '/kb_clinical_modifiers.json',
    /* Shared drug name dictionary — lives at kb/ root, not inside a track
     * subfolder, because variant/brand-name mappings are track-independent. */
    drugDictionary:    'kb/drug_dictionary.json'
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

function updateKBStatus(loaded, failed) {
  var mode = state.kbMode;
  var version = getKBVersion();

  var statusEl = document.getElementById('kb-status');
  if (statusEl) {
    if (failed === 0) {
      statusEl.innerHTML = '<span class="kb-chip ok">&#10003; KB ' + mode + (version ? ' v' + version : '') + '</span>';
    } else if (loaded === 0) {
      /* Total failure — all files unavailable */
      statusEl.innerHTML = '<span class="kb-chip fail">&#10007; KB unavailable &mdash; ' + failed + ' file(s) failed to load</span>';
    } else {
      /* Partial failure — some files loaded, some failed */
      statusEl.innerHTML =
        '<span class="kb-chip ok">&#10003; ' + loaded + ' loaded</span> ' +
        '<span class="kb-chip fail">&#10007; ' + failed + ' failed</span> ' +
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

  var byField    = opResult.fallbackByField    || {};
  var byFieldIds = opResult.fallbackByFieldIds || {};
  var hasFallback = opResult.fallbackCascadeCount > 0;

  /* i18n detail rows — shown only inside the expandable panel, never in the headline */
  var i18nDetailItems = Object.keys(byField).sort().map(function (field) {
    var count = byField[field];
    var ids   = byFieldIds[field] || [];
    return '<li><code>' + escHtml(field) + '</code>: ' + count + ' cascade(s) using EN fallback' +
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
      '<strong>Errors:</strong><ul style="margin:.4rem 0 0 1.2rem;padding:0;">' +
        opResult.errors.map(function(e){ return '<li>' + escHtml(e) + '</li>'; }).join('') +
      '</ul>' +
      (structuralItems.length ?
        '<strong>Warnings:</strong><ul style="margin:.4rem 0 0 1.2rem;padding:0;">' +
          structuralItems.join('') + '</ul>' : '') +
      /* i18n note inside error detail, not as a separate banner */
      (hasFallback ?
        '<details style="margin-top:.5rem"><summary style="cursor:pointer;font-size:.75rem;">' +
          'Show translation details (' + opResult.fallbackCascadeCount + ' cascade(s), ' +
          opResult.fallbackFieldCount + ' field(s))</summary>' +
          '<ul style="margin:.3rem 0 0 1.2rem;padding:0;">' + i18nDetailItems.join('') + '</ul>' +
        '</details>' : '');
    banner.innerHTML =
      '<div style="background:#c0392b;color:#fff;padding:.6rem 1rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;">' +
        '<strong>&#9888; KB load error \u2014 ' + opResult.errors.length + ' schema error(s) detected. Some features may be unavailable.</strong>' +
        '<button onclick="document.getElementById(\'kb-val-detail\').style.display=document.getElementById(\'kb-val-detail\').style.display===\'none\'?\'block\':\'none\'" ' +
          'style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.5);color:#fff;padding:.2rem .5rem;cursor:pointer;border-radius:3px;font-size:.75rem;">View errors</button>' +
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
      ? 'Language: mixed (EN fallback active) \u2014 ' +
        opResult.fallbackCascadeCount + ' cascade(s), ' + opResult.fallbackFieldCount + ' field(s).'
      : 'KB notices (' + structuralItems.length + ')';

    /* Detail panel: structural warnings first, then i18n per-field breakdown */
    var amberDetailParts = [];
    if (structuralItems.length > 0) {
      amberDetailParts.push(
        '<strong style="display:block;margin-bottom:.2rem">Structural notices:</strong>' +
        '<ul style="margin:.2rem 0 .5rem 1.2rem;padding:0;">' + structuralItems.join('') + '</ul>'
      );
    }
    if (hasFallback) {
      amberDetailParts.push(
        '<ul style="margin:.2rem 0 0 1.2rem;padding:0;">' + i18nDetailItems.join('') + '</ul>'
      );
    }

    var detailBtnLabel = hasFallback ? 'Show translation details' : 'View notices';

    banner.innerHTML =
      '<div style="background:#f39c12;color:#fff;padding:.4rem 1rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;">' +
        '<span>&#9888; ' + headlineText + '</span>' +
        '<button onclick="document.getElementById(\'kb-val-detail\').style.display=document.getElementById(\'kb-val-detail\').style.display===\'none\'?\'block\':\'none\'" ' +
          'style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.5);color:#fff;padding:.15rem .45rem;cursor:pointer;border-radius:3px;font-size:.75rem;">' +
          escHtml(detailBtnLabel) + '</button>' +
        '<button onclick="this.parentElement.parentElement.style.display=\'none\'" ' +
          'style="margin-left:auto;background:transparent;border:none;color:#fff;cursor:pointer;font-size:1rem;line-height:1;" title="Dismiss">&times;</button>' +
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
   Cascade Detection Engine
   ============================================================ */

/**
 * Drug mention resolver (Phase 1):
 * - text normalization (NFC + diacritic folding + punctuation simplification)
 * - aliases / abbreviations / frequent brand names
 * - slash combinations support
 *
 * Output shape for each mention:
 * {
 *   mention, canonical, drug_class,
 *   match_type: 'exact'|'alias'|'combo'|'normalized',
 *   confidence: 'high'|'medium'
 * }
 */
function normalizeDrugText(text) {
  var raw = (text || '');
  if (raw.normalize) {
    raw = raw.normalize('NFC').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  return raw
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[‐-―]/g, '-')
    .replace(/[\(\)\[\],;:]/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildDrugResolver() {
  var resolver = {
    byVariant: {},
    variantPattern: null
  };

  var allCascades = [].concat(
    (state.kb.coreCascades && state.kb.coreCascades.cascades) || [],
    (state.kb.vihModifiers && state.kb.vihModifiers.art_related_cascades) || []
  );

  var MANUAL_ALIASES = {
    'azt': 'zidovudine',
    'tdf': 'tenofovir disoproxil fumarate',
    'dtg': 'dolutegravir',
    'biktarvy': 'bictegravir',
    'descovy': 'tenofovir disoproxil fumarate',
    'truvada': 'tenofovir disoproxil fumarate',
    'kaletra': 'lopinavir/ritonavir',
    'prezista': 'darunavir',
    'rezolsta': 'darunavir/cobicistat',
    'symtuza': 'darunavir/cobicistat',
    'evotaz': 'atazanavir/cobicistat',
    'reyataz': 'atazanavir',
    'norvir': 'ritonavir',
    'isentress': 'raltegravir',
    'tivicay': 'dolutegravir'
  };

  function addVariant(rawVariant, canonical, drugClass, matchType, confidence) {
    var normVariant = normalizeDrugText(rawVariant);
    if (!normVariant || normVariant.length < 2) return;

    var current = resolver.byVariant[normVariant];
    if (!current || (current.confidence !== 'high' && confidence === 'high')) {
      resolver.byVariant[normVariant] = {
        variant: rawVariant,
        canonical: canonical,
        drug_class: drugClass || '',
        match_type: matchType,
        confidence: confidence
      };
    }
  }

  allCascades.forEach(function (cascade) {
    var idxClass = cascade.index_drug_class ||
      (Array.isArray(cascade.index_drug_classes) ? cascade.index_drug_classes[0] : '') || '';
    var casClass = cascade.cascade_drug_class || '';

    getIndexExamples(cascade).forEach(function (drug) {
      addVariant(drug, drug, idxClass, 'exact', 'high');
      addVariant(drug.replace(/\//g, ' / '), drug, idxClass, 'combo', 'high');
      drug.split('/').forEach(function (part) {
        addVariant(part.trim(), drug, idxClass, 'combo', 'medium');
      });
    });

    getCascadeExamples(cascade).forEach(function (drug) {
      addVariant(drug, drug, casClass, 'exact', 'high');
      addVariant(drug.replace(/\//g, ' / '), drug, casClass, 'combo', 'high');
      drug.split('/').forEach(function (part) {
        addVariant(part.trim(), drug, casClass, 'combo', 'medium');
      });
    });
  });

  Object.keys(MANUAL_ALIASES).forEach(function (alias) {
    var canonical = MANUAL_ALIASES[alias];
    var canonicalMeta = resolver.byVariant[normalizeDrugText(canonical)] || null;
    addVariant(alias, canonical, canonicalMeta ? canonicalMeta.drug_class : '', 'alias', 'medium');
  });

  /* ── Drug dictionary (kb/drug_dictionary.json) ──────────────────────────
   * Each entry declares a canonical English INN and a list of variants that
   * should resolve to it: Spanish INNs (e.g. "amlodipino"), alternate
   * spellings, and common brand names.  Normalisation is applied to every
   * variant so that diacritics or mixed-case in free text still match.
   * Entries are added at 'high' confidence so they take priority over the
   * 'medium' combo-split matches produced from cascade examples above. */
  var dictEntries = (state.kb.drugDictionary && state.kb.drugDictionary.entries) || [];
  dictEntries.forEach(function (entry) {
    if (!entry.canonical) return;
    var drugClass = entry.drug_class || '';
    /* Register the canonical name itself so it is always found */
    addVariant(entry.canonical, entry.canonical, drugClass, 'dict', 'high');
    /* Register each declared variant → canonical */
    (entry.variants || []).forEach(function (variant) {
      if (variant) addVariant(variant, entry.canonical, drugClass, 'dict', 'high');
    });
  });

  var escaped = Object.keys(resolver.byVariant)
    .sort(function (a, b) { return b.length - a.length; })
    .map(function (term) { return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });

  if (escaped.length) {
    resolver.variantPattern = new RegExp('(^|[^a-z0-9])(' + escaped.join('|') + ')(?=[^a-z0-9]|$)', 'gi');
  }

  return resolver;
}

function getDrugResolver() {
  if (!state.drugResolver) {
    state.drugResolver = buildDrugResolver();
  }
  return state.drugResolver;
}

function resolveDrugMentions(noteText) {
  if (!noteText || !noteText.trim()) return [];

  var resolver = getDrugResolver();
  if (!resolver.variantPattern) return [];

  /* Normalization: apply the same pipeline used when building the resolver
   * (NFC + diacritic stripping + punctuation simplification + lowercase).
   * This lets "Amlodipino" match the stored variant "amlodipino" without
   * needing case-sensitive entries for every capitalisation variant. */
  var normalized = normalizeDrugText(noteText);
  var mentions = [];
  var seen = {};
  var match;

  /* Dictionary matching: the compiled regex tests every known variant (from
   * KB cascade examples, manual aliases, and drug_dictionary.json) against
   * the normalised note in one pass.  Each match's captured group [2] is the
   * exact variant string; byVariant maps it to the canonical English INN and
   * therapeutic class. */
  while ((match = resolver.variantPattern.exec(normalized)) !== null) {
    var variant = (match[2] || '').trim();
    if (!variant) continue;

    var meta = resolver.byVariant[variant];
    if (!meta) continue;

    /* Deduplicate: same canonical at the same offset is only reported once. */
    var dedupeKey = meta.canonical + '::' + match.index;
    if (seen[dedupeKey]) continue;
    seen[dedupeKey] = true;

    mentions.push({
      mention: variant,        /* surface form found in note */
      canonical: meta.canonical, /* normalised generic INN passed to cascade engine */
      drug_class: meta.drug_class || '',
      match_type: meta.match_type || 'normalized',
      confidence: meta.confidence || 'medium',
      start_index: match.index
    });
  }

  mentions.sort(function (a, b) { return a.start_index - b.start_index; });
  return mentions;
}

/**
 * Backward-compatible boolean matcher used by existing logic.
 */
function drugFoundInNote(noteText, drug) {
  var target = normalizeDrugText(drug);
  return resolveDrugMentions(noteText).some(function (m) {
    return normalizeDrugText(m.canonical) === target;
  });
}

/* ============================================================
   NLP RELIABILITY LAYER — negation, temporality, context
   ============================================================ */

/**
 * Return the first match position for `term` in `noteText` using the same
 * word-boundary logic as drugFoundInNote(), but yielding {index, length}.
 * Returns null if not found.
 *
 * Handles slash-separated compound names (lopinavir/ritonavir).
 */
function findTermInNote(noteText, term) {
  /* Normalise both strings to NFC so that decomposed Unicode characters
   * (NFD form — e.g. n + combining-tilde instead of ñ U+00F1, or
   * i + combining-acute instead of í U+00ED) still match their composed
   * equivalents stored in the KB.  macOS clipboard and some browsers can
   * produce NFD text; the KB JSON is always stored as NFC. */
  var normNote = (noteText && noteText.normalize) ? noteText.normalize('NFC') : (noteText || '');
  var parts = term.split('/');
  for (var p = 0; p < parts.length; p++) {
    var part = parts[p].trim();
    if (!part) continue;
    var normPart = part.normalize ? part.normalize('NFC') : part;
    try {
      var escaped = normPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var m = new RegExp('\\b' + escaped + '\\b', 'i').exec(normNote);
      if (m) return { index: m.index, length: m[0].length };
    } catch (e) {
      var idx = normNote.toLowerCase().indexOf(normPart.toLowerCase());
      if (idx !== -1) return { index: idx, length: normPart.length };
    }
  }
  return null;
}

/**
 * Determine whether a symptom mention at `matchIndex`…`matchIndex+matchLength`
 * is negated, historical, or resolved — and should therefore NOT be counted
 * as an active symptom.
 *
 * Strategy: extract a token window of ≤6 tokens before and ≤3 tokens after
 * the match and pattern-match against curated negation/resolution lists.
 *
 * @param {string} noteText
 * @param {number} matchIndex  character offset of match start
 * @param {number} matchLength character length of matched term
 * @returns {{ negated: boolean, reason: string }}
 */
function isNegatedSymptom(noteText, matchIndex, matchLength) {
  /* ---- pre-window: up to 80 chars / 6 tokens before match ---- */
  var preRaw  = noteText.slice(Math.max(0, matchIndex - 80), matchIndex);
  var preTokens = preRaw.trim().split(/[\s,;:()\.\!\?]+/).filter(Boolean).slice(-6);
  var preStr  = preTokens.join(' ').toLowerCase();

  /* ---- post-window: up to 60 chars / 3 tokens after match ---- */
  var postRaw = noteText.slice(matchIndex + matchLength,
                               Math.min(noteText.length, matchIndex + matchLength + 60));
  var postTokens = postRaw.trim().split(/[\s,;:()\.\!\?]+/).filter(Boolean).slice(0, 3);
  var postStr = postTokens.join(' ').toLowerCase();

  /* ---- negation cues appearing BEFORE the term ---- */
  var negBefore = [
    /* English */
    /\bno\b/, /\bnot\b/, /\bdenies\b/, /\bdenied\b/, /\bwithout\b/,
    /\bnegative\s+for\b/, /\bfree\s+of\b/, /\brule\s*out\b/, /\br\/o\b/,
    /\bunlikely\b/, /\?/,
    /* Spanish */
    /\bniega\b/, /\bsin\b/, /\bdescarta\b/, /\bnegativo\s+para\b/, /\bnegativa\s+para\b/,
    /\bausencia\s+de\b/, /\bno\s+presenta\b/, /\bno\s+refiere\b/, /\bno\s+hay\b/
  ];
  for (var i = 0; i < negBefore.length; i++) {
    if (negBefore[i].test(preStr)) {
      return { negated: true, reason: 'negated before: "' + preTokens.slice(-3).join(' ') + '"' };
    }
  }

  /* ---- resolved / historical cues appearing BEFORE the term ---- */
  var histBefore = [
    /* English */
    /\bresolved\b/, /\bimproved\b/, /\bprevious\b/, /\bhistory\s+of\b/,
    /\bhx\s+of\b/, /\bh\/o\b/, /\bprior\b/, /\bpast\b/, /\bused\s+to\b/,
    /\bformer(?:ly)?\b/, /\bold\b/,
    /* Spanish */
    /\bantecedentes\s+de\b/, /\bhistoria\s+de\b/, /\bap\s+de\b/,
    /\bprevio\b/, /\bprevia\b/, /\bpreviamente\b/, /\ben\s+el\s+pasado\b/
  ];
  for (var j = 0; j < histBefore.length; j++) {
    if (histBefore[j].test(preStr)) {
      return { negated: true, reason: 'historical before: "' + preTokens.slice(-3).join(' ') + '"' };
    }
  }

  /* ---- resolved / past cues appearing AFTER the term ---- */
  var resolvedAfter = [
    /* English */
    /\bresolved\b/, /\bimproved\b/, /\bcleared\b/, /\bgone\b/, /\babated\b/,
    /* Spanish */
    /\bresuelto\b/, /\bresuelta\b/, /\bmejor[ií]a\b/, /\bmejorado\b/, /\bmejorada\b/,
    /\bcontrolado\b/, /\bcontrolada\b/, /\bcede\b/, /\bdesaparece\b/
  ];
  for (var k = 0; k < resolvedAfter.length; k++) {
    if (resolvedAfter[k].test(postStr)) {
      return { negated: true,
               reason: 'resolved after: "' + noteText.slice(matchIndex, matchIndex + matchLength) +
                       ' ' + postTokens.slice(0, 2).join(' ') + '"' };
    }
  }

  return { negated: false, reason: '' };
}

/**
 * Scan ±40 characters (≈ ±8 tokens) around `matchIndex` for temporal cues
 * that hint at whether a drug was recently started, a symptom is new, or a
 * treatment was recently added.  Also flags "chronic/long-term" patterns that
 * suggest the finding is pre-existing.
 *
 * Returns a plain object — never throws.
 *
 * @param {string} noteText
 * @param {number} matchIndex character offset of the term being evaluated
 * @returns {{ drugStartHint: boolean, symptomNewHint: boolean,
 *             treatmentAddedHint: boolean, chronicHint: boolean,
 *             details: string }}
 */
function detectTimeCues(noteText, matchIndex) {
  var R = 40; /* radius in characters */
  var start = Math.max(0, matchIndex - R);
  var end   = Math.min(noteText.length, matchIndex + R);
  var ctx   = noteText.slice(start, end).toLowerCase();

  return {
    /* EN: started/initiated/… | ES: inicia/se inicia/se empezó/tras iniciar/… */
    drugStartHint: (
      /\b(started|initiated|begin|began|since\s+starting|after\s+starting|on\s+\d|commenced)\b/.test(ctx) ||
      /\b(inicia|se\s+inicia|se\s+empez[oó]|tras\s+iniciar|al\s+iniciar|comienza|se\s+pauta)\b/.test(ctx)
    ),
    /* EN: since/after/worsened/new/… | ES: nuevo/reciente/empeora/presenta/aparece/desde hace */
    symptomNewHint: (
      /\b(since|after|worsened|new|recent|developed|onset|appearing|presenting\s+with|new[- ]onset)\b/.test(ctx) ||
      /\b(nuevo|nueva|reciente|recientemente|empeora|presenta|aparece|desde\s+hace|de\s+nueva\s+aparici[oó]n)\b/.test(ctx)
    ),
    /* EN: added/given/prescribed/… | ES: se añade/se pauta/se prescribe/se inicia/a demanda/prn */
    treatmentAddedHint: (
      /\b(added|given|prescribed|initiated|started|commenced|prn\s+started|increased)\b/.test(ctx) ||
      /\b(se\s+a[nñ]ade|se\s+pauta|se\s+prescribe|se\s+inicia|a\s+demanda|prn)\b/.test(ctx)
    ),
    /* EN: chronic/long-term/… | ES: crónico/de base/habitual/desde hace años/largo tiempo */
    chronicHint: (
      /\b(chronic|long[- ]term|longstanding|long\s+standing|baseline|ongoing|persistent|established|years|months|pre[- ]existing)\b/.test(ctx) ||
      /\b(cr[oó]nic[oa]|de\s+base|habitual|desde\s+hace\s+a[nñ]os|de\s+a[nñ]os|largo\s+tiempo|de\s+larga\s+evoluci[oó]n)\b/.test(ctx)
    ),
    details: ctx.trim().slice(0, 80)
  };
}

/**
 * Return the index drug examples for a cascade entry, handling both the
 * singular field name used in kb_core_cascades.json ("index_drug_examples")
 * and the plural form used in kb_vih_modifiers.json ("index_drugs_examples").
 */
function getIndexExamples(cascade) {
  return cascade.index_drug_examples || cascade.index_drugs_examples || [];
}

/**
 * Return the cascade drug examples for a cascade entry, handling both the
 * singular field name used in kb_core_cascades.json ("cascade_drug_examples")
 * and the plural form used in kb_vih_modifiers.json ("cascade_drugs_examples").
 */
function getCascadeExamples(cascade) {
  return cascade.cascade_drug_examples || cascade.cascade_drugs_examples || [];
}

/**
 * Scan `noteText` for clinical context terms defined in kb_clinical_modifiers.json.
 * Returns an array of matched modifier objects (augmented with the KB entry).
 *
 * @param {string} noteText
 * @returns {Array<Object>} Matched modifier entries from the KB
 */
function detectClinicalContextModifiers(noteText) {
  if (!noteText || !noteText.trim()) return [];
  var modifiers = (state.kb.clinicalModifiers && state.kb.clinicalModifiers.clinical_modifiers) || [];
  if (!modifiers.length) return [];

  var normalizedNote = normalizeDrugText(noteText);
  var matched = [];

  modifiers.forEach(function (mod) {
    var keywords = [];
    if (mod.trigger_context) {
      keywords = keywords.concat(mod.trigger_context.keywords_en || []);
      keywords = keywords.concat(mod.trigger_context.keywords_es || []);
    }
    for (var ki = 0; ki < keywords.length; ki++) {
      var kw = normalizeDrugText(keywords[ki]);
      if (kw && normalizedNote.indexOf(kw) !== -1) {
        matched.push(mod);
        return; /* one match per modifier is enough */
      }
    }
  });

  return matched;
}

/**
 * Post-process detected cascade signals by applying clinical context modifiers.
 * For each active modifier:
 *   - Upgrades signal confidence by one level (low→medium, medium→high)
 *   - Appends a context message to clinical_hint / clinical_hint_es
 *
 * @param {Array} signals   Output of detectCascades (before modifier pass)
 * @param {Array} modifiers Output of detectClinicalContextModifiers
 * @returns {Array} Signals with updated confidence and appended context messages
 */
function applyClinicalModifiers(signals, modifiers) {
  if (!signals.length || !modifiers.length) return signals;

  var CONFIDENCE_UPGRADE = { 'low': 'medium', 'medium': 'high', 'high': 'high' };

  return signals.map(function (sig) {
    var upgraded = Object.assign({}, sig);
    var appendedEn = [];
    var appendedEs = [];

    modifiers.forEach(function (mod) {
      if (!mod.effect || !mod.effect.priority_upgrade) return;

      /* Upgrade confidence one level */
      var current = (upgraded.confidence || 'low').toLowerCase();
      upgraded.confidence = CONFIDENCE_UPGRADE[current] || current;

      /* Collect context messages */
      if (mod.message_en) appendedEn.push('[' + mod.name_en + '] ' + mod.message_en);
      if (mod.message_es) appendedEs.push('[' + mod.name_es + '] ' + mod.message_es);

      /* Tag which modifiers contributed */
      if (!upgraded.clinical_modifiers) upgraded.clinical_modifiers = [];
      upgraded.clinical_modifiers.push(mod.id);
    });

    if (appendedEn.length) {
      upgraded.clinical_hint = (upgraded.clinical_hint ? upgraded.clinical_hint + ' | ' : '') + appendedEn.join(' | ');
    }
    if (appendedEs.length) {
      upgraded.clinical_hint_es = (upgraded.clinical_hint_es ? upgraded.clinical_hint_es + ' | ' : '') + appendedEs.join(' | ');
    }

    return upgraded;
  });
}

/**
 * Scan `noteText` against every loaded cascade entry (core + HIV modifiers).
 * A signal fires when at least one index_drug_example AND at least one
 * cascade_drug_example are both found in the note (case-insensitive whole-word
 * match via drugFoundInNote).
 *
 * Handles both KB field-name variants via getIndexExamples / getCascadeExamples.
 * Handles both confidence-field names: "confidence" (core) / "plausibility" (VIH).
 *
 * @param {string} noteText
 * @returns {Array<{
 *   cascade_id, cascade_name,
 *   index_drug, cascade_drug,
 *   confidence, risk_focus,
 *   ade_en, appropriateness,
 *   ddi_warning, clinical_hint
 * }>}
 */
function detectCascades(noteText) {
  if (!noteText || !noteText.trim()) return [];

  var mentions = resolveDrugMentions(noteText);
  var mentionByCanonical = {};
  mentions.forEach(function (m) {
    var key = normalizeDrugText(m.canonical);
    if (!mentionByCanonical[key]) mentionByCanonical[key] = [];
    mentionByCanonical[key].push(m);
  });

  var allCascades = [].concat(
    (state.kb.coreCascades && state.kb.coreCascades.cascades) || [],
    (state.kb.vihModifiers && state.kb.vihModifiers.art_related_cascades) || []
  );

  var detected = [];

  allCascades.forEach(function (cascade) {
    var indexExamples   = getIndexExamples(cascade);
    var cascadeExamples = getCascadeExamples(cascade);

    var foundIndex = null;
    var foundIndexMeta = null;
    indexExamples.some(function (d) {
      var hit = mentionByCanonical[normalizeDrugText(d)];
      if (hit && hit.length) {
        foundIndex = d;
        foundIndexMeta = hit[0];
        return true;
      }
      return false;
    });

    var foundCascade = null;
    var foundCascadeMeta = null;
    cascadeExamples.some(function (d) {
      var hit = mentionByCanonical[normalizeDrugText(d)];
      if (hit && hit.length) {
        foundCascade = d;
        foundCascadeMeta = hit[0];
        return true;
      }
      return false;
    });

    if (!foundIndex || !foundCascade) return;

    detected.push({
      cascade_id:    cascade.id,
      cascade_name:  cascade.name_en || cascade.id,
      cascade_name_es: cascade.name_es || '',
      signal_type:   'drug_drug',
      index_drug:    foundIndex,
      cascade_drug:  foundCascade,
      drug_resolution: {
        index: foundIndexMeta,
        cascade: foundCascadeMeta
      },
      confidence:    cascade.confidence || cascade.plausibility || 'low',
      risk_focus:    cascade.risk_focus || [],
      ade_en:        cascade.ade_en || '',
      ade_es:        cascade.ade_es || '',
      appropriateness: cascade.appropriateness || '',
      ddi_warning:   cascade.ddi_warning_en || '',
      ddi_warning_es: cascade.ddi_warning_es || '',
      clinical_hint: cascade.clinical_note_en || cascade.recommended_first_action_en || '',
      clinical_hint_es: cascade.clinical_note_es || cascade.recommended_first_action_es || ''
    });
  });

  var allSignals = detected.concat(detectSymptomCascades(noteText, mentionByCanonical));

  /* Post-process: apply clinical context modifiers (priority upgrade + messages) */
  var activeModifiers = detectClinicalContextModifiers(noteText);
  if (activeModifiers.length) {
    allSignals = applyClinicalModifiers(allSignals, activeModifiers);
  }

  /* ── Deduplication: suppress near-duplicate signals ────────────────────
   * After modifiers have been applied (so final confidence is known), remove
   * signals that share the same (index_drug, cascade_drug) pair, keeping only
   * the strongest one.  Suppressed IDs are stored on the winner for JSON export.
   * ─────────────────────────────────────────────────────────────────────── */
  allSignals = suppressDuplicateSignals(allSignals);

  return allSignals;
}

/**
 * Symptom-bridge cascade detection.
 * Fires when ALL THREE of these are present in `noteText`:
 *   1. A drug listed in a symptom's caused_by_drug_examples
 *   2. The symptom itself (detected via state.symptomsDetected)
 *   3. A drug listed in the same symptom's treated_by_drug_examples
 *
 * Uses state.symptomsDetected if already populated (e.g. by Step 2);
 * otherwise runs extractSymptoms() so Step 4 works independently.
 *
 * @param {string} noteText
 * @returns {Array} Same signal shape as detectCascades()
 */
function detectSymptomCascades(noteText, mentionByCanonical) {
  if (!noteText || !noteText.trim()) return [];

  var symEntries = (state.kb.symptomDictionary && state.kb.symptomDictionary.symptoms) || [];
  if (!symEntries.length) return [];

  /* Use cached results from Step 2, or run fresh if not yet populated.
     Backward-compat: if saved state has old string-array format, re-extract. */
  var detectedSymptoms = state.symptomsDetected.length
    ? state.symptomsDetected
    : extractSymptoms(noteText);
  /* Migrate legacy format: array of strings → skip, just re-extract */
  if (detectedSymptoms.length && typeof detectedSymptoms[0] === 'string') {
    detectedSymptoms = extractSymptoms(noteText);
  }

  if (!detectedSymptoms.length) return [];

  var signals = [];

  var mentionMap = mentionByCanonical || {};

  detectedSymptoms.forEach(function (ds) {
    /* ── Gate 1: symptom must be contextually active ── */
    if (ds.active === false) return;

    var entry = symEntries.find(function (s) { return s.id === ds.id; });
    if (!entry) return;

    var causedBy  = entry.caused_by_drug_examples  || [];
    var treatedBy = entry.treated_by_drug_examples || [];
    if (!causedBy.length || !treatedBy.length) return;

    /* Find cause and treatment drugs and their positions */
    var foundCause = null; var causePos = null; var foundCauseMeta = null;
    for (var ci = 0; ci < causedBy.length; ci++) {
      var cKey = normalizeDrugText(causedBy[ci]);
      var cHit = mentionMap[cKey];
      if (cHit && cHit.length) {
        foundCause = causedBy[ci];
        foundCauseMeta = cHit[0];
        causePos = { index: foundCauseMeta.start_index || 0, length: foundCauseMeta.mention.length };
        break;
      }
      var cp = findTermInNote(noteText, causedBy[ci]);
      if (cp) { foundCause = causedBy[ci]; causePos = cp; break; }
    }
    var foundTreatment = null; var treatPos = null; var foundTreatmentMeta = null;
    for (var ti = 0; ti < treatedBy.length; ti++) {
      var tKey = normalizeDrugText(treatedBy[ti]);
      var tHit = mentionMap[tKey];
      if (tHit && tHit.length) {
        foundTreatment = treatedBy[ti];
        foundTreatmentMeta = tHit[0];
        treatPos = { index: foundTreatmentMeta.start_index || 0, length: foundTreatmentMeta.mention.length };
        break;
      }
      var tp = findTermInNote(noteText, treatedBy[ti]);
      if (tp) { foundTreatment = treatedBy[ti]; treatPos = tp; break; }
    }
    if (!foundCause || !foundTreatment) return;

    /* ── Gate 2: temporality heuristics ── */
    var symIdx   = typeof ds.startIndex === 'number' ? ds.startIndex : 0;
    var timeSym   = detectTimeCues(noteText, symIdx);
    var timeCause = detectTimeCues(noteText, causePos.index);
    var timeTreat = detectTimeCues(noteText, treatPos.index);

    /* Determine confidence adjustment */
    var confidence = 'medium';
    var rationaleLines = [];

    /* Positive signals → upgrade */
    var supportive = (timeCause.drugStartHint || timeCause.treatmentAddedHint) &&
                     (timeSym.symptomNewHint  || timeTreat.treatmentAddedHint);
    if (supportive) {
      confidence = 'high';
      rationaleLines.push('Supportive temporality: index drug started + new symptom/treatment noted.');
    }

    /* Chronic/pre-existing signal → downgrade */
    var chronic = timeSym.chronicHint || timeTreat.chronicHint;
    if (chronic) {
      confidence = confidence === 'high' ? 'medium' : 'low';
      rationaleLines.push('Possible pre-existing condition (chronic/long-term cue detected).');
    }

    /* Unknown temporality — leave as-is, note it */
    if (!supportive && !chronic) {
      rationaleLines.push('Temporality unknown; confidence not adjusted.');
    }

    /* Capitalise first letter of symptom term for display */
    var symLabel = ds.term.charAt(0).toUpperCase() + ds.term.slice(1);

    signals.push({
      cascade_id:      ds.id + ':' + foundCause + ':' + foundTreatment,
      cascade_name:    foundCause + ' \u2192 ' + symLabel + ' \u2192 ' + foundTreatment,
      index_drug:      foundCause,
      cascade_drug:    foundTreatment,
      signal_type:     'symptom_bridge',
      drug_resolution: { index: foundCauseMeta || null, cascade: foundTreatmentMeta || null },
      confidence:      confidence,
      risk_focus:      [ds.category],
      ade_en:          ds.term,
      appropriateness: '',
      ddi_warning:     '',
      clinical_hint:   entry.cascade_relevance || '',
      /* Rationale for clinician transparency */
      rationale: {
        symptomActive:   true,
        negationReason:  ds.reason || '',
        timeHints: {
          symptom:   timeSym,
          causeDrug: timeCause,
          treatDrug: timeTreat
        },
        explanation: rationaleLines.join(' ')
      }
    });
  });

  return signals;
}

/**
 * Cached wrapper around detectCascades().
 * Returns the cached result if the note hasn't changed; otherwise calls
 * detectCascades() and stores the result in state.detectedCascades.
 * Call invalidateDetectedCascades() to force a re-run.
 */
function getDetectedCascades(noteText) {
  if (!state.detectedCascades) {
    state.detectedCascades = detectCascades(noteText);
  }
  return state.detectedCascades;
}

function invalidateDetectedCascades() {
  state.detectedCascades = null;
}

function invalidateDrugResolver() {
  state.drugResolver = null;
}

/**
 * Scan `noteText` for any drug name present in the KB (both index and cascade
 * drug examples across all loaded cascade entries).
 *
 * @param {string} noteText
 * @returns {string[]} Unique drug names found (in KB casing)
 */
function extractDrugs(noteText) {
  if (!noteText || !noteText.trim()) return [];

  var seen   = {};
  var result = [];

  resolveDrugMentions(noteText).forEach(function (mention) {
    var canonical = mention.canonical;
    var key = normalizeDrugText(canonical);
    if (!seen[key]) {
      seen[key] = true;
      result.push(canonical);
    }
  });

  return result;
}

/* ============================================================
   SYMPTOM NORMALISATION LAYER
   Converts free-text clinical expressions to canonical ADE labels
   before cascade matching, improving recall for:
     – accented / diacritic variants ("náuseas" → "nausea")
     – Spanish synonyms ("estreñimiento" → "constipation")
     – Any synonym listed in kb_symptoms.json
   ============================================================ */

/**
 * Normalise a symptom string for diacritic-insensitive matching:
 *  1. NFC-compose (consistent Unicode form before any operation)
 *  2. Lowercase (case-fold)
 *  3. NFD-decompose + strip all combining diacritical marks (U+0300–U+036F)
 *     so "náuseas" == "nauseas", "estreñimiento" ~ "estrenimiento".
 *  4. Collapse runs of whitespace (multi-word expressions stay intact).
 * Punctuation and word boundaries are preserved so \b regexes still work.
 *
 * @param {string} str
 * @returns {string}
 */
function normalizeSymptomText(str) {
  if (!str) return '';
  /* Step 1-3: compose → lowercase → decompose → strip combining marks */
  var s = str.normalize('NFC').toLowerCase().normalize('NFD')
             .replace(/[\u0300-\u036f]/g, '');
  /* Step 4: normalise internal whitespace */
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Build a lookup map from every normalised synonym (and canonical term)
 * in the symptom dictionary to its canonical ADE label (sym.term).
 *
 * Used by extractSymptoms() to map any matched free-text expression
 * directly to the canonical label used in kb_core_cascades.json (ade_en).
 *
 * @param {Array} symptoms  Array of symptom entries from kb_symptoms.json
 * @returns {Object}  normalizedText → canonical term string
 */
function buildSynonymMap(symptoms) {
  var map = {};
  (symptoms || []).forEach(function (sym) {
    /* Include the canonical term itself plus all listed synonyms */
    var allTerms = [sym.term].concat(sym.synonyms || []);
    allTerms.forEach(function (t) {
      var key = normalizeSymptomText(t);
      /* First writer wins — canonical term registers itself first */
      if (key && !map[key]) {
        map[key] = sym.term; /* value is always the canonical ADE label */
      }
    });
  });
  return map;
}

/**
 * Scan `noteText` for symptom terms defined in kb_symptoms.json.
 * Uses the same drugFoundInNote() whole-word match as extractDrugs().
 * Each symptom's `term` and `synonyms` are all tested; the first match wins.
 *
 * Normalisation flow (new):
 *  1. A diacritic-stripped version of noteText is pre-computed once.
 *  2. A synonym → canonical label map is built from the KB at call time.
 *  3. For each symptom, matching is attempted on the original note first
 *     (preserving existing behaviour); if that fails, a second attempt is
 *     made against the normalised note using the normalised KB term —
 *     catching cases where the clinician omitted accents or used a variant
 *     Unicode form.
 *  4. The canonical ADE label (sym.term) is always stored in detected[].term
 *     so downstream cascade matching compares like-for-like labels.
 *
 * Results are also cached in state.symptomsDetected so other steps can
 * read them without re-running extraction.
 *
 * @param {string} noteText
 * @returns {Array<{id, term, matched_term, category, cascade_relevance}>}
 */
function extractSymptoms(noteText) {
  if (!noteText || !noteText.trim()) {
    state.symptomsDetected = [];
    return [];
  }

  var symptoms = (state.kb.symptomDictionary && state.kb.symptomDictionary.symptoms) || [];

  /* Pre-compute a diacritic-free lowercase copy of the note once for all
   * symptom iterations (avoid repeated normalisation inside the loop). */
  var normalizedNote = normalizeSymptomText(noteText);

  /* Build synonym → canonical term map for ADE label resolution */
  var synonymMap = buildSynonymMap(symptoms);

  var detected = [];

  symptoms.forEach(function (sym) {
    var allTerms = [sym.term].concat(sym.synonyms || []);

    /* Find the first matching term AND its position in the note.
     * Pass 1: match against original noteText (backward-compatible path).
     * Pass 2: if no match found, retry against the normalised note using the
     *         normalised KB term — catches diacritic/casing mismatches. */
    var matchResult = null;
    var matchedTerm = null;
    for (var ti = 0; ti < allTerms.length; ti++) {
      /* Pass 1 — original text (preserves existing behaviour) */
      var pos = findTermInNote(noteText, allTerms[ti]);
      if (pos) { matchResult = pos; matchedTerm = allTerms[ti]; break; }

      /* Pass 2 — normalised fallback (new: diacritic-insensitive) */
      var normTerm = normalizeSymptomText(allTerms[ti]);
      if (normTerm) {
        var normPos = findTermInNote(normalizedNote, normTerm);
        if (normPos) {
          /* Record position relative to original note (offsets match because
           * normalizeSymptomText only strips combining marks, not base chars,
           * so character positions are preserved). */
          matchResult = normPos;
          matchedTerm = allTerms[ti]; /* keep original KB term for display */
          break;
        }
      }
    }
    if (!matchResult) return; /* term not in note at all */

    /* Negation / historical context check (always on original noteText) */
    var negCheck = isNegatedSymptom(noteText, matchResult.index, matchResult.length);

    /* Map matched expression → canonical ADE label via synonymMap.
     * Falls back to sym.term (which is always correct) if not found. */
    var canonicalTerm = synonymMap[normalizeSymptomText(matchedTerm)] || sym.term;

    detected.push({
      id:                sym.id,
      term:              canonicalTerm,  /* canonical ADE label for cascade matching */
      matched_term:      matchedTerm,    /* raw KB expression that triggered the match */
      category:          sym.category          || '',
      cascade_relevance: sym.cascade_relevance || '',
      /* reliability fields */
      active:            !negCheck.negated,
      reason:            negCheck.reason,
      startIndex:        matchResult.index
    });
  });

  state.symptomsDetected = detected;
  invalidateDetectedCascades();
  return detected;
}

/**
 * Map an array of drug names to their canonical drug classes using the KB.
 *
 * Two-pass priority: index-drug roles are resolved first (a drug acting as a
 * cascade trigger is labelled with its index class), then cascade-drug roles
 * fill in any drug not yet mapped.  This ensures, e.g., that amlodipine is
 * labelled "Calcium channel blocker" (its index role in CC004) rather than
 * the less specific "Antihypertensive" it receives as a cascade drug in CC001.
 *
 * Handles both KB field-name variants:
 *   index_drug_classes  (array)  — kb_core_cascades.json
 *   index_drug_class    (string) — kb_vih_modifiers.json
 *
 * @param {string[]} drugs  Output of extractDrugs()
 * @returns {Array<{drug: string, class: string}>} One entry per input drug
 */
function normalizeDrugs(drugs) {
  if (!drugs || !drugs.length) return [];

  var drugToClass = {};   // key: drug.toLowerCase() → first canonical class string

  var allCascades = [].concat(
    (state.kb.coreCascades && state.kb.coreCascades.cascades) || [],
    (state.kb.vihModifiers && state.kb.vihModifiers.art_related_cascades) || []
  );

  /* Pass 1 — index drugs get priority (causal / trigger role) */
  allCascades.forEach(function (cascade) {
    /* index_drug_classes is an array in core cascades;
       index_drug_class   is a string  in VIH modifiers  */
    var idxArr = cascade.index_drug_classes ||
                 (cascade.index_drug_class ? [cascade.index_drug_class] : []);
    var idxClass = idxArr.length ? idxArr[0] : '';

    getIndexExamples(cascade).forEach(function (drug) {
      var key = drug.toLowerCase();
      if (!drugToClass[key] && idxClass) drugToClass[key] = idxClass;
    });
  });

  /* Pass 2 — cascade drugs fill in anything not yet mapped */
  allCascades.forEach(function (cascade) {
    var casClass = cascade.cascade_drug_class || '';

    getCascadeExamples(cascade).forEach(function (drug) {
      var key = drug.toLowerCase();
      if (!drugToClass[key] && casClass) drugToClass[key] = casClass;
    });
  });

  return drugs.map(function (drug) {
    return {
      drug:  drug,
      class: drugToClass[drug.toLowerCase()] || ''
    };
  });
}

/**
 * Look up a full cascade entry by its ID across both loaded KB files.
 *
 * @param {string} cascadeId  e.g. "CC001" or "VIH001"
 * @returns {Object|null}
 */
function findCascadeEntry(cascadeId) {
  var coreCascades = (state.kb.coreCascades && state.kb.coreCascades.cascades) || [];
  var vihCascades  = (state.kb.vihModifiers && state.kb.vihModifiers.art_related_cascades) || [];
  var all = [].concat(coreCascades, vihCascades);
  for (var i = 0; i < all.length; i++) {
    if (all[i].id === cascadeId) return all[i];
  }
  return null;
}

/**
 * Find the KB cascade entry for any signal type.
 * For drug_drug signals: exact ID lookup (existing behaviour).
 * For symptom_bridge signals: the cascade_id is a synthetic key
 * (e.g. "SYM001:pregabalin:furosemide") that won't match any KB entry
 * directly, so we search for an entry whose index_drug_examples contains
 * the signal's index_drug AND whose cascade_drug_examples contains the
 * signal's cascade_drug.
 */
function findCascadeEntryForSignal(signal) {
  if (signal.signal_type !== 'symptom_bridge') {
    return findCascadeEntry(signal.cascade_id);
  }
  var coreCascades = (state.kb.coreCascades && state.kb.coreCascades.cascades) || [];
  var vihCascades  = (state.kb.vihModifiers && state.kb.vihModifiers.art_related_cascades) || [];
  var all = [].concat(coreCascades, vihCascades);
  var normIndex   = normalizeDrugText(signal.index_drug);
  var normCascade = normalizeDrugText(signal.cascade_drug);
  for (var i = 0; i < all.length; i++) {
    var kbEntry = all[i];
    var idxMatch = getIndexExamples(kbEntry).some(function (d) {
      return normalizeDrugText(d) === normIndex;
    });
    var casMatch = getCascadeExamples(kbEntry).some(function (d) {
      return normalizeDrugText(d) === normCascade;
    });
    if (idxMatch && casMatch) return kbEntry;
  }
  return null;
}

/* ============================================================
   Step 5 — clinician classification handler
   Called via inline onclick: classifyCascade(id, value)
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
              '<span class="onboarding-icon">&#128301;</span>' +
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
              '<button class="btn btn-outline btn-sm" onclick="loadDemoCase()" type="button">' + tUI('onboarding_demo_btn') + '</button>' +
            '</div>' +
          '</div>'
        );
      }
      return (
        onboarding +
        '<div class="form-group">' +
          '<label class="form-label" for="note-input">' + tUI('note_label') + '</label>' +
          '<textarea id="note-input" class="textarea-clinical" ' +
            'placeholder="' + tUI('note_placeholder') + '">' +
            escHtml(state.clinicalNote) +
          '</textarea>' +
          '<div class="form-hint">' + tUI('note_hint') + '</div>' +
        '</div>'
      );
    },
    onMount: function (el) {
      var ta = el.querySelector('#note-input');
      if (ta) {
        ta.addEventListener('input', function () {
          state.clinicalNote = ta.value;
          invalidateDetectedCascades();
          invalidateDrugResolver();
          saveState();
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
      var drugs      = extractDrugs(state.clinicalNote);
      var normalized = normalizeDrugs(drugs);
      var classLookup = {};
      normalized.forEach(function (n) { classLookup[n.drug.toLowerCase()] = n.class; });

      var drugSection;
      if (drugs.length === 0) {
        drugSection = (
          '<div class="callout callout-success">' +
            '<strong>' + tUI('no_drugs_title') + '</strong> ' +
            tUI('no_drugs_detail') +
          '</div>'
        );
      } else {
        var drugTags = drugs.map(function (d) {
          var cls = classLookup[d.toLowerCase()] || '';
          var clsLabel = cls
            ? '<span style="display:block;font-size:.68rem;opacity:.85;margin-top:.1rem;font-weight:400;">' +
                escHtml(cls) + '</span>'
            : '';
          return (
            '<span style="display:inline-block;background:#1a6b9a;color:#fff;border-radius:4px;' +
              'padding:.28rem .65rem;margin:.25rem .18rem;font-size:.84rem;font-weight:600;' +
              'vertical-align:top;line-height:1.3;">' +
              escHtml(d) + clsLabel +
            '</span>'
          );
        }).join('');
        drugSection = (
          '<div class="callout callout-info" style="margin-bottom:.7rem;">' +
            tUI('drugs_detected', drugs.length) +
          '</div>' +
          '<div style="padding:.2rem 0 .65rem;">' + drugTags + '</div>'
        );
      }

      /* ── Symptom extraction — uses extractSymptoms() which also caches in state ── */
      var symptoms    = extractSymptoms(state.clinicalNote);
      saveState();   /* persist state.symptomsDetected */

      var symCountLabel;
      var symptomSection;
      if (!state.kb.symptomDictionary) {
        symCountLabel = tUI('symptoms_dict_missing');
        symptomSection = (
          '<div class="callout callout-warning" style="font-size:.84rem;">' +
            tUI('symptoms_dict_unavailable_title') + ' ' +
            tUI('symptoms_dict_unavailable_detail') +
          '</div>'
        );
      } else if (symptoms.length === 0) {
        symCountLabel = tUI('symptoms_zero_label');
        symptomSection = (
          '<div class="callout callout-success">' +
            tUI('no_symptoms') +
          '</div>'
        );
      } else {
        /* Split into active vs non-active (negated / historical) */
        var activeSyms   = symptoms.filter(function (s) { return s.active !== false; });
        var inactiveSyms = symptoms.filter(function (s) { return s.active === false; });
        symCountLabel = tUI('symptoms_count', activeSyms.length, inactiveSyms.length);

        /* Category → colour mapping */
        var catColor = {
          gastrointestinal: '#7d6608',
          anticholinergic:  '#6c3483',
          neurological:     '#154360',
          safety:           '#922b21',
          cardiovascular:   '#1a5276',
          urological:       '#145a32'
        };

        var renderSymTag = function (s, inactive) {
          var bg    = inactive ? '#bdc3c7' : (catColor[s.category] || '#555');
          var color = inactive ? '#555'    : '#fff';
          var label = escHtml(s.term);
          if (s.matched_term && s.matched_term.toLowerCase() !== s.term.toLowerCase()) {
            label += ' <span style="font-size:.72rem;opacity:.8;">(' + escHtml(s.matched_term) + ')</span>';
          }
          var catLabel = s.category
            ? '<span style="display:block;font-size:.67rem;opacity:.82;margin-top:.1rem;font-weight:400;">' +
                escHtml(s.category) + '</span>'
            : '';
          var negBadge = inactive
            ? '<span style="display:block;font-size:.63rem;font-weight:400;margin-top:.08rem;' +
                'color:#777;font-style:italic;">' +
                escHtml(s.reason || 'non-active') + '</span>'
            : '';
          return (
            '<span style="display:inline-block;background:' + bg + ';color:' + color + ';' +
              'border-radius:4px;padding:.28rem .65rem;margin:.25rem .18rem;font-size:.84rem;' +
              'font-weight:600;vertical-align:top;line-height:1.3;' +
              (inactive ? 'opacity:.7;' : '') +
              '" title="' + escHtml(s.cascade_relevance || '') + '">' +
              label + catLabel + negBadge +
            '</span>'
          );
        };

        var symTagsActive   = activeSyms.map(function (s) { return renderSymTag(s, false); }).join('');
        var symTagsInactive = inactiveSyms.map(function (s) { return renderSymTag(s, true); }).join('');

        var inactiveRow = inactiveSyms.length
          ? '<div style="margin-top:.45rem;">' +
              '<span style="font-size:.72rem;color:#aaa;font-style:italic;">' + tUI('inactive_mentions') + '</span>' +
              symTagsInactive +
            '</div>'
          : '';

        symptomSection = (
          '<div style="padding:.2rem 0 .65rem;">' +
            (activeSyms.length ? symTagsActive : '<span style="font-size:.83rem;color:#888;">' + tUI('none') + '</span>') +
            inactiveRow +
          '</div>'
        );
      }

      var divider = '<hr style="border:none;border-top:1px solid #eee;margin:.9rem 0;">';

      return (
        '<div style="font-size:.8rem;font-weight:700;text-transform:uppercase;' +
          'letter-spacing:.06em;color:#888;margin-bottom:.5rem;">' + tUI('drugs_section_label') + '</div>' +
        drugSection +
        divider +
        '<div style="font-size:.8rem;font-weight:700;text-transform:uppercase;' +
          'letter-spacing:.06em;color:#888;margin-bottom:.5rem;">' + symCountLabel + '</div>' +
        symptomSection +
        '<div class="callout callout-warning" style="margin-top:.75rem;font-size:.83rem;">' +
          tUI('detection_warning') +
        '</div>'
      );
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

      var drugs      = extractDrugs(state.clinicalNote);
      var normalized = normalizeDrugs(drugs);

      if (drugs.length === 0) {
        return (
          '<div class="callout callout-success">' +
            '<strong>' + tUI('no_drugs_to_classify') + '</strong> ' +
            tUI('no_drugs_to_classify_detail') +
          '</div>'
        );
      }

      var mappedCount   = normalized.filter(function (n) { return n.class; }).length;
      var unmappedCount = normalized.length - mappedCount;

      var rows = normalized.map(function (n) {
        var classCell = n.class
          ? '<span style="display:inline-block;background:#1e8449;color:#fff;border-radius:3px;' +
              'padding:.18rem .55rem;font-size:.82rem;font-weight:600;">' + escHtml(n.class) + '</span>'
          : '<span style="color:#999;font-size:.82rem;font-style:italic;">' + tUI('drug_class_none') + '</span>';
        return (
          '<tr style="border-bottom:1px solid #eef1f4;">' +
            '<td style="padding:.45rem .6rem;font-size:.88rem;font-weight:600;white-space:nowrap;">' +
              escHtml(n.drug) +
            '</td>' +
            '<td style="padding:.45rem .4rem;color:#666;font-size:.82rem;text-align:center;">' +
              '&rarr;' +
            '</td>' +
            '<td style="padding:.45rem .6rem;">' + classCell + '</td>' +
          '</tr>'
        );
      }).join('');

      return (
        '<div class="callout callout-info" style="margin-bottom:.85rem;">' +
          tUI('class_summary', drugs.length, mappedCount, unmappedCount) +
        '</div>' +
        '<div style="overflow-x:auto;">' +
          '<table style="width:100%;border-collapse:collapse;font-size:.88rem;' +
            'border:1px solid #d0d7de;border-radius:5px;background:#fff;">' +
            '<thead>' +
              '<tr style="background:#f6f8fa;border-bottom:2px solid #d0d7de;">' +
                '<th style="padding:.45rem .6rem;text-align:left;font-size:.8rem;' +
                  'color:#57606a;font-weight:600;text-transform:uppercase;letter-spacing:.04em;">' + tUI('col_drug') + '</th>' +
                '<th style="padding:.45rem .4rem;width:2rem;"></th>' +
                '<th style="padding:.45rem .6rem;text-align:left;font-size:.8rem;' +
                  'color:#57606a;font-weight:600;text-transform:uppercase;letter-spacing:.04em;">' + tUI('col_class') + '</th>' +
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

      var cCount = (state.kb.coreCascades.cascades || []).length;
      var vCount = (state.kb.vihModifiers.art_related_cascades || []).length;
      var dCount = (state.kb.ddiWatchlist.interactions || []).length;

      var kbInfo = (
        '<div class="callout callout-info">' +
          tUI('kb_ready') + ' ' + tUI('kb_ready_detail', cCount, vCount, dCount) +
        '</div>'
      );

      var detected = getDetectedCascades(state.clinicalNote);

      if (detected.length === 0) {
        return (
          kbInfo +
          '<div class="callout callout-success" style="margin-top:.75rem;">' +
            '<strong>' + tUI('no_cascades_title') + '</strong> ' +
            tUI('no_cascades_detail') +
          '</div>'
        );
      }

      /* --- Badge helpers ------------------------------------------ */
      var confidenceBadge = function (conf) {
        var color = conf === 'high' ? '#27ae60' : conf === 'medium' ? '#e67e22' : '#7f8c8d';
        var label = tUI('conf_' + conf) || conf;
        return (
          '<span style="font-size:.7rem;font-weight:700;color:#fff;background:' + color + ';' +
            'padding:.1rem .4rem;border-radius:3px;vertical-align:middle;margin-left:.4rem;' +
            'text-transform:uppercase;letter-spacing:.03em;">' +
            escHtml(label) +
          '</span>'
        );
      };

      var appropriatenessBadge = function (val) {
        if (!val) return '';
        var label = val === 'often_inappropriate' ? tUI('appr_often_inappropriate')
                  : val === 'often_appropriate'   ? tUI('appr_often_appropriate')
                  : tUI('appr_context_dependent');
        var color = val === 'often_inappropriate' ? '#c0392b'
                  : val === 'often_appropriate'   ? '#1e8449'
                  : '#7f8c8d';
        return (
          '<span style="font-size:.68rem;font-weight:600;color:' + color + ';' +
            'border:1px solid ' + color + ';border-radius:3px;padding:.08rem .38rem;' +
            'margin-left:.4rem;vertical-align:middle;white-space:nowrap;">' +
            escHtml(label) +
          '</span>'
        );
      };

      /* --- Signal cards ------------------------------------------- */
      var rows = detected.map(function (c) {
        /* Resolve localized fields for display */
        var displayName = (currentLanguage === 'es' && c.cascade_name_es)
          ? c.cascade_name_es : c.cascade_name;
        var adeDisplay = (currentLanguage === 'es' && c.ade_es)
          ? c.ade_es : (c.ade_en || '');
        var ddiDisplay = (currentLanguage === 'es' && c.ddi_warning_es)
          ? c.ddi_warning_es : c.ddi_warning;
        var hintDisplay = (currentLanguage === 'es' && c.clinical_hint_es)
          ? c.clinical_hint_es : c.clinical_hint;

        /* Cascade chain: index drug → [ADE] → cascade drug */
        var chain = (
          '<div style="margin:.6rem 0 0;font-size:.9rem;display:flex;align-items:center;' +
            'flex-wrap:wrap;gap:.2rem;">' +
            '<span style="background:#eaf4fb;border:1px solid #aed6f1;border-radius:4px;' +
              'padding:.18rem .55rem;font-weight:700;font-size:.85rem;">' +
              escHtml(c.index_drug) +
            '</span>' +
            '<span style="color:#95a5a6;font-size:.8rem;">&rarr;</span>' +
            '<span style="background:#fef9e7;border:1px solid #f9e79f;border-radius:4px;' +
              'padding:.18rem .55rem;font-size:.82rem;color:#7d6608;">' +
              escHtml(adeDisplay || 'ADE') +
            '</span>' +
            '<span style="color:#95a5a6;font-size:.8rem;">&rarr;</span>' +
            '<span style="background:#eafaf1;border:1px solid #a9dfbf;border-radius:4px;' +
              'padding:.18rem .55rem;font-weight:700;font-size:.85rem;">' +
              escHtml(c.cascade_drug) +
            '</span>' +
          '</div>'
        );

        /* Risk focus chips */
        var riskTags = c.risk_focus.length
          ? '<div style="margin-top:.5rem;display:flex;flex-wrap:wrap;gap:.25rem;align-items:center;">' +
              '<span style="font-size:.72rem;color:#888;">' + tUI('risk_label') + '</span>' +
              c.risk_focus.map(function (r) {
                return '<span style="font-size:.72rem;background:#f0f0f0;border-radius:3px;' +
                  'padding:.08rem .38rem;color:#555;">' + escHtml(r) + '</span>';
              }).join('') +
            '</div>'
          : '';

        /* DDI warning — red alert box */
        var ddiBox = ddiDisplay
          ? '<div style="margin-top:.55rem;font-size:.83rem;color:#922b21;' +
              'border-left:3px solid #e74c3c;padding:.35rem .65rem;background:#fdedec;' +
              'border-radius:0 3px 3px 0;">' +
              '<strong>' + tUI('ddi_alert') + '</strong>&nbsp;' + escHtml(ddiDisplay) +
            '</div>'
          : '';

        /* Clinical hint — blue note box */
        var hintBox = hintDisplay
          ? '<div style="margin-top:.45rem;font-size:.83rem;color:#1a5276;' +
              'border-left:3px solid #2980b9;padding:.35rem .65rem;background:#eaf4fb;' +
              'border-radius:0 3px 3px 0;">' +
              '<strong>' + tUI('clinical_action') + '</strong>&nbsp;' + escHtml(hintDisplay) +
            '</div>'
          : '';

        /* Rationale box (symptom-bridge only) — grey/olive tint */
        var rationaleBox = '';
        if (c.rationale && c.rationale.explanation) {
          rationaleBox = (
            '<div style="margin-top:.42rem;font-size:.78rem;color:#5d6d7e;' +
              'border-left:3px solid #aab7b8;padding:.3rem .6rem;background:#f4f6f7;' +
              'border-radius:0 3px 3px 0;">' +
              '<strong>' + tUI('detection_reason') + '</strong>&nbsp;' +
              escHtml(c.rationale.explanation) +
            '</div>'
          );
        }

        return (
          '<div style="border:1px solid #d0d7de;border-radius:6px;padding:.85rem 1rem;' +
            'margin-bottom:.8rem;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.05);">' +

            /* Header row: name + badges + ID */
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;' +
              'flex-wrap:wrap;gap:.4rem;">' +
              '<span style="font-size:.92rem;font-weight:700;line-height:1.35;">' +
                escHtml(displayName) +
                confidenceBadge(c.confidence) +
                appropriatenessBadge(c.appropriateness) +
                (c.signal_type === 'symptom_bridge'
                  ? '<span style="font-size:.65rem;font-weight:600;color:#6c3483;' +
                      'border:1px solid #a569bd;border-radius:3px;padding:.08rem .38rem;' +
                      'margin-left:.4rem;vertical-align:middle;white-space:nowrap;">' + tUI('via_symptom') + '</span>'
                  : '') +
              '</span>' +
              '<code style="font-size:.76rem;color:#aaa;white-space:nowrap;">' +
                escHtml(c.cascade_id) +
              '</code>' +
            '</div>' +

            chain + riskTags + ddiBox + hintBox + rationaleBox +
          '</div>'
        );
      });

      return (
        kbInfo +
        '<div style="margin-top:1rem;">' +
          '<h3 style="margin:0 0 .7rem;font-size:.97rem;color:#2c3e50;">' +
            tUI('cascade_count', detected.length) +
          '</h3>' +
          rows.join('') +
        '</div>' +
        '<div class="callout callout-warning" style="margin-top:.75rem;font-size:.84rem;">' +
          tUI('pharmacist_only_warning') +
        '</div>'
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

      /* ── Classification tally banner ── */
      var cls = state.cascadeClassifications;
      var nConfirmed  = detected.filter(function (c) { return cls[c.cascade_id] === 'confirmed';   }).length;
      var nPossible   = detected.filter(function (c) { return cls[c.cascade_id] === 'possible';    }).length;
      var nNot        = detected.filter(function (c) { return cls[c.cascade_id] === 'not_cascade'; }).length;
      var nUnreviewed = detected.length - nConfirmed - nPossible - nNot;

      var tallyHtml = (
        '<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:1rem;' +
          'padding:.65rem .9rem;background:#f8f9fa;border:1px solid #e0e0e0;border-radius:6px;' +
          'font-size:.83rem;align-items:center;">' +
          '<span style="color:#555;font-weight:600;margin-right:.2rem;">' + tUI('clinical_review_label') + '</span>' +
          '<span style="background:#1e8449;color:#fff;border-radius:4px;padding:.1rem .45rem;font-weight:700;">' +
            tUI('tally_confirmed', nConfirmed) + '</span>' +
          '<span style="background:#e67e22;color:#fff;border-radius:4px;padding:.1rem .45rem;font-weight:700;">' +
            tUI('tally_possible', nPossible) + '</span>' +
          '<span style="background:#7f8c8d;color:#fff;border-radius:4px;padding:.1rem .45rem;font-weight:700;">' +
            tUI('tally_discarded', nNot) + '</span>' +
          (nUnreviewed > 0
            ? '<span style="color:#888;margin-left:.15rem;">' + tUI('tally_unreviewed', nUnreviewed) + '</span>'
            : '<span style="color:#1e8449;margin-left:.15rem;">' + tUI('all_reviewed') + '</span>') +
        '</div>'
      );

      /* ── Per-cascade detail cards ── */
      var rows = detected.map(function (c) {
        var entry       = findCascadeEntry(c.cascade_id);
        var recAction   = entry ? getLocalizedField(entry, 'recommended_first_action', currentLanguage) : '';
        var clinNote    = entry ? getLocalizedField(entry, 'clinical_note', currentLanguage) : '';
        var ddiWarning  = entry ? getLocalizedField(entry, 'ddi_warning', currentLanguage) : '';
        var diffHints   = (entry && Array.isArray(entry.differential_hints) && entry.differential_hints.length)
                          ? entry.differential_hints : [];

        /* Use the richer field; for core it's recAction, for VIH it's clinNote */
        var actionText  = recAction || clinNote;

        /* Confidence badge */
        var confColor   = c.confidence === 'high' ? '#27ae60' : c.confidence === 'medium' ? '#e67e22' : '#7f8c8d';
        var confBadge   = (
          '<span style="font-size:.7rem;font-weight:700;color:#fff;background:' + confColor + ';' +
            'padding:.1rem .4rem;border-radius:3px;vertical-align:middle;margin-left:.4rem;' +
            'text-transform:uppercase;">' + escHtml(tUI('conf_' + c.confidence) || c.confidence) + '</span>'
        );

        /* Resolve localized display name and ADE for Step 5 */
        var step5DisplayName = (currentLanguage === 'es' && c.cascade_name_es)
          ? c.cascade_name_es : c.cascade_name;
        var step5AdeDisplay = (currentLanguage === 'es' && c.ade_es)
          ? c.ade_es : (c.ade_en || '');

        /* Cascade chain pill row */
        var chain = (
          '<div style="margin:.6rem 0;display:flex;align-items:center;flex-wrap:wrap;gap:.25rem;">' +
            '<span style="background:#eaf4fb;border:1px solid #aed6f1;border-radius:4px;' +
              'padding:.2rem .6rem;font-weight:700;font-size:.85rem;">' +
              escHtml(c.index_drug) + '</span>' +
            '<span style="color:#aaa;font-size:.8rem;">&rarr;</span>' +
            (step5AdeDisplay
              ? '<span style="background:#fef9e7;border:1px solid #f9e79f;border-radius:4px;' +
                  'padding:.2rem .6rem;font-size:.82rem;color:#7d6608;">' +
                  escHtml(step5AdeDisplay) + '</span>' +
                '<span style="color:#aaa;font-size:.8rem;">&rarr;</span>'
              : '') +
            '<span style="background:#eafaf1;border:1px solid #a9dfbf;border-radius:4px;' +
              'padding:.2rem .6rem;font-weight:700;font-size:.85rem;">' +
              escHtml(c.cascade_drug) + '</span>' +
          '</div>'
        );

        /* DDI warning */
        var ddiHtml = ddiWarning
          ? '<div style="background:#fdedec;border-left:3px solid #e74c3c;padding:.4rem .7rem;' +
              'margin-top:.45rem;font-size:.82rem;color:#922b21;border-radius:0 3px 3px 0;">' +
              '<strong>' + tUI('ddi_alert') + '</strong>&nbsp;' + escHtml(ddiWarning) +
            '</div>'
          : '';

        /* Recommended action */
        var actionHtml = actionText
          ? '<div style="background:#eaf4fb;border-left:3px solid #2980b9;padding:.4rem .7rem;' +
              'margin-top:.45rem;font-size:.82rem;color:#1a5276;border-radius:0 3px 3px 0;">' +
              '<strong>' + tUI('recommended_action') + '</strong>&nbsp;' + escHtml(actionText) +
            '</div>'
          : '';

        /* Differential hints */
        var diffHtml = diffHints.length
          ? '<div style="margin-top:.45rem;font-size:.81rem;color:#555;">' +
              '<strong>' + tUI('consider_also') + '</strong>&nbsp;' +
              escHtml(diffHints.join(' \u2022 ')) +
            '</div>'
          : '';

        /* Classification buttons */
        var current = cls[c.cascade_id] || '';
        var id      = escHtml(c.cascade_id);   /* safe for HTML attr; IDs are alphanumeric */

        function classBtn(value, label, activeColor, activeText) {
          var isActive = current === value;
          return (
            '<button onclick="classifyCascade(\'' + id + '\',\'' + value + '\')" ' +
              'style="font-size:.78rem;padding:.28rem .75rem;border-radius:4px;cursor:pointer;' +
                'font-weight:' + (isActive ? '700' : '500') + ';' +
                'background:' + (isActive ? activeColor : '#f0f0f0') + ';' +
                'color:'      + (isActive ? activeText  : '#444')    + ';' +
                'border:1px solid ' + (isActive ? activeColor : '#ccc') + ';' +
                'transition:background .15s;">' +
              label +
            '</button>'
          );
        }

        var classButtons = (
          '<div style="display:flex;gap:.45rem;margin-top:.7rem;flex-wrap:wrap;align-items:center;">' +
            '<span style="font-size:.78rem;color:#888;margin-right:.1rem;">' + tUI('classify_label') + '</span>' +
            classBtn('confirmed',   tUI('btn_confirmed'), '#1e8449', '#fff') +
            classBtn('possible',    tUI('btn_possible'),  '#e67e22', '#fff') +
            classBtn('not_cascade', tUI('btn_discard'),   '#7f8c8d', '#fff') +
          '</div>'
        );

        /* Card border colour based on classification */
        var borderColor = current === 'confirmed'  ? '#1e8449'
                        : current === 'possible'   ? '#e67e22'
                        : current === 'not_cascade'? '#bdc3c7'
                        : '#d0d7de';

        return (
          '<div style="border:2px solid ' + borderColor + ';border-radius:6px;padding:.9rem 1rem;' +
            'margin-bottom:.85rem;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.05);">' +

            /* Header */
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;' +
              'flex-wrap:wrap;gap:.35rem;">' +
              '<span style="font-size:.93rem;font-weight:700;">' +
                escHtml(step5DisplayName) + confBadge +
              '</span>' +
              '<code style="font-size:.75rem;color:#aaa;">' + escHtml(c.cascade_id) + '</code>' +
            '</div>' +

            chain + ddiHtml + actionHtml + diffHtml + classButtons +
          '</div>'
        );
      });

      return (
        '<div class="callout callout-warning" style="margin-bottom:.85rem;font-size:.84rem;">' +
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
      function section(title, content) {
        return (
          '<div style="margin-bottom:1.1rem;">' +
            '<div style="font-size:.78rem;font-weight:700;text-transform:uppercase;' +
              'letter-spacing:.06em;color:#888;border-bottom:1px solid #eee;' +
              'padding-bottom:.3rem;margin-bottom:.55rem;">' + title + '</div>' +
            content +
          '</div>'
        );
      }

      /* ── Drug chips ── */
      function chips(arr, bg, border, color) {
        if (!arr.length) return '<em style="color:#aaa;font-size:.85rem;">' + tUI('none_detected') + '</em>';
        return arr.map(function (d) {
          return (
            '<span style="display:inline-block;background:' + bg + ';border:1px solid ' + border + ';' +
              'border-radius:4px;padding:.18rem .55rem;font-size:.82rem;color:' + color + ';' +
              'margin:.18rem .2rem .18rem 0;">' + escHtml(d) + '</span>'
          );
        }).join('');
      }

      /* ── Verification status badge ── */
      function verBadge(status) {
        var map = {
          confirmed:   { bg: '#1e8449', fg: '#fff', label: tUI('ver_confirmed')   },
          possible:    { bg: '#e67e22', fg: '#fff', label: tUI('ver_possible')     },
          not_cascade: { bg: '#bdc3c7', fg: '#555', label: tUI('ver_not_cascade') },
          unreviewed:  { bg: '#f0f0f0', fg: '#888', label: tUI('ver_unreviewed')  }
        };
        var s = map[status] || map.unreviewed;
        return (
          '<span style="font-size:.72rem;font-weight:700;background:' + s.bg + ';color:' + s.fg + ';' +
            'border-radius:3px;padding:.1rem .42rem;white-space:nowrap;">' +
            escHtml(s.label) + '</span>'
        );
      }

      /* ── Clinical summary ── */
      var summary = r.clinical_summary || {
        total_cascades: r.cascade_count,
        plausible_cascades: 0,
        high_priority_cascades: 0,
        top_interventions: [],
        validation_warning: tUI('validation_warning')
      };

      function priorityBadge(priorityLevel) {
        var map = {
          alta:       { bg: '#b71c1c', fg: '#fff', label: tUI('prio_high')   },
          intermedia: { bg: '#ef6c00', fg: '#fff', label: tUI('prio_medium') },
          baja:       { bg: '#546e7a', fg: '#fff', label: tUI('prio_low')    }
        };
        var p = map[priorityLevel] || map.baja;
        return '<span style="font-size:.74rem;font-weight:700;background:' + p.bg + ';color:' + p.fg + ';' +
          'border-radius:4px;padding:.16rem .5rem;white-space:nowrap;">' + escHtml(p.label) + '</span>';
      }

      function confidenceBadge(conf) {
        var label = tUI('conf_' + conf) || conf;
        return '<span style="font-size:.74rem;font-weight:700;color:#fff;border-radius:4px;padding:.16rem .5rem;' +
          'background:' + (conf === 'high' ? '#1e8449' : conf === 'medium' ? '#e67e22' : '#7f8c8d') + ';">' + escHtml(label) + '</span>';
      }

      var cascadeContent;
      if (r.cascades.length === 0) {
        cascadeContent = (
          '<p style="color:#1e8449;font-size:.88rem;margin:.2rem 0;">' +
            tUI('no_cascades_report') +
          '</p>'
        );
      } else {
        function sortForDisplay(items) {
          return items.slice().sort(function (a, b) {
            var byPriority = priorityRank(b.pharmacy_priority_level) - priorityRank(a.pharmacy_priority_level);
            if (byPriority !== 0) return byPriority;
            var aLevel = a.finding_level === 'plausible_cascade' ? 1 : 0;
            var bLevel = b.finding_level === 'plausible_cascade' ? 1 : 0;
            if (bLevel !== aLevel) return bLevel - aLevel;
            return confidenceRank(b.confidence) - confidenceRank(a.confidence);
          });
        }

        function levelBadge(c) {
          var map = {
            plausible_cascade:  { bg: '#1e8449', fg: '#fff' },
            preliminary_signal: { bg: '#7f8c8d', fg: '#fff' }
          };
          var s = map[c.finding_level] || map.preliminary_signal;
          var label = c.finding_level === 'plausible_cascade' ? tUI('level_plausible_label') : tUI('level_preliminary_label');
          return '<span style="font-size:.72rem;font-weight:700;background:' + s.bg + ';color:' + s.fg + ';border-radius:4px;padding:.14rem .45rem;">' + escHtml(label) + '</span>';
        }

        function renderCards(items) {
          return items.map(function (c) {
            var factorsInFavor  = (c.factors_in_favor  || []).map(function (it) { return '<li>' + escHtml(it) + '</li>'; }).join('');
            var factorsToVerify = (c.factors_to_verify || []).map(function (it) { return '<li>' + escHtml(it) + '</li>'; }).join('');
            var levelLabel = c.finding_level === 'plausible_cascade' ? tUI('level_plausible_label') : tUI('level_preliminary_label');
            var prioLabel  = c.pharmacy_priority_level === 'alta' ? tUI('prio_high')
                           : c.pharmacy_priority_level === 'intermedia' ? tUI('prio_medium') : tUI('prio_low');
            return (
              '<div style="border:1px solid #d0d7de;border-radius:6px;padding:.9rem 1rem;margin:.75rem 0;background:#fff;">' +
                '<div style="display:flex;justify-content:space-between;gap:.45rem;align-items:flex-start;flex-wrap:wrap;">' +
                  '<div>' +
                    '<div style="font-weight:700;color:#2c3e50;">' + escHtml(c.cascade_name) + '</div>' +
                    '<div style="font-size:.75rem;color:#8a8a8a;margin-top:.2rem;">' + tUI('tech_id') + ' ' + escHtml(c.cascade_id) + '</div>' +
                  '</div>' +
                  '<div style="display:flex;gap:.35rem;flex-wrap:wrap;">' +
                    levelBadge(c) + priorityBadge(c.pharmacy_priority_level) + confidenceBadge(c.confidence) + verBadge(c.verification_status) +
                  '</div>' +
                '</div>' +
                '<div style="margin-top:.55rem;font-size:.83rem;"><strong>' + tUI('pharmacological_sequence') + '</strong> ' + escHtml(c.sequence) + '</div>' +
                '<div style="margin-top:.3rem;font-size:.82rem;"><strong>' + tUI('finding_level_lbl') + '</strong> ' + escHtml(levelLabel) + '</div>' +
                '<div style="margin-top:.3rem;font-size:.82rem;"><strong>' + tUI('pharmacy_priority_lbl') + '</strong> ' + escHtml(prioLabel) + '</div>' +
                '<div style="margin-top:.35rem;font-size:.82rem;"><strong>' + tUI('what_supports') + '</strong> ' + escHtml(c.support_summary || '\u2014') + '</div>' +
                '<div style="margin-top:.3rem;font-size:.82rem;"><strong>' + tUI('what_missing') + '</strong> ' + escHtml(c.missing_summary || '\u2014') + '</div>' +
                '<div style="margin-top:.3rem;font-size:.82rem;"><strong>' + tUI('level_assigned') + '</strong> ' + escHtml(c.level_reason || '\u2014') + '</div>' +
                '<div style="margin-top:.4rem;font-size:.83rem;"><strong>' + tUI('clinical_interpretation_lbl') + '</strong> ' + escHtml(c.clinical_interpretation || '\u2014') + '</div>' +
                '<div style="margin-top:.4rem;font-size:.83rem;"><strong>' + tUI('trigger_signal') + '</strong> ' + escHtml(c.trigger_explanation || '\u2014') + '</div>' +
                '<div style="margin-top:.45rem;font-size:.82rem;">' +
                  '<strong>' + tUI('factors_in_favor') + '</strong><ul style="margin:.28rem 0 .2rem 1rem;">' + factorsInFavor + '</ul>' +
                '</div>' +
                '<div style="margin-top:.32rem;font-size:.82rem;">' +
                  '<strong>' + tUI('factors_to_verify') + '</strong><ul style="margin:.28rem 0 .2rem 1rem;">' + factorsToVerify + '</ul>' +
                '</div>' +
                '<div style="margin-top:.45rem;font-size:.83rem;color:#1a5276;"><strong>' + tUI('suggested_intervention_lbl') + '</strong> ' +
                  escHtml(c.suggested_intervention || c.clinical_recommendation || '\u2014') + '</div>' +
                '<div style="margin-top:.3rem;font-size:.82rem;color:#1f4f2a;"><strong>' + tUI('brief_recommendation_lbl') + '</strong> ' +
                  escHtml(c.clinical_recommendation || c.suggested_intervention || '\u2014') + '</div>' +
                '<div style="margin-top:.35rem;font-size:.8rem;color:#666;"><strong>' + tUI('certainty_gap_lbl') + '</strong> ' + escHtml(c.certainty_gap || '\u2014') + '</div>' +
              '</div>'
            );
          }).join('');
        }

        var plausible = sortForDisplay(r.cascades.filter(function (c) { return c.finding_level === 'plausible_cascade'; }));
        var preliminary = sortForDisplay(r.cascades.filter(function (c) { return c.finding_level === 'preliminary_signal'; }));
        cascadeContent =
          '<div style="margin-bottom:.8rem;padding:.45rem .6rem;background:#eaf7ef;border:1px solid #b7dfc3;border-radius:5px;"><strong>' + tUI('plausible_group', plausible.length) + '</strong></div>' +
          (plausible.length ? renderCards(plausible) : '<p style="font-size:.82rem;color:#7f8c8d;">' + tUI('no_plausible') + '</p>') +
          '<div style="margin:.9rem 0 .8rem;padding:.45rem .6rem;background:#f3f4f6;border:1px solid #d6d9dd;border-radius:5px;"><strong>' + tUI('preliminary_group', preliminary.length) + '</strong></div>' +
          (preliminary.length ? renderCards(preliminary) : '<p style="font-size:.82rem;color:#7f8c8d;">' + tUI('no_preliminary') + '</p>');
      }

      var summaryInterventions = (summary.top_interventions || []).length
        ? '<ul style="margin:.35rem 0 0 1rem;">' +
            summary.top_interventions.map(function (it) { return '<li>' + escHtml(it) + '</li>'; }).join('') +
          '</ul>'
        : '<p style="margin:.35rem 0 0;color:#6b7280;font-size:.82rem;">' + tUI('no_dominant_interventions') + '</p>';
      /* ── Export buttons ── */
      var exportRow = (
        '<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1rem;">' +
          '<button onclick="copyReportForClinicalRecord()" ' +
            'style="font-size:.82rem;padding:.35rem .85rem;border-radius:4px;cursor:pointer;' +
              'background:#34495e;color:#fff;border:none;font-weight:600;">' +
            tUI('btn_copy_record') +
          '</button>' +
          '<button onclick="printReportAsPDF()" ' +
            'style="font-size:.82rem;padding:.35rem .85rem;border-radius:4px;cursor:pointer;' +
              'background:#8e44ad;color:#fff;border:none;font-weight:600;">' +
            tUI('btn_save_pdf') +
          '</button>' +
          '<button onclick="exportReport(\'json\')" ' +
            'style="font-size:.82rem;padding:.35rem .85rem;border-radius:4px;cursor:pointer;' +
              'background:#2c3e50;color:#fff;border:none;font-weight:600;">' +
            tUI('btn_export_json') +
          '</button>' +
          '<button onclick="exportReport(\'csv\')" ' +
            'style="font-size:.82rem;padding:.35rem .85rem;border-radius:4px;cursor:pointer;' +
              'background:#1a7a4a;color:#fff;border:none;font-weight:600;">' +
            tUI('btn_export_csv') +
          '</button>' +
        '</div>'
      );

      return (
        '<div style="background:#fff;border:1px solid #d0d7de;border-radius:6px;' +
          'padding:1.15rem 1.3rem;">' +

          '<h3 style="margin:0 0 1rem;font-size:1rem;color:#2c3e50;">' +
            tUI('report_title') +
          '</h3>' +

          section(tUI('section_case_data'),
            '<table style="font-size:.87rem;border-collapse:collapse;width:auto;">' +
              '<tr><td style="padding:.28rem .5rem .28rem 0;color:#666;padding-right:1.5rem;">' + tUI('label_patient_id') + '</td>' +
                  '<td style="padding:.28rem 0;font-weight:700;">' +
                    (r.patient_id ? escHtml(r.patient_id) : '<em style="color:#bbb;">' + tUI('not_set') + '</em>') +
                  '</td></tr>' +
              '<tr><td style="padding:.28rem .5rem .28rem 0;color:#666;padding-right:1.5rem;">' + tUI('label_generated') + '</td>' +
                  '<td style="padding:.28rem 0;">' + escHtml(now) + '</td></tr>' +
              '<tr><td style="padding:.28rem .5rem .28rem 0;color:#666;padding-right:1.5rem;">' + tUI('label_kb_version') + '</td>' +
                  '<td style="padding:.28rem 0;">' +
                    escHtml(r.kb_version) + '&nbsp;<span style="color:#bbb;font-size:.8rem;">(' + escHtml(r.kb_mode) + ')</span>' +
                  '</td></tr>' +
            '</table>'
          ) +

          section(tUI('section_drugs', r.drugs_detected.length),
            (r.drugs_detected.length
              ? '<ul style="margin:.2rem 0 .2rem 1rem;font-size:.84rem;">' + r.drugs_detected.map(function (d) { return '<li>' + escHtml(d) + '</li>'; }).join('') + '</ul>'
              : '<em style="color:#aaa;font-size:.85rem;">' + tUI('none_detected') + '</em>') +
            (r.diagnostics && r.diagnostics.inferredDrugsFromCascades
              ? '<p style="margin:.4rem 0 0;font-size:.75rem;color:#7f8c8d;">' +
                  tUI('inferred_drugs', r.diagnostics.inferredDrugCount) +
                '</p>'
              : '')
          ) +

          section(tUI('section_classes', r.drug_classes.length),
            (r.drug_classes.length
              ? '<ul style="margin:.2rem 0 .2rem 1rem;font-size:.84rem;">' + r.drug_classes.map(function (g) { return '<li>' + escHtml(g) + '</li>'; }).join('') + '</ul>'
              : '<em style="color:#aaa;font-size:.85rem;">' + tUI('not_classified') + '</em>')
          ) +

          section(tUI('section_summary'),
            '<div style="font-size:.84rem;line-height:1.45;">' +
              '<div><strong>' + tUI('total_findings') + '</strong> ' + summary.total_cascades + '</div>' +
              '<div><strong>' + tUI('label_plausible') + '</strong> ' + (summary.plausible_cascades || 0) + '</div>' +
              '<div><strong>' + tUI('label_high_priority') + '</strong> ' + summary.high_priority_cascades + '</div>' +
              '<div style="margin-top:.4rem;"><strong>' + tUI('main_interventions') + '</strong></div>' +
              summaryInterventions +
              '<div class="callout callout-warning" style="margin-top:.5rem;font-size:.8rem;">&#9888;&nbsp;' + escHtml(summary.validation_warning) + '</div>' +
            '</div>'
          ) +

          section(tUI('section_findings', r.cascade_count), cascadeContent) +

          '<div class="callout callout-warning" style="margin-top:.85rem;font-size:.82rem;">' +
            tUI('decision_support_warning') +
          '</div>' +

          exportRow +
        '</div>'
      );
    }
  }
};

/* ============================================================
   Wizard navigation
   ============================================================ */
function goTo(step) {
  if (step < 1 || step > 6) return;
  state.step = step;
  saveState();
  renderStepContent(step);
  updateStepNav(step);
  updateNavButtons(step);
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
  container.innerHTML =
    '<div class="step-header"><h2>' + titleText + '</h2></div>' +
    '<div class="step-section">' + cfg.body() + '</div>';

  if (typeof cfg.onMount === 'function') {
    cfg.onMount(container);
  }
}

function updateStepNav(active) {
  document.querySelectorAll('.step-btn').forEach(function (btn) {
    var s = parseInt(btn.dataset.step, 10);
    btn.classList.remove('active', 'completed');
    if (s === active)   btn.classList.add('active');
    else if (s < active) btn.classList.add('completed');
  });
}

function updateNavButtons(step) {
  var prev    = document.getElementById('btn-prev');
  var next    = document.getElementById('btn-next');
  var counter = document.getElementById('step-counter');
  if (prev) {
    prev.disabled  = step === 1;
    prev.innerHTML = tUI('btn_prev');
  }
  if (next)    next.innerHTML = step === 6 ? tUI('btn_finish') : tUI('btn_next');
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

/* ── reconcileDrugsWithCascades ────────────────────────────────────────────
 * Merges cascade index_drug / cascade_drug into the drugs array so that
 * drugs_detected can never be empty while cascades are shown.
 *
 * Why: extractDrugs() scans the note against KB example lists; the cascade
 * engine can match drugs via symptom-bridge or Spanish INN variants that
 * extractDrugs() misses.  This function is the single authoritative fix.
 *
 * Contract:
 *   - Returns a new string[] (original array not mutated).
 *   - Deduplication is case-insensitive; original casing is preserved.
 *   - Only index_drug and cascade_drug are used; ADE/symptom terms are never
 *     added (they live in detectedCascades[*].ade_en, not the drug fields).
 *   - detectedCascades entries with falsy drug fields are silently skipped.
 * ──────────────────────────────────────────────────────────────────────── */
function reconcileDrugsWithCascades(drugs, detectedCascades) {
  var result = drugs.slice();               /* copy — never mutate input */
  var seen   = {};
  result.forEach(function (d) { seen[d.toLowerCase()] = true; });

  (detectedCascades || []).forEach(function (c) {
    [c.index_drug, c.cascade_drug].forEach(function (drug) {
      if (!drug || typeof drug !== 'string') return;
      var key = drug.trim().toLowerCase();
      if (key && !seen[key]) {
        result.push(drug.trim());
        seen[key] = true;
      }
    });
  });

  return result;
}

function confidenceRank(conf) {
  return conf === 'high' ? 3 : conf === 'medium' ? 2 : 1;
}

function priorityRank(priority) {
  return priority === 'alta' ? 3 : priority === 'intermedia' ? 2 : 1;
}

function hasText(value) {
  return !!(value && String(value).trim());
}

/* ── Alternative-indication map ────────────────────────────────────────────
 * Each entry describes a well-established clinical condition that provides a
 * plausible independent (non-cascade) reason for the cascade drug to have been
 * prescribed.  Used by detectAlternativeIndication() to apply a conservative
 * confidence penalty when such a condition is mentioned in the clinical note.
 * ─────────────────────────────────────────────────────────────────────────── */
var ALTERNATIVE_INDICATION_MAP = [
  {
    keywords_es: ['artrosis', 'osteoartritis', 'artritis crónica', 'dolor musculoesquelético', 'dolor crónico musculoesquelético', 'lumbalgia crónica', 'coxartrosis', 'gonartrosis'],
    keywords_en: ['osteoarthritis', 'arthrosis', 'chronic arthritis', 'musculoskeletal pain', 'chronic musculoskeletal pain', 'chronic low back pain'],
    cascade_drugs: ['ibuprofen', 'naproxen', 'naproxeno', 'celecoxib', 'diclofenac', 'diclofenaco', 'meloxicam', 'indometacin', 'indomethacin', 'ketorolac'],
    reason_es: 'artrosis/dolor musculoesquelético crónico',
    reason_en: 'osteoarthritis / chronic musculoskeletal pain'
  },
  {
    keywords_es: ['reflujo gastroesofágico', 'erge', 'dispepsia', 'gastritis', 'úlcera péptica', 'pirosis crónica', 'esofagitis', 'reflujo previo'],
    keywords_en: ['gerd', 'gastroesophageal reflux', 'dyspepsia', 'gastritis', 'peptic ulcer', 'chronic heartburn', 'esophagitis', 'prior reflux'],
    cascade_drugs: ['omeprazole', 'omeprazol', 'esomeprazole', 'esomeprazol', 'pantoprazole', 'pantoprazol', 'lansoprazole', 'lansoprazol', 'rabeprazole', 'rabeprazol'],
    reason_es: 'ERGE/dispepsia/gastritis previa',
    reason_en: 'prior GERD / dyspepsia / gastritis'
  },
  {
    keywords_es: ['hipertensión esencial', 'hta esencial', 'hta previa', 'hipertensión arterial crónica', 'hipertensión conocida', 'hipertensión arterial esencial', 'hta conocida'],
    keywords_en: ['essential hypertension', 'prior hypertension', 'known hypertension', 'chronic hypertension', 'pre-existing hypertension'],
    cascade_drugs: ['amlodipine', 'amlodipino', 'enalapril', 'lisinopril', 'losartan', 'losartán', 'valsartan', 'valsartán', 'ramipril', 'telmisartan', 'perindopril'],
    reason_es: 'hipertensión arterial esencial previa',
    reason_en: 'pre-existing essential hypertension'
  },
  {
    keywords_es: ['parkinson', 'enfermedad de parkinson', 'enfermedad de parkinson conocida'],
    keywords_en: ['parkinson', "parkinson's disease", 'parkinson disease', 'known parkinson'],
    cascade_drugs: ['levodopa', 'carbidopa', 'ropinirole', 'ropinirol', 'pramipexole', 'pramipexol', 'rotigotine', 'rotigotina'],
    reason_es: 'enfermedad de Parkinson conocida',
    reason_en: 'known Parkinson disease'
  },
  {
    keywords_es: ['diabetes mellitus', 'dm2', 'dm tipo 2', 'diabetes tipo 2', 'diabetes conocida', 'diabetes previa', 'diabetes mellitus tipo 2'],
    keywords_en: ['diabetes mellitus', 'type 2 diabetes', 'known diabetes', 'pre-existing diabetes', 'diabetes mellitus type 2'],
    cascade_drugs: ['metformin', 'metformina', 'sitagliptin', 'sitagliptina', 'empagliflozin', 'dapagliflozin', 'liraglutide', 'liraglutida', 'glipizide', 'glibenclamide', 'glibenclamida'],
    reason_es: 'diabetes mellitus tipo 2 conocida',
    reason_en: 'known type 2 diabetes mellitus'
  }
];

/**
 * Check whether the clinical note contains a plausible independent diagnosis
 * that could explain why the cascade drug was prescribed, independently of
 * any adverse drug event from the index drug.
 *
 * Uses ALTERNATIVE_INDICATION_MAP: a conservative list of well-established
 * diagnosis→drug relationships.  Returns { found: true } only when the note
 * explicitly mentions a recognised diagnosis keyword for that drug.
 *
 * @param {string} noteText
 * @param {string} cascadeDrug  Canonical cascade drug name
 * @returns {{ found: boolean, reason: string }}
 */
function detectAlternativeIndication(noteText, cascadeDrug) {
  if (!hasText(noteText) || !hasText(cascadeDrug)) return { found: false, reason: '' };
  var normNote    = normalizeDrugText(noteText);
  var normCascade = normalizeDrugText(cascadeDrug);

  for (var i = 0; i < ALTERNATIVE_INDICATION_MAP.length; i++) {
    var entry = ALTERNATIVE_INDICATION_MAP[i];

    /* Does the cascade drug match this indication entry? */
    var drugMatch = entry.cascade_drugs.some(function (d) {
      return normalizeDrugText(d) === normCascade;
    });
    if (!drugMatch) continue;

    /* Does the note explicitly mention the independent diagnosis? */
    var allKeywords = (entry.keywords_es || []).concat(entry.keywords_en || []);
    for (var ki = 0; ki < allKeywords.length; ki++) {
      var kw = normalizeDrugText(allKeywords[ki]);
      if (kw && normNote.indexOf(kw) !== -1) {
        var reason = currentLanguage === 'es' ? entry.reason_es : entry.reason_en;
        return { found: true, reason: reason };
      }
    }
  }
  return { found: false, reason: '' };
}

/**
 * Deduplication / overlap suppression layer.
 *
 * After all cascade signals (drug_drug + symptom_bridge) have been collected,
 * group them by their core pharmacological pair:
 *   key = normalized(index_drug) + '|' + normalized(cascade_drug)
 *
 * Within each group, keep only the BEST signal and suppress the others.
 * Selection preference (in order):
 *   1. Higher confidence rank (high > medium > low)
 *   2. More specific signal type (symptom_bridge > drug_drug)
 *   3. Classic ('often_inappropriate') over context-dependent
 *
 * Suppressed signal IDs are stored on the winner as suppressed_duplicates[]
 * for transparency in JSON export; they are not shown in the UI.
 *
 * @param {Array} signals
 * @returns {Array}
 */
function suppressDuplicateSignals(signals) {
  if (!signals || signals.length < 2) return signals;

  /* Build groups keyed by (normalized index_drug | normalized cascade_drug) */
  var groups = {};
  signals.forEach(function (sig) {
    var key = normalizeDrugText(sig.index_drug || '') + '|' + normalizeDrugText(sig.cascade_drug || '');
    if (!groups[key]) groups[key] = [];
    groups[key].push(sig);
  });

  var result = [];
  Object.keys(groups).forEach(function (key) {
    var group = groups[key];
    if (group.length === 1) {
      result.push(group[0]);
      return;
    }

    /* Sort by preference: confidence → signal type → appropriateness */
    group.sort(function (a, b) {
      /* 1. Higher confidence wins */
      var confDiff = confidenceRank(b.confidence) - confidenceRank(a.confidence);
      if (confDiff !== 0) return confDiff;

      /* 2. symptom_bridge is more specific than drug_drug */
      var aSpec = a.signal_type === 'symptom_bridge' ? 1 : 0;
      var bSpec = b.signal_type === 'symptom_bridge' ? 1 : 0;
      if (bSpec !== aSpec) return bSpec - aSpec;

      /* 3. 'often_inappropriate' (classic) beats context-dependent */
      var aClassic = a.appropriateness === 'often_inappropriate' ? 1 : 0;
      var bClassic = b.appropriateness === 'often_inappropriate' ? 1 : 0;
      return bClassic - aClassic;
    });

    var winner = group[0];
    /* Attach suppressed IDs to winner for JSON-export transparency */
    winner.suppressed_duplicates = group.slice(1).map(function (s) { return s.cascade_id; });

    result.push(winner);
  });

  return result;
}

function isNonspecificSymptom(symptomTerm) {
  if (!hasText(symptomTerm)) return false;
  var nonspecific = ['dizziness', 'nausea', 'insomnia'];
  return nonspecific.indexOf(String(symptomTerm).trim().toLowerCase()) !== -1;
}

function detectDrugPairTemporality(noteText, signal) {
  if (!hasText(noteText) || !signal) {
    return { status: 'unknown', detail: tUI('temporality_no_data') };
  }

  var idxPos = signal.index_drug ? findTermInNote(noteText, signal.index_drug) : null;
  var casPos = signal.cascade_drug ? findTermInNote(noteText, signal.cascade_drug) : null;
  if (!idxPos && !casPos) {
    return { status: 'unknown', detail: tUI('temporality_no_data') };
  }

  var idxCue = idxPos ? detectTimeCues(noteText, idxPos.index) : {};
  var casCue = casPos ? detectTimeCues(noteText, casPos.index) : {};
  var supportive = !!(idxCue.drugStartHint || casCue.treatmentAddedHint || idxCue.treatmentAddedHint);
  var chronic = !!(idxCue.chronicHint || casCue.chronicHint);

  if (supportive) return { status: 'supportive', detail: tUI('temporality_supportive') };
  if (chronic)    return { status: 'weak',        detail: tUI('temporality_weak')       };
  return            { status: 'unknown',           detail: tUI('temporality_unknown')   };
}

function buildEvidenceProfile(signal, recommendationText, noteText) {
  var supports = [];
  var missing = [];
  var temporality = detectDrugPairTemporality(noteText, signal);
  var symptomMatch = false;
  var explicitKbIntervention = hasText(recommendationText) || signal.appropriateness === 'often_inappropriate';
  var explicitEvidence = hasText(signal.ddi_warning);

  if (signal.signal_type === 'symptom_bridge') {
    supports.push(tUI('symptom_detected'));
  } else {
    var matchedSymptoms = (state.symptomsDetected || []).filter(function (s) {
      /* Use normalizeSymptomText() so diacritic variants and mixed-case ADE
       * labels compare equal (e.g. "Oedema" === "oedema", "náuseas" === "nauseas"). */
      return hasText(signal.ade_en) && s && hasText(s.term) &&
             normalizeSymptomText(s.term) === normalizeSymptomText(signal.ade_en);
    });
    symptomMatch = matchedSymptoms.length > 0;
    if (symptomMatch) supports.push(tUI('ade_detected', signal.ade_en));
  }

  if (temporality.status === 'supportive') supports.push(temporality.detail);
  else missing.push(temporality.detail);

  if (explicitKbIntervention) supports.push(tUI('kb_has_recommendation'));
  if (explicitEvidence)       supports.push(tUI('explicit_kb_evidence'));

  var noteDrivenSupport = symptomMatch || temporality.status === 'supportive' || explicitEvidence;
  var hasClinicalSupport = signal.signal_type === 'symptom_bridge' || noteDrivenSupport;
  if (signal.signal_type === 'drug_drug' && !hasClinicalSupport) {
    missing.push(tUI('missing_clinical_support'));
  }

  /* ── Alternative-indication detection ──────────────────────────────────
   * Check whether the note contains a plausible independent diagnosis that
   * could explain the cascade drug without a prescribing cascade.
   * Conservative: only fires when a well-known diagnosis keyword is present.
   * When found, adds an explicit "Qué falta" item so clinicians see the caveat.
   * ─────────────────────────────────────────────────────────────────────── */
  var altIndication = detectAlternativeIndication(noteText, signal.cascade_drug);
  if (altIndication.found) {
    missing.push(tUI('alt_indication_note', altIndication.reason));
  }

  /* ── HIV modifier-only down-weighting ──────────────────────────────────
   * A signal is "HIV-modifier-only" if it was upgraded by an HIV clinical
   * context modifier but has NO direct ADE or symptom evidence in the note.
   * These signals should not strongly outscore direct drug→ADE→drug patterns,
   * so we flag them here and apply a scoring penalty in derivePharmacyPriority.
   * ─────────────────────────────────────────────────────────────────────── */
  var hivModifierOnly = !!(
    signal.clinical_modifiers && signal.clinical_modifiers.length > 0 &&
    signal.signal_type === 'drug_drug' &&
    !symptomMatch && !explicitEvidence
  );
  if (hivModifierOnly) {
    missing.push(tUI('hiv_modifier_only_note'));
  }

  var isPreliminary = signal.signal_type === 'drug_drug' && !hasClinicalSupport;
  return {
    level:       isPreliminary ? 'preliminary_signal' : 'plausible_cascade',
    label:       isPreliminary ? tUI('level_preliminary_label') : tUI('level_plausible_label'),
    levelReason: isPreliminary ? tUI('level_preliminary_reason') : tUI('level_plausible_reason'),
    supports: supports,
    missing: missing,
    hasClinicalSupport: hasClinicalSupport,
    temporality: temporality,
    altIndicationPenalty: altIndication.found,   /* used by derivePharmacyPriority */
    hivModifierOnly: hivModifierOnly             /* used by derivePharmacyPriority */
  };
}

function derivePharmacyPriority(signal, recommendationText, evidence) {
  var score = 0;
  var reasons = [];

  var confScore = confidenceRank(signal.confidence);
  score += confScore;
  reasons.push(tUI('prio_reason_probability', signal.confidence || 'low'));

  var specificityScore = signal.signal_type === 'symptom_bridge' ? 2 : 1;
  if (signal.signal_type === 'drug_drug' && hasText(signal.ade_en)) specificityScore += 1;
  score += specificityScore;
  reasons.push(
    signal.signal_type === 'symptom_bridge'
      ? tUI('prio_reason_symptom_bridge')
      : tUI('prio_reason_pharmacological')
  );

  var hasClearIntervention = !!(recommendationText && recommendationText.trim()) ||
    signal.appropriateness === 'often_inappropriate';
  if (hasClearIntervention) {
    score += 1;
    reasons.push(tUI('prio_reason_actionable'));
  } else {
    reasons.push(tUI('prio_reason_less_defined'));
  }

  if (evidence) {
    if (!evidence.hasClinicalSupport) {
      score -= 2;
      reasons.push(tUI('prio_reason_no_clinical'));
    }
    if (evidence.temporality.status === 'supportive') {
      score += 1;
      reasons.push(tUI('prio_reason_temp_good'));
    } else if (evidence.temporality.status === 'weak') {
      score -= 1;
      reasons.push(tUI('prio_reason_temp_weak'));
    } else {
      score -= 1;
      reasons.push(tUI('prio_reason_no_temporal'));
    }
  }

  var hasAdditionalSupport = !!(
    evidence && evidence.temporality && evidence.temporality.status === 'supportive'
  ) || signal.confidence === 'high';

  if (signal.signal_type === 'symptom_bridge' && isNonspecificSymptom(signal.ade_en) && !hasAdditionalSupport) {
    score -= 1;
    reasons.push(tUI('prio_reason_nonspecific'));
  }

  /* ── Alternative-indication penalty ────────────────────────────────────
   * If the note contains a plausible independent diagnosis that could explain
   * the cascade drug on its own, reduce the score by 1.  This prevents the
   * signal from being over-called when the cascade drug likely has a primary
   * non-cascade indication.  Applied conservatively (-1 only).
   * ─────────────────────────────────────────────────────────────────────── */
  if (evidence && evidence.altIndicationPenalty) {
    score -= 1;
    reasons.push(tUI('prio_reason_alt_indication'));
  }

  /* ── HIV modifier-only down-weighting ──────────────────────────────────
   * Signals driven mainly by an HIV clinical context modifier but lacking
   * direct ADE evidence in the note should not outscore direct drug→ADE→drug
   * patterns.  Apply a modest penalty (-1) to keep them correctly ranked.
   * ─────────────────────────────────────────────────────────────────────── */
  if (evidence && evidence.hivModifierOnly) {
    score -= 1;
    reasons.push(tUI('prio_reason_hiv_modifier_only'));
  }

  if (score >= 6) return { level: 'alta',       label: tUI('prio_high'),   score: score, reasons: reasons };
  if (score >= 4) return { level: 'intermedia',  label: tUI('prio_medium'), score: score, reasons: reasons };
  return             { level: 'baja',            label: tUI('prio_low'),    score: score, reasons: reasons };
}

function buildVerificationItems(signal) {
  var items = [
    tUI('verif_chronology'),
    tUI('verif_indication'),
    tUI('verif_evolution')
  ];

  if (signal.signal_type === 'symptom_bridge') {
    items.push(tUI('verif_symptom_active'));
  }

  if (!signal.ade_en) {
    items.push(tUI('verif_no_ade'));
  }

  return items;
}

function buildSignalExplanation(signal) {
  if (signal.signal_type === 'symptom_bridge') {
    var temporal = signal.rationale && signal.rationale.explanation
      ? ' ' + signal.rationale.explanation
      : tUI('signal_bridge_incomplete');
    return tUI('signal_bridge_base') + temporal;
  }

  return tUI('signal_drug_drug');
}

function buildClinicalInterpretation(signal, entry) {
  /* Use currentLanguage to pick the preferred field, fall back to English */
  var clinNote  = entry ? getLocalizedField(entry, 'clinical_note', currentLanguage) : '';
  var recAction = entry ? getLocalizedField(entry, 'recommended_first_action', currentLanguage) : '';
  if (clinNote)  return clinNote;
  if (recAction) return recAction;
  if (signal.clinical_hint) return signal.clinical_hint;
  return tUI('default_interpretation');
}

/* ── buildReport ──────────────────────────────────────────────────────────
   Assembles the full structured report object.
   Used by the Step 6 display, JSON export, and CSV export so that all
   three surfaces always show identical data.
   ──────────────────────────────────────────────────────────────────────── */
function buildReport() {
  var drugs      = extractDrugs(state.clinicalNote);
  var detected   = getDetectedCascades(state.clinicalNote);

  /* Reconcile before normalization so drug_classes also cover cascade drugs */
  var reconciledDrugs = reconcileDrugsWithCascades(drugs, detected);
  var inferredCount   = reconciledDrugs.length - drugs.length;
  var normalized      = normalizeDrugs(reconciledDrugs);

  /* Unique drug classes, preserving first-seen order */
  var uniqueClasses = [];
  var _seenCls = {};
  normalized.forEach(function (n) {
    if (n.class && !_seenCls[n.class]) { _seenCls[n.class] = true; uniqueClasses.push(n.class); }
  });

  var cascades = detected.map(function (c) {
    var entry = findCascadeEntryForSignal(c);
    var rec   = entry
      ? (getLocalizedField(entry, 'recommended_first_action', currentLanguage) ||
         getLocalizedField(entry, 'clinical_note', currentLanguage))
      : (c.clinical_hint || '');
    var evidence = buildEvidenceProfile(c, rec, state.clinicalNote);
    var priority = derivePharmacyPriority(c, rec, evidence);
    var clinicalInterpretation = buildClinicalInterpretation(c, entry);
    var adeDisplay = (currentLanguage === 'es' && c.ade_es) ? c.ade_es : (c.ade_en || '');
    var factorsInFavor = [
      'Secuencia detectada: ' + c.index_drug + ' \u2192 ' + (adeDisplay || tUI('seq_potential_ade')) + ' \u2192 ' + c.cascade_drug + '.',
      buildSignalExplanation(c)
    ].concat(priority.reasons, evidence.supports);

    /* Resolve display id/name from the matched KB entry when available.
     * This is critical for symptom_bridge signals whose synthetic cascade_id
     * (e.g. "SYM001:pregabalin:furosemide") does not correspond to any KB
     * entry — the true KB cascade (e.g. CC027) must be surfaced instead. */
    var displayId   = (entry && entry.id) ? entry.id : c.cascade_id;
    var displayName = entry
      ? (getLocalizedField(entry, 'name', currentLanguage) || c.cascade_name)
      : ((currentLanguage === 'es' && c.cascade_name_es) ? c.cascade_name_es : c.cascade_name);

    return {
      cascade_id:              displayId,
      cascade_name:            displayName,
      index_drug:              c.index_drug,
      cascade_drug:            c.cascade_drug,
      confidence:              c.confidence,
      ade_en:                  c.ade_en  || '',
      ade_display:             adeDisplay,
      clinical_recommendation: rec,
      verification_status:     state.cascadeClassifications[c.cascade_id] || 'unreviewed',
      sequence:                c.index_drug + ' \u2192 ' + (adeDisplay || tUI('seq_potential_ade')) + ' \u2192 ' + c.cascade_drug,
      clinical_interpretation: clinicalInterpretation,
      factors_in_favor:        factorsInFavor,
      factors_to_verify:       buildVerificationItems(c).concat(evidence.missing),
      suggested_intervention:  rec || tUI('no_kb_intervention'),
      pharmacy_priority:       priority.label,
      pharmacy_priority_level: priority.level,
      trigger_explanation:     buildSignalExplanation(c),
      certainty_gap:           tUI('certainty_gap_text'),
      finding_level:           evidence.level,
      finding_label:           evidence.label,
      support_summary:         evidence.supports.length ? evidence.supports.join(' | ') : tUI('no_support_summary'),
      missing_summary:         evidence.missing.length ? evidence.missing.join(' | ') : tUI('no_missing_summary'),
      level_reason:            evidence.levelReason,
      temporal_support:        evidence.temporality.status
    };
  });

  cascades.sort(function (a, b) {
    var byPriority = priorityRank(b.pharmacy_priority_level) - priorityRank(a.pharmacy_priority_level);
    if (byPriority !== 0) return byPriority;
    var aLevel = a.finding_level === 'plausible_cascade' ? 1 : 0;
    var bLevel = b.finding_level === 'plausible_cascade' ? 1 : 0;
    if (bLevel !== aLevel) return bLevel - aLevel;
    return confidenceRank(b.confidence) - confidenceRank(a.confidence);
  });

  var plausibleCount = cascades.filter(function (c) { return c.finding_level === 'plausible_cascade'; }).length;
  var highPriorityCount = cascades.filter(function (c) { return c.pharmacy_priority_level === 'alta'; }).length;
  var topInterventions = [];
  var seenInterventions = {};
  cascades.forEach(function (c) {
    var key = (c.suggested_intervention || '').trim().toLowerCase();
    if (!key || seenInterventions[key]) return;
    seenInterventions[key] = true;
    topInterventions.push(c.suggested_intervention);
  });

  return {
    patient_id:         state.patientId || '',
    generated_at:       new Date().toISOString(),
    kb_version:         getKBVersion(),
    kb_mode:            state.kbMode,
    drugs_detected:     reconciledDrugs,
    drug_classes:       uniqueClasses,
    diagnostics: {
      inferredDrugsFromCascades: inferredCount > 0,
      inferredDrugCount:         inferredCount
    },
    symptoms_detected:  state.symptomsDetected.map(function (s) {
      return { id: s.id, term: s.term, matched_term: s.matched_term, category: s.category };
    }),
    cascade_count:      detected.length,
    cascades:           cascades,
    clinical_summary: {
      total_cascades: detected.length,
      plausible_cascades: plausibleCount,
      high_priority_cascades: highPriorityCount,
      top_interventions: topInterventions.slice(0, 3),
      validation_warning: tUI('validation_warning')
    }
  };
}

function formatReportForClinicalRecord(report) {
  var lines = [];
  lines.push(tUI('report_header'));
  lines.push(tUI('report_patient') + (report.patient_id || tUI('report_not_set')));
  lines.push(tUI('report_date') + report.generated_at);
  lines.push(tUI('report_kb') + report.kb_mode + (report.kb_version ? ' v' + report.kb_version : ''));
  lines.push('');
  lines.push(tUI('report_summary'));
  lines.push(tUI('report_total') + report.cascade_count);
  lines.push(tUI('report_plausible_count') + (report.clinical_summary && report.clinical_summary.plausible_cascades ? report.clinical_summary.plausible_cascades : 0));
  lines.push(tUI('report_high_prio') + (report.clinical_summary && report.clinical_summary.high_priority_cascades ? report.clinical_summary.high_priority_cascades : 0));
  lines.push(tUI('report_drugs_list') + (report.drugs_detected.join(', ') || tUI('report_none')));
  lines.push(tUI('report_classes_list') + (report.drug_classes.join(', ') || tUI('report_not_classified')));
  lines.push('');

  if (!report.cascades.length) {
    lines.push(tUI('report_no_cascades'));
  } else {
    var plausible = report.cascades.filter(function (c) { return c.finding_level === 'plausible_cascade'; });
    var preliminary = report.cascades.filter(function (c) { return c.finding_level === 'preliminary_signal'; });
    lines.push(tUI('report_plausible_section', plausible.length));
    plausible.forEach(function (c, idx) {
      lines.push((idx + 1) + '. ' + c.cascade_name + ' [' + c.cascade_id + ']');
      lines.push(tUI('report_seq') + c.sequence);
      lines.push(tUI('report_finding') + c.finding_level);
      lines.push(tUI('report_prio') + c.pharmacy_priority);
      lines.push(tUI('report_verif') + c.verification_status);
      lines.push(tUI('report_evidence') + (c.support_summary || tUI('report_no_support')));
      lines.push(tUI('report_missing_conf') + (c.missing_summary || tUI('report_no_gaps')));
      lines.push(tUI('report_rec') + (c.clinical_recommendation || c.suggested_intervention || tUI('report_no_rec')));
    });

    lines.push('');
    lines.push(tUI('report_preliminary_section', preliminary.length));
    preliminary.forEach(function (c, idx) {
      lines.push((idx + 1) + '. ' + c.cascade_name + ' [' + c.cascade_id + ']');
      lines.push(tUI('report_seq') + c.sequence);
      lines.push(tUI('report_finding') + c.finding_level);
      lines.push(tUI('report_prio') + c.pharmacy_priority);
      lines.push(tUI('report_verif') + c.verification_status);
      lines.push(tUI('report_evidence') + (c.support_summary || tUI('report_no_support')));
      lines.push(tUI('report_missing_conf') + (c.missing_summary || tUI('report_no_gaps')));
      lines.push(tUI('report_rec') + (c.clinical_recommendation || c.suggested_intervention || tUI('report_no_rec')));
    });
  }

  if (report.clinical_summary && report.clinical_summary.top_interventions && report.clinical_summary.top_interventions.length) {
    lines.push('');
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
  if (!text) return Promise.reject(new Error('No text to copy.'));

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
  window.print();
};

/* ── exportReport ─────────────────────────────────────────────────────────
   Inline export buttons in Step 6 call: exportReport('json') / ('csv')
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
    /* One row per cascade; header + data rows */
    var csvCols = [
      'patient_id', 'generated_at', 'kb_version',
      'cascade_id', 'cascade_name',
      'index_drug', 'cascade_drug', 'confidence', 'ade_en',
      'clinical_recommendation', 'verification_status', 'finding_level', 'temporal_support'
    ];
    /* RFC 4180 cell quoting: wrap in " and double any inner " */
    function csvCell(v) {
      var s = v === null || v === undefined ? '' : String(v);
      return '"' + s.replace(/"/g, '""') + '"';
    }
    var rows = [csvCols.join(',')];
    if (report.cascades.length === 0) {
      /* Single data row indicating no cascades */
      rows.push([
        csvCell(report.patient_id), csvCell(report.generated_at), csvCell(report.kb_version),
        csvCell(''), csvCell(tUI('report_no_cascades')),
        csvCell(''), csvCell(''), csvCell(''), csvCell(''),
        csvCell(''), csvCell(''), csvCell(''), csvCell('')
      ].join(','));
    } else {
      report.cascades.forEach(function (c) {
        rows.push([
          csvCell(report.patient_id),
          csvCell(report.generated_at),
          csvCell(report.kb_version),
          csvCell(c.cascade_id),
          csvCell(c.cascade_name),
          csvCell(c.index_drug),
          csvCell(c.cascade_drug),
          csvCell(c.confidence),
          csvCell(c.ade_en),
          csvCell(c.clinical_recommendation),
          csvCell(c.verification_status),
          csvCell(c.finding_level),
          csvCell(c.temporal_support)
        ].join(','));
      });
    }
    blob = new Blob([rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
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
      if (typeof data.patientId === 'string' && data.patientId.length <= 200) {
        state.patientId = data.patientId;
        imported++;
      }
      if (typeof data.clinicalNote === 'string') {
        state.clinicalNote = data.clinicalNote;
        imported++;
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
        throw new Error('No recognizable case data found in this file. Make sure it was exported by this application.');
      }

      /* Reset derived state that depends on the imported note */
      state.symptomsDetected = [];
      state.detectedCascades = null;

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

  /* Helper: run extractSymptoms on a scratch note without touching state */
  function probeSymptoms(note) {
    var savedNote   = state.clinicalNote;
    var savedSym    = state.symptomsDetected;
    var savedCache  = state.detectedCascades;
    state.clinicalNote    = note;
    state.symptomsDetected = [];
    var result = extractSymptoms(note);
    state.clinicalNote    = savedNote;
    state.symptomsDetected = savedSym;
    state.detectedCascades = savedCache;
    return result;
  }

  /* Helper: run detectSymptomCascades on a scratch note */
  function probeCascades(note) {
    var savedNote  = state.clinicalNote;
    var savedSym   = state.symptomsDetected;
    var savedCache = state.detectedCascades;
    state.clinicalNote     = note;
    state.symptomsDetected = [];
    state.detectedCascades = null;
    var syms = extractSymptoms(note);
    var sigs = detectSymptomCascades(note);
    state.clinicalNote     = savedNote;
    state.symptomsDetected = savedSym;
    state.detectedCascades = savedCache;
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

  /* ── Priority penalty checks for non-specific symptoms ── */
  console.group('C2. Priority penalty — non-specific symptoms');

  var p1 = probeCascades(
    'Patient reports dizziness. Amlodipine and meclizine are listed with no clear temporal relation.'
  );
  var p1s = p1.sigs.find(function (s) { return s.ade_en === 'dizziness'; });
  var p1e = p1s ? buildEvidenceProfile(p1s, p1s.clinical_hint || '', 'Patient reports dizziness. Amlodipine and meclizine are listed with no clear temporal relation.') : null;
  var p1p = p1s ? derivePharmacyPriority(p1s, p1s.clinical_hint || '', p1e) : null;
  assert('P1: dizziness + unknown temporality gets additional penalty (score <= 4)',
         p1p ? p1p.score <= 4 : null, true);

  var p2 = probeCascades(
    'After starting amlodipine the patient developed new dizziness. Meclizine was added.'
  );
  var p2s = p2.sigs.find(function (s) { return s.ade_en === 'dizziness'; });
  var p2e = p2s ? buildEvidenceProfile(p2s, p2s.clinical_hint || '', 'After starting amlodipine the patient developed new dizziness. Meclizine was added.') : null;
  var p2p = p2s ? derivePharmacyPriority(p2s, p2s.clinical_hint || '', p2e) : null;
  assert('P2: dizziness + supportive temporality avoids extra penalty (score >= 5)',
         p2p ? p2p.score >= 5 : null, true);

  var p3 = probeCascades(
    'New onset oedema after amlodipine start. Furosemide prescribed due to persistent ankle swelling.'
  );
  var p3s = p3.sigs.find(function (s) { return s.ade_en === 'oedema'; });
  var p3e = p3s ? buildEvidenceProfile(p3s, p3s.clinical_hint || '', 'New onset oedema after amlodipine start. Furosemide prescribed due to persistent ankle swelling.') : null;
  var p3p = p3s ? derivePharmacyPriority(p3s, p3s.clinical_hint || '', p3e) : null;
  assert('P3: specific symptom with clinical support keeps higher score (>=5)',
         p3p ? p3p.score >= 5 : null, true);

  console.groupEnd();

  /* ── Spanish assertions ── */
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

  /* ── Group F: strict/operational split, non-mutation, richer report ──── */
  console.group('F — Bilingual strict/operational + fallback report');
  (function () {
    /* Factory — each test gets a fresh source so mutations never bleed across */
    function makeMinimalKB() {
      return {
        version: '0.0.1-test',
        cascades: [
          {
            id: 'CC_T1',
            name_en: 'Drug A \u2192 ADE A \u2192 Treatment A',
            index_drug_classes: ['ClassA'],
            index_drug_examples: ['druga'],
            ade_en: 'Adverse effect alpha',
            cascade_drug_examples: ['treatmenta'],
            confidence: 'high', age_sensitivity: 'low',
            risk_focus: ['metabolic'],
            differential_hints: ['hint1','hint2','hint3'],
            appropriateness: 'context_dependent'
          },
          {
            id: 'CC_T2',
            name_en: 'Drug B \u2192 ADE B \u2192 Treatment B',
            /* name_es present, ade_es missing — partial translation */
            name_es: 'Fármaco B \u2192 EAM B \u2192 Tratamiento B',
            index_drug_classes: ['ClassB'],
            index_drug_examples: ['drugb'],
            ade_en: 'Adverse effect beta',
            cascade_drug_examples: ['treatmentb'],
            confidence: 'medium', age_sensitivity: 'medium',
            risk_focus: ['cardiovascular'],
            differential_hints: ['hint1','hint2','hint3'],
            appropriateness: 'often_appropriate'
          }
        ]
      };
    }

    if (typeof validateKBStrict !== 'function' || typeof validateKBOperational !== 'function') {
      assert('F0: validateKBStrict + validateKBOperational available', false, true);
      return;
    }

    /* F1 — strict fails when *_es missing */
    var strictR = validateKBStrict(makeMinimalKB());
    assert('F1: strict.ok = false (missing name_es/ade_es)', strictR.ok, false);
    assert('F1: strict errors mention _es fields',
      strictR.errors.some(function(e){ return /name_es|ade_es/.test(e); }), true);

    /* F2 — operational passes; richer fallback report */
    var opR = validateKBOperational(makeMinimalKB());
    assert('F2: operational.ok = true', opR.ok, true);
    /* CC_T1 needs both name_es + ade_es; CC_T2 already has name_es, needs only ade_es */
    assert('F2: fallbackCascadeCount = 2', opR.fallbackCascadeCount, 2);
    assert('F2: fallbackFieldCount = 3',   opR.fallbackFieldCount,   3);
    assert('F2: fallbackByField.name_es = 1 (only CC_T1 missing it)',
      opR.fallbackByField && opR.fallbackByField['name_es'], 1);
    assert('F2: fallbackByField.ade_es = 2 (both cascades missing it)',
      opR.fallbackByField && opR.fallbackByField['ade_es'], 2);
    assert('F2: fallbackByFieldIds.ade_es includes CC_T1',
      opR.fallbackByFieldIds && opR.fallbackByFieldIds['ade_es'] &&
      opR.fallbackByFieldIds['ade_es'].indexOf('CC_T1') !== -1, true);
    assert('F2: fallbackByFieldIds.ade_es includes CC_T2',
      opR.fallbackByFieldIds && opR.fallbackByFieldIds['ade_es'] &&
      opR.fallbackByFieldIds['ade_es'].indexOf('CC_T2') !== -1, true);

    /* F3 — non-mutating: source unchanged after operational */
    var srcKb = makeMinimalKB();
    validateKBOperational(srcKb);
    assert('F3: source name_es not filled', srcKb.cascades[0].name_es, undefined);
    assert('F3: source __i18n not set',     srcKb.cascades[0].__i18n,  undefined);

    /* F4 — idempotent: two calls on same source give identical results */
    var iKb = makeMinimalKB();
    var r4a = validateKBOperational(iKb);
    var r4b = validateKBOperational(iKb);
    assert('F4: idempotent ok',                r4a.ok,                 r4b.ok);
    assert('F4: idempotent fallbackCascadeCount', r4a.fallbackCascadeCount, r4b.fallbackCascadeCount);
    assert('F4: idempotent fallbackFieldCount',   r4a.fallbackFieldCount,   r4b.fallbackFieldCount);
    assert('F4: source clean after 2 calls',   iKb.cascades[0].__i18n, undefined);

    /* F5 — export: source has no __i18n after operational (safe to export as-is) */
    var eKb = makeMinimalKB();
    validateKBOperational(eKb);
    assert('F5: source exportable — no __i18n on entry', eKb.cascades[0].__i18n, undefined);

    /* F6 — structuredClone used when available */
    var usesStructuredClone = (typeof globalThis !== 'undefined' &&
                               typeof globalThis.structuredClone === 'function');
    var scKb = makeMinimalKB();
    validateKBOperational(scKb);
    assert('F6: clone path (structuredClone=' + usesStructuredClone + ') preserves non-mutation',
      scKb.cascades[0].__i18n, undefined);

    /* F7 — empty-string *_es triggers fill (missing-value semantics) */
    var f7Kb = makeMinimalKB();
    f7Kb.cascades[0].name_es = '';       /* explicit empty — should be treated as missing */
    f7Kb.cascades[1].ade_es  = '';
    var f7R = validateKBOperational(f7Kb);
    assert('F7: operational.ok = true with empty-string _es', f7R.ok, true);
    assert('F7: empty name_es filled (cascadeCount ≥ 1)', f7R.fallbackCascadeCount >= 1, true);
    assert('F7: fallbackByField.name_es counts empty-string entry',
      f7R.fallbackByField && (f7R.fallbackByField['name_es'] || 0) >= 1, true);

    /* F8 — whitespace-only *_es triggers fill */
    var f8Kb = makeMinimalKB();
    f8Kb.cascades[0].name_es = '   ';   /* whitespace-only — must be treated as missing */
    f8Kb.cascades[0].ade_es  = '\t';
    var f8R = validateKBOperational(f8Kb);
    assert('F8: operational.ok = true with whitespace _es', f8R.ok, true);
    assert('F8: whitespace name_es filled', f8R.fallbackByField && f8R.fallbackByField['name_es'] >= 1, true);
    assert('F8: whitespace ade_es filled',  f8R.fallbackByField && f8R.fallbackByField['ade_es']  >= 1, true);
    /* Confirm source is still whitespace (non-mutating) */
    assert('F8: source name_es still whitespace', f8Kb.cascades[0].name_es, '   ');

    /* F9 — fallbackByFieldIds are sorted deterministically */
    /* Build KB with IDs intentionally out of lexical order: ZZ before AA */
    var f9Kb = {
      version: '0.0.1-test',
      cascades: [
        { id: 'CC_ZZ', name_en: 'Z drug', index_drug_classes:['C'], index_drug_examples:['z'],
          ade_en:'Z ade', cascade_drug_examples:['zt'], confidence:'low', age_sensitivity:'low',
          risk_focus:['metabolic'], differential_hints:['h1','h2','h3'], appropriateness:'context_dependent' },
        { id: 'CC_AA', name_en: 'A drug', index_drug_classes:['C'], index_drug_examples:['a'],
          ade_en:'A ade', cascade_drug_examples:['at'], confidence:'low', age_sensitivity:'low',
          risk_focus:['metabolic'], differential_hints:['h1','h2','h3'], appropriateness:'context_dependent' }
      ]
    };
    var f9R = validateKBOperational(f9Kb);
    var f9Ids = f9R.fallbackByFieldIds && f9R.fallbackByFieldIds['name_es'];
    assert('F9: IDs sorted — CC_AA before CC_ZZ',
      f9Ids && f9Ids.length === 2 && f9Ids[0] === 'CC_AA' && f9Ids[1] === 'CC_ZZ', true);

    /* F10 — requireTranslations: true causes ok:false when fills applied */
    var f10R = validateKBOperational(makeMinimalKB(), { requireTranslations: true });
    assert('F10: requireTranslations + fills → ok = false', f10R.ok, false);
    assert('F10: errors mention requireTranslations',
      f10R.errors.some(function(e){ return e.indexOf('requireTranslations') === 0; }), true);
    assert('F10: error names the missing field',
      f10R.errors.some(function(e){ return /name_es|ade_es/.test(e); }), true);

    /* F11 — requireTranslations: true passes when all *_es present */
    var f11Kb = makeMinimalKB();
    /* Fill in all required ES fields explicitly */
    f11Kb.cascades[0].name_es = 'Fármaco A → EAM A → Tratamiento A';
    f11Kb.cascades[0].ade_es  = 'Efecto adverso alfa';
    f11Kb.cascades[1].ade_es  = 'Efecto adverso beta';
    var f11R = validateKBOperational(f11Kb, { requireTranslations: true });
    assert('F11: requireTranslations + no fills → ok = true', f11R.ok, true);
    assert('F11: fallbackFieldCount = 0 when all ES present', f11R.fallbackFieldCount, 0);
  })();
  console.groupEnd();

  /* ── Group G: reconcileDrugsWithCascades ─────────────────────────────── */
  console.group('G — Drug-cascade reconciliation');

  /* G1: drugs already present are NOT duplicated */
  var g1 = reconcileDrugsWithCascades(
    ['amlodipine'],
    [{ index_drug: 'Amlodipine', cascade_drug: 'furosemide' }]
  );
  assert('G1: existing drug not duplicated (case-insensitive)', g1.filter(function(d){
    return d.toLowerCase() === 'amlodipine';
  }).length, 1);
  assert('G1: cascade_drug added when missing', g1.indexOf('furosemide') >= 0, true);

  /* G2: empty drugs + cascade with both drugs → both back-filled */
  var g2 = reconcileDrugsWithCascades(
    [],
    [{ index_drug: 'amlodipino', cascade_drug: 'furosemida' }]
  );
  assert('G2: index_drug added when drugs empty', g2.indexOf('amlodipino') >= 0, true);
  assert('G2: cascade_drug added when drugs empty', g2.indexOf('furosemida') >= 0, true);
  assert('G2: length is 2', g2.length, 2);

  /* G3: ADE/symptom terms must NOT appear — cascade has no ADE field used */
  var g3 = reconcileDrugsWithCascades(
    [],
    [{ index_drug: 'amlodipino', cascade_drug: 'furosemida', ade_en: 'oedema' }]
  );
  assert('G3: ade_en "oedema" NOT in result', g3.indexOf('oedema'), -1);
  assert('G3: result length still 2',          g3.length, 2);

  /* G4: null / undefined drug fields are skipped gracefully */
  var g4 = reconcileDrugsWithCascades(
    [],
    [{ index_drug: null, cascade_drug: undefined }]
  );
  assert('G4: null/undefined drugs → empty result', g4.length, 0);

  /* G5: buildReport() diagnostics populated when cascades add drugs.
   * We use reconcileDrugsWithCascades directly (no live note needed). */
  var g5in  = [];
  var g5cas = [{ index_drug: 'metoprolol', cascade_drug: 'salbutamol' }];
  var g5out = reconcileDrugsWithCascades(g5in, g5cas);
  var g5cnt = g5out.length - g5in.length;
  assert('G5: inferredCount = 2 when both drugs back-filled', g5cnt, 2);

  /* G6: original input array is NOT mutated */
  var g6orig = ['atenolol'];
  var g6     = reconcileDrugsWithCascades(g6orig, [{ index_drug: 'bisoprolol', cascade_drug: 'furosemide' }]);
  assert('G6: original drugs array not mutated', g6orig.length, 1);
  assert('G6: returned array has all three',     g6.length,     3);

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

function isoDate() {
  return new Date().toISOString().split('T')[0];
}

/* Simple toast notification */
function showToast(message, type) {
  var container = document.getElementById('toast-container');
  if (!container) return;
  var toast = document.createElement('div');
  toast.className = 'toast ' + (type || 'info');
  toast.innerHTML = escHtml(message) +
    '<button class="toast-close" aria-label="Dismiss">&times;</button>';
  toast.querySelector('.toast-close').addEventListener('click', function () {
    toast.classList.add('hiding');
    setTimeout(function () { toast.remove(); }, 350);
  });
  container.appendChild(toast);
  setTimeout(function () {
    toast.classList.add('hiding');
    setTimeout(function () { toast.remove(); }, 350);
  }, 4000);
}

/* ============================================================
   Static UI string updater — refreshes HTML elements that are
   not part of the dynamically rendered step content when the
   language changes.
   ============================================================ */
function updateStaticUI() {
  /* Step nav labels */
  var stepLabels = [
    [1, 'nav_step1'], [2, 'nav_step2'], [3, 'nav_step3'],
    [4, 'nav_step4'], [5, 'nav_step5'], [6, 'nav_step6']
  ];
  stepLabels.forEach(function (pair) {
    var btn = document.querySelector('.step-btn[data-step="' + pair[0] + '"] .step-label');
    if (btn) btn.innerHTML = tUI(pair[1]);
  });

  /* Demo button in patient bar */
  var demoBtn = document.getElementById('btn-demo');
  if (demoBtn) demoBtn.innerHTML = '&#9654; ' + (currentLanguage === 'es' ? 'Probar demo' : 'Try demo');
}

/* ============================================================
   Event wiring
   ============================================================ */
function wireEvents() {
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
        state.kb.coreCascades = null;
        state.kb.vihModifiers = null;
        state.kb.ddiWatchlist = null;
        state.kb.clinicalModifiers = null;
        invalidateDetectedCascades();
        var statusEl = document.getElementById('kb-status');
        if (statusEl) statusEl.innerHTML = '<span class="kb-chip loading"><span class="spinner" style="width:12px;height:12px;border-width:2px;" aria-hidden="true"></span> ' + newMode + '&hellip;</span>';
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
    try { localStorage.setItem(LS_LANG_KEY, lang); } catch (e) { /* ignore */ }
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
    /* Update step counter / prev-next buttons */
    updateNavButtons(state.step);
    /* Re-render the current step so all text reflects the new language */
    renderStepContent(state.step);
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
        'Loading KB&hellip;</span>';
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

  } catch (err) {
    console.error('[App] Initialization failed:', err);

    /* Show visible error in the step content area */
    var container = document.getElementById('step-content');
    if (container) {
      container.innerHTML =
        '<div class="callout callout-danger">' +
          '<strong>&#9888; Application failed to initialize.</strong> ' +
          'Error: ' + escHtml(err.message) + '. ' +
          'Check the browser console for details.' +
        '</div>';
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
