'use strict';
/* ============================================================================
   Structural KB validation — catches the class of defect this audit found
   (near-duplicate rules, dead cross-references) automatically, so it cannot
   silently recur as the KB grows.
   ============================================================================ */
const { loadKB, CE, assert, reset, summary } = require('./helpers');

function run() {
  reset();
  console.log('== kb-audit.test.js ==');

  ['prod', 'dev'].forEach((track) => {
    const kb = loadKB(track);
    const core = kb.coreCascades.cascades || [];
    const vih = kb.vihModifiers.art_related_cascades || [];
    const all = core.concat(vih);

    const ids = all.map((c) => c.id);
    assert(`[${track}] every cascade id is unique`, new Set(ids).size === ids.length);

    all.forEach((c) => {
      assert(`[${track}] ${c.id} has index_drug_examples or index_drugs_examples`,
        Array.isArray(CE.getIndexExamples(c)) && CE.getIndexExamples(c).length > 0);
      assert(`[${track}] ${c.id} has cascade_drug_examples or cascade_drugs_examples`,
        Array.isArray(CE.getCascadeExamples(c)) && CE.getCascadeExamples(c).length > 0);
    });

    /* The two near-duplicate pairs found during the audit must stay merged
       and excluded from active detection (not silently deleted — see
       kb/CHANGELOG.md — but never firing on their own either). */
    const cc061 = all.find((c) => c.id === 'CC061');
    const cc050 = all.find((c) => c.id === 'CC050');
    assert(`[${track}] CC061 is marked merged into CC001`, !!cc061 && cc061.status === 'merged' && cc061.merged_into === 'CC001');
    assert(`[${track}] CC050 is marked merged into CC033`, !!cc050 && cc050.status === 'merged' && cc050.merged_into === 'CC033');

    const activeIds = CE.buildDrugResolver ? null : null; /* resolver doesn't expose active ids directly; check via allCascadeEntries indirectly */
    // Merged entries must not be usable as a live cascade: simulate a note containing
    // only their own first index+cascade example and confirm CC061/CC050 never appear.
    if (cc061) {
      const note = CE.getIndexExamples(cc061)[0] + ' y ' + CE.getCascadeExamples(cc061)[0] + ' pautados.';
      const model = CE.buildCaseModel(note, kb, { lang: 'es' });
      assert(`[${track}] CC061 never fires as its own signal (merged into CC001)`,
        !model.possibleCascades.some((s) => s.cascade_id === 'CC061'));
    }

    /* Every clinical_problems entry with source_cascade_ids must point at
       cascades that actually exist (no dangling cross-reference). */
    const problems = (kb.clinicalProblems && kb.clinicalProblems.problems) || [];
    problems.forEach((p) => {
      (p.source_cascade_ids || []).forEach((cid) => {
        assert(`[${track}] clinical_problems ${p.id} source_cascade_ids references an existing cascade (${cid})`,
          ids.indexOf(cid) !== -1);
      });
    });

    /* ade_treatment_map source_cascade_ids must also resolve. */
    const atmEntries = (kb.adeTreatmentMap && kb.adeTreatmentMap.ade_treatment_map) || [];
    atmEntries.forEach((e) => {
      (e.source_cascade_ids || []).forEach((cid) => {
        assert(`[${track}] ade_treatment_map ${e.ade_id} source_cascade_ids references an existing cascade (${cid})`,
          ids.indexOf(cid) !== -1);
      });
    });
  });

  /* drug_dictionary.json / drug_combinations.json: fixed-dose combination
     brands must never ALSO appear as a plain single-ingredient variant --
     that duplication is exactly what caused the Dovato defect. */
  {
    const dict = CE.msg ? require('../kb/drug_dictionary.json') : null;
    const combos = require('../kb/drug_combinations.json');
    const comboAliases = new Set();
    combos.combinations.forEach((c) => {
      [c.brand].concat(c.aliases || []).forEach((a) => comboAliases.add(a.toLowerCase()));
    });
    dict.entries.forEach((entry) => {
      (entry.variants || []).forEach((v) => {
        assert(`drug_dictionary variant "${v}" (under ${entry.canonical}) is not a combo brand handled elsewhere`,
          !comboAliases.has(v.toLowerCase()));
      });
    });
    assert('Dovato is registered as a combination (dolutegravir + lamivudine)',
      combos.combinations.some((c) => c.brand === 'Dovato' &&
        c.activeIngredients.includes('dolutegravir') && c.activeIngredients.includes('lamivudine')));
  }

  const r = summary();
  console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`);
  return r.fail === 0;
}

module.exports = { run };
if (require.main === module) { process.exit(run() ? 0 : 1); }
