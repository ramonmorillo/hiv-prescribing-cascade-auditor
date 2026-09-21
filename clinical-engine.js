'use strict';
/* ============================================================================
   HIV Prescribing Cascade Auditor — clinical-engine.js
   ============================================================================
   Pure clinical logic, deliberately free of any DOM/browser dependency:
     - normalization of clinical text and drug names
     - drug mention resolution (generic names, brands, fixed-dose combos)
     - extraction of active clinical problems (diagnoses/comorbidities)
     - extraction of simple clinical measurements (e.g. blood pressure)
     - prescribing-cascade evaluation with an explicit, traceable
       classification (never "confirmed" — always a graded, cautious label)
     - global medication alerts (anticholinergic/CNS-depressant burden, etc.)
       kept structurally separate from cascade findings

   Every function here takes its inputs explicitly (noteText, kb, ...) and
   returns plain data. Nothing here touches `window`, `document`, or any
   mutable module-level state — this is what makes the module runnable both
   in the browser (loaded before app.js, which owns all DOM/state concerns)
   and under plain Node for the automated test suite in tests/.

   KB shape expected by every function that takes a `kb` argument (same keys
   loadKB() in app.js already populates, plus the new `clinicalProblems`):
     {
       coreCascades, vihModifiers, ddiWatchlist, symptomDictionary,
       clinicalModifiers, adeTreatmentMap, drugDictionary, drugCombinations,
       clinicalProblems
     }
   ============================================================================ */

(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  }
  if (root) {
    root.ClinicalEngine = mod;
  }
})(
  typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : null),
  function () {

/* ============================================================
   0. Bilingual message catalog
   ------------------------------------------------------------
   The engine never hard-codes UI prose inline; every human-readable
   evidence/rationale string is looked up here by a stable `code`, so:
     (a) tests can assert on the stable `code` rather than fragile prose,
     (b) app.js (or any other consumer) can re-render the same evidence in
         either language without re-deriving it,
     (c) the set of possible reasons is enumerable and auditable.
   ============================================================ */
var MESSAGES = {
  problem_not_mentioned: {
    es: 'El problema clínico intermedio no aparece mencionado en la nota.',
    en: 'The intermediate clinical problem is not mentioned in the note.'
  },
  problem_negated: {
    es: 'El problema clínico intermedio aparece explícitamente negado en la nota.',
    en: 'The intermediate clinical problem is explicitly negated in the note.'
  },
  problem_chronic_or_prior: {
    es: 'El problema clínico intermedio se describe como antecedente/crónico, previo al fármaco índice.',
    en: 'The intermediate clinical problem is described as a prior/chronic condition, pre-dating the index drug.'
  },
  problem_suspected_only: {
    es: 'El problema clínico intermedio se menciona en términos de sospecha, no de forma confirmada.',
    en: 'The intermediate clinical problem is mentioned only as a suspicion, not confirmed.'
  },
  problem_active_explicit: {
    es: 'El problema clínico intermedio aparece mencionado como activo/de nueva aparición en la nota.',
    en: 'The intermediate clinical problem is mentioned as active/new-onset in the note.'
  },
  temporality_supportive: {
    es: 'La cronología descrita es compatible con una posible cascada terapéutica: el medicamento índice precede al problema clínico y al tratamiento posterior. La relación causal requiere validación profesional.',
    en: 'The chronology described is compatible with a possible prescribing cascade: the index medication precedes the clinical problem and subsequent treatment. The causal relationship requires professional validation.'
  },
  temporality_unknown: {
    es: 'La nota no aporta información cronológica suficiente para evaluar la secuencia.',
    en: 'The note does not provide enough chronological information to assess the sequence.'
  },
  alternative_indication_found: {
    es: 'La nota documenta una indicación alternativa conocida para el fármaco-cascada, independiente del fármaco índice.',
    en: 'The note documents a known alternative indication for the cascade drug, independent of the index drug.'
  },
  measurement_discordant: {
    es: 'La medición clínica aportada no alcanza el umbral diagnóstico habitual para el problema descrito; existe discordancia entre el dato objetivo y el diagnóstico consignado en la nota.',
    en: 'The clinical measurement provided does not reach the usual diagnostic threshold for the stated problem; there is a discordance between the objective data point and the diagnosis recorded in the note.'
  },
  measurement_supportive: {
    es: 'La medición clínica aportada es compatible con el umbral diagnóstico habitual para el problema descrito.',
    en: 'The clinical measurement provided is compatible with the usual diagnostic threshold for the stated problem.'
  },
  pharmacological_class_match_only: {
    es: 'Únicamente se ha detectado una coincidencia de clases farmacológicas (fármaco índice + fármaco potencialmente relacionado); no hay evidencia textual del problema intermedio ni de la cronología.',
    en: 'Only a pharmacological-class coincidence was detected (index drug + potentially related drug); there is no textual evidence of the intermediate problem or the chronology.'
  },
  duplicate_kb_rule_merged: {
    es: 'Señal consolidada: la base de conocimiento contenía una regla casi-duplicada para este mismo patrón, fusionada en auditoría.',
    en: 'Consolidated signal: the knowledge base contained a near-duplicate rule for this same pattern, merged during audit.'
  },
  problem_resolved: {
    es: 'El problema clínico intermedio consta como resuelto en la nota; no hay evidencia de que esté activo actualmente.',
    en: 'The intermediate clinical problem is recorded as resolved in the note; there is no evidence it is currently active.'
  },
  problem_contradiction: {
    es: 'La nota contiene afirmaciones contradictorias sobre este problema clínico que no pueden ordenarse cronológicamente; el resultado no está resuelto y requiere validación profesional.',
    en: 'The note contains contradictory statements about this clinical problem that cannot be chronologically ordered; the result is unresolved and requires professional validation.'
  },
  cascade_drug_predates_index: {
    es: 'El fármaco propuesto como respuesta a la cascada ya estaba pautado antes de que se iniciara el fármaco índice; no puede ser una respuesta a un efecto que aún no había ocurrido.',
    en: 'The drug proposed as the cascade response was already prescribed before the index drug was started; it cannot be a response to an effect that had not yet occurred.'
  },
  problem_predates_index: {
    es: 'El problema clínico intermedio ya estaba presente antes de que se iniciara el fármaco índice; la información disponible es incompatible con la secuencia temporal propuesta por esta regla.',
    en: 'The intermediate clinical problem was already present before the index drug was started; the available information is incompatible with the temporal sequence proposed by this rule.'
  },
  medication_indication_mismatch: {
    es: 'El fármaco propuesto como respuesta a la cascada tiene en esta nota una indicación explícita distinta e incompatible con el problema propuesto por esta regla; la indicación explícita prevalece sobre la inferencia farmacológica genérica.',
    en: 'The drug proposed as the cascade response has an explicit indication in this note that is different from and incompatible with the problem this rule proposes; the explicit indication takes precedence over the generic pharmacological inference.'
  }
};

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/* Common automated conclusion text. Rule-specific evidence remains in
 * MESSAGES, but every rule and output surface receives the same cautious
 * interpretation for a given classification. */
var CLASSIFICATION_MESSAGES = {
  supported_possible_cascade: {
    es: 'Secuencia temporal y farmacológica compatible con una posible cascada terapéutica. La relación causal requiere validación profesional.',
    en: 'Temporal and pharmacological sequence compatible with a possible prescribing cascade. The causal relationship requires professional validation.'
  },
  possible_but_incomplete: {
    es: 'Patrón compatible con una posible cascada terapéutica, pero faltan datos clínicos o temporales necesarios para evaluarla.',
    en: 'Pattern compatible with a possible prescribing cascade, but clinical or temporal data needed for assessment are missing.'
  },
  pharmacological_match_only: {
    es: 'Coincidencia farmacológica sin evidencia suficiente del problema intermedio o de la secuencia temporal.',
    en: 'Pharmacological match without sufficient evidence of the intermediate problem or temporal sequence.'
  },
  not_evaluable: {
    es: 'No es posible evaluar la posible cascada con la información disponible.',
    en: 'The possible prescribing cascade cannot be assessed with the available information.'
  },
  discarded: {
    es: 'La información disponible es incompatible con la secuencia propuesta por esta regla.',
    en: 'The available information is incompatible with the sequence proposed by this rule.'
  }
};

function classificationReason(classification, lang) {
  var entry = CLASSIFICATION_MESSAGES[classification] || CLASSIFICATION_MESSAGES.not_evaluable;
  return entry[lang] || entry.es;
}

function msg(code, lang) {
  var entry = MESSAGES[code];
  if (!entry) return code;
  return entry[lang] || entry.es || code;
}

/* ============================================================
   1. Text / drug-name normalization
   ============================================================ */

function getLocalizedField(obj, baseField, lang) {
  if (!obj) return '';
  var preferred = obj[baseField + '_' + lang];
  if (preferred && typeof preferred === 'string' && preferred.trim()) return preferred;
  var en = obj[baseField + '_en'];
  if (en && typeof en === 'string' && en.trim()) return en;
  var base = obj[baseField];
  if (base && typeof base === 'string' && base.trim()) return base;
  return '';
}

var CLINICAL_TYPO_CORRECTIONS = {
  'vral': 'viral',
  'izqueirdo': 'izquierdo',
  'izuqierdo': 'izquierdo',
  'dolro': 'dolor',
  'palapcion': 'palpacion',
  'sintomatologia': 'sintomatologia',
  'puñopercusion': 'punopercusion',
  'capo': 'comp',
  'q comp': '1 comp'
};

function normalizeClinicalText(text) {
  if (!text) return '';
  var corrected = text;
  Object.keys(CLINICAL_TYPO_CORRECTIONS).forEach(function (typo) {
    if (typo.indexOf(' ') === -1) return;
    var escaped = typo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    corrected = corrected.replace(new RegExp(escaped, 'gi'), CLINICAL_TYPO_CORRECTIONS[typo]);
  });
  Object.keys(CLINICAL_TYPO_CORRECTIONS).forEach(function (typo) {
    if (typo.indexOf(' ') !== -1) return;
    var escaped = typo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    corrected = corrected.replace(new RegExp('\\b' + escaped + '\\b', 'gi'), CLINICAL_TYPO_CORRECTIONS[typo]);
  });
  return corrected.replace(/[ \t]+/g, ' ');
}

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

function normalizeSymptomText(str) {
  if (!str) return '';
  var s = str.normalize('NFC').toLowerCase().normalize('NFD')
             .replace(/[̀-ͯ]/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

function hasText(value) {
  return !!(value && String(value).trim());
}

/** De-duplicates a string array while preserving first-seen order; drops
 * falsy entries. Shared by anything that builds an evidence/finding list
 * from multiple event mentions of the same concept. */
function uniqueStrings(arr) {
  var seen = {};
  return (arr || []).filter(function (s) {
    if (!s || seen[s]) return false;
    seen[s] = true;
    return true;
  });
}

/* ============================================================
   2. Drug mention resolver
   ------------------------------------------------------------
   Sources, in priority order (highest confidence last-writer-wins per the
   original design — 'high' confidence entries are never downgraded by a
   later 'medium' one):
     1. KB cascade example lists (core + VIH) — legacy bootstrap source.
     2. MANUAL_ALIASES — a short, deliberately reviewed list of abbreviations
        and SINGLE-INGREDIENT brand names only. Fixed-dose combination
        brands must NOT appear here (see drug_combinations.json below) —
        collapsing a combination brand to one ingredient here was the exact
        root cause of the "Dovato → dolutegravir only" defect.
     3. kb/drug_dictionary.json — canonical generic names + variants/brands.
     4. kb/drug_combinations.json — fixed-dose combination brands, expanded
        to ALL of their active ingredients at match time (not collapsed to
        a single canonical name).
   ============================================================ */

var MANUAL_ALIASES = {
  'azt': 'zidovudine',
  'tdf': 'tenofovir disoproxil fumarate',
  'dtg': 'dolutegravir',
  'kaletra': 'lopinavir/ritonavir',
  'prezista': 'darunavir',
  'rezolsta': 'darunavir/cobicistat',
  'symtuza': 'darunavir/cobicistat',
  'evotaz': 'atazanavir/cobicistat',
  'reyataz': 'atazanavir',
  'norvir': 'ritonavir',
  'isentress': 'raltegravir',
  'tivicay': 'dolutegravir'
  /* Deliberately NOT here: dovato, triumeq, juluca, kivexa, epzicom,
   * truvada, descovy — all fixed-dose combinations, handled exclusively via
   * drug_combinations.json so every active ingredient is preserved. */
};

function getIndexExamples(cascade) {
  return cascade.index_drug_examples || cascade.index_drugs_examples || [];
}
function getCascadeExamples(cascade) {
  return cascade.cascade_drug_examples || cascade.cascade_drugs_examples || [];
}

/** A cascade entry that has been merged into another during KB audit is
 * kept in the file for traceability but must never fire on its own. */
function isActiveCascadeEntry(cascade) {
  return !cascade || cascade.status !== 'merged';
}

function allCascadeEntries(kb) {
  var core = (kb.coreCascades && kb.coreCascades.cascades) || [];
  var vih = (kb.vihModifiers && kb.vihModifiers.art_related_cascades) || [];
  return core.concat(vih).filter(isActiveCascadeEntry);
}

function buildDrugResolver(kb) {
  var resolver = { byVariant: {}, variantPattern: null, combosByVariant: {} };

  function addVariant(rawVariant, canonical, drugClass, matchType, confidence) {
    var normVariant = normalizeDrugText(rawVariant);
    if (!normVariant || normVariant.length < 2) return;
    var current = resolver.byVariant[normVariant];
    if (!current || (current.confidence !== 'high' && confidence === 'high')) {
      resolver.byVariant[normVariant] = {
        variant: rawVariant, canonical: canonical, drug_class: drugClass || '',
        match_type: matchType, confidence: confidence
      };
    }
  }

  allCascadeEntries(kb).forEach(function (cascade) {
    var idxClass = cascade.index_drug_class ||
      (Array.isArray(cascade.index_drug_classes) ? cascade.index_drug_classes[0] : '') || '';
    var casClass = cascade.cascade_drug_class || '';

    getIndexExamples(cascade).forEach(function (drug) {
      addVariant(drug, drug, idxClass, 'exact', 'high');
      addVariant(drug.replace(/\//g, ' / '), drug, idxClass, 'combo', 'high');
      drug.split('/').forEach(function (part) { addVariant(part.trim(), drug, idxClass, 'combo', 'medium'); });
    });
    getCascadeExamples(cascade).forEach(function (drug) {
      addVariant(drug, drug, casClass, 'exact', 'high');
      addVariant(drug.replace(/\//g, ' / '), drug, casClass, 'combo', 'high');
      drug.split('/').forEach(function (part) { addVariant(part.trim(), drug, casClass, 'combo', 'medium'); });
    });
  });

  Object.keys(MANUAL_ALIASES).forEach(function (alias) {
    var canonical = MANUAL_ALIASES[alias];
    var canonicalMeta = resolver.byVariant[normalizeDrugText(canonical)] || null;
    addVariant(alias, canonical, canonicalMeta ? canonicalMeta.drug_class : '', 'alias', 'medium');
  });

  var dictEntries = (kb.drugDictionary && kb.drugDictionary.entries) || [];
  dictEntries.forEach(function (entry) {
    if (!entry.canonical) return;
    var drugClass = entry.drug_class || '';
    /* The curated dictionary is authoritative for display taxonomy; cascade
       classes describe rule roles and must not overwrite a medicine's class. */
    resolver.byVariant[normalizeDrugText(entry.canonical)] = {
      variant: entry.canonical, canonical: entry.canonical, drug_class: drugClass,
      match_type: 'dict', confidence: 'high'
    };
    (entry.variants || []).forEach(function (variant) {
      if (variant) resolver.byVariant[normalizeDrugText(variant)] = {
        variant: variant, canonical: entry.canonical, drug_class: drugClass,
        match_type: 'dict', confidence: 'high'
      };
    });
  });

  var combos = (kb.drugCombinations && kb.drugCombinations.combinations) || [];
  combos.forEach(function (combo) {
    if (!combo.brand || !Array.isArray(combo.activeIngredients) || !combo.activeIngredients.length) return;
    var aliases = [combo.brand].concat(combo.aliases || []);
    aliases.forEach(function (alias) {
      var normAlias = normalizeDrugText(alias);
      if (!normAlias || normAlias.length < 2) return;
      resolver.combosByVariant[normAlias] = combo;
      addVariant(alias, combo.activeIngredients[0], '', 'combo_brand', 'high');
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

function resolveDrugMentions(noteText, resolver) {
  if (!noteText || !noteText.trim()) return [];
  if (!resolver || !resolver.variantPattern) return [];

  var normalized = normalizeDrugText(noteText);
  var mentions = [];
  var seen = {};
  var match;

  while ((match = resolver.variantPattern.exec(normalized)) !== null) {
    var variant = (match[2] || '').trim();
    if (!variant) continue;

    var combo = resolver.combosByVariant && resolver.combosByVariant[variant];
    if (combo) {
      combo.activeIngredients.forEach(function (ingredient) {
        var normIngredient = normalizeDrugText(ingredient);
        var dedupeKey = normIngredient + '::' + match.index;
        if (seen[dedupeKey]) return;
        seen[dedupeKey] = true;
        var ingredientMeta = resolver.byVariant[normIngredient];
        mentions.push({
          mention: variant, canonical: ingredient,
          drug_class: (ingredientMeta && ingredientMeta.drug_class) || '',
          match_type: 'combo_brand', confidence: 'high', start_index: match.index,
          brand: combo.brand, brand_ingredients: combo.activeIngredients,
          brand_therapeutic_class_es: combo.therapeuticClass_es || '',
          brand_therapeutic_class_en: combo.therapeuticClass_en || ''
        });
      });
      continue;
    }

    var meta = resolver.byVariant[variant];
    if (!meta) continue;
    var dedupeKey2 = meta.canonical + '::' + match.index;
    if (seen[dedupeKey2]) continue;
    seen[dedupeKey2] = true;
    mentions.push({
      mention: variant, canonical: meta.canonical, drug_class: meta.drug_class || '',
      match_type: meta.match_type || 'normalized', confidence: meta.confidence || 'medium',
      start_index: match.index
    });
  }

  mentions.sort(function (a, b) { return a.start_index - b.start_index; });
  return mentions;
}

/* Medication assertion is deliberately evaluated at the mention, rather than
 * at drug-dictionary level.  The clause boundary at an adversative conjunction
 * prevents "no toma X, pero toma Y" from leaking negation into Y, while a
 * coordinated "X ni Y" remains in one clause and therefore negates both. */
function classifyMedicationMention(noteText, mention) {
  var text = noteText || '';
  var index = Math.max(0, mention.actual_start_index != null ? mention.actual_start_index : (mention.start_index || 0));
  var before = text.slice(0, index);
  var boundary = Math.max(before.lastIndexOf('.'), before.lastIndexOf(';'), before.lastIndexOf('\n'));
  var adversatives = /\bpero(?:\s+s[ií])?\b/gi;
  var adv;
  while ((adv = adversatives.exec(before)) !== null) boundary = Math.max(boundary, adv.index + adv[0].length);
  var clauseBefore = normalizeDrugText(before.slice(boundary + 1));
  var sentenceEnd = text.slice(index).search(/[.;\n]/);
  var sentence = normalizeDrugText(text.slice(boundary + 1, sentenceEnd < 0 ? text.length : index + sentenceEnd));

  /* Canonical medication-state vocabulary.  Keep this deliberately small
     and stable: every downstream consumer uses isActiveMedication(), rather
     than inventing its own interpretation of these values. */
  var assertion = 'affirmed', status = 'active', temporality = 'current';
  if (/\b(no|ni)\s+(toma|tomaba|recibe|recibia|usa|utiliza|esta tomando|est[aá] tomando)\b/.test(clauseBefore) ||
             /\bno\s+(?:toma|recibe|usa)[^.;]*\bni\b/.test(clauseBefore)) {
    assertion = 'negated'; status = 'not_taking'; temporality = 'current';
  } else if (/\b(nunca|jam[aá]s)\s+(?:se\s+)?(?:llego|lleg[oó])?\s*a?\s*(?:iniciar|iniciarlo|iniciarla|tomar|recibir)\b/.test(sentence) ||
             /\b(no\s+(?:se\s+)?inicio|no\s+(?:se\s+)?inici[oó]|no\s+iniciado|no\s+iniciada)\b/.test(sentence)) {
    assertion = 'negated'; status = 'never_started'; temporality = 'historical';
  } else if (/\bsi\s+(desarrolla|presenta|aparece|ocurre|desarrollara|desarrollar[aá])\b|\ben caso de\b/.test(clauseBefore) || /\b(podria|podr[ií]a|se valorara|se valorar[aá]|se plantea|se plantearia|se plantear[ií]a)\b/.test(sentence)) {
    assertion = /\bsi\s+(desarrolla|presenta|aparece|ocurre)\b/.test(clauseBefore) ? 'conditional' : 'hypothetical';
    status = 'conditional_future'; temporality = 'future';
  } else if (/\b(se )?(suspendio|suspendi[oó]|suspendido|suspendida|retirado|retirada|interrumpio|interrumpi[oó])\b/.test(sentence) ||
             /\b(tomo|tom[oó]|recibio|recibi[oó])\b/.test(clauseBefore) && /\bhasta\b/.test(sentence)) {
    assertion = 'affirmed'; status = 'discontinued'; temporality = 'historical';
  }
  return { assertion: assertion, status: status, temporality: temporality };
}

function medicationExclusionReason(m) {
  if (m.status === 'never_started') return 'never_started';
  if (m.assertion === 'negated') return 'explicit_current_negation';
  if (m.status === 'discontinued') return 'discontinued_or_historical_therapy';
  if (m.assertion === 'conditional' || m.assertion === 'hypothetical' || m.temporality === 'future') return 'future_conditional_or_hypothetical_mention';
  return 'not_currently_active';
}

function extractFutureMedicationCondition(noteText, mention) {
  var start = mention.actual_start_index != null ? mention.actual_start_index : mention.start_index || 0;
  var sentenceStart = Math.max(noteText.lastIndexOf('.', start), noteText.lastIndexOf('\n', start)) + 1;
  var endOffset = noteText.slice(start).search(/[.\n]/);
  var sentenceEnd = endOffset < 0 ? noteText.length : start + endOffset;
  var sentence = noteText.slice(sentenceStart, sentenceEnd).trim();
  var normalized = normalizeDrugText(sentence);
  if (!/\b(podria|se valorara|se plantea|se plantearia|futuro)\b/.test(normalized)) return null;
  var condition = sentence.match(/\bsi\s+([^.;]+)/i);
  return {
    assertion: 'conditional', status: 'conditional_future', temporality: 'future',
    condition: condition ? condition[0].trim() : null, evidence_span: sentence
  };
}

function isActiveMedication(medication) {
  return !!medication && medication.assertion === 'affirmed' && medication.status === 'active';
}

function drugFoundInNote(noteText, drug, resolver) {
  var target = normalizeDrugText(drug);
  return resolveDrugMentions(noteText, resolver).some(function (m) {
    return normalizeDrugText(m.canonical) === target;
  });
}

function extractDrugs(noteText, resolver) {
  if (!noteText || !noteText.trim()) return [];
  noteText = normalizeClinicalText(noteText);
  var seen = {};
  var result = [];
  resolveDrugMentions(noteText, resolver).forEach(function (mention) {
    var key = normalizeDrugText(mention.canonical);
    if (!seen[key]) { seen[key] = true; result.push(mention.canonical); }
  });
  return result;
}

/* ============================================================
   3. NLP reliability layer — negation / history / suspicion / temporality
   ============================================================ */

function findTermInNote(noteText, term) {
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
 * Like findTermInNote(), but returns EVERY non-overlapping occurrence of
 * `term` in `noteText`, not just the first. Needed to build a full event
 * history for a clinical concept — a note can affirm and later negate (or
 * vice versa) the same concept, and the pre-audit engine's "first match
 * wins" behaviour silently dropped every occurrence after the first.
 * @returns {Array<{index:number, length:number}>}
 */
function findAllTermOccurrences(noteText, term) {
  var normNote = (noteText && noteText.normalize) ? noteText.normalize('NFC') : (noteText || '');
  var results = [];
  var parts = term.split('/');
  for (var p = 0; p < parts.length; p++) {
    var part = parts[p].trim();
    if (!part) continue;
    var normPart = part.normalize ? part.normalize('NFC') : part;
    var escaped = normPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re;
    try {
      re = new RegExp('\\b' + escaped + '\\b', 'gi');
    } catch (e) {
      continue;
    }
    var m;
    while ((m = re.exec(normNote)) !== null) {
      results.push({ index: m.index, length: m[0].length });
      if (m[0].length === 0) re.lastIndex++; /* guard against zero-length match loops */
    }
  }
  results.sort(function (a, b) { return a.index - b.index; });
  /* De-duplicate overlapping matches from different `parts` (e.g. a
     combination term matching both its full form and a sub-part). */
  var deduped = [];
  results.forEach(function (r) {
    var last = deduped[deduped.length - 1];
    if (last && r.index < last.index + last.length) return;
    deduped.push(r);
  });
  return deduped;
}

/**
 * Classify a mention at [matchIndex, matchIndex+matchLength) into one of:
 *   'negated'   — explicitly denied ("no presenta", "niega", "negativo para")
 *   'history'   — antecedent/resolved/chronic-prior wording ("antecedente de",
 *                 "previo", "resuelto", "controlado")
 *   'suspected' — hedged wording ("posible", "sospecha de", "probable")
 *   'active'    — none of the above; taken at face value as currently stated
 * Never returns a diagnostic confirmation — 'active' means "stated as
 * present", not "confirmed by objective criteria" (that distinction is the
 * caller's job, e.g. via clinical measurement discordance).
 */
/**
 * Classify a mention at [matchIndex, matchIndex+matchLength) along TWO
 * INDEPENDENT axes, then derive a single `status` from their combination.
 *
 * This is the fix for the "No tenía antecedentes de hipertensión" defect:
 * the pre-audit version checked negation cues ("no") and historical cues
 * ("antecedentes de") as mutually exclusive, early-return branches, so a
 * phrase containing BOTH ("no tenía antecedentes de X" = X was historically
 * ABSENT, not a current denial of X) was classified identically to a bare
 * current negation ("no presenta X"). Detecting both axes independently and
 * then combining them is what lets the two be told apart.
 *
 *   assertion:   affirmed | negated | suspected
 *   temporality: historical | current
 *   status  (derived):
 *     negated  + historical -> 'absent'    (never had it / ausencia histórica)
 *     negated  + current    -> 'absent'    (does not currently have it)
 *     affirmed + historical -> 'active'    (chronic / antecedent — still an
 *                                            ongoing condition, just with a
 *                                            historical onset; temporal-order
 *                                            comparison against the index
 *                                            drug — see evaluateDrugDrugCascades
 *                                            — decides whether that predates
 *                                            a proposed new cascade)
 *     affirmed + current    -> 'active'
 *     *        + resolved-after cue        -> 'resolved'
 *     suspected              -> 'suspected'
 */
function classifyMention(noteText, matchIndex, matchLength) {
  var preRaw = noteText.slice(Math.max(0, matchIndex - 80), matchIndex);
  var preTokens = preRaw.trim().split(/[\s,;:()\.\!\?]+/).filter(Boolean).slice(-8);
  var preStr = preTokens.join(' ').toLowerCase();

  var postRaw = noteText.slice(matchIndex + matchLength, Math.min(noteText.length, matchIndex + matchLength + 60));
  var postTokens = postRaw.trim().split(/[\s,;:()\.\!\?]+/).filter(Boolean).slice(0, 3);
  var postStr = postTokens.join(' ').toLowerCase();

  var negBefore = [
    /\bno\b/, /\bnot\b/, /\bdenies\b/, /\bdenied\b/, /\bwithout\b/,
    /\bnegative\s+for\b/, /\bfree\s+of\b/, /\brule\s*out\b/, /\br\/o\b/, /\?/,
    /\bniega\b/, /\bsin\b/, /\bdescarta\b/, /\bnegativo\s+para\b/, /\bnegativa\s+para\b/,
    /\bausencia\s+de\b/, /\bno\s+presenta\b/, /\bno\s+refiere\b/, /\bno\s+hay\b/
  ];
  var suspectBefore = [
    /\bpossible\b/, /\bsuspected\b/, /\blikely\b/, /\bprobable\b/, /\bquery\b/,
    /\bposible\b/, /\bsospecha\s+de\b/, /\ba\s+descartar\b/
  ];
  var histBefore = [
    /\bresolved\b/, /\bimproved\b/, /\bprevious\b/, /\bhistory\s+of\b/, /\bhx\s+of\b/, /\bh\/o\b/,
    /\bprior\b/, /\bpast\b/, /\bused\s+to\b/, /\bformer(?:ly)?\b/, /\bold\b/, /\bchronic\b/,
    /\bantecedentes\s+de\b/, /\bantecedente\s+de\b/, /\bhistoria\s+de\b/, /\bap\s+de\b/,
    /\bprevio\b/, /\bprevia\b/, /\bpreviamente\b/, /\ben\s+el\s+pasado\b/, /\bcr[oó]nic[oa]\b/, /\bconocid[oa]\b/
  ];
  var resolvedAfter = [
    /\bresolved\b/, /\bimproved\b/, /\bcleared\b/, /\bgone\b/, /\babated\b/,
    /\bresuelto\b/, /\bresuelta\b/, /\bmejor[ií]a\b/, /\bmejorado\b/, /\bmejorada\b/,
    /\bcontrolado\b/, /\bcontrolada\b/, /\bcede\b/, /\bdesaparece\b/
  ];
  var negAfter = [/\bnegative\b/, /\bnegativo\b/, /\bnegativa\b/, /\bnegativos\b/, /\bnegativas\b/];

  var hasNeg = negBefore.some(function (re) { return re.test(preStr); }) ||
               negAfter.some(function (re) { return re.test(postStr); });
  var hasSuspect = suspectBefore.some(function (re) { return re.test(preStr); });
  var hasHist = histBefore.some(function (re) { return re.test(preStr); });
  var hasResolved = resolvedAfter.some(function (re) { return re.test(postStr); });

  var reasonParts = [];
  if (hasNeg) reasonParts.push('negation cue');
  if (hasSuspect) reasonParts.push('hedging cue');
  if (hasHist) reasonParts.push('historical cue');
  if (hasResolved) reasonParts.push('resolved cue');
  var reason = (reasonParts.length ? reasonParts.join('+') : 'no cue') +
    ' | before: "' + preTokens.slice(-4).join(' ') + '" | after: "' + postTokens.join(' ') + '"';

  if (hasResolved) {
    return { assertion: 'affirmed', temporality: 'historical', status: 'resolved', reason: reason };
  }
  if (hasSuspect) {
    return { assertion: 'suspected', temporality: hasHist ? 'historical' : 'current', status: 'suspected', reason: reason };
  }
  if (hasNeg) {
    return { assertion: 'negated', temporality: hasHist ? 'historical' : 'current', status: 'absent', reason: reason };
  }
  if (hasHist) {
    return { assertion: 'affirmed', temporality: 'historical', status: 'active', reason: reason };
  }
  return { assertion: 'affirmed', temporality: 'current', status: 'active', reason: '' };
}

/** Backward-compatible boolean view used by the ADE symptom-bridge pipeline
 * (kb_symptoms.json), which only ever needed active/not-active.
 *
 * Deliberately stricter than the clinical_problems status: an ADE symptom
 * ("dry mouth", "constipation"...) described only in historical terms
 * ("history of constipation") means the EPISODE is past, not currently
 * happening — unlike a chronic DISEASE described the same way ("antecedente
 * de hipertensión"), which conventionally still means an ongoing diagnosis.
 * detectGenericActiveProblems() keeps affirmed+historical as status:'active'
 * (with temporality:'historical' exposed separately) for that reason; this
 * function instead treats ANY historical temporality as not-currently-active,
 * matching how symptom-bridge cascades need "is this happening now". */
function isNegatedSymptom(noteText, matchIndex, matchLength) {
  var c = classifyMention(noteText, matchIndex, matchLength);
  return { negated: c.status === 'absent' || c.status === 'resolved' || c.temporality === 'historical', reason: c.reason };
}

function extractSentenceSnippet(text, index, length) {
  var start = index;
  while (start > 0 && !/[.,;:\n]/.test(text.charAt(start - 1))) start--;
  var end = index + length;
  while (end < text.length && !/[.,;\n]/.test(text.charAt(end))) end++;
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function findClinicalFinding(originalText, normalizedText, term) {
  var pos = findTermInNote(normalizedText, term);
  if (!pos) return null;
  var cls = classifyMention(normalizedText, pos.index, pos.length);
  return {
    status: cls.status,
    active: cls.status === 'active',
    reason: cls.reason,
    snippet: extractSentenceSnippet(originalText, pos.index, pos.length),
    index: pos.index
  };
}

function detectTimeCues(noteText, matchIndex) {
  var R = 40;
  var start = Math.max(0, matchIndex - R);
  var end = Math.min(noteText.length, matchIndex + R);
  var ctx = noteText.slice(start, end).toLowerCase();

  return {
    drugStartHint: (
      /\b(started|initiated|begin|began|since\s+starting|after\s+starting|on\s+\d|commenced)\b/.test(ctx) ||
      /\b(inicia|se\s+inicia|se\s+empez[oó]|tras\s+iniciar|al\s+iniciar|comienza|se\s+pauta)\b/.test(ctx) ||
      /\bdesde\s+(\d|ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sept?(?:iembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)/.test(ctx) ||
      /\bsince\s+\d/.test(ctx)
    ),
    symptomNewHint: (
      /\b(since|after|worsened|new|recent|developed|onset|appearing|presenting\s+with|new[- ]onset)\b/.test(ctx) ||
      /\b(nuevo|nueva|reciente|recientemente|empeora|presenta|aparece|desde\s+hace|de\s+nueva\s+aparici[oó]n)\b/.test(ctx)
    ),
    treatmentAddedHint: (
      /\b(added|given|prescribed|initiated|started|commenced|prn\s+started|increased)\b/.test(ctx) ||
      /\b(se\s+a[nñ]ade|se\s+pauta|se\s+prescribe|se\s+inicia|a\s+demanda|prn)\b/.test(ctx)
    ),
    chronicHint: (
      /\b(chronic|long[- ]term|longstanding|long\s+standing|baseline|ongoing|persistent|established|years|months|pre[- ]existing)\b/.test(ctx) ||
      /\b(cr[oó]nic[oa]|de\s+base|habitual|desde\s+hace\s+a[nñ]os|de\s+a[nñ]os|largo\s+tiempo|de\s+larga\s+evoluci[oó]n)\b/.test(ctx)
    ),
    details: ctx.trim().slice(0, 80)
  };
}

var MONTHS_ES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7,
  ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12
};
var MONTHS_EN = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12
};

/**
 * Extract an explicit, literally-stated date from the SENTENCE containing a
 * mention — "desde 2019", "desde mayo de 2026", "en agosto de 2026" — as a
 * comparable numeric value (year*100+month, or year*100 when only a year is
 * stated). Scoped to the current sentence (previous/next '.' or newline)
 * rather than a fixed character window: Spanish clinical narrative typically
 * states the date once, often at the very start of the sentence ("En agosto
 * de 2026 presenta... se inicia enalapril"), so a short fixed window before
 * the mention would miss it while a long one would risk bleeding into an
 * unrelated adjacent sentence. Deliberately narrow otherwise: only matches
 * an EXPLICIT year or month name; never infers or guesses a date from
 * context. Used to order medication starts and problem onsets against each
 * other (see evaluateDrugDrugCascades's temporal-order check) without
 * inventing chronology the note doesn't state.
 * @returns {{year:number, month:number|null, value:number, raw:string, index:number}|null}
 */
function extractDateNear(noteText, matchIndex, matchLength) {
  var sentStart = matchIndex;
  while (sentStart > 0 && !/[.\n]/.test(noteText.charAt(sentStart - 1))) sentStart--;
  var sentEnd = matchIndex + matchLength;
  while (sentEnd < noteText.length && !/[.\n]/.test(noteText.charAt(sentEnd))) sentEnd++;
  var start = sentStart;
  var ctx = noteText.slice(sentStart, sentEnd);
  var monthNames = Object.keys(MONTHS_ES).concat(Object.keys(MONTHS_EN))
    .sort(function (a, b) { return b.length - a.length; }).join('|');

  /* Year (+ optional month): "desde 2019", "en agosto de 2026". */
  var reYear = new RegExp('\\b(desde|en|since|in|inicio|onset)\\s+(?:el\\s+mes\\s+de\\s+)?(' + monthNames + ')?\\s*(?:de\\s+|of\\s+)?(\\d{4})\\b', 'i');
  var m = reYear.exec(ctx);
  if (m) {
    var monthName = m[2] ? m[2].toLowerCase() : null;
    var month = monthName ? (MONTHS_ES[monthName] || MONTHS_EN[monthName] || null) : null;
    var year = parseInt(m[3], 10);
    if (year >= 1900 && year <= 2100) {
      return { year: year, month: month, value: year * 100 + (month || 0), raw: m[0].trim(), index: start + m.index };
    }
  }

  /* Month only, no year stated — e.g. "En enero no presentaba...", "En
     marzo se diagnostica...". It remains a weak month-only value unless an
     explicitly written year elsewhere in the note can anchor it. */
  var reMonthOnly = new RegExp('\\b(desde|en|since|in|inicio|onset)\\s+(' + monthNames + ')\\b', 'i');
  var m2 = reMonthOnly.exec(ctx);
  if (m2) {
    var monthName2 = m2[2].toLowerCase();
    var month2 = MONTHS_ES[monthName2] || MONTHS_EN[monthName2] || null;
    if (month2) {
      /* A month-only event is commonly written after one fully dated event:
         "En enero de 2026 ... En marzo ...".  Anchor it to the closest
         explicitly stated year in the note.  This is not a clinical-date
         invention: the returned object records that the year was inherited,
         and it is used only for relative ordering within this note. */
      var yearMatches = [];
      var yearRe = /\b(19|20|21)\d{2}\b/g;
      var ym;
      while ((ym = yearRe.exec(noteText)) !== null) {
        yearMatches.push({ year: parseInt(ym[0], 10), index: ym.index });
      }
      var anchor = yearMatches.sort(function (a, b) {
        return Math.abs(a.index - (start + m2.index)) - Math.abs(b.index - (start + m2.index));
      })[0];
      return {
        year: anchor ? anchor.year : null, month: month2,
        value: anchor ? anchor.year * 100 + month2 : month2,
        raw: m2[0].trim(), index: start + m2.index,
        year_inherited_from_context: !!anchor
      };
    }
  }

  return null;
}

/* ============================================================
   4. Symptom bridge extraction (kb_symptoms.json — ADE symptom dictionary)
   ============================================================ */

function buildSynonymMap(symptoms) {
  var map = {};
  (symptoms || []).forEach(function (sym) {
    var allTerms = [sym.term].concat(sym.synonyms || []);
    allTerms.forEach(function (t) {
      var key = normalizeSymptomText(t);
      if (key && !map[key]) map[key] = sym.term;
    });
  });
  return map;
}

function extractSymptoms(noteText, kb) {
  if (!noteText || !noteText.trim()) return [];
  noteText = normalizeClinicalText(noteText);
  var symptoms = (kb.symptomDictionary && kb.symptomDictionary.symptoms) || [];
  var normalizedNote = normalizeSymptomText(noteText);
  var synonymMap = buildSynonymMap(symptoms);
  var detected = [];

  symptoms.forEach(function (sym) {
    var allTerms = [sym.term].concat(sym.synonyms || []);
    var matchResult = null;
    var matchedTerm = null;
    for (var ti = 0; ti < allTerms.length; ti++) {
      var pos = findTermInNote(noteText, allTerms[ti]);
      if (pos) { matchResult = pos; matchedTerm = allTerms[ti]; break; }
      var normTerm = normalizeSymptomText(allTerms[ti]);
      if (normTerm) {
        var normPos = findTermInNote(normalizedNote, normTerm);
        if (normPos) { matchResult = normPos; matchedTerm = allTerms[ti]; break; }
      }
    }
    if (!matchResult) return;

    var cls = classifyMention(noteText, matchResult.index, matchResult.length);
    var canonicalTerm = synonymMap[normalizeSymptomText(matchedTerm)] || sym.term;

    /* An ADE symptom described only in historical terms ("history of
       constipation") is a past episode, not a currently active one — see
       isNegatedSymptom()'s docstring for why this differs from how a
       chronic disease's historical phrasing is treated. */
    detected.push({
      id: sym.id, term: canonicalTerm, matched_term: matchedTerm,
      category: sym.category || '', cascade_relevance: sym.cascade_relevance || '',
      active: cls.status === 'active' && cls.temporality !== 'historical',
      status: cls.status, reason: cls.reason,
      startIndex: matchResult.index
    });
  });

  return detected;
}

/* ============================================================
   5. Active clinical problems (kb/{prod,dev}/clinical_problems.json)
   ------------------------------------------------------------
   Two complementary sources:
     (a) generic, data-driven problems (hypertension, heart failure,
         diabetes, GERD, osteoarthritis, Parkinson...) from
         kb.clinicalProblems — this is the piece that was entirely absent
         before this audit (see KB_REFERENCE / CHANGELOG).
     (b) the pre-existing hand-curated urologic/renal pattern, kept as-is
         (it uses anchor+support term combination logic that doesn't fit
         the generic single-keyword-list shape, and was working correctly
         before this audit — no reason to touch it).
   ============================================================ */

/**
 * Reconcile a concept's full list of textual mentions (events, in textual
 * order) into a single current-state summary.
 *
 * Ordering preference:
 *   1. If every event has the same status, no conflict — use the most
 *      informative one (prefer one carrying an explicit date).
 *   2. If events disagree and at least one carries an explicit/relative
 *      date, the event with the LATEST date wins — unless two events tie at
 *      the same latest date with different statuses, which is a genuine
 *      contradiction.
 *   3. If none carries a date, fall back to textual order ONLY when the
 *      first event is clearly historical-temporality and the last is not
 *      (the "was absent historically, now affirmed" pattern — Prueba I).
 *   4. Otherwise: do not guess. Mark the concept as a contradiction
 *      requiring professional validation (Prueba J) rather than arbitrarily
 *      picking a side.
 *
 * Never discards the raw events — every mention stays available on
 * `.events` for full traceability (Fase 2, point 3: "no elimines menciones
 * anteriores").
 */
function reconcileProblemEvents(events) {
  if (!events.length) return null;

  var firstActiveDate = null;
  events.forEach(function (e) {
    if (e.status === 'active' && e.date && (!firstActiveDate || e.date.value < firstActiveDate.value)) {
      firstActiveDate = e.date;
    }
  });

  function finalize(base, extra) {
    return Object.assign({}, base, { first_active_date: firstActiveDate, events: events }, extra || {});
  }

  if (events.length === 1) {
    return finalize(events[0], { contradiction: false });
  }

  var statuses = events.map(function (e) { return e.status; })
    .filter(function (v, i, a) { return a.indexOf(v) === i; });

  if (statuses.length === 1) {
    var withDate = events.filter(function (e) { return e.date; });
    var chosenSame = withDate.length ? withDate[withDate.length - 1] : events[events.length - 1];
    return finalize(chosenSame, { contradiction: false });
  }

  var dated = events.filter(function (e) { return e.date; });
  if (dated.length) {
    dated.sort(function (a, b) { return a.date.value - b.date.value; });
    var latest = dated[dated.length - 1];
    var conflictAtMax = dated.filter(function (e) { return e.date.value === latest.date.value && e.status !== latest.status; });
    if (conflictAtMax.length > 1) {
      return finalize(events[events.length - 1], {
        status: 'unknown', assertion: 'unknown', temporality: 'undetermined', contradiction: true,
        evidence_span: events.map(function (e) { return e.evidence_span; }).join(' // ')
      });
    }
    return finalize(latest, { contradiction: false, resolved_by: 'explicit_date' });
  }

  var first = events[0];
  var last = events[events.length - 1];
  if (first.temporality === 'historical' && last.temporality !== 'historical') {
    return finalize(last, { contradiction: false, resolved_by: 'textual_order' });
  }

  return finalize(events[events.length - 1], {
    status: 'unknown', assertion: 'unknown', temporality: 'undetermined', contradiction: true,
    evidence_span: events.map(function (e) { return e.evidence_span; }).join(' // ')
  });
}

/** Category slug -> localized label, for the small handful of coarse
 * buckets used in kb/clinical_problems.json. Falls back to the raw slug
 * (Title Cased) for any category not in this list, so an unmapped value is
 * degraded gracefully rather than throwing or showing nothing. */
var PROBLEM_CATEGORY_LABELS = {
  cardiovascular: { es: 'Cardiovascular', en: 'Cardiovascular' },
  metabolic: { es: 'Metabólico', en: 'Metabolic' },
  gastrointestinal: { es: 'Gastrointestinal', en: 'Gastrointestinal' },
  musculoskeletal: { es: 'Musculoesquelético', en: 'Musculoskeletal' },
  neurological: { es: 'Neurológico', en: 'Neurological' }
};
function problemCategoryLabel(category, lang) {
  var entry = PROBLEM_CATEGORY_LABELS[category];
  if (entry) return entry[lang] || entry.es;
  if (!category) return lang === 'en' ? 'Other' : 'Otro';
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** Maps the reconciled temporal-event status/assertion onto the UI's
 * pre-existing certainty vocabulary (confirmed/suspected/symptom/rule_out/
 * negated — see app.js CERTAINTY_COLOR and tUI certainty_* strings). This
 * is a DISPLAY-layer relabeling only: it never changes activeProblems'
 * own status/assertion/temporality fields, which remain the source of
 * truth for cascade reasoning. */
function problemCertaintyForDisplay(status) {
  if (status === 'active') return 'confirmed'; /* explicitly stated in the note */
  if (status === 'suspected') return 'suspected';
  if (status === 'absent') return 'negated';
  if (status === 'resolved') return 'negated'; /* no longer current, same display bucket as absent */
  return 'suspected'; /* 'unknown' — prudent default, never overclaim */
}

function detectGenericActiveProblems(noteText, kb, lang) {
  if (!noteText || !noteText.trim()) return [];
  lang = lang || 'es';
  var original = noteText;
  var normalized = normalizeSymptomText(noteText);
  var entries = (kb.clinicalProblems && kb.clinicalProblems.problems) || [];
  var results = [];

  entries.forEach(function (entry) {
    var chronicKeywords = (entry.chronic_keywords_es || []).concat(entry.chronic_keywords_en || []);
    var plainKeywords = (entry.keywords_es || []).concat(entry.keywords_en || []);

    /* Collect every occurrence of every keyword variant (not just the
       first) as its own event — this is the fix for "no tenía antecedentes
       de hipertensión" silently shadowing a later, separate, affirmed
       mention of the same concept (see docs/clinical-engine-fix-audit.md
       §1.1). Chronic-specific phrasing ("hipertensión arterial esencial",
       "HTA previa") forces temporality=historical for that event even when
       classifyMention's own nearby-word cues wouldn't catch it, since the
       phrase itself asserts chronicity. */
    var rawEvents = [];
    function collect(keywordList, isChronicList) {
      keywordList.forEach(function (kw) {
        var normKw = normalizeSymptomText(kw);
        if (!normKw) return;
        findAllTermOccurrences(normalized, normKw).forEach(function (pos) {
          var cls = classifyMention(normalized, pos.index, pos.length);
          var status = cls.status;
          var temporality = cls.temporality;
          if (isChronicList && status === 'active') temporality = 'historical';
          var date = extractDateNear(original, pos.index, pos.length);
          rawEvents.push({
            pos: pos, keyword: kw, is_chronic_phrasing: !!isChronicList,
            assertion: cls.assertion, temporality: temporality, status: status, reason: cls.reason,
            evidence_span: extractSentenceSnippet(original, pos.index, pos.length),
            date: date, matched_keyword: kw
          });
        });
      });
    }
    collect(chronicKeywords, true);
    collect(plainKeywords, false);

    if (!rawEvents.length) return;

    /* De-duplicate events at (near-)identical positions found via more than
       one keyword variant (e.g. "hipertension" matching both a plain and a
       chronic-phrase keyword at the same spot). */
    rawEvents.sort(function (a, b) { return a.pos.index - b.pos.index; });
    var events = [];
    rawEvents.forEach(function (e) {
      var last = events[events.length - 1];
      if (last && e.pos.index < last.pos.index + last.pos.length) return;
      events.push(e);
    });

    var reconciled = reconcileProblemEvents(events);
    if (!reconciled) return;

    /* UI-compat fields (Step 3 "Clasificación" screen, app.js renderProblemCard):
       that renderer pre-dates the Fase 2 multi-event/temporal rewrite and
       still reads problem/certainty/category_label/evidence[]/negatedFindings[]
       — added here rather than forking a second problem-detection path, so
       CaseModel.activeProblems (cascade reasoning, tests) and the Step 3
       display stay backed by the exact same reconciled event data. */
    var displayEvidence = uniqueStrings(events.filter(function (e) {
      return e.status === 'active' || e.status === 'resolved' || e.status === 'suspected';
    }).map(function (e) { return e.evidence_span; }));
    var displayNegated = uniqueStrings(events.filter(function (e) {
      return e.status === 'absent';
    }).map(function (e) { return e.evidence_span; }));

    results.push({
      id: entry.id,
      concept_es: entry.concept_es,
      concept_en: entry.concept_en,
      category: entry.category || '',
      status: reconciled.status, /* 'active' | 'absent' | 'resolved' | 'suspected' | 'unknown' */
      assertion: reconciled.assertion,
      temporality: reconciled.temporality,
      contradiction: !!reconciled.contradiction,
      matched_keyword: reconciled.matched_keyword,
      is_chronic_phrasing: !!reconciled.is_chronic_phrasing,
      evidence_span: reconciled.evidence_span,
      source: 'explicit',
      confidence: reconciled.contradiction ? 'low' : (reconciled.status === 'active' ? 'high' : 'medium'),
      /* Step 3 display fields — see comment above. */
      problem: lang === 'en' ? (entry.concept_en || entry.concept_es) : (entry.concept_es || entry.concept_en),
      category_label: problemCategoryLabel(entry.category, lang),
      certainty: problemCertaintyForDisplay(reconciled.status),
      evidence: displayEvidence,
      negatedFindings: displayNegated,
      measurement_type: entry.measurement_type || null,
      diagnostic_note_es: entry.diagnostic_note_es || '',
      diagnostic_note_en: entry.diagnostic_note_en || '',
      alternative_indication_for_drug_examples: entry.alternative_indication_for_drug_examples || [],
      source_cascade_ids: entry.source_cascade_ids || [],
      references: entry.references || [],
      /* Full event history — never discarded, per Fase 2 point 3. */
      events: events.map(function (e) {
        return {
          originalText: e.evidence_span, assertion: e.assertion, temporality: e.temporality,
          status: e.status, evidenceSpan: e.evidence_span, date: e.date ? e.date.raw : null,
          startDate: e.date ? e.date.value : null, source: 'explicit', confidence: e.status === 'active' ? 'high' : 'medium'
        };
      }),
      /* Earliest date at which this problem was affirmed active — used to
         compare against a candidate index drug's own start date (Fase 4:
         "la hipertensión era previa al AINE" reduces/discards plausibility). */
      first_active_date: reconciled.first_active_date
    });
  });

  return results;
}

/** Ported as-is from the pre-audit app.js: anchor + support term combination
 * logic for a urologic/renal work-up pattern. Kept separate from the
 * generic keyword-list detector above because its logic (anchors are
 * sufficient alone; support terms only raise certainty in combination)
 * doesn't fit the generic single-keyword-list shape. */
function detectUrologicRenalProblem(noteText, lang, resolver) {
  if (!noteText || !noteText.trim()) return null;
  var original = noteText;
  var text = normalizeSymptomText(noteText);

  var ANCHOR_TERMS = ['flanco', 'colico renal', 'litiasis', 'hematuria', 'obstruccion urinaria', 'expulsion de calculo'];
  var SUPPORT_TERMS = [
    'urocultivo', 'sistematico', 'ecografia abdominal', 'ecografia renal',
    'disuria', 'polaquiuria', 'tenesmo', 'retencion urinaria', 'sintomatologia miccional'
  ];

  var evidence = [];
  var negatedFindings = [];
  var hasAnchor = false;
  var supportCount = 0;

  ANCHOR_TERMS.forEach(function (term) {
    var f = findClinicalFinding(original, text, term);
    if (!f) return;
    if (f.active) { hasAnchor = true; evidence.push(f.snippet); }
    else negatedFindings.push(f.snippet);
  });
  SUPPORT_TERMS.forEach(function (term) {
    var f = findClinicalFinding(original, text, term);
    if (!f) return;
    if (f.active) { supportCount++; evidence.push(f.snippet); }
    else negatedFindings.push(f.snippet);
  });

  var punopercusion = findClinicalFinding(original, text, 'punopercusion');
  if (punopercusion) {
    if (punopercusion.active) { supportCount++; evidence.push(punopercusion.snippet); }
    else negatedFindings.push(punopercusion.snippet);
  }
  var tiraOrina = findClinicalFinding(original, text, 'tira de orina');
  if (tiraOrina) {
    if (tiraOrina.active) { supportCount++; evidence.push(tiraOrina.snippet); }
    else negatedFindings.push(tiraOrina.snippet);
  }

  /* Tamsulosin: contextual signal ONLY — never sufficient by itself. */
  if (drugFoundInNote(original, 'tamsulosin', resolver) && (hasAnchor || supportCount > 0)) {
    supportCount++;
    evidence.push(lang === 'es' ? 'tamsulosina prescrita' : 'tamsulosin prescribed');
  }

  if (!hasAnchor && supportCount === 0) return null;

  var certainty = hasAnchor ? (supportCount > 0 ? 'suspected' : 'symptom') : 'suspected';
  var problem = hasAnchor
    ? (lang === 'es' ? 'Dolor de flanco / problema urológico-renal en estudio' : 'Flank pain / urologic-renal problem under study')
    : (lang === 'es' ? 'Problema urológico/renal en estudio' : 'Urologic/renal problem under study');

  function uniqueInOrder(arr) {
    var seen = {};
    return arr.filter(function (s) { return seen[s] ? false : (seen[s] = true); });
  }

  return {
    id: 'CP_UROLOGIC_RENAL',
    category: 'urologic_renal_problem',
    category_label: lang === 'es' ? 'Urológico/Renal' : 'Urologic/Renal',
    problem: problem,
    status: certainty === 'symptom' ? 'active' : 'suspected',
    certainty: certainty,
    evidence: uniqueInOrder(evidence),
    negatedFindings: uniqueInOrder(negatedFindings),
    source: 'inferred'
  };
}

function detectActiveProblems(noteText, kb, lang, resolver) {
  if (!noteText || !noteText.trim()) return [];
  var corrected = normalizeClinicalText(noteText);
  var problems = detectGenericActiveProblems(corrected, kb, lang);
  var urologic = detectUrologicRenalProblem(corrected, lang || 'es', resolver || buildDrugResolver(kb));
  if (urologic) problems.push(urologic);
  return problems;
}

/* ============================================================
   6. Clinical measurements (e.g. blood pressure readings)
   ------------------------------------------------------------
   Deliberately narrow scope: only extracts a value + unit + the raw
   evidence span. Interpretation (e.g. "does this reach the diagnostic
   threshold for hypertension?") is kept as a SEPARATE field, never baked
   into the extracted value itself — per the requirement that a measurement
   must never be silently converted into a confirmed diagnosis.
   ============================================================ */

function extractClinicalMeasurements(noteText) {
  if (!noteText || !noteText.trim()) return [];
  var measurements = [];
  var bpContextRe = /\b(ta|pa|ba|tensi[oó]n(?:\s+arterial)?|presi[oó]n(?:\s+arterial)?|blood\s+pressure|bp)\b/i;
  var bpValueRe = /\b(\d{2,3})\s*\/\s*(\d{2,3})\s*(mm\s*hg|mmhg)?\b/gi;
  var match;
  while ((match = bpValueRe.exec(noteText)) !== null) {
    var sys = parseInt(match[1], 10);
    var dia = parseInt(match[2], 10);
    if (sys < 60 || sys > 260 || dia < 30 || dia > 200 || sys <= dia) continue; /* implausible as BP */
    var ctxStart = Math.max(0, match.index - 30);
    var ctx = noteText.slice(ctxStart, match.index);
    var hasUnit = !!match[3];
    if (!hasUnit && !bpContextRe.test(ctx)) continue; /* avoid matching unrelated N/M ratios */

    measurements.push({
      type: 'blood_pressure',
      value: { systolic: sys, diastolic: dia },
      unit: 'mmHg',
      evidence_span: extractSentenceSnippet(noteText, match.index, match[0].length),
      index: match.index,
      /* Interpretation kept explicitly separate from the raw value. Uses the
         2023/2024 ESC/ESH threshold (>=140/90) as a single-reading numeric
         reference only — NOT a diagnostic confirmation, which requires
         repeated readings per guideline. */
      interpretation: {
        meets_single_reading_hypertension_threshold: (sys >= 140 || dia >= 90),
        note_es: 'Lectura única; no diagnostica hipertensión por sí sola (requiere confirmación en visitas separadas o MAPA/AMPA).',
        note_en: 'Single reading; does not by itself diagnose hypertension (requires confirmation on separate visits or ABPM/HBPM).'
      }
    });
  }
  return measurements;
}

/**
 * Best-effort extraction of dose/frequency/PRN for a drug mention. Scans a
 * bounded window right after the mention (where Spanish clinical notes
 * conventionally place posology: "naproxeno 550 mg cada 8 horas") and a
 * slightly wider window on both sides for "si precisa"/"PRN"/"a demanda".
 * Returns null fields rather than guessing when nothing matches — a missing
 * dose/frequency must stay missing, never be invented.
 */
function extractDosePosology(noteText, matchIndex, matchLength) {
  /* Clinical notes in this tool's expected format list one drug per line
     (bulleted). Confining the scan window to the current line prevents a
     dose/frequency/PRN cue from a NEIGHBOURING drug's line from bleeding
     into this one (e.g. "si precisa" on the previous line, or a dose on
     the next line right after a drug with no explicit mg of its own). */
  var lineEnd = noteText.indexOf('\n', matchIndex + matchLength);
  if (lineEnd === -1) lineEnd = noteText.length;
  var lineStart = noteText.lastIndexOf('\n', matchIndex);
  lineStart = lineStart === -1 ? 0 : lineStart + 1;

  var after = noteText.slice(matchIndex + matchLength, Math.min(lineEnd, matchIndex + matchLength + 70));
  var around = noteText.slice(Math.max(lineStart, matchIndex - 20), Math.min(lineEnd, matchIndex + matchLength + 70));

  var doseMatch = after.match(/\b(\d+(?:[.,]\d+)?)\s*(mg|mcg|microgramos|g|ui|comp(?:rimidos?)?|c[aá]psulas?|ml)\b/i);
  var freqMatch = after.match(/\b(cada\s+\d+\s*(?:horas?|h)|c\/\d+\s*h|una?\s+vez\s+al\s+d[ií]a|al\s+d[ií]a|\d+\s*veces?\s+al\s+d[ií]a|\/24h|\/12h|\/8h)\b/i);
  var prnMatch = /\b(si\s+precisa|si\s+necesario|a\s+demanda|prn|as\s+needed|when\s+needed)\b/i.test(around);

  return {
    dose: doseMatch ? (doseMatch[1] + ' ' + doseMatch[2]) : null,
    frequency: freqMatch ? freqMatch[1] : null,
    prn: prnMatch
  };
}

/* ============================================================
   7. Alternative-indication check (kb/{prod,dev}/clinical_problems.json)
   ============================================================ */

/**
 * @param {string} currentCascadeId  id of the cascade currently being
 *   evaluated. A clinical_problems.json entry that is itself the documented
 *   intermediate problem FOR THIS cascade (source_cascade_ids includes it)
 *   is never counted as an "alternative" indication for it — that would be
 *   circular (e.g. hypertension cannot simultaneously be CC001's own
 *   intermediate ADE and an "independent alternative reason" for enalapril
 *   in the very same cascade).
 */
function detectAlternativeIndication(noteText, cascadeDrug, kb, activeProblems, currentCascadeId) {
  if (!hasText(noteText) || !hasText(cascadeDrug)) return { found: false, reason_es: '', reason_en: '', chronic: false };
  var normCascade = normalizeDrugText(cascadeDrug);

  for (var i = 0; i < (activeProblems || []).length; i++) {
    var p = activeProblems[i];
    if (p.status === 'absent' || p.status === 'resolved') continue;
    if (currentCascadeId && Array.isArray(p.source_cascade_ids) && p.source_cascade_ids.indexOf(currentCascadeId) !== -1) continue;
    var drugs = (p.alternative_indication_for_drug_examples || []).map(normalizeDrugText);
    if (drugs.indexOf(normCascade) === -1) continue;
    return {
      found: true,
      reason_es: p.concept_es,
      reason_en: p.concept_en,
      chronic: p.temporality === 'historical' || p.is_chronic_phrasing
    };
  }
  return { found: false, reason_es: '', reason_en: '', chronic: false };
}

/* ============================================================
   8. Global medication alerts (kb/{prod,dev}/kb_clinical_modifiers.json)
   ------------------------------------------------------------
   FIX vs pre-audit app.js: every modifier's `affects` field is now read
   and enforced. A modifier only attaches to a cascade signal when that
   cascade's risk_focus/id intersects `affects` (or `affects` explicitly
   says 'all_cascades' AND the modifier is genuinely patient-level, e.g.
   age/frailty/renal/hepatic/polypharmacy — never drug-specific burden
   scores like anticholinergic/CNS-depressant load, which are ALWAYS kept
   as standalone alerts, never injected into an unrelated cascade card).
   ============================================================ */

/* CM006 (anticholinergic burden) is superseded by scoreAnticholinergicBurden()
 * below, which uses a real, sourced, per-drug scoring table
 * (kb/anticholinergic_burden_scale.json) instead of a keyword trigger that
 * fires the whole alert on any single mention and then lists every drug in
 * the note as a "contributor" — see docs/clinical-engine-fix-audit.md §1.3.
 * CM006 itself is kept in kb_clinical_modifiers.json (not silently deleted)
 * but is excluded from BOTH modifier buckets below so it never fires under
 * its old keyword-trigger behaviour. CM007 (CNS depressant burden) still
 * uses the keyword-trigger mechanism, but drugs_involved is now restricted
 * to the mentions that actually matched one of ITS keywords (see
 * matched_keywords below), not every drug in the note. */
var SUPERSEDED_MODIFIER_IDS = ['CM006'];
var DRUG_SPECIFIC_MODIFIER_IDS = ['CM007']; /* CNS depressant burden */

function detectClinicalContextModifiers(noteText, kb) {
  if (!noteText || !noteText.trim()) return [];
  var modifiers = (kb.clinicalModifiers && kb.clinicalModifiers.clinical_modifiers) || [];
  if (!modifiers.length) return [];
  var normalizedNote = normalizeDrugText(noteText);
  var matched = [];
  modifiers.forEach(function (mod) {
    if (SUPERSEDED_MODIFIER_IDS.indexOf(mod.id) !== -1) return;
    var keywords = [].concat((mod.trigger_context && mod.trigger_context.keywords_en) || [],
                              (mod.trigger_context && mod.trigger_context.keywords_es) || []);
    var matchedKeywords = [];
    for (var ki = 0; ki < keywords.length; ki++) {
      var kw = normalizeDrugText(keywords[ki]);
      if (kw && normalizedNote.indexOf(kw) !== -1) matchedKeywords.push(keywords[ki]);
    }
    if (matchedKeywords.length) matched.push(Object.assign({}, mod, { matched_keywords: matchedKeywords }));
  });
  return matched;
}

/**
 * Split matched modifiers into:
 *   - patientLevelModifiers: apply as a priority-upgrade context note to
 *     EVERY cascade (age, frailty, renal/hepatic impairment, polypharmacy,
 *     fall risk, CV risk, dementia) — these describe the PATIENT, not one
 *     specific drug pair, so "affects all cascades" is a legitimate reading
 *     of the KB's own `affects` field for them.
 *   - globalAlerts: drug-burden scores (CNS depressant load) that are
 *     properties of the CURRENT DRUG LIST as a whole, never of one cascade —
 *     these become their own entries in CaseModel.globalMedicationAlerts and
 *     are NEVER merged into a cascade card's text.
 */
function classifyMatchedModifiers(matched) {
  var patientLevel = [];
  var globalAlerts = [];
  matched.forEach(function (mod) {
    if (DRUG_SPECIFIC_MODIFIER_IDS.indexOf(mod.id) !== -1) {
      globalAlerts.push(mod);
    } else {
      patientLevel.push(mod);
    }
  });
  return { patientLevel: patientLevel, globalAlerts: globalAlerts };
}

/**
 * Fase 6 — real, sourced anticholinergic burden scoring using
 * kb/anticholinergic_burden_scale.json (ACB scale, Boustani et al. 2008).
 * Only mentions matching a scored entry become contributors; a drug absent
 * from the table is never assumed anticholinergic. Wording adapts to the
 * number of contributors — "cumulative"/"elevated" language is only used
 * with 2+ contributors and a total reaching the disclosed threshold; a
 * single contributor gets a prudent, non-alarmist phrasing instead.
 */
function scoreAnticholinergicBurden(mentions, kb) {
  var scaleData = kb.anticholinergicBurdenScale || {};
  var scaleEntries = scaleData.entries || [];
  if (!scaleEntries.length) return null; /* scale not loaded: not evaluable, never guess */

  var scaleByCanonical = {};
  scaleEntries.forEach(function (e) { scaleByCanonical[normalizeDrugText(e.canonical)] = e; });

  var contributors = [];
  var seen = {};
  (mentions || []).forEach(function (m) {
    var key = normalizeDrugText(m.canonical);
    if (seen[key]) return;
    var entry = scaleByCanonical[key];
    if (!entry) return;
    seen[key] = true;
    contributors.push({ canonical: m.canonical, score: entry.score, drug_class: entry.drug_class || '' });
  });

  if (!contributors.length) return { contributors: [], total_score: 0 };

  var total = contributors.reduce(function (sum, c) { return sum + c.score; }, 0);
  var CLINICALLY_RELEVANT_THRESHOLD = 3; /* ACB total >=3 is the threshold Boustani et al. use for clinical relevance */

  return {
    contributors: contributors,
    total_score: total,
    threshold: CLINICALLY_RELEVANT_THRESHOLD,
    meets_threshold: total >= CLINICALLY_RELEVANT_THRESHOLD,
    scale_name_es: scaleData.scale_name_es || 'Escala ACB',
    scale_name_en: scaleData.scale_name_en || 'ACB Scale',
    references: scaleData.references || []
  };
}

function applyPatientLevelModifiers(signal, patientLevelModifiers) {
  if (!patientLevelModifiers.length) return signal;
  var CONFIDENCE_UPGRADE = { low: 'medium', medium: 'high', high: 'high' };
  var upgraded = Object.assign({}, signal);
  var contextNotesEs = [];
  var contextNotesEn = [];
  patientLevelModifiers.forEach(function (mod) {
    if (!mod.effect || !mod.effect.priority_upgrade) return;
    var current = (upgraded.confidence || 'low').toLowerCase();
    upgraded.confidence = CONFIDENCE_UPGRADE[current] || current;
    if (mod.message_es) contextNotesEs.push('[' + mod.name_es + '] ' + mod.message_es);
    if (mod.message_en) contextNotesEn.push('[' + mod.name_en + '] ' + mod.message_en);
    if (!upgraded.patient_context_modifiers) upgraded.patient_context_modifiers = [];
    upgraded.patient_context_modifiers.push(mod.id);
  });
  upgraded.patient_context_note_es = contextNotesEs.join(' | ');
  upgraded.patient_context_note_en = contextNotesEn.join(' | ');
  return upgraded;
}

function buildGlobalMedicationAlerts(noteText, kb, mentions) {
  var matched = detectClinicalContextModifiers(noteText, kb);
  var split = classifyMatchedModifiers(matched);

  /* CM007 (CNS-depressant burden): drugs_involved is restricted to the
     mentions that actually matched one of the modifier's own trigger
     keywords — not the full drug list — the same class of bug already
     fixed for the retired CM006 keyword-trigger path. */
  var alerts = split.globalAlerts.map(function (mod) {
    var drugsInvolved = (mentions || []).filter(function (m) {
      var mCanon = normalizeDrugText(m.canonical || '');
      var mText = normalizeDrugText(m.mention || m.canonical || '');
      return (mod.matched_keywords || []).some(function (kw) {
        var nkw = normalizeDrugText(kw);
        if (!nkw) return false;
        return mCanon.indexOf(nkw) !== -1 || nkw.indexOf(mCanon) !== -1 ||
               mText.indexOf(nkw) !== -1 || nkw.indexOf(mText) !== -1;
      });
    }).map(function (m) { return m.canonical; });

    return {
      id: mod.id,
      type: 'drug_burden',
      name_es: mod.name_es,
      name_en: mod.name_en,
      message_es: mod.message_es,
      message_en: mod.message_en,
      drugs_involved: drugsInvolved,
      references: mod.references || [],
      rule_id: mod.id
    };
  });

  /* Fase 6 — real ACB-scale anticholinergic burden alert, replacing the
     retired CM006 keyword trigger. Wording never claims a "cumulative"/
     multi-drug effect with a single contributor, and never claims
     "elevated burden" below the disclosed threshold. */
  var acb = scoreAnticholinergicBurden(mentions, kb);
  if (acb && acb.contributors && acb.contributors.length) {
    var multi = acb.contributors.length >= 2;
    var list = acb.contributors.map(function (c) { return c.canonical + ' (ACB ' + c.score + ')'; }).join(', ');
    var nameEs, nameEn, messageEs, messageEn;
    if (multi) {
      nameEs = 'Carga anticolinérgica acumulada';
      nameEn = 'Cumulative anticholinergic burden';
      messageEs = 'Carga anticolinérgica acumulada detectada: ' + list + ' (puntuación ACB total = ' +
        acb.total_score + ', umbral de relevancia clínica de la escala ≥' + acb.threshold +
        '). El efecto acumulado de varios fármacos con actividad anticolinérgica definida aumenta el riesgo ' +
        'de confusión, retención urinaria, estreñimiento y caídas, especialmente en personas mayores.';
      messageEn = 'Cumulative anticholinergic burden detected: ' + list + ' (total ACB score = ' +
        acb.total_score + ', scale clinical-relevance threshold ≥' + acb.threshold +
        '). The cumulative effect of several drugs with definite anticholinergic activity increases the risk ' +
        'of confusion, urinary retention, constipation, and falls, especially in older adults.';
    } else {
      nameEs = 'Fármaco con actividad anticolinérgica definida (ACB 3)';
      nameEn = 'Drug with definite anticholinergic activity (ACB 3)';
      messageEs = 'Fármaco con actividad anticolinérgica definida detectado: ' + list +
        '. Vigilar efectos anticolinérgicos (confusión, retención urinaria, estreñimiento, sequedad de boca), ' +
        'especialmente en personas mayores. No se identifican otros fármacos con actividad anticolinérgica ' +
        'definida en esta nota: no procede describir una carga acumulada por polimedicación anticolinérgica.';
      messageEn = 'Drug with definite anticholinergic activity detected: ' + list +
        '. Monitor for anticholinergic effects (confusion, urinary retention, constipation, dry mouth), ' +
        'especially in older adults. No other drugs with definite anticholinergic activity are identified in ' +
        'this note: cumulative anticholinergic-burden language does not apply.';
    }
    alerts.push({
      id: 'ACB_SCORE',
      type: 'anticholinergic_burden',
      name_es: nameEs,
      name_en: nameEn,
      message_es: messageEs,
      message_en: messageEn,
      drugs_involved: acb.contributors.map(function (c) { return c.canonical; }),
      contributors: acb.contributors,
      total_score: acb.total_score,
      threshold: acb.threshold,
      meets_threshold: acb.meets_threshold,
      scale_name_es: acb.scale_name_es,
      scale_name_en: acb.scale_name_en,
      references: acb.references || [],
      rule_id: 'ACB_SCORE'
    });
  }

  return { alerts: alerts, patientLevelModifiers: split.patientLevel };
}

/* ============================================================
   9. Duplicate suppression
   ============================================================ */

/**
 * Fase 5 — single centralized check for "does every entity a rule/alert
 * requires actually appear in this note", used everywhere a DDI warning or
 * similar multi-drug alert is about to be shown, so no component has to
 * re-implement (and potentially get wrong) this logic independently.
 *
 * @param {Array<Array<string>>} requiredGroups  conjunctive-normal-form drug
 *   requirement: EVERY group must have AT LEAST ONE of its members present
 *   (group = alternative drugs satisfying the same requirement, e.g.
 *   ["simvastatin","lovastatin"] — either one is enough; two separate
 *   single-member groups mean both are independently required, e.g.
 *   VIH003's [["metformin"]] combined with its own already-guaranteed
 *   index drug). An empty `requiredGroups` array means "not yet reviewed
 *   for this check" and is treated as automatically satisfied (unchanged,
 *   pre-audit behaviour) — see kb_cascade_registry.md for which rules still
 *   need this review.
 * @param {string[]} presentCanonicals  canonical drug names resolved from
 *   the note (state.kb-independent — just the plain list).
 * @param {string[]} [ownCascadeExamples]  the rule's own cascade_drugs_examples
 *   (e.g. VIH003's metformin/sitagliptin/liraglutide/enalapril/atorvastatin).
 *   When a required drug is ALSO one of these — i.e. it can itself be the
 *   candidate cascade_drug picked for some signal generated from this same
 *   rule — presence must be scoped to `matchedCascadeDrug` rather than "is
 *   it anywhere in the note", or the warning bleeds from the one relevant
 *   candidate onto every unrelated candidate the same rule produces (e.g.
 *   VIH003's dolutegravir–metformin dosing warning appearing on an
 *   unrelated atorvastatin candidate just because metformin happens to be
 *   present elsewhere in the note). A required drug absent from this list
 *   is a genuine third party (e.g. VIH001's simvastatin/lovastatin, never a
 *   member of its own rosuvastatin/pravastatin/... cascade_drugs_examples)
 *   and keeps the unscoped, note-wide presence check.
 * @param {string} [matchedCascadeDrug]  the specific cascade_drug matched
 *   for the signal being evaluated right now.
 */
function allRequiredEntitiesPresent(requiredGroups, presentCanonicals, ownCascadeExamples, matchedCascadeDrug) {
  if (!requiredGroups || !requiredGroups.length) return true;
  var normPresent = (presentCanonicals || []).map(normalizeDrugText);
  var normOwnExamples = (ownCascadeExamples || []).map(normalizeDrugText);
  var normMatchedCascadeDrug = normalizeDrugText(matchedCascadeDrug || '');
  return requiredGroups.every(function (group) {
    return (group || []).some(function (drug) {
      var normDrug = normalizeDrugText(drug);
      if (normOwnExamples.indexOf(normDrug) !== -1) return normDrug === normMatchedCascadeDrug;
      return normPresent.indexOf(normDrug) !== -1;
    });
  });
}

function parseInteractionParticipants(value) {
  return (value || '').replace(/\([^)]*\)/g, '').split(/\s*\/\s*|\s*,\s*/)
    .map(function (v) { return normalizeDrugText(v); }).filter(Boolean);
}

/* DDI activation is a single, auditable gateway. Ingredient rules require an
 * exact canonical participant on both sides; class matching is only available
 * to rules explicitly marked class_based. */
function evaluateCurrentInteractions(kb, activeMedications) {
  var meds = activeMedications || [];
  var names = meds.map(function (m) { return normalizeDrugText(m.normalized_name); });
  var classes = meds.map(function (m) { return normalizeDrugText(m.drug_class); });
  return (((kb || {}).ddiWatchlist || {}).interactions || []).filter(function (rule) {
    var scope = rule.match_scope || 'ingredient_specific';
    if (scope === 'class_based') {
      return classes.indexOf(normalizeDrugText(rule.drug_a_class)) !== -1 &&
        classes.indexOf(normalizeDrugText(rule.drug_b_class)) !== -1;
    }
    if (scope === 'regimen_based') return false; // requires a dedicated regimen matcher
    return parseInteractionParticipants(rule.drug_a).some(function (n) { return names.indexOf(n) !== -1; }) &&
      parseInteractionParticipants(rule.drug_b).some(function (n) { return names.indexOf(n) !== -1; });
  }).map(function (rule) {
    var participants = names.filter(function (n) {
      return parseInteractionParticipants(rule.drug_a).concat(parseInteractionParticipants(rule.drug_b)).indexOf(n) !== -1;
    });
    return Object.assign({}, rule, { match_scope: rule.match_scope || 'ingredient_specific', active_participants: participants });
  });
}

function getRecommendationPresentation(classification, rule, professionalValidation) {
  var actionEs = getLocalizedField(rule || {}, 'recommended_first_action', 'es') || getLocalizedField(rule || {}, 'clinical_note', 'es') || '';
  var actionEn = getLocalizedField(rule || {}, 'recommended_first_action', 'en') || getLocalizedField(rule || {}, 'clinical_note', 'en') || '';
  if (professionalValidation === 'confirmed') {
    return { mode: 'validated_action', applicable: true, action_es: actionEs, action_en: actionEn, theoretical_es: '', theoretical_en: '' };
  }
  if (classification === 'supported_possible_cascade') {
    return { mode: classification, applicable: true, action_es: actionEs, action_en: actionEn, theoretical_es: '', theoretical_en: '' };
  }
  var textEs = classification === 'discarded'
    ? 'No procede intervención por esta señal con la información disponible.'
    : classification === 'not_evaluable'
      ? 'No evaluable: deben aportarse los datos esenciales ausentes antes de proponer una intervención.'
      : classification === 'pharmacological_match_only'
        ? 'Coincidencia farmacológica de baja certeza: documentar el problema intermedio y una cronología compatible antes de evaluarla.'
        : 'Posible señal incompleta: verificar el problema intermedio, la indicación y la cronología antes de considerar cambios terapéuticos.';
  var textEn = classification === 'discarded'
    ? 'No intervention is indicated for this signal with the available information.'
    : classification === 'not_evaluable'
      ? 'Not evaluable: obtain the missing essential data before proposing an intervention.'
      : classification === 'pharmacological_match_only'
        ? 'Low-certainty pharmacological match: document the intermediate problem and compatible chronology before assessment.'
        : 'Possible incomplete signal: verify the intermediate problem, indication and chronology before considering treatment changes.';
  return { mode: classification, applicable: false, action_es: textEs, action_en: textEn, theoretical_es: actionEs, theoretical_en: actionEn };
}

function confidenceRank(conf) { return conf === 'high' ? 3 : conf === 'medium' ? 2 : 1; }
function priorityRank(priority) { return priority === 'alta' ? 3 : priority === 'intermedia' ? 2 : 1; }
function classificationRank(c) {
  var order = { supported_possible_cascade: 5, possible_but_incomplete: 4, pharmacological_match_only: 3, not_evaluable: 2, discarded: 1 };
  return order[c] || 0;
}

/**
 * Fase 8 — explicit, non-hardcoded priority criteria for "Principales
 * intervenciones sugeridas". A recommendation is only surfaced as a leading
 * intervention when the SYSTEM'S OWN automated case assessment
 * (signal.classification) found it actionable for THIS patient — never for
 * a pharmacological-coincidence-only, not-evaluable, or discarded signal.
 * This is the fix for the audit's bug #8: a discarded cascade's KB action
 * text (e.g. VIH003's "switch the INSTI") was leaking into the top-
 * interventions summary purely because it happened to be one of few
 * possibleCascades entries, with no check on whether the system itself
 * still stood behind that signal for this specific case.
 *
 * Ordering within the actionable set is preserved from `signals`'
 * incoming order (callers are expected to have already sorted by
 * classificationRank/confidence, as buildReport() does), so the most
 * actionable classification still comes first; this function only FILTERS
 * and de-duplicates, it never re-orders.
 *
 * @param {Array} signals  possibleCascades-shaped entries (need
 *   .classification, .recommended_action_es, .recommended_action_en)
 * @param {string} lang  'es' | 'en'
 * @param {number} [limit=3]
 * @returns {string[]} deduplicated, non-empty recommendation strings
 */
var ACTIONABLE_CLASSIFICATIONS = ['supported_possible_cascade', 'possible_but_incomplete'];
function selectTopInterventions(signals, lang, limit) {
  limit = typeof limit === 'number' ? limit : 3;
  var seen = {};
  var out = [];
  (signals || []).forEach(function (c) {
    if (ACTIONABLE_CLASSIFICATIONS.indexOf(c.classification) === -1) return;
    var presentation = c.recommendation_presentation;
    var text = presentation
      ? (lang === 'en' ? presentation.action_en : presentation.action_es)
      : ((lang === 'en' ? c.recommended_action_en : c.recommended_action_es) || '');
    var key = text.trim().toLowerCase();
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(text);
  });
  return limit > 0 ? out.slice(0, limit) : out;
}

function suppressDuplicateSignals(signals) {
  if (!signals || signals.length < 2) return signals;
  var groups = {};
  signals.forEach(function (sig) {
    /* Equivalent means the same rule, clinical bridge and actual medication
       pair.  Different rules which happen to use the same two drugs are not
       duplicates and must retain their independent rationale/tracing. */
    var key = (sig.rule_id || sig.cascade_id || '') + '|' + (sig.signal_type || '') + '|' +
      normalizeDrugText(sig.ade_en || sig.ade_es || '') + '|' +
      normalizeDrugText(sig.index_drug || '') + '|' + normalizeDrugText(sig.cascade_drug || '');
    if (!groups[key]) groups[key] = [];
    groups[key].push(sig);
  });
  var result = [];
  Object.keys(groups).forEach(function (key) {
    var group = groups[key];
    if (group.length === 1) { result.push(group[0]); return; }
    group.sort(function (a, b) {
      var classDiff = classificationRank(b.classification) - classificationRank(a.classification);
      if (classDiff !== 0) return classDiff;
      var confDiff = confidenceRank(b.confidence) - confidenceRank(a.confidence);
      if (confDiff !== 0) return confDiff;
      var aSpec = a.signal_type === 'symptom_bridge' ? 1 : 0;
      var bSpec = b.signal_type === 'symptom_bridge' ? 1 : 0;
      return bSpec - aSpec;
    });
    var winner = group[0];
    winner.suppressed_duplicates = group.slice(1).map(function (s) { return s.cascade_id; });
    result.push(winner);
  });
  /* A symptom bridge is a fallback, not a second clinical card, when its
     dictionary entry explicitly names the active drug-drug rule and both
     signals resolve to the same canonical medication pair.  Pair equality
     alone is deliberately insufficient: separate rules can describe
     different clinical problems for the same medicines. */
  var retained = [];
  result.forEach(function (sig) {
    if (sig.signal_type !== 'symptom_bridge') { retained.push(sig); return; }
    var linked = sig.linked_rule_ids || [];
    var indexCanonical = normalizeDrugText((sig.drug_resolution && sig.drug_resolution.index &&
      sig.drug_resolution.index.canonical) || sig.index_drug || '');
    var cascadeCanonical = normalizeDrugText((sig.drug_resolution && sig.drug_resolution.cascade &&
      sig.drug_resolution.cascade.canonical) || sig.cascade_drug || '');
    var primary = result.find(function (candidate) {
      if (candidate.signal_type !== 'drug_drug' || linked.indexOf(candidate.rule_id) === -1) return false;
      var candidateIndex = normalizeDrugText((candidate.drug_resolution && candidate.drug_resolution.index &&
        candidate.drug_resolution.index.canonical) || candidate.index_drug || '');
      var candidateCascade = normalizeDrugText((candidate.drug_resolution && candidate.drug_resolution.cascade &&
        candidate.drug_resolution.cascade.canonical) || candidate.cascade_drug || '');
      return candidateIndex === indexCanonical && candidateCascade === cascadeCanonical;
    });
    if (!primary) { retained.push(sig); return; }
    primary.evidence = primary.evidence || {};
    primary.evidence.symptom_bridge_provenance = primary.evidence.symptom_bridge_provenance || [];
    primary.evidence.symptom_bridge_provenance.push({
      rule_id: sig.rule_id,
      symptom: sig.ade_en || sig.ade_es || '',
      evidence: sig.evidence || {},
      classification: sig.classification
    });
    primary.provenance = primary.provenance || [];
    primary.provenance.push({ source: 'symptom_bridge', rule_id: sig.rule_id });
    primary.suppressed_duplicates = (primary.suppressed_duplicates || []).concat([sig.cascade_id]);
  });
  return retained;
}

/** Rank candidates without deleting any of them.  Patient-specific temporal
 * evidence is considered before the KB confidence, and a medication whose
 * explicitly documented indication matches this rule receives the strongest
 * tie-break.  Later compatible drugs in the same sequence are retained and
 * labelled as intensification rather than collapsed as duplicates. */
function prioritizeCascadeCandidates(signals) {
  var candidates = (signals || []).slice();
  var groups = {};
  candidates.forEach(function (signal) {
    var key = (signal.rule_id || signal.cascade_id || '') + '|' + normalizeDrugText(signal.index_drug || '');
    if (!groups[key]) groups[key] = [];
    groups[key].push(signal);
  });
  Object.keys(groups).forEach(function (key) {
    var compatible = groups[key].filter(function (signal) {
      return signal.classification === 'supported_possible_cascade' || signal.classification === 'possible_but_incomplete';
    }).sort(function (a, b) {
      var ad = a.evidence && a.evidence.temporal_order && a.evidence.temporal_order.cascade_date;
      var bd = b.evidence && b.evidence.temporal_order && b.evidence.temporal_order.cascade_date;
      return (ad ? ad.value : Number.MAX_SAFE_INTEGER) - (bd ? bd.value : Number.MAX_SAFE_INTEGER);
    });
    compatible.forEach(function (signal, index) {
      signal.candidate_role = index === 0 ? 'initial_response' : 'subsequent_intensification';
    });
  });
  candidates.forEach(function (signal) {
    var temporal = signal.evidence && signal.evidence.temporal_order;
    var linked = signal.evidence && signal.evidence.explicit_indication_compatible;
    signal.candidate_priority_score = classificationRank(signal.classification) * 100 +
      (temporal && temporal.status === 'supportive' ? 20 : 0) + (linked ? 10 : 0) +
      confidenceRank(signal.confidence);
  });
  return candidates.sort(function (a, b) {
    return b.candidate_priority_score - a.candidate_priority_score;
  });
}

/* ============================================================
   10. Cascade evaluation — the core fix
   ------------------------------------------------------------
   Five-level classification (never "confirmed"):
     supported_possible_cascade | possible_but_incomplete |
     pharmacological_match_only | not_evaluable | discarded
   See MESSAGES above and KB_REFERENCE.md for the decision rationale.
   ============================================================ */

function findCascadeEntry(cascadeId, kb) {
  var all = allCascadeEntries(kb);
  for (var i = 0; i < all.length; i++) if (all[i].id === cascadeId) return all[i];
  return null;
}

function findCascadeEntryForSignal(signal, kb) {
  if (signal.signal_type !== 'symptom_bridge') return findCascadeEntry(signal.cascade_id, kb);
  var all = allCascadeEntries(kb);
  var normIndex = normalizeDrugText(signal.index_drug);
  var normCascade = normalizeDrugText(signal.cascade_drug);
  for (var i = 0; i < all.length; i++) {
    var kbEntry = all[i];
    var idxMatch = getIndexExamples(kbEntry).some(function (d) { return normalizeDrugText(d) === normIndex; });
    var casMatch = getCascadeExamples(kbEntry).some(function (d) { return normalizeDrugText(d) === normCascade; });
    if (idxMatch && casMatch) return kbEntry;
  }
  return null;
}

/** Look up the ade_treatment_map.json entry linked to a given cascade id
 * (via source_cascade_ids), falling back to a loose ade_en text match when
 * no explicit link exists. This is the piece that existed in the KB
 * (ade_treatment_map.json) but was never wired into detection before this
 * audit — see KB_REFERENCE.md. */
function findAdeTreatmentEntry(cascade, kb) {
  var entries = (kb.adeTreatmentMap && kb.adeTreatmentMap.ade_treatment_map) || [];
  var byId = entries.find(function (e) {
    return Array.isArray(e.source_cascade_ids) && e.source_cascade_ids.indexOf(cascade.id) !== -1;
  });
  if (byId) return byId;
  var adeEn = (cascade.ade_en || '').toLowerCase().trim();
  if (!adeEn) return null;
  return entries.find(function (e) { return (e.ade_en || '').toLowerCase().trim() === adeEn; }) || null;
}

/** Find the clinical_problems.json entry (if any) linked to this cascade,
 * used for chronic/alternative-indication/measurement-discordance context. */
function findClinicalProblemForCascade(cascade, kb) {
  var problems = (kb.clinicalProblems && kb.clinicalProblems.problems) || [];
  return problems.find(function (p) {
    return Array.isArray(p.source_cascade_ids) && p.source_cascade_ids.indexOf(cascade.id) !== -1;
  }) || null;
}

/** Verify whether the intermediate problem for `cascade` is actually
 * mentioned/active in the note. Returns null when the ADE has no known
 * synonym list to check against (ade_treatment_map has no matching entry) —
 * callers must treat null as "cannot verify" (→ pharmacological_match_only),
 * never as "verified absent". */
function verifyIntermediateProblem(noteText, cascade, kb, activeProblems) {
  var problemEntry = findClinicalProblemForCascade(cascade, kb);
  if (problemEntry) {
    var fromActive = (activeProblems || []).find(function (p) { return p.id === problemEntry.id; });
    if (fromActive) {
      return {
        checked: true, status: fromActive.status, temporality: fromActive.temporality,
        contradiction: !!fromActive.contradiction, evidence_span: fromActive.evidence_span,
        first_active_date: fromActive.first_active_date || null,
        source: 'clinical_problems', linked_problem_id: problemEntry.id,
        concept_es: problemEntry.concept_es || '', concept_en: problemEntry.concept_en || '',
        measurement_type: problemEntry.measurement_type || null,
        diagnostic_note_es: problemEntry.diagnostic_note_es || '',
        diagnostic_note_en: problemEntry.diagnostic_note_en || ''
      };
    }
    return { checked: true, status: 'none', evidence_span: '', source: 'clinical_problems', linked_problem_id: problemEntry.id,
      concept_es: problemEntry.concept_es || '', concept_en: problemEntry.concept_en || '' };
  }

  var atmEntry = findAdeTreatmentEntry(cascade, kb);
  if (!atmEntry) return { checked: false, status: 'unknown', evidence_span: '', source: 'none', linked_problem_id: null };

  var synonyms = [].concat(atmEntry.ade_synonyms_es || [], atmEntry.ade_synonyms_en || []);
  var normalized = normalizeSymptomText(noteText);
  for (var i = 0; i < synonyms.length; i++) {
    var normKw = normalizeSymptomText(synonyms[i]);
    var occurrences = findAllTermOccurrences(normalized, normKw);
    if (occurrences.length) {
      var events = occurrences.map(function (pos) {
        var cls = classifyMention(normalized, pos.index, pos.length);
        return {
          status: cls.status, temporality: cls.temporality, assertion: cls.assertion,
          evidence_span: extractSentenceSnippet(noteText, pos.index, pos.length),
          date: extractDateNear(noteText, pos.index, pos.length)
        };
      });
      var reconciled = reconcileProblemEvents(events);
      return {
        checked: true, status: reconciled.status, temporality: reconciled.temporality,
        contradiction: !!reconciled.contradiction, first_active_date: reconciled.first_active_date,
        evidence_span: reconciled.evidence_span,
        source: 'ade_treatment_map', linked_problem_id: null
      };
    }
  }
  return { checked: true, status: 'none', evidence_span: '', source: 'ade_treatment_map', linked_problem_id: null };
}

/**
 * Match free-text indication wording (e.g. "dolor articular") to a
 * kb/clinical_problems.json concept via its own keyword lists. Returns the
 * matching entry, or null when the reason text doesn't correspond to any
 * cataloged concept (still useful as raw evidence — see
 * extractExplicitIndicationForMedication — just without a concept_id).
 */
function matchReasonToClinicalProblem(reasonText, kb) {
  var normReason = normalizeSymptomText(reasonText);
  if (!normReason) return null;
  var problems = (kb.clinicalProblems && kb.clinicalProblems.problems) || [];
  for (var i = 0; i < problems.length; i++) {
    var p = problems[i];
    var kws = [].concat(p.keywords_es || [], p.keywords_en || [], p.chronic_keywords_es || [], p.chronic_keywords_en || []);
    for (var j = 0; j < kws.length; j++) {
      var nk = normalizeSymptomText(kws[j]);
      if (nk && normReason.indexOf(nk) !== -1) return p;
    }
  }
  return null;
}

/**
 * Fase 3 — medicación↔indicación: general, pattern-based extraction of a
 * medication's EXPLICIT indication from its own sentence. Two patterns,
 * neither tied to any specific drug or diagnosis name:
 *   1. "se diagnostica <problema> ... se inicia/pauta/prescribe <fármaco>"
 *      (diagnosis immediately followed by prescription of THIS drug).
 *   2. "<fármaco> ... por/para/debido a <razón>" (connector right after the
 *      drug mention, in the same sentence).
 * Returns { found:false } when neither pattern matches — callers must never
 * invent an indication when this returns nothing.
 */
function extractExplicitIndicationForMedication(noteText, mentionPos, kb) {
  if (!mentionPos) return { found: false };
  var sentStart = mentionPos.index;
  while (sentStart > 0 && !/[.\n]/.test(noteText.charAt(sentStart - 1))) sentStart--;
  var sentEnd = mentionPos.index + mentionPos.length;
  while (sentEnd < noteText.length && !/[.\n]/.test(noteText.charAt(sentEnd))) sentEnd++;
  var sentence = noteText.slice(sentStart, sentEnd);
  var relPos = mentionPos.index - sentStart;

  var reDiag = /se\s+diagnostica\s+([^,;.]{3,80}?)\s*(?:,|\by\b|por lo que)?\s*(?:se\s+(?:inicia|pauta|prescribe|a[ñn]ade))\b/i;
  var dm = reDiag.exec(sentence);
  if (dm) {
    var verbEnd = dm.index + dm[0].length;
    if (relPos >= verbEnd - 5 && relPos <= verbEnd + 30) {
      var reasonText1 = dm[1].trim();
      var concept1 = matchReasonToClinicalProblem(reasonText1, kb);
      return {
        found: true, reason_text: reasonText1,
        concept_id: concept1 ? concept1.id : null,
        concept_es: concept1 ? concept1.concept_es : reasonText1,
        concept_en: concept1 ? concept1.concept_en : reasonText1,
        evidence_span: dm[0].trim(), source: 'explicit', pattern: 'diagnosis_then_prescription'
      };
    }
  }

  var afterDrug = sentence.slice(relPos + mentionPos.length);
  var reConn = /^[^,.;]{0,40}?\b(?:por|para|debido a|a causa de)\s+([^,;.]{3,60})/i;
  var cm = reConn.exec(afterDrug);
  /* "por la noche/mañana/tarde", "por vía oral" etc. are dosing-schedule or
     route wording caught by the same "por X" connector, not a clinical
     indication — must not be fabricated into one. */
  var NON_INDICATION_REASON = /^(?:la\s+)?(?:noche|ma[ñn]ana|tarde|v[ií]a\s+\w+|orden\s+m[eé]dica|prescripci[oó]n\s+m[eé]dica)\b/i;
  if (cm && !NON_INDICATION_REASON.test(cm[1].trim())) {
    var reasonText2 = cm[1].trim();
    var concept2 = matchReasonToClinicalProblem(reasonText2, kb);
    return {
      found: true, reason_text: reasonText2,
      concept_id: concept2 ? concept2.id : null,
      concept_es: concept2 ? concept2.concept_es : reasonText2,
      concept_en: concept2 ? concept2.concept_en : reasonText2,
      evidence_span: cm[0].trim(), source: 'explicit', pattern: 'connector'
    };
  }

  return { found: false };
}

/**
 * Temporal order between the index drug, the cascade drug, and the
 * intermediate problem's own onset — combining, in order of reliability:
 *   1. Explicit dates (when at least two of the three carry one): if the
 *      cascade drug or the problem's onset PRE-DATES the index drug, the
 *      candidate cannot be an incident cascade caused by that index drug
 *      (Fase 4: "la hipertensión era previa al AINE" / "el antihipertensivo
 *      era previo" — Prueba C).
 *   2. The pre-existing text-cue heuristic (detectTimeCues) as a fallback
 *      when dates aren't available for both sides being compared.
 * Uses each mention's own MATCHED TEXT (`.mention`, e.g. "naproxeno") to
 * locate it in the original note — searching for the KB's canonical INN
 * (e.g. "naproxen") would silently fail to find the Spanish spelling.
 */
function detectDrugPairTemporality(noteText, indexMeta, cascadeMeta, problemCheck) {
  /* Candidate metadata points at the exact occurrence. Falling back to a
     lexical search is only for legacy callers. Using the first occurrence
     here made repeated medications share the wrong date/assertion. */
  var idxIndex = indexMeta && (indexMeta.actual_start_index != null ? indexMeta.actual_start_index : indexMeta.start_index);
  var casIndex = cascadeMeta && (cascadeMeta.actual_start_index != null ? cascadeMeta.actual_start_index : cascadeMeta.start_index);
  var idxPos = idxIndex != null ? { index: idxIndex, length: (indexMeta.mention || '').length } : null;
  var casPos = casIndex != null ? { index: casIndex, length: (cascadeMeta.mention || '').length } : null;
  var idxDate = idxPos ? extractDateNear(noteText, idxPos.index, idxPos.length) : null;
  var casDate = casPos ? extractDateNear(noteText, casPos.index, casPos.length) : null;
  var problemDate = problemCheck && problemCheck.first_active_date ? problemCheck.first_active_date : null;

  if (idxDate && casDate && casDate.value < idxDate.value) {
    return { status: 'incompatible', reason_code: 'cascade_drug_predates_index', index_date: idxDate, cascade_date: casDate };
  }
  if (idxDate && problemDate && problemDate.value < idxDate.value) {
    return { status: 'incompatible', reason_code: 'problem_predates_index', index_date: idxDate, problem_date: problemDate };
  }
  if (idxDate && casDate && casDate.value >= idxDate.value) {
    return { status: 'supportive', reason_code: 'explicit_dates_compatible', index_date: idxDate, cascade_date: casDate };
  }

  if (!idxPos && !casPos) return { status: 'unknown' };
  var idxCue = idxPos ? detectTimeCues(noteText, idxPos.index) : {};
  var casCue = casPos ? detectTimeCues(noteText, casPos.index) : {};
  var supportive = !!(idxCue.drugStartHint || casCue.treatmentAddedHint || idxCue.treatmentAddedHint);
  var chronic = !!(idxCue.chronicHint || casCue.chronicHint);
  if (supportive) return { status: 'supportive' };
  if (chronic) return { status: 'weak' };
  return { status: 'unknown' };
}

/**
 * Classify a single index-drug/cascade-drug pair given everything we know.
 * This is the decision tree described in KB_REFERENCE.md §"Clasificación de
 * cascadas": it is the direct fix for the pre-audit defect where a bare
 * pharmacological-class coincidence (e.g. naproxen + enalapril both present)
 * was presented as a cascade without ever checking whether the intermediate
 * problem (hypertension) was actually documented, negated, pre-existing, or
 * contradicted by an available measurement.
 */
function classifyCascadeSignal(problemCheck, altIndication, temporality, measurementDiscordance, indicationMismatch) {
  if (indicationMismatch) {
    return { classification: 'discarded', reason_code: 'medication_indication_mismatch' };
  }
  if (temporality.status === 'incompatible') {
    return { classification: 'discarded', reason_code: temporality.reason_code };
  }
  if (altIndication.found && problemCheck.status !== 'active') {
    return { classification: 'discarded', reason_code: 'alternative_indication_found' };
  }
  if (problemCheck.contradiction) {
    return { classification: 'not_evaluable', reason_code: 'problem_contradiction' };
  }
  if (problemCheck.status === 'absent') {
    return { classification: 'discarded', reason_code: 'problem_negated' };
  }
  if (problemCheck.status === 'resolved') {
    return { classification: 'discarded', reason_code: 'problem_resolved' };
  }
  if (problemCheck.status === 'none' || !problemCheck.checked) {
    return { classification: 'pharmacological_match_only', reason_code: 'pharmacological_class_match_only' };
  }
  if (problemCheck.status === 'suspected') {
    return { classification: 'not_evaluable', reason_code: 'problem_suspected_only' };
  }
  /* status === 'active' from here on. Chronic/antecedent phrasing
     ("antecedente de hipertensión") defaults to discard — a condition only
     ever described in historical/chronic terms, with nothing placing its
     onset after the index drug, is not a new event. Only an EXPLICIT DATE
     comparison proving the index drug precedes it (reason_code
     'explicit_dates_compatible', set above in detectDrugPairTemporality) is
     strong enough evidence to override that default; a generic text-cue
     "supportive" match (e.g. a bare "inicia" near the index drug, which
     proves nothing about when the CHRONIC problem itself began) is not. */
  if (problemCheck.temporality === 'historical' && temporality.reason_code !== 'explicit_dates_compatible') {
    return { classification: 'discarded', reason_code: 'problem_chronic_or_prior' };
  }
  if (altIndication.found) {
    return { classification: 'possible_but_incomplete', reason_code: 'alternative_indication_found' };
  }
  if (measurementDiscordance) {
    return { classification: 'possible_but_incomplete', reason_code: 'measurement_discordant' };
  }
  if (temporality.status === 'supportive') {
    return { classification: 'supported_possible_cascade', reason_code: 'temporality_supportive' };
  }
  return { classification: 'possible_but_incomplete', reason_code: 'temporality_unknown' };
}

function buildCandidateExplanation(decision, indexDrug, cascadeDrug, problemCheck) {
  if (decision.classification !== 'supported_possible_cascade') {
    return {
      es: classificationReason(decision.classification, 'es'),
      en: classificationReason(decision.classification, 'en')
    };
  }
  function title(value) { return value ? value.charAt(0).toUpperCase() + value.slice(1) : value; }
  var problemEs = (problemCheck && (problemCheck.concept_es || problemCheck.matched_term)) || 'el problema clínico intermedio';
  var problemEn = (problemCheck && (problemCheck.concept_en || problemCheck.matched_term)) || 'the intermediate clinical problem';
  return {
    es: 'La secuencia temporal y farmacológica es compatible con una posible cascada terapéutica. ' +
      title(indexDrug) + ' precede a la aparición de ' + problemEs + ' y ' + cascadeDrug +
      ' se inicia posteriormente para tratarla. La relación causal requiere validación profesional.',
    en: 'The temporal and pharmacological sequence is compatible with a possible prescribing cascade. ' +
      title(indexDrug) + ' precedes the onset of ' + problemEn + ', and ' + cascadeDrug +
      ' is subsequently started to treat it. The causal relationship requires professional validation.'
  };
}

/** Check whether an active-problem's associated measurement (if any) is
 * numerically discordant with the stated diagnosis — the "single 130/80
 * reading labelled hipertensión" case explicitly required by the audit. */
function checkMeasurementDiscordance(problemCheck, measurements) {
  if (!problemCheck.measurement_type || problemCheck.measurement_type !== 'blood_pressure') {
    return { applicable: false, discordant: false, measurement: null };
  }
  if (!measurements || !measurements.length) return { applicable: false, discordant: false, measurement: null };
  var bp = measurements.find(function (m) { return m.type === 'blood_pressure'; });
  if (!bp) return { applicable: false, discordant: false, measurement: null };
  var discordant = !bp.interpretation.meets_single_reading_hypertension_threshold;
  return { applicable: true, discordant: discordant, measurement: bp };
}

/**
 * @param {Object} indicationByCanonical  map of normalizeDrugText(canonical)
 *   -> extractExplicitIndicationForMedication() result, built once in
 *   buildCaseModel() and passed in here so every candidate rule can check
 *   whether its proposed cascade_drug already has an incompatible explicit
 *   indication (Fase 3: "una inferencia genérica nunca debe desplazar una
 *   indicación explícita incompatible").
 */
function evaluateDrugDrugCascades(noteText, kb, mentions, activeProblems, measurements, indicationByCanonical) {
  var mentionByCanonical = {};
  mentions.forEach(function (m) {
    var key = normalizeDrugText(m.canonical);
    if (!mentionByCanonical[key]) mentionByCanonical[key] = [];
    mentionByCanonical[key].push(m);
  });
  indicationByCanonical = indicationByCanonical || {};
  var presentCanonicals = mentions.map(function (m) { return m.canonical; });

  var signals = [];
  var potentialAdeNoCascadeDrug = [];

  allCascadeEntries(kb).forEach(function (cascade) {
    var indexExamples = getIndexExamples(cascade);
    var cascadeExamples = getCascadeExamples(cascade);

    var foundIndexes = [];
    indexExamples.forEach(function (d) {
      (mentionByCanonical[normalizeDrugText(d)] || []).forEach(function (hit) {
        foundIndexes.push({ drug: d, mention: hit });
      });
    });
    var foundCascades = [];
    cascadeExamples.forEach(function (d) {
      (mentionByCanonical[normalizeDrugText(d)] || []).forEach(function (hit) {
        foundCascades.push({ drug: d, mention: hit });
      });
    });

    if (!foundIndexes.length) return;

    var problemCheck = verifyIntermediateProblem(noteText, cascade, kb, activeProblems);

    if (!foundCascades.length) {
      /* Index drug + an actively-documented intermediate problem, but no
         second (cascade) drug at all: this is a potential ADE worth
         surfacing, but it is NOT a cascade (no third element) — kept out
         of possibleCascades per the CaseModel contract. */
      if (problemCheck.checked && problemCheck.status === 'active') {
        potentialAdeNoCascadeDrug.push({
          index_drug: foundIndexes[0].drug,
          ade_es: cascade.ade_es || '',
          ade_en: cascade.ade_en || '',
          evidence_span: problemCheck.evidence_span,
          rule_id: cascade.id
        });
      }
      return;
    }

    /* Evaluate every compatible active pair. A temporally incompatible first
       antihypertensive must never prevent a later candidate from being
       considered (the former .some()/first-hit logic did exactly that). */
    foundIndexes.forEach(function (foundIndexPair) {
      foundCascades.forEach(function (foundCascadePair) {
    var foundIndex = foundIndexPair.drug, foundIndexMeta = foundIndexPair.mention;
    var foundCascade = foundCascadePair.drug, foundCascadeMeta = foundCascadePair.mention;

    var altIndication = detectAlternativeIndication(noteText, foundCascade, kb, activeProblems, cascade.id);
    var temporality = detectDrugPairTemporality(noteText, foundIndexMeta, foundCascadeMeta, problemCheck);
    var measDiscordance = checkMeasurementDiscordance(problemCheck, measurements);

    /* Medication↔indication mismatch (Fase 3): the cascade_drug already has
       an EXPLICIT indication in the note that names a different concept
       than the one THIS rule proposes, and this rule has no independent
       evidence of its own problem — the explicit, textual indication wins. */
    var cascadeIndex = foundCascadeMeta.actual_start_index != null
      ? foundCascadeMeta.actual_start_index : foundCascadeMeta.start_index;
    var cascadePosition = cascadeIndex != null ? {
      index: cascadeIndex, length: (foundCascadeMeta.mention || '').length
    } : null;
    var cascadeIndication = cascadePosition
      ? extractExplicitIndicationForMedication(noteText, cascadePosition, kb)
      : { found: false };
    if (!cascadeIndication.found) cascadeIndication = indicationByCanonical[normalizeDrugText(foundCascade)];
    var linkedProblemEntry = findClinicalProblemForCascade(cascade, kb);
    var indicationMismatch = false;
    var explicitIndicationCompatible = false;
    if (cascadeIndication && cascadeIndication.found && problemCheck.status !== 'active') {
      var matchesThisRule = linkedProblemEntry && cascadeIndication.concept_id === linkedProblemEntry.id;
      if (!matchesThisRule) indicationMismatch = true;
    }
    if (cascadeIndication && cascadeIndication.found && linkedProblemEntry) {
      explicitIndicationCompatible = cascadeIndication.concept_id === linkedProblemEntry.id;
    }

    var decision = classifyCascadeSignal(problemCheck, altIndication, temporality, measDiscordance.discordant, indicationMismatch);
    var candidateExplanation = buildCandidateExplanation(decision, foundIndex, foundCascade, problemCheck);

    var adeDisplay = { es: cascade.ade_es || '', en: cascade.ade_en || '' };

    /* Fase 5: a ddi_warning is only shown when every drug it requires is
       actually present in this note (see allRequiredEntitiesPresent above)
       — the fix for "dolutegravir-metformin interaction shown with no
       metformin in the note" (VIH003) and the same pattern in the other
       rules audited in kb/CHANGELOG.md. Rules with ddi_required_drugs still
       empty (not yet reviewed) keep their pre-audit unconditional display. */
    var ddiVisible = allRequiredEntitiesPresent(cascade.ddi_required_drugs, presentCanonicals,
        cascade.cascade_drugs_examples, foundCascade) &&
      (!cascade.ddi_required_index_drugs || cascade.ddi_required_index_drugs.map(normalizeDrugText)
        .indexOf(normalizeDrugText(foundIndex)) !== -1);

    signals.push({
      cascade_id: cascade.id,
      /* cascade_id stays the bare rule id (findCascadeEntry() and every
         `cascade_id === 'VIH003'`-style test/lookup depends on that), but a
         single rule can produce several independent candidates here — one
         per compatible (index_drug, cascade_drug) pair, e.g. VIH003 firing
         once for metformin and once for atorvastatin. Without a key that
         distinguishes those, Step 5's per-card "confirmar/posible/descartar"
         buttons and the final-report filter both keyed off cascade_id alone,
         so classifying ANY one candidate silently overwrote every other
         candidate of the same rule (shared object key) — the actual cause
         of the cards in Step 5 looking "duplicated" and behaving as one. */
      candidate_id: cascade.id + '::' + normalizeDrugText(foundIndex) + '::' + normalizeDrugText(foundCascade),
      rule_id: cascade.id,
      cascade_name: cascade.name_en || cascade.id,
      cascade_name_es: cascade.name_es || '',
      signal_type: 'drug_drug',
      index_drug: foundIndex,
      cascade_drug: foundCascade,
      drug_resolution: { index: foundIndexMeta, cascade: foundCascadeMeta },
      confidence: cascade.confidence || cascade.plausibility || 'low',
      risk_focus: cascade.risk_focus || [],
      ade_es: adeDisplay.es,
      ade_en: adeDisplay.en,
      appropriateness: cascade.appropriateness || '',
      ddi_warning: ddiVisible ? (cascade.ddi_warning_en || '') : '',
      ddi_warning_es: ddiVisible ? (cascade.ddi_warning_es || '') : '',
      ddi_required_drugs: cascade.ddi_required_drugs || [],
      ddi_suppressed_missing_entities: !ddiVisible && !!(cascade.ddi_warning_es || cascade.ddi_warning_en),
      recommended_action_es: getLocalizedField(cascade, 'recommended_first_action', 'es') || getLocalizedField(cascade, 'clinical_note', 'es'),
      recommended_action_en: getLocalizedField(cascade, 'recommended_first_action', 'en') || getLocalizedField(cascade, 'clinical_note', 'en'),
      classification: decision.classification,
      classification_reason_code: decision.reason_code,
      classification_reason_es: candidateExplanation.es,
      classification_reason_en: candidateExplanation.en,
      classification_evidence_reason_es: msg(decision.reason_code, 'es'),
      classification_evidence_reason_en: msg(decision.reason_code, 'en'),
      knowledge_validation_status: (cascade.references && cascade.references.length) ? 'reviewed_source' : 'pending_review',
      potential_clinical_relevance: mapConfidenceToRelevance(cascade.confidence || cascade.plausibility),
      evidence: {
        index_drug: { present: true, mention: foundIndexMeta && foundIndexMeta.mention, source: 'explicit' },
        cascade_drug: {
          present: true, mention: foundCascadeMeta && foundCascadeMeta.mention, source: 'explicit',
          explicit_indication: cascadeIndication && cascadeIndication.found ? cascadeIndication : null
        },
        intermediate_problem: problemCheck,
        temporal_order: temporality,
        alternative_indication: altIndication,
        measurement_discordance: measDiscordance,
        indication_mismatch: indicationMismatch,
        explicit_indication_compatible: explicitIndicationCompatible
      },
      merged_from: cascade.merged_from || [],
      references: cascade.references || []
    });
      });
    });
  });

  return { signals: signals, potentialAdeNoCascadeDrug: potentialAdeNoCascadeDrug };
}

/** potentialClinicalRelevance (Fase 7): derived from the KB's own
 * confidence/plausibility rating of the ASSOCIATION, never from this
 * patient's data — see buildEvidenceListHtml in app.js for the label that
 * makes this distinction explicit to the clinician. */
function mapConfidenceToRelevance(confidence) {
  if (confidence === 'high') return 'alta';
  if (confidence === 'medium') return 'moderada';
  return 'baja';
}

function isNonspecificSymptom(symptomTerm) {
  if (!hasText(symptomTerm)) return false;
  var nonspecific = ['dizziness', 'nausea', 'insomnia'];
  return nonspecific.indexOf(String(symptomTerm).trim().toLowerCase()) !== -1;
}

function evaluateSymptomBridgeCascades(noteText, kb, mentionByCanonical, symptomsDetected) {
  var symEntries = (kb.symptomDictionary && kb.symptomDictionary.symptoms) || [];
  if (!symEntries.length || !symptomsDetected.length) return [];

  var signals = [];
  symptomsDetected.forEach(function (ds) {
    if (ds.active === false) return;
    var entry = symEntries.find(function (s) { return s.id === ds.id; });
    if (!entry) return;
    var causedBy = entry.caused_by_drug_examples || [];
    var treatedBy = entry.treated_by_drug_examples || [];
    if (!causedBy.length || !treatedBy.length) return;

    var foundCause = null, causePos = null, foundCauseMeta = null;
    for (var ci = 0; ci < causedBy.length; ci++) {
      var cKey = normalizeDrugText(causedBy[ci]);
      var cHit = mentionByCanonical[cKey];
      if (cHit && cHit.length) {
        foundCause = causedBy[ci]; foundCauseMeta = cHit[0];
        /* Re-locate in the ORIGINAL text rather than trusting start_index,
           which is an offset into the resolver's internally-normalized
           (whitespace/punctuation-collapsed) copy and therefore not a valid
           offset into `noteText` — see clinical-engine.js history/CHANGELOG. */
        causePos = findTermInNote(noteText, foundCauseMeta.mention);
        break;
      }
      var cp = findTermInNote(noteText, causedBy[ci]);
      if (cp) { foundCause = causedBy[ci]; causePos = cp; break; }
    }
    var foundTreatment = null, treatPos = null, foundTreatmentMeta = null;
    for (var ti = 0; ti < treatedBy.length; ti++) {
      var tKey = normalizeDrugText(treatedBy[ti]);
      var tHit = mentionByCanonical[tKey];
      if (tHit && tHit.length) {
        foundTreatment = treatedBy[ti]; foundTreatmentMeta = tHit[0];
        treatPos = findTermInNote(noteText, foundTreatmentMeta.mention);
        break;
      }
      var tp = findTermInNote(noteText, treatedBy[ti]);
      if (tp) { foundTreatment = treatedBy[ti]; treatPos = tp; break; }
    }
    if (!foundCause || !foundTreatment) return;

    var timeSym = detectTimeCues(noteText, typeof ds.startIndex === 'number' ? ds.startIndex : 0);
    var timeCause = causePos ? detectTimeCues(noteText, causePos.index) : {};
    var timeTreat = treatPos ? detectTimeCues(noteText, treatPos.index) : {};
    var symptomDate = typeof ds.startIndex === 'number' ? extractDateNear(noteText, ds.startIndex, (ds.matched_term || ds.term).length) : null;
    var causeDate = causePos ? extractDateNear(noteText, causePos.index, causePos.length) : null;
    var treatmentDate = treatPos ? extractDateNear(noteText, treatPos.index, treatPos.length) : null;

    var explicitDatesCompatible = !!(causeDate && symptomDate && treatmentDate &&
      causeDate.value <= symptomDate.value && symptomDate.value <= treatmentDate.value);
    var supportive = explicitDatesCompatible ||
      ((timeCause.drugStartHint || timeCause.treatmentAddedHint) && (timeSym.symptomNewHint || timeTreat.treatmentAddedHint));
    var chronic = timeSym.chronicHint || timeTreat.chronicHint;

    var classification = supportive ? 'supported_possible_cascade'
      : chronic ? 'possible_but_incomplete'
      : 'possible_but_incomplete';
    var confidence = supportive ? 'high' : chronic ? 'low' : 'medium';

    var symLabel = ds.term.charAt(0).toUpperCase() + ds.term.slice(1);
    var linkedRuleIds = (entry.cascade_relevance || '').match(/\b(?:CC|VIH)\d{3}\b/g) || [];

    signals.push({
      cascade_id: ds.id + ':' + foundCause + ':' + foundTreatment,
      /* Already unique per (cause, treatment) pair, unlike drug_drug
         signals above — see the note on candidate_id there. */
      candidate_id: ds.id + ':' + foundCause + ':' + foundTreatment,
      rule_id: ds.id,
      linked_rule_ids: linkedRuleIds,
      cascade_name: foundCause + ' → ' + symLabel + ' → ' + foundTreatment,
      index_drug: foundCause,
      cascade_drug: foundTreatment,
      signal_type: 'symptom_bridge',
      drug_resolution: { index: foundCauseMeta || null, cascade: foundTreatmentMeta || null },
      confidence: confidence,
      risk_focus: [ds.category],
      ade_en: ds.term, ade_es: ds.term,
      appropriateness: '',
      ddi_warning: '', ddi_warning_es: '',
      recommended_action_es: entry.cascade_relevance || '',
      recommended_action_en: entry.cascade_relevance || '',
      classification: classification,
      classification_reason_code: supportive ? 'temporality_supportive' : 'temporality_unknown',
      classification_reason_es: classificationReason(supportive ? 'supported_possible_cascade' : 'possible_but_incomplete', 'es'),
      classification_reason_en: classificationReason(supportive ? 'supported_possible_cascade' : 'possible_but_incomplete', 'en'),
      classification_evidence_reason_es: msg(supportive ? 'temporality_supportive' : 'temporality_unknown', 'es'),
      classification_evidence_reason_en: msg(supportive ? 'temporality_supportive' : 'temporality_unknown', 'en'),
      /* Fase 7: the symptom dictionary carries no `references` field today,
         so this path is always "pending_review" — an honest reflection of
         what has and hasn't been source-checked, not a guess. */
      knowledge_validation_status: (entry.references && entry.references.length) ? 'reviewed_source' : 'pending_review',
      potential_clinical_relevance: mapConfidenceToRelevance(confidence),
      evidence: {
        index_drug: { present: true, mention: foundCause, source: 'explicit' },
        cascade_drug: { present: true, mention: foundTreatment, source: 'explicit' },
        intermediate_problem: { checked: true, status: 'active', evidence_span: '', source: 'symptom_dictionary', onset_date: symptomDate },
        temporal_order: {
          status: supportive ? 'supportive' : (chronic ? 'weak' : 'unknown'),
          reason_code: explicitDatesCompatible ? 'explicit_dates_compatible' : (supportive ? 'temporality_supportive' : 'temporality_unknown'),
          index_date: causeDate,
          problem_date: symptomDate,
          cascade_date: treatmentDate
        },
        alternative_indication: { found: false },
        measurement_discordance: { applicable: false, discordant: false }
      },
      merged_from: [],
      references: entry.references || []
    });
  });

  return signals;
}

/* ============================================================
   11. Top-level orchestration
   ============================================================ */

/**
 * Build the full, structured CaseModel for a clinical note.
 *
 * @param {string} noteText
 * @param {object} kb  KB object with the shape documented at the top of
 *                      this file (loadKB()'s state.kb in app.js has this
 *                      exact shape once `clinicalProblems` is added).
 * @param {object} [options]
 * @param {string} [options.lang='es']
 * @returns {object} CaseModel
 */
function buildCaseModel(noteText, kb, options) {
  options = options || {};
  var lang = options.lang || 'es';
  var reviewedInput = options.reviewedInput || null;
  kb = kb || {};
  noteText = typeof noteText === 'string' ? noteText : '';

  if ((!noteText || !noteText.trim()) && !reviewedInput) {
    return {
      medications: [], activeMedications: [], allMedicationMentions: [], inactiveOrNegatedMedications: [],
      currentInteractions: [], activeProblems: [], clinicalMeasurements: [], events: [],
      possibleCascades: [], globalMedicationAlerts: [], missingInformation: [],
      drug_classes: []
    };
  }

  var corrected = normalizeClinicalText(noteText);
  var resolver = buildDrugResolver(kb);
  var mentions = resolveDrugMentions(corrected, resolver);
  mentions.forEach(function (m) {
    var escaped = (m.mention || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var candidates = [], hit, re = new RegExp(escaped, 'gi');
    while ((hit = re.exec(corrected)) !== null) candidates.push(hit.index);
    m.actual_start_index = candidates.reduce(function (best, candidate) {
      var distance = Math.abs(normalizeDrugText(corrected.slice(0, candidate)).length - m.start_index);
      return !best || distance < best.distance ? { index: candidate, distance: distance } : best;
    }, null);
    m.actual_start_index = m.actual_start_index ? m.actual_start_index.index : m.start_index;
  });
  mentions.forEach(function (m) {
    var state = classifyMedicationMention(corrected, m);
    m.assertion = state.assertion; m.status = state.status; m.temporality = state.temporality;
  });
  var extractedActiveMentions = mentions.filter(function (m) {
    return isActiveMedication({ assertion: m.assertion, status: m.status });
  });
  /* A confirmed professional review can replace the active medication set.
     Extracted mention metadata is retained whenever a reviewed item maps to
     one of the original medicines, preserving literal evidence and dates.
     Manual additions deliberately carry no invented position or chronology. */
  var activeMentions = reviewedInput && Array.isArray(reviewedInput.medications)
    ? reviewedInput.medications.map(function (medication) {
        var provenance = medication.review_provenance || {};
        var originalName = provenance.original_name || medication.normalized_name;
        var base = extractedActiveMentions.find(function (mention) {
          return normalizeDrugText(mention.canonical) === normalizeDrugText(originalName);
        });
        if (base) {
          return Object.assign({}, base, {
            canonical: medication.normalized_name,
            drug_class: medication.drug_class || '',
            brand: medication.brand || null,
            brand_ingredients: medication.active_ingredients || [medication.normalized_name],
            review_provenance: cloneJson(provenance)
          });
        }
        return {
          mention: medication.original_text || medication.normalized_name,
          canonical: medication.normalized_name,
          start_index: null,
          actual_start_index: null,
          match_type: 'professional_review',
          confidence: 'professional_review',
          brand: medication.brand || null,
          brand_ingredients: medication.active_ingredients || [medication.normalized_name],
          drug_class: medication.drug_class || '',
          assertion: 'affirmed', status: 'active', temporality: medication.temporality || 'undetermined',
          review_provenance: cloneJson(provenance)
        };
      })
    : extractedActiveMentions;
  var mentionByCanonical = {};
  activeMentions.forEach(function (m) {
    var key = normalizeDrugText(m.canonical);
    if (!mentionByCanonical[key]) mentionByCanonical[key] = [];
    mentionByCanonical[key].push(m);
  });

  var extractedActiveProblems = detectActiveProblems(corrected, kb, lang, resolver);
  var activeProblems = reviewedInput && Array.isArray(reviewedInput.activeProblems)
    ? cloneJson(reviewedInput.activeProblems)
    : extractedActiveProblems;
  var measurements = extractClinicalMeasurements(corrected);
  var symptomsDetected = extractSymptoms(corrected, kb);

  /* Resolve each distinct medication's real position in `corrected` once
     (never trust mention.start_index — it is an offset into the resolver's
     internally-normalized copy, not into `corrected`), then derive its
     explicit indication and start date from that position. Built BEFORE
     evaluateDrugDrugCascades so every candidate rule can check whether its
     proposed cascade_drug already has an incompatible explicit indication
     (Fase 3). */
  var reconciledDrugCanonicals = activeMentions.map(function (m) { return m.canonical; })
    .filter(function (v, i, a) { return a.indexOf(v) === i; });
  var positionByCanonical = {};
  var indicationByCanonical = {};
  reconciledDrugCanonicals.forEach(function (canonical) {
    var m = activeMentions.find(function (x) { return x.canonical === canonical; });
    var mentionIndex = m.actual_start_index != null ? m.actual_start_index : m.start_index;
    var pos = mentionIndex != null ? { index: mentionIndex, length: (m.mention || '').length } : null;
    positionByCanonical[canonical] = pos;
    indicationByCanonical[normalizeDrugText(canonical)] = pos
      ? extractExplicitIndicationForMedication(corrected, pos, kb)
      : { found: false };
  });

  var drugDrug = evaluateDrugDrugCascades(corrected, kb, activeMentions, activeProblems, measurements, indicationByCanonical);
  var symptomBridge = evaluateSymptomBridgeCascades(corrected, kb, mentionByCanonical, symptomsDetected);

  var allSignals = drugDrug.signals.concat(symptomBridge);

  var contextModifiers = detectClinicalContextModifiers(corrected, kb);
  var split = classifyMatchedModifiers(contextModifiers);
  allSignals = allSignals.map(function (sig) { return applyPatientLevelModifiers(sig, split.patientLevel); });

  allSignals = suppressDuplicateSignals(allSignals);
  allSignals = prioritizeCascadeCandidates(allSignals);

  var globalAlertsResult = buildGlobalMedicationAlerts(corrected, kb, activeMentions);

  /* NSAID/COX-inhibitor concurrent-exposure duplicity — a distinct "other
     finding", never a cascade (no intermediate problem, no third drug). */
  var nsaidClasses = ['NSAID', 'NSAID / COX inhibitor'];
  var nsaidCanonicals = [];
  allCascadeEntries(kb).forEach(function (c) {
    if (nsaidClasses.indexOf(c.index_drug_classes ? c.index_drug_classes[0] : '') !== -1 ||
        nsaidClasses.indexOf((c.index_drug_classes || [])[0]) !== -1) {
      getIndexExamples(c).forEach(function (d) { if (nsaidCanonicals.indexOf(d) === -1) nsaidCanonicals.push(d); });
    }
  });
  var nsaidsPresent = activeMentions.filter(function (m) {
    return nsaidCanonicals.indexOf(m.canonical) !== -1;
  }).map(function (m) { return m.canonical; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
  if (nsaidsPresent.length > 1) {
    globalAlertsResult.alerts.push({
      id: 'GA_NSAID_DUPLICITY',
      type: 'therapeutic_duplicity',
      name_es: 'Posible duplicidad de AINE',
      name_en: 'Possible NSAID duplicity',
      message_es: 'Exposición concurrente a más de un AINE/inhibidor de la COX (' + nsaidsPresent.join(', ') + '): revisar necesidad de ambos, riesgo GI/renal/cardiovascular acumulado.',
      message_en: 'Concurrent exposure to more than one NSAID/COX inhibitor (' + nsaidsPresent.join(', ') + '): review the need for both; cumulative GI/renal/cardiovascular risk.',
      drugs_involved: nsaidsPresent,
      references: [],
      rule_id: 'GA_NSAID_DUPLICITY'
    });
  }

  var missingInformation = [];
  drugDrug.potentialAdeNoCascadeDrug.forEach(function (p) {
    missingInformation.push({
      type: 'potential_ade_without_cascade_drug',
      message_es: 'Posible efecto adverso (' + (p.ade_es || p.ade_en) + ') tras ' + p.index_drug + '; no se ha documentado un segundo fármaco prescrito para tratarlo, por lo que no constituye una cascada completa.',
      message_en: 'Possible adverse effect (' + (p.ade_en || p.ade_es) + ') after ' + p.index_drug + '; no second drug prescribed to treat it was documented, so this is not a complete cascade.',
      evidence_span: p.evidence_span,
      rule_id: p.rule_id
    });
  });
  if (!measurements.length) {
    var hasProblemWithMeasurementType = activeProblems.some(function (p) { return p.measurement_type; });
    if (hasProblemWithMeasurementType) {
      missingInformation.push({
        type: 'missing_confirmatory_measurement',
        message_es: 'Se menciona un diagnóstico que habitualmente requiere una medición objetiva (p. ej. presión arterial) para su confirmación, pero no se ha encontrado ninguna medición en la nota.',
        message_en: 'A diagnosis that usually requires an objective measurement (e.g. blood pressure) for confirmation is mentioned, but no measurement was found in the note.'
      });
    }
  }

  var derivedMedications = reconciledDrugCanonicals.map(function (canonical) {
    var m = mentions.find(function (x) { return x.canonical === canonical; });
    var activeMention = activeMentions.find(function (x) { return x.canonical === canonical; });
    m = m || activeMention;
    var pos = positionByCanonical[canonical];
    var posology = pos ? extractDosePosology(corrected, pos.index, pos.length) : { dose: null, frequency: null, prn: false };
    var startDate = pos ? extractDateNear(corrected, pos.index, pos.length) : null;
    var indication = indicationByCanonical[normalizeDrugText(canonical)];
    return {
      original_text: m.mention,
      normalized_name: canonical,
      brand: m.brand || null,
      active_ingredients: m.brand_ingredients || [canonical],
      drug_class: m.drug_class || '',
      dose: posology.dose, frequency: posology.frequency, route: null,
      start_date: startDate ? startDate.raw : null,
      prn: posology.prn,
      ingredient_id: normalizeDrugText(canonical).replace(/\s+/g, '-'),
      assertion: m.assertion,
      status: m.status,
      current_status: m.status,
      temporality: m.temporality,
      end_date: null,
      explicit_indication: indication && indication.found ? indication : null,
      source: m.match_type === 'combo_brand' ? 'inferred' : 'explicit',
      confidence: m.confidence || 'medium',
      evidence_span: pos ? extractSentenceSnippet(corrected, pos.index, pos.length) : ''
    };
  });

  var medications = reviewedInput && Array.isArray(reviewedInput.medications)
    ? cloneJson(reviewedInput.medications)
    : derivedMedications;

  var uniqueClasses = [];
  medications.forEach(function (m) { if (m.drug_class && uniqueClasses.indexOf(m.drug_class) === -1) uniqueClasses.push(m.drug_class); });

  var allMedicationMentions = mentions.map(function (m) {
    var pos = { index: m.actual_start_index, length: (m.mention || '').length };
    var date = extractDateNear(corrected, pos.index, pos.length);
    return {
      original_text: m.mention, normalized_name: m.canonical,
      ingredient_id: normalizeDrugText(m.canonical).replace(/\s+/g, '-'), brand: m.brand || null,
      assertion: m.assertion, status: m.status, current_status: m.status,
      temporality: m.temporality, start_date: date ? date.raw : null, end_date: null,
      evidence_span: extractSentenceSnippet(corrected, pos.index, pos.length),
      source: m.match_type === 'combo_brand' ? 'inferred' : 'explicit', confidence: m.confidence || 'medium',
      drug_class: m.drug_class || '', active_for_clinical_reasoning: isActiveMedication(m),
      exclusion_reason: isActiveMedication(m) ? null : medicationExclusionReason(m),
      condition: (function () {
        if (m.assertion !== 'conditional' && m.assertion !== 'hypothetical') return null;
        var condition = extractSentenceSnippet(corrected, pos.index, pos.length).match(/\bsi\s+([^.;]+)/i);
        return condition ? condition[0].trim() : null;
      }()),
      provenance: 'clinical_note'
    };
  });
  mentions.forEach(function (m) {
    /* A second event is needed only when the same lexical mention carries a
       present negation plus a separate future condition. A standalone future
       mention is already represented by its primary mention above. */
    if (m.assertion !== 'negated') return;
    var future = extractFutureMedicationCondition(corrected, m);
    if (!future) return;
    var existing = allMedicationMentions.find(function (x) { return x.normalized_name === m.canonical; });
    allMedicationMentions.push(Object.assign({}, existing, future, {
      current_status: future.status,
      active_for_clinical_reasoning: false,
      exclusion_reason: medicationExclusionReason(future),
      evidence_span: future.evidence_span
    }));
  });
  var inactiveOrNegatedMedications = allMedicationMentions.filter(function (m) { return !isActiveMedication(m); });
  var currentInteractions = evaluateCurrentInteractions(kb, medications);

  allSignals.forEach(function (signal) {
    signal.recommendation_presentation = getRecommendationPresentation(signal.classification, findCascadeEntryForSignal(signal, kb));
  });

  return {
    medications: medications,
    activeMedications: medications,
    allMedicationMentions: allMedicationMentions,
    inactiveOrNegatedMedications: inactiveOrNegatedMedications,
    currentInteractions: currentInteractions,
    drug_classes: uniqueClasses,
    activeProblems: activeProblems,
    clinicalMeasurements: measurements,
    events: [], /* reserved for future chronological-event modelling */
    possibleCascades: allSignals,
    globalMedicationAlerts: globalAlertsResult.alerts,
    missingInformation: missingInformation,
    symptomsDetected: symptomsDetected,
    reviewedInputApplication: reviewedInput ? cloneJson(reviewedInput.application || null) : null,
    reviewAudit: reviewedInput ? cloneJson(reviewedInput.audit || null) : null
  };
}

/* ============================================================
   Public API
   ============================================================ */
return {
  MESSAGES: MESSAGES,
  CLASSIFICATION_MESSAGES: CLASSIFICATION_MESSAGES,
  msg: msg,
  classificationReason: classificationReason,
  getLocalizedField: getLocalizedField,
  normalizeClinicalText: normalizeClinicalText,
  normalizeDrugText: normalizeDrugText,
  normalizeSymptomText: normalizeSymptomText,
  buildDrugResolver: buildDrugResolver,
  resolveDrugMentions: resolveDrugMentions,
  classifyMedicationMention: classifyMedicationMention,
  isActiveMedication: isActiveMedication,
  drugFoundInNote: drugFoundInNote,
  extractDrugs: extractDrugs,
  findTermInNote: findTermInNote,
  classifyMention: classifyMention,
  isNegatedSymptom: isNegatedSymptom,
  extractSentenceSnippet: extractSentenceSnippet,
  findClinicalFinding: findClinicalFinding,
  detectTimeCues: detectTimeCues,
  extractSymptoms: extractSymptoms,
  detectActiveProblems: detectActiveProblems,
  detectUrologicRenalProblem: detectUrologicRenalProblem,
  extractClinicalMeasurements: extractClinicalMeasurements,
  detectAlternativeIndication: detectAlternativeIndication,
  detectClinicalContextModifiers: detectClinicalContextModifiers,
  getIndexExamples: getIndexExamples,
  getCascadeExamples: getCascadeExamples,
  findCascadeEntry: findCascadeEntry,
  findCascadeEntryForSignal: findCascadeEntryForSignal,
  isNonspecificSymptom: isNonspecificSymptom,
  suppressDuplicateSignals: suppressDuplicateSignals,
  prioritizeCascadeCandidates: prioritizeCascadeCandidates,
  confidenceRank: confidenceRank,
  priorityRank: priorityRank,
  classificationRank: classificationRank,
  classifyCascadeSignal: classifyCascadeSignal,
  findAllTermOccurrences: findAllTermOccurrences,
  extractDateNear: extractDateNear,
  reconcileProblemEvents: reconcileProblemEvents,
  extractExplicitIndicationForMedication: extractExplicitIndicationForMedication,
  matchReasonToClinicalProblem: matchReasonToClinicalProblem,
  detectDrugPairTemporality: detectDrugPairTemporality,
  mapConfidenceToRelevance: mapConfidenceToRelevance,
  allRequiredEntitiesPresent: allRequiredEntitiesPresent,
  evaluateCurrentInteractions: evaluateCurrentInteractions,
  getRecommendationPresentation: getRecommendationPresentation,
  selectTopInterventions: selectTopInterventions,
  scoreAnticholinergicBurden: scoreAnticholinergicBurden,
  buildGlobalMedicationAlerts: buildGlobalMedicationAlerts,
  buildCaseModel: buildCaseModel
};

});
