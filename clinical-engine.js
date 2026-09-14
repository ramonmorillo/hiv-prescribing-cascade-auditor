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
    es: 'La cronología descrita en la nota es compatible con una secuencia causal (fármaco índice → problema → fármaco cascada).',
    en: 'The chronology described in the note is compatible with a causal sequence (index drug → problem → cascade drug).'
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
  }
};

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
    addVariant(entry.canonical, entry.canonical, drugClass, 'dict', 'high');
    (entry.variants || []).forEach(function (variant) {
      if (variant) addVariant(variant, entry.canonical, drugClass, 'dict', 'high');
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
function classifyMention(noteText, matchIndex, matchLength) {
  var preRaw = noteText.slice(Math.max(0, matchIndex - 80), matchIndex);
  var preTokens = preRaw.trim().split(/[\s,;:()\.\!\?]+/).filter(Boolean).slice(-6);
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
  for (var i = 0; i < negBefore.length; i++) {
    if (negBefore[i].test(preStr)) {
      return { status: 'negated', reason: 'negated before: "' + preTokens.slice(-3).join(' ') + '"' };
    }
  }

  var suspectBefore = [
    /\bpossible\b/, /\bsuspected\b/, /\blikely\b/, /\bprobable\b/, /\bquery\b/,
    /\bposible\b/, /\bsospecha\s+de\b/, /\bprobable\b/, /\ba\s+descartar\b/
  ];
  for (var s = 0; s < suspectBefore.length; s++) {
    if (suspectBefore[s].test(preStr)) {
      return { status: 'suspected', reason: 'hedged before: "' + preTokens.slice(-3).join(' ') + '"' };
    }
  }

  var histBefore = [
    /\bresolved\b/, /\bimproved\b/, /\bprevious\b/, /\bhistory\s+of\b/, /\bhx\s+of\b/, /\bh\/o\b/,
    /\bprior\b/, /\bpast\b/, /\bused\s+to\b/, /\bformer(?:ly)?\b/, /\bold\b/, /\bchronic\b/,
    /\bantecedentes\s+de\b/, /\bantecedente\s+de\b/, /\bhistoria\s+de\b/, /\bap\s+de\b/,
    /\bprevio\b/, /\bprevia\b/, /\bpreviamente\b/, /\ben\s+el\s+pasado\b/, /\bcr[oó]nic[oa]\b/, /\bconocid[oa]\b/
  ];
  for (var j = 0; j < histBefore.length; j++) {
    if (histBefore[j].test(preStr)) {
      return { status: 'history', reason: 'historical before: "' + preTokens.slice(-3).join(' ') + '"' };
    }
  }

  var resolvedAfter = [
    /\bresolved\b/, /\bimproved\b/, /\bcleared\b/, /\bgone\b/, /\babated\b/,
    /\bresuelto\b/, /\bresuelta\b/, /\bmejor[ií]a\b/, /\bmejorado\b/, /\bmejorada\b/,
    /\bcontrolado\b/, /\bcontrolada\b/, /\bcede\b/, /\bdesaparece\b/
  ];
  for (var k = 0; k < resolvedAfter.length; k++) {
    if (resolvedAfter[k].test(postStr)) {
      return { status: 'history', reason: 'resolved after: "' + noteText.slice(matchIndex, matchIndex + matchLength) + ' ' + postTokens.slice(0, 2).join(' ') + '"' };
    }
  }

  var negAfter = [/\bnegative\b/, /\bnegativo\b/, /\bnegativa\b/, /\bnegativos\b/, /\bnegativas\b/];
  for (var n = 0; n < negAfter.length; n++) {
    if (negAfter[n].test(postStr)) {
      return { status: 'negated', reason: 'negative result after: "' + noteText.slice(matchIndex, matchIndex + matchLength) + ' ' + postTokens.slice(0, 2).join(' ') + '"' };
    }
  }

  return { status: 'active', reason: '' };
}

/** Backward-compatible boolean view used by the ADE symptom-bridge pipeline
 * (kb_symptoms.json), which only ever needed active/not-active. */
function isNegatedSymptom(noteText, matchIndex, matchLength) {
  var c = classifyMention(noteText, matchIndex, matchLength);
  return { negated: c.status === 'negated' || c.status === 'history', reason: c.reason };
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
      /\bdesde\s+(\d|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/.test(ctx) ||
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

    detected.push({
      id: sym.id, term: canonicalTerm, matched_term: matchedTerm,
      category: sym.category || '', cascade_relevance: sym.cascade_relevance || '',
      active: cls.status === 'active', status: cls.status, reason: cls.reason,
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

function detectGenericActiveProblems(noteText, kb) {
  if (!noteText || !noteText.trim()) return [];
  var original = noteText;
  var normalized = normalizeSymptomText(noteText);
  var entries = (kb.clinicalProblems && kb.clinicalProblems.problems) || [];
  var results = [];

  entries.forEach(function (entry) {
    var chronicKeywords = (entry.chronic_keywords_es || []).concat(entry.chronic_keywords_en || []);
    var plainKeywords = (entry.keywords_es || []).concat(entry.keywords_en || []);

    /* Chronic-specific phrasing takes priority: if the note uses a phrase
       like "hipertensión arterial esencial" or "HTA previa", that alone
       settles status=history regardless of what classifyMention would say
       about the shorter bare term nearby. */
    var chronicHit = null;
    for (var ci = 0; ci < chronicKeywords.length; ci++) {
      var normKw = normalizeSymptomText(chronicKeywords[ci]);
      var pos = findTermInNote(normalized, normKw);
      if (pos) { chronicHit = { pos: pos, keyword: chronicKeywords[ci] }; break; }
    }

    var plainHit = null;
    for (var pi = 0; pi < plainKeywords.length; pi++) {
      var normKw2 = normalizeSymptomText(plainKeywords[pi]);
      var pos2 = findTermInNote(normalized, normKw2);
      if (pos2) { plainHit = { pos: pos2, keyword: plainKeywords[pi] }; break; }
    }

    var hit = chronicHit || plainHit;
    if (!hit) return;

    var cls = classifyMention(normalized, hit.pos.index, hit.pos.length);
    var status = cls.status;
    if (chronicHit && status === 'active') status = 'history'; /* explicit chronic phrasing wins */

    results.push({
      id: entry.id,
      concept_es: entry.concept_es,
      concept_en: entry.concept_en,
      category: entry.category || '',
      status: status, /* 'active' | 'history' | 'negated' | 'suspected' */
      matched_keyword: hit.keyword,
      is_chronic_phrasing: !!chronicHit,
      evidence_span: extractSentenceSnippet(original, hit.pos.index, hit.pos.length),
      source: 'explicit',
      confidence: status === 'active' ? 'high' : 'medium',
      measurement_type: entry.measurement_type || null,
      diagnostic_note_es: entry.diagnostic_note_es || '',
      diagnostic_note_en: entry.diagnostic_note_en || '',
      alternative_indication_for_drug_examples: entry.alternative_indication_for_drug_examples || [],
      source_cascade_ids: entry.source_cascade_ids || [],
      references: entry.references || []
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
  var problems = detectGenericActiveProblems(corrected, kb);
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
    if (p.status === 'negated') continue;
    if (currentCascadeId && Array.isArray(p.source_cascade_ids) && p.source_cascade_ids.indexOf(currentCascadeId) !== -1) continue;
    var drugs = (p.alternative_indication_for_drug_examples || []).map(normalizeDrugText);
    if (drugs.indexOf(normCascade) === -1) continue;
    return {
      found: true,
      reason_es: p.concept_es,
      reason_en: p.concept_en,
      chronic: p.status === 'history' || p.is_chronic_phrasing
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

var DRUG_SPECIFIC_MODIFIER_IDS = ['CM006', 'CM007']; /* anticholinergic / CNS depressant burden */

function detectClinicalContextModifiers(noteText, kb) {
  if (!noteText || !noteText.trim()) return [];
  var modifiers = (kb.clinicalModifiers && kb.clinicalModifiers.clinical_modifiers) || [];
  if (!modifiers.length) return [];
  var normalizedNote = normalizeDrugText(noteText);
  var matched = [];
  modifiers.forEach(function (mod) {
    var keywords = [].concat((mod.trigger_context && mod.trigger_context.keywords_en) || [],
                              (mod.trigger_context && mod.trigger_context.keywords_es) || []);
    for (var ki = 0; ki < keywords.length; ki++) {
      var kw = normalizeDrugText(keywords[ki]);
      if (kw && normalizedNote.indexOf(kw) !== -1) { matched.push(mod); return; }
    }
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
 *   - globalAlerts: drug-burden scores (anticholinergic/CNS depressant) that
 *     are properties of the CURRENT DRUG LIST as a whole, never of one
 *     cascade — these become their own entries in CaseModel.globalMedicationAlerts
 *     and are NEVER merged into a cascade card's text.
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
  var mentionCanonicals = (mentions || []).map(function (m) { return m.canonical; });

  var alerts = split.globalAlerts.map(function (mod) {
    return {
      id: mod.id,
      type: 'drug_burden',
      name_es: mod.name_es,
      name_en: mod.name_en,
      message_es: mod.message_es,
      message_en: mod.message_en,
      drugs_involved: mentionCanonicals,
      references: mod.references || [],
      rule_id: mod.id
    };
  });

  return { alerts: alerts, patientLevelModifiers: split.patientLevel };
}

/* ============================================================
   9. Duplicate suppression
   ============================================================ */

function confidenceRank(conf) { return conf === 'high' ? 3 : conf === 'medium' ? 2 : 1; }
function priorityRank(priority) { return priority === 'alta' ? 3 : priority === 'intermedia' ? 2 : 1; }
function classificationRank(c) {
  var order = { supported_possible_cascade: 5, possible_but_incomplete: 4, pharmacological_match_only: 3, not_evaluable: 2, discarded: 1 };
  return order[c] || 0;
}

function suppressDuplicateSignals(signals) {
  if (!signals || signals.length < 2) return signals;
  var groups = {};
  signals.forEach(function (sig) {
    var key = normalizeDrugText(sig.index_drug || '') + '|' + normalizeDrugText(sig.cascade_drug || '');
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
  return result;
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
        checked: true, status: fromActive.status, evidence_span: fromActive.evidence_span,
        source: 'clinical_problems', linked_problem_id: problemEntry.id,
        measurement_type: problemEntry.measurement_type || null,
        diagnostic_note_es: problemEntry.diagnostic_note_es || '',
        diagnostic_note_en: problemEntry.diagnostic_note_en || ''
      };
    }
    return { checked: true, status: 'none', evidence_span: '', source: 'clinical_problems', linked_problem_id: problemEntry.id };
  }

  var atmEntry = findAdeTreatmentEntry(cascade, kb);
  if (!atmEntry) return { checked: false, status: 'unknown', evidence_span: '', source: 'none', linked_problem_id: null };

  var synonyms = [].concat(atmEntry.ade_synonyms_es || [], atmEntry.ade_synonyms_en || []);
  var normalized = normalizeSymptomText(noteText);
  for (var i = 0; i < synonyms.length; i++) {
    var normKw = normalizeSymptomText(synonyms[i]);
    var pos = findTermInNote(normalized, normKw);
    if (pos) {
      var cls = classifyMention(normalized, pos.index, pos.length);
      return {
        checked: true, status: cls.status,
        evidence_span: extractSentenceSnippet(noteText, pos.index, pos.length),
        source: 'ade_treatment_map', linked_problem_id: null
      };
    }
  }
  return { checked: true, status: 'none', evidence_span: '', source: 'ade_treatment_map', linked_problem_id: null };
}

function detectDrugPairTemporality(noteText, indexDrug, cascadeDrug) {
  var idxPos = indexDrug ? findTermInNote(noteText, indexDrug) : null;
  var casPos = cascadeDrug ? findTermInNote(noteText, cascadeDrug) : null;
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
function classifyCascadeSignal(problemCheck, altIndication, temporality, measurementDiscordance) {
  if (altIndication.found && problemCheck.status !== 'active') {
    return { classification: 'discarded', reason_code: 'alternative_indication_found' };
  }
  if (problemCheck.status === 'negated') {
    return { classification: 'discarded', reason_code: 'problem_negated' };
  }
  if (problemCheck.status === 'history') {
    return { classification: 'discarded', reason_code: 'problem_chronic_or_prior' };
  }
  if (problemCheck.status === 'none' || !problemCheck.checked) {
    return { classification: 'pharmacological_match_only', reason_code: 'pharmacological_class_match_only' };
  }
  if (problemCheck.status === 'suspected') {
    return { classification: 'not_evaluable', reason_code: 'problem_suspected_only' };
  }
  /* status === 'active' from here on */
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

function evaluateDrugDrugCascades(noteText, kb, mentions, activeProblems, measurements) {
  var mentionByCanonical = {};
  mentions.forEach(function (m) {
    var key = normalizeDrugText(m.canonical);
    if (!mentionByCanonical[key]) mentionByCanonical[key] = [];
    mentionByCanonical[key].push(m);
  });

  var signals = [];
  var potentialAdeNoCascadeDrug = [];

  allCascadeEntries(kb).forEach(function (cascade) {
    var indexExamples = getIndexExamples(cascade);
    var cascadeExamples = getCascadeExamples(cascade);

    var foundIndex = null, foundIndexMeta = null;
    indexExamples.some(function (d) {
      var hit = mentionByCanonical[normalizeDrugText(d)];
      if (hit && hit.length) { foundIndex = d; foundIndexMeta = hit[0]; return true; }
      return false;
    });
    var foundCascade = null, foundCascadeMeta = null;
    cascadeExamples.some(function (d) {
      var hit = mentionByCanonical[normalizeDrugText(d)];
      if (hit && hit.length) { foundCascade = d; foundCascadeMeta = hit[0]; return true; }
      return false;
    });

    if (!foundIndex) return;

    var problemCheck = verifyIntermediateProblem(noteText, cascade, kb, activeProblems);

    if (!foundCascade) {
      /* Index drug + an actively-documented intermediate problem, but no
         second (cascade) drug at all: this is a potential ADE worth
         surfacing, but it is NOT a cascade (no third element) — kept out
         of possibleCascades per the CaseModel contract. */
      if (problemCheck.checked && problemCheck.status === 'active') {
        potentialAdeNoCascadeDrug.push({
          index_drug: foundIndex,
          ade_es: cascade.ade_es || '',
          ade_en: cascade.ade_en || '',
          evidence_span: problemCheck.evidence_span,
          rule_id: cascade.id
        });
      }
      return;
    }

    var altIndication = detectAlternativeIndication(noteText, foundCascade, kb, activeProblems, cascade.id);
    var temporality = detectDrugPairTemporality(noteText, foundIndex, foundCascade);
    var measDiscordance = checkMeasurementDiscordance(problemCheck, measurements);
    var decision = classifyCascadeSignal(problemCheck, altIndication, temporality, measDiscordance.discordant);

    var adeDisplay = { es: cascade.ade_es || '', en: cascade.ade_en || '' };

    signals.push({
      cascade_id: cascade.id,
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
      ddi_warning: cascade.ddi_warning_en || '',
      ddi_warning_es: cascade.ddi_warning_es || '',
      recommended_action_es: getLocalizedField(cascade, 'recommended_first_action', 'es') || getLocalizedField(cascade, 'clinical_note', 'es'),
      recommended_action_en: getLocalizedField(cascade, 'recommended_first_action', 'en') || getLocalizedField(cascade, 'clinical_note', 'en'),
      classification: decision.classification,
      classification_reason_code: decision.reason_code,
      classification_reason_es: msg(decision.reason_code, 'es'),
      classification_reason_en: msg(decision.reason_code, 'en'),
      evidence: {
        index_drug: { present: true, mention: foundIndexMeta && foundIndexMeta.mention, source: 'explicit' },
        cascade_drug: { present: true, mention: foundCascadeMeta && foundCascadeMeta.mention, source: 'explicit' },
        intermediate_problem: problemCheck,
        temporal_order: temporality,
        alternative_indication: altIndication,
        measurement_discordance: measDiscordance
      },
      merged_from: cascade.merged_from || [],
      references: cascade.references || []
    });
  });

  return { signals: signals, potentialAdeNoCascadeDrug: potentialAdeNoCascadeDrug };
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
        causePos = findTermInNote(noteText, foundCauseMeta.mention) || { index: 0, length: foundCauseMeta.mention.length };
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
        treatPos = findTermInNote(noteText, foundTreatmentMeta.mention) || { index: 0, length: foundTreatmentMeta.mention.length };
        break;
      }
      var tp = findTermInNote(noteText, treatedBy[ti]);
      if (tp) { foundTreatment = treatedBy[ti]; treatPos = tp; break; }
    }
    if (!foundCause || !foundTreatment) return;

    var timeSym = detectTimeCues(noteText, typeof ds.startIndex === 'number' ? ds.startIndex : 0);
    var timeCause = detectTimeCues(noteText, causePos.index);
    var timeTreat = detectTimeCues(noteText, treatPos.index);

    var supportive = (timeCause.drugStartHint || timeCause.treatmentAddedHint) && (timeSym.symptomNewHint || timeTreat.treatmentAddedHint);
    var chronic = timeSym.chronicHint || timeTreat.chronicHint;

    var classification = supportive ? 'supported_possible_cascade'
      : chronic ? 'possible_but_incomplete'
      : 'possible_but_incomplete';
    var confidence = supportive ? 'high' : chronic ? 'low' : 'medium';

    var symLabel = ds.term.charAt(0).toUpperCase() + ds.term.slice(1);

    signals.push({
      cascade_id: ds.id + ':' + foundCause + ':' + foundTreatment,
      rule_id: ds.id,
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
      classification_reason_es: msg(supportive ? 'temporality_supportive' : 'temporality_unknown', 'es'),
      classification_reason_en: msg(supportive ? 'temporality_supportive' : 'temporality_unknown', 'en'),
      evidence: {
        index_drug: { present: true, mention: foundCause, source: 'explicit' },
        cascade_drug: { present: true, mention: foundTreatment, source: 'explicit' },
        intermediate_problem: { checked: true, status: 'active', evidence_span: '', source: 'symptom_dictionary' },
        temporal_order: { status: supportive ? 'supportive' : (chronic ? 'weak' : 'unknown') },
        alternative_indication: { found: false },
        measurement_discordance: { applicable: false, discordant: false }
      },
      merged_from: [],
      references: []
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
  kb = kb || {};

  if (!noteText || !noteText.trim()) {
    return {
      medications: [], activeProblems: [], clinicalMeasurements: [], events: [],
      possibleCascades: [], globalMedicationAlerts: [], missingInformation: [],
      drug_classes: []
    };
  }

  var corrected = normalizeClinicalText(noteText);
  var resolver = buildDrugResolver(kb);
  var mentions = resolveDrugMentions(corrected, resolver);
  var mentionByCanonical = {};
  mentions.forEach(function (m) {
    var key = normalizeDrugText(m.canonical);
    if (!mentionByCanonical[key]) mentionByCanonical[key] = [];
    mentionByCanonical[key].push(m);
  });

  var activeProblems = detectActiveProblems(corrected, kb, lang, resolver);
  var measurements = extractClinicalMeasurements(corrected);
  var symptomsDetected = extractSymptoms(corrected, kb);

  var drugDrug = evaluateDrugDrugCascades(corrected, kb, mentions, activeProblems, measurements);
  var symptomBridge = evaluateSymptomBridgeCascades(corrected, kb, mentionByCanonical, symptomsDetected);

  var allSignals = drugDrug.signals.concat(symptomBridge);

  var contextModifiers = detectClinicalContextModifiers(corrected, kb);
  var split = classifyMatchedModifiers(contextModifiers);
  allSignals = allSignals.map(function (sig) { return applyPatientLevelModifiers(sig, split.patientLevel); });

  allSignals = suppressDuplicateSignals(allSignals);

  var globalAlertsResult = buildGlobalMedicationAlerts(corrected, kb, mentions);

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
  var nsaidsPresent = mentions.filter(function (m) {
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

  var reconciledDrugCanonicals = mentions.map(function (m) { return m.canonical; })
    .filter(function (v, i, a) { return a.indexOf(v) === i; });

  var medications = reconciledDrugCanonicals.map(function (canonical) {
    var m = mentions.find(function (x) { return x.canonical === canonical; });
    /* Re-locate in `corrected` rather than trusting m.start_index, which is
       an offset into the resolver's internally-normalized (whitespace/
       punctuation-collapsed) copy, not into `corrected` itself. */
    var pos = findTermInNote(corrected, m.mention) || { index: 0, length: (m.mention || '').length };
    var posology = extractDosePosology(corrected, pos.index, pos.length);
    return {
      original_text: m.mention,
      normalized_name: canonical,
      brand: m.brand || null,
      active_ingredients: m.brand_ingredients || [canonical],
      drug_class: m.drug_class || '',
      dose: posology.dose, frequency: posology.frequency, route: null, start_date: null,
      prn: posology.prn,
      current_status: 'active',
      explicit_indication: null,
      source: m.match_type === 'combo_brand' ? 'inferred' : 'explicit',
      confidence: m.confidence || 'medium',
      evidence_span: extractSentenceSnippet(corrected, pos.index, pos.length)
    };
  });

  var uniqueClasses = [];
  medications.forEach(function (m) { if (m.drug_class && uniqueClasses.indexOf(m.drug_class) === -1) uniqueClasses.push(m.drug_class); });

  return {
    medications: medications,
    drug_classes: uniqueClasses,
    activeProblems: activeProblems,
    clinicalMeasurements: measurements,
    events: [], /* reserved for future chronological-event modelling */
    possibleCascades: allSignals,
    globalMedicationAlerts: globalAlertsResult.alerts,
    missingInformation: missingInformation,
    symptomsDetected: symptomsDetected
  };
}

/* ============================================================
   Public API
   ============================================================ */
return {
  MESSAGES: MESSAGES,
  msg: msg,
  getLocalizedField: getLocalizedField,
  normalizeClinicalText: normalizeClinicalText,
  normalizeDrugText: normalizeDrugText,
  normalizeSymptomText: normalizeSymptomText,
  buildDrugResolver: buildDrugResolver,
  resolveDrugMentions: resolveDrugMentions,
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
  confidenceRank: confidenceRank,
  priorityRank: priorityRank,
  classificationRank: classificationRank,
  classifyCascadeSignal: classifyCascadeSignal,
  buildCaseModel: buildCaseModel
};

});
