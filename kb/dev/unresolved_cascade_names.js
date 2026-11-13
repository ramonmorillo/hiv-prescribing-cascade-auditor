'use strict';
/* Lists cascade-rule drug names (index/cascade examples, every slash part)
 * that are not a drug_dictionary canonical or variant. Such names only match
 * a note that uses the literal English label: a Spanish note ("sildenafilo")
 * or a brand silently misses the rule. Shared by the ratchet test and the
 * baseline generator.
 * Usage: node kb/dev/unresolved_cascade_names.js --write   (refresh baseline) */
function unresolvedCascadeNames(kb, normalize) {
  var known = {};
  kb.drugDictionary.entries.forEach(function (e) {
    [e.canonical].concat(e.variants || []).forEach(function (v) { known[normalize(v)] = true; });
  });
  var rules = (kb.coreCascades.cascades || []).concat(kb.vihModifiers.art_related_cascades || [])
    .filter(function (c) { return c.status !== 'merged'; });
  var out = {};
  rules.forEach(function (r) {
    (r.index_drug_examples || r.index_drugs_examples || []).concat(r.cascade_drug_examples || r.cascade_drugs_examples || [])
      .forEach(function (label) {
        label.split('/').forEach(function (part) {
          var n = normalize(part.trim());
          if (n && !known[n]) out[n] = true;
        });
      });
  });
  return Object.keys(out).sort();
}
module.exports = { unresolvedCascadeNames: unresolvedCascadeNames };

if (require.main === module && process.argv.indexOf('--write') !== -1) {
  var fs = require('fs'), path = require('path');
  var CE = require('../../clinical-engine.js');
  var load = function (p) { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', p), 'utf8')); };
  var kb = { drugDictionary: load('drug_dictionary.json'), coreCascades: load('prod/kb_core_cascades.json'), vihModifiers: load('prod/kb_vih_modifiers.json') };
  var names = unresolvedCascadeNames(kb, CE.normalizeDrugText);
  var file = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'unresolved-cascade-names.json');
  fs.writeFileSync(file, JSON.stringify({
    description: 'Ratchet baseline: cascade-rule drug names (PROD) not yet in drug_dictionary.json. Mix of real medicines lacking Spanish variants and non-drug free text (e.g. procedures) that should be removed from *_drug_examples. This list may only shrink.',
    generated: new Date().toISOString().slice(0, 10), count: names.length, names: names
  }, null, 2) + '\n');
  console.log('baseline written: ' + names.length + ' names');
}
