'use strict';

/* Read-only knowledge-base catalogue for the "Base de conocimiento" view.
 * Presentation helper only: it never changes the KB and never feeds the
 * clinical engine. It mirrors the engine's own predicates — a rule with
 * status "merged" never fires (ClinicalEngine.isActiveCascadeEntry) and a
 * rule is "reviewed_source" only when it carries references (same test as
 * knowledge_validation_status in buildCaseModel) — so the catalogue cannot
 * describe the KB differently from how the engine uses it. DOM-free so it
 * is testable in Node. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KBCatalog = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function localized(obj, base, lang) {
    if (!obj) return '';
    var preferred = obj[base + '_' + lang];
    if (typeof preferred === 'string' && preferred.trim()) return preferred;
    var en = obj[base + '_en'];
    if (typeof en === 'string' && en.trim()) return en;
    var bare = obj[base];
    return typeof bare === 'string' ? bare : '';
  }

  function list(value) {
    if (Array.isArray(value)) return value.filter(function (v) { return typeof v === 'string' && v.trim(); });
    return typeof value === 'string' && value.trim() ? [value] : [];
  }

  function toRow(entry, source, lang) {
    var references = list(entry.references);
    return {
      id: String(entry.id || ''),
      source: source,
      name: localized(entry, 'name', lang),
      index_class: list(entry.index_drug_classes).concat(list(entry.index_drug_class)).join(' / '),
      ade: localized(entry, 'ade', lang),
      cascade_class: list(entry.cascade_drug_class).join(' / '),
      mechanism: localized(entry, 'ade_mechanism', lang),
      index_examples: list(entry.index_drug_examples || entry.index_drugs_examples),
      cascade_examples: list(entry.cascade_drug_examples || entry.cascade_drugs_examples),
      action: localized(entry, 'recommended_first_action', lang) || localized(entry, 'clinical_note', lang),
      ddi_warning: localized(entry, 'ddi_warning', lang),
      references: references,
      knowledge_validation_status: references.length ? 'reviewed_source' : 'pending_review'
    };
  }

  /** canonical INN -> dictionary variants (e.g. amlodipine -> amlodipino),
   * used only to make the catalogue searchable with Spanish/brand names. */
  function variantIndex(kb) {
    var index = {};
    var entries = (kb.drugDictionary && kb.drugDictionary.entries) || [];
    entries.forEach(function (e) {
      if (e && typeof e.canonical === 'string') index[e.canonical.toLowerCase()] = list(e.variants);
    });
    return index;
  }

  /** Active cascade rules (core + HIV-specific) as display rows. */
  function buildRows(kb, lang) {
    kb = kb || {};
    var variants = variantIndex(kb);
    function withSearchTerms(row) {
      row.search_terms = row.index_examples.concat(row.cascade_examples).reduce(function (acc, name) {
        return acc.concat(variants[name.toLowerCase()] || []);
      }, []);
      return row;
    }
    var core = (kb.coreCascades && kb.coreCascades.cascades) || [];
    var vih = (kb.vihModifiers && kb.vihModifiers.art_related_cascades) || [];
    var active = function (entry) { return entry && entry.status !== 'merged'; };
    return core.filter(active).map(function (e) { return withSearchTerms(toRow(e, 'core', lang)); })
      .concat(vih.filter(active).map(function (e) { return withSearchTerms(toRow(e, 'hiv', lang)); }));
  }

  function count(obj, key) {
    var value = obj && obj[key];
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object') return Object.keys(value).length;
    return null;
  }

  /** Per-file inventory: version and entry count, read from the loaded KB. */
  function inventory(kb) {
    kb = kb || {};
    var core = (kb.coreCascades && kb.coreCascades.cascades) || [];
    var vih = (kb.vihModifiers && kb.vihModifiers.art_related_cascades) || [];
    var activeCore = core.filter(function (e) { return e && e.status !== 'merged'; }).length;
    var activeVih = vih.filter(function (e) { return e && e.status !== 'merged'; }).length;
    function file(key, collection, active) {
      var data = kb[key];
      return {
        key: key,
        loaded: !!data,
        version: data && data.version ? String(data.version) : '',
        count: active !== undefined ? active : count(data, collection)
      };
    }
    return [
      file('coreCascades', 'cascades', kb.coreCascades ? activeCore : undefined),
      file('vihModifiers', 'art_related_cascades', kb.vihModifiers ? activeVih : undefined),
      file('ddiWatchlist', 'interactions'),
      file('symptomDictionary', 'symptoms'),
      file('clinicalProblems', 'problems'),
      file('clinicalModifiers', 'clinical_modifiers'),
      file('drugDictionary', 'entries'),
      file('drugCombinations', 'combinations')
    ];
  }

  function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /** Free-text filter over the visible row fields (accent-insensitive). */
  function filterRows(rows, query, filters) {
    var q = normalize(query).trim();
    filters = filters || {};
    return rows.filter(function (row) {
      if (filters.source && filters.source !== 'all' && row.source !== filters.source) return false;
      if (filters.status && filters.status !== 'all' && row.knowledge_validation_status !== filters.status) return false;
      if (!q) return true;
      var haystack = normalize([row.id, row.name, row.index_class, row.ade, row.cascade_class]
        .concat(row.index_examples, row.cascade_examples, row.search_terms || []).join(' '));
      return q.split(/\s+/).every(function (term) { return haystack.indexOf(term) !== -1; });
    });
  }

  return { buildRows: buildRows, inventory: inventory, filterRows: filterRows };
}));
