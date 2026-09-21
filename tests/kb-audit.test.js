'use strict';
/* ============================================================================
   Structural KB validation — catches the class of defect this audit found
   (near-duplicate rules, dead cross-references) automatically, so it cannot
   silently recur as the KB grows.
   ============================================================================ */
const { loadKB, CE, assert, assertEqual, reset, summary } = require('./helpers');
const { validateKBStrict, validateKBOperational } = require('../kb/dev/kb_validator.js');

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
    const cc004 = all.find((c) => c.id === 'CC004');
    const cc041 = all.find((c) => c.id === 'CC041');
    assert(`[${track}] CC061 is marked merged into CC001`, !!cc061 && cc061.status === 'merged' && cc061.merged_into === 'CC001');
    assert(`[${track}] CC050 is marked merged into CC033`, !!cc050 && cc050.status === 'merged' && cc050.merged_into === 'CC033');
    assert(`[${track}] CC041 is traceably merged into canonical CC004`, !!cc041 && cc041.status === 'merged' &&
      cc041.merged_into === 'CC004' && cc004.merged_from.includes('CC041'));

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

  const overlapping = {
    version: 'test', cascades: ['A', 'B'].map((id) => ({
      id, name_es: id, name_en: id,
      index_drug_classes: ['class'], index_drug_examples: ['drug-a', 'drug-b'],
      ade_es: 'edema periférico', ade_en: 'peripheral oedema',
      cascade_drug_examples: ['drug-c', 'drug-d'], confidence: 'high', age_sensitivity: 'low',
      risk_focus: ['cardiovascular'], differential_hints: ['one', 'two', 'three'], appropriateness: 'context_dependent'
    }))
  };
  const overlapReport = validateKBStrict(overlapping);
  assert('KB validator warns without blocking or automatically merging overlapping active rules',
    overlapReport.ok && overlapReport.warnings.some((warning) => /Possible overlapping active rules/.test(warning)) &&
    overlapping.cascades.every((entry) => !entry.status && !entry.merged_into));

  /* The nine near-duplicate active pairs this validator used to flag
     (CC003/CC042, CC007/CC045, CC013/CC070, CC019/CC082, CC023/CC053,
     CC025/CC079, CC026/CC068, CC027/CC067, CC028/CC065) were reviewed and
     merged into their lower-numbered, originally-referenced counterpart —
     see kb/kb_cascade_registry.md and kb/CHANGELOG.md. The detector itself
     must keep working (proven above with synthetic entries); production
     content should no longer trip it. */
  const prodOverlapReport = validateKBOperational(loadKB('prod').coreCascades);
  const prodOverlapWarnings = prodOverlapReport.warnings.filter((warning) =>
    /Possible overlapping active rules/.test(warning));
  assertEqual('operational KB validation finds no remaining unreviewed overlapping active pairs',
    prodOverlapWarnings.length, 0);

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

  /* ---- No active rule may ever produce two candidates for the exact same
     (index drug, cascade drug) pair. Feeding every one of a rule's own
     listed examples into a single note exercises the redundant
     composite/bare match case (a rule listing both "cobicistat" and
     "darunavir/cobicistat") across the WHOLE active catalogue, not just the
     one case reported against the demo — this must keep holding as the KB
     grows, not just today. ---- */
  ['prod', 'dev'].forEach((track) => {
    const kb = loadKB(track);
    const allRules = [].concat(kb.coreCascades.cascades, kb.vihModifiers.art_related_cascades || [])
      .filter((r) => r.status !== 'merged');
    allRules.forEach((rule) => {
      const idxExamples = rule.index_drug_examples || rule.index_drugs_examples || [];
      const cascExamples = rule.cascade_drug_examples || rule.cascade_drugs_examples || [];
      const note = idxExamples.concat(cascExamples).map((t) => t.replace(/\//g, ' ')).join(', ') +
        '. Presenta un problema clinico. Se inicia tratamiento.';
      const model = CE.buildCaseModel(note, kb, { lang: 'es' });
      const pairs = {};
      model.possibleCascades.filter((s) => s.rule_id === rule.id).forEach((s) => {
        const key = CE.normalizeDrugText(s.index_drug) + '|' + CE.normalizeDrugText(s.cascade_drug);
        pairs[key] = (pairs[key] || 0) + 1;
      });
      Object.entries(pairs).forEach(([key, count]) => {
        assert(`[${track}] ${rule.id} fires once for ${key}, not ${count} times (redundant composite/bare match)`, count === 1);
      });
    });
  });

  const r = summary();
  console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`);
  return r.fail === 0;
}

module.exports = { run };
if (require.main === module) { process.exit(run() ? 0 : 1); }
