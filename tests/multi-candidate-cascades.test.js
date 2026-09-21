'use strict';
const { loadKB, CE, assert, assertEqual, reset, summary } = require('./helpers');

function plausible(model) {
  return model.possibleCascades.filter((c) =>
    c.classification === 'supported_possible_cascade' || c.classification === 'possible_but_incomplete');
}

function run() {
  reset(); console.log('== multi-candidate-cascades.test.js ==');
  const kb = loadKB('prod');

  const complete = CE.buildCaseModel('Varón con VIH en tratamiento con Dovato. No toma metformina; podría iniciarse si desarrolla diabetes. Hidroclorotiazida suspendida desde enero de 2023. Etoricoxib activo desde febrero de 2026. En mayo de 2026 aparece hipertensión y se inicia candesartán, indicado para hipertensión.', kb, { lang: 'es' });
  assertEqual('complete case has exactly the four active ingredients',
    complete.medications.map((m) => m.normalized_name).sort(),
    ['candesartan', 'dolutegravir', 'etoricoxib', 'lamivudine']);
  assert('hydrochlorothiazide remains traceable but inactive',
    !complete.medications.some((m) => m.normalized_name === 'hydrochlorothiazide') &&
    complete.inactiveOrNegatedMedications.some((m) => m.normalized_name === 'hydrochlorothiazide'));
  assert('metformin remains non-active and triggers no interaction',
    !complete.medications.some((m) => m.normalized_name === 'metformin') && complete.currentInteractions.length === 0);
  const main = plausible(complete);
  assert('complete case has one supported CC001 candidate with candesartan', main.length === 1 &&
    main[0].cascade_id === 'CC001' && main[0].index_drug === 'etoricoxib' &&
    main[0].cascade_drug === 'candesartan' && main[0].classification === 'supported_possible_cascade');
  assert('complete case uses cautious professional-validation language',
    /secuencia temporal y farmacológica/i.test(main[0].classification_reason_es) &&
    /relación causal requiere validación profesional/i.test(main[0].classification_reason_es) &&
    !/secuencia causal|confirmada/i.test(main[0].classification_reason_es));

  const chronological = CE.buildCaseModel('Enalapril fue suspendido en 2022. En enero de 2026 inicia naproxeno. En marzo se diagnostica hipertensión y se inicia amlodipino.', kb);
  assert('suspended first antihypertensive does not block amlodipine',
    !chronological.medications.some((m) => m.normalized_name === 'enalapril') &&
    plausible(chronological).some((c) => c.index_drug === 'naproxen' && c.cascade_drug === 'amlodipine'));

  const inverted = CE.buildCaseModel('Actualmente toma amlodipino, iniciado en marzo de 2026 tras diagnosticarse hipertensión. Naproxeno se inició en enero de 2026. Enalapril había sido suspendido en 2022.', kb);
  assertEqual('sentence order leaves the clinical candidate unchanged',
    plausible(inverted).map((c) => [c.cascade_id, c.index_drug, c.cascade_drug, c.classification]),
    plausible(chronological).map((c) => [c.cascade_id, c.index_drug, c.cascade_drug, c.classification]));

  const prior = CE.buildCaseModel('Hipertensión desde 2020 y candesartán desde entonces. Inicia diclofenaco en 2026.', kb);
  assert('prior antihypertensive cannot become an incident cascade', plausible(prior).length === 0);

  ['No toma metformina. Actualmente recibe dolutegravir.', 'Podría iniciarse metformina si desarrolla diabetes.'].forEach((note) => {
    const model = CE.buildCaseModel(note, kb);
    assert(note + ' excludes metformin from current reasoning',
      !model.medications.some((m) => m.normalized_name === 'metformin') &&
      model.currentInteractions.length === 0 && model.possibleCascades.length === 0);
  });

  const two = CE.buildCaseModel('Inicia naproxeno en enero. En marzo desarrolla hipertensión e inicia amlodipino. En abril añade losartán por control insuficiente.', kb);
  const later = plausible(two).filter((c) => c.cascade_id === 'CC001');
  assert('both later antihypertensives are evaluated independently', later.length === 2 &&
    later.some((c) => c.cascade_drug === 'amlodipine') && later.some((c) => c.cascade_drug === 'losartan'));
  assert('initial response and subsequent intensification are retained',
    later.find((c) => c.cascade_drug === 'amlodipine').candidate_role === 'initial_response' &&
    later.find((c) => c.cascade_drug === 'losartan').candidate_role === 'subsequent_intensification');

  const nonEquivalent = CE.suppressDuplicateSignals([
    { rule_id: 'A', signal_type: 'drug_drug', ade_en: 'one', index_drug: 'x', cascade_drug: 'y' },
    { rule_id: 'B', signal_type: 'drug_drug', ade_en: 'two', index_drug: 'x', cascade_drug: 'y' }
  ]);
  assert('different rules for the same pair are not falsely deduplicated', nonEquivalent.length === 2);

  /* ---- VIH003 with BOTH metformin and atorvastatin present: two distinct,
     legitimate candidates are expected (one per cascade_drug) — but the
     dolutegravir-metformin dosing warning must only appear on the metformin
     candidate. Before the fix, `ddiVisible` only checked "is metformin
     anywhere in the note", so the same metformin-specific warning bled onto
     the unrelated atorvastatin candidate, making the two cards look like a
     duplicated finding in the review step. ---- */
  const vih003note = CE.buildCaseModel('Varón con VIH en tratamiento con dolutegravir. Presenta ganancia de peso significativa y síndrome metabólico. Toma metformina para diabetes tipo 2 y atorvastatina para dislipemia.', kb, { lang: 'es' });
  const vih003candidates = vih003note.possibleCascades.filter((c) => c.cascade_id === 'VIH003');
  assert('VIH003 produces one candidate per cascade drug (metformin and atorvastatin)',
    vih003candidates.length === 2 &&
    vih003candidates.some((c) => c.cascade_drug === 'metformin') &&
    vih003candidates.some((c) => c.cascade_drug === 'atorvastatin'));
  assert('the dolutegravir-metformin DDI warning is shown on the metformin candidate',
    !!vih003candidates.find((c) => c.cascade_drug === 'metformin').ddi_warning_es);
  assert('the same DDI warning is NOT leaked onto the unrelated atorvastatin candidate',
    !vih003candidates.find((c) => c.cascade_drug === 'atorvastatin').ddi_warning_es);

  /* ---- A rule may list both a bare ingredient and a composite label that
     contains it (e.g. VIH027's "cobicistat" and "darunavir/cobicistat") to
     match a boosted regimen however the note phrases it. When a fixed-dose
     combination expands to both components, the bare form AND the composite
     form used to match independently, producing two cards for the exact
     same physical drug (the same cobicistat) — the duplicate reported
     against the demo case (Symtuza + inhaled fluticasone). Only the more
     specific (smallest) match should remain. ---- */
  const symtuzaFluticasone = CE.buildCaseModel(
    'Toma darunavir/cobicistat/emtricitabina/tenofovir alafenamida (Symtuza) y fluticasona inhalada. Toma metformina para diabetes tipo 2.', kb, { lang: 'es' });
  const vih027candidates = symtuzaFluticasone.possibleCascades.filter((c) => c.cascade_id === 'VIH027');
  assertEqual('VIH027 fires once for cobicistat, not once per index example that matches it',
    vih027candidates.length, 1);
  assert('the surviving VIH027 candidate uses the specific ingredient, not the redundant FDC label',
    vih027candidates[0] && vih027candidates[0].index_drug === 'cobicistat');

  /* Same redundant-composite pattern on a different rule (CC072: "ritonavir"
     bare + "lopinavir/ritonavir"/"darunavir/ritonavir"/"atazanavir/ritonavir"
     composites), confirming the fix is generic and not a VIH027-only patch. */
  const kaletraDyslipidemia = CE.buildCaseModel(
    'Toma lopinavir/ritonavir. Presenta dislipemia. Se inicia atorvastatina.', kb, { lang: 'es' });
  const cc072candidates = kaletraDyslipidemia.possibleCascades.filter((c) => c.cascade_id === 'CC072');
  assertEqual('CC072 fires once for ritonavir, not once per index example that matches it',
    cc072candidates.length, 1);
  assert('the surviving CC072 candidate uses the specific ingredient, not the redundant FDC label',
    cc072candidates[0] && cc072candidates[0].index_drug === 'ritonavir');

  /* A composite that is the ONLY matching example (no bare alternative also
     listed on the same rule) must keep firing exactly as before — this is
     VIH001, which lists "darunavir/cobicistat" but never bare "cobicistat". */
  const boostedRegimenOnly = CE.buildCaseModel(
    'Toma darunavir/cobicistat. Toma atorvastatina para dislipemia.', kb, { lang: 'es' });
  assert('a composite with no redundant bare alternative on the same rule still matches',
    boostedRegimenOnly.possibleCascades.some((c) => c.cascade_id === 'VIH001' && c.index_drug === 'darunavir/cobicistat'));

  /* ---- CC013/CC070 were a near-duplicate rule pair (merged 2026-09-21, see
     kb/kb_cascade_registry.md), and SYM001 (constipation) structurally
     overlapped both without naming either in its cascade_relevance text —
     together these produced THREE cards (CC070, SYM001, CC013, with
     contradictory classifications) for one clinical finding, reported
     against a real note. Both root causes are now fixed: CC070 no longer
     exists as an independent rule, and SYM001 is linked to CC013 so it
     folds in as provenance instead of rendering separately. ---- */
  const amitriptylineConstipation = CE.buildCaseModel(
    'Toma amitriptilina 25 mg por la noche desde enero de 2020. En marzo de 2020 presenta estreñimiento. Se inicia macrogol.', kb, { lang: 'es' });
  assertEqual('amitriptyline->constipation->macrogol renders exactly one card, not three',
    amitriptylineConstipation.possibleCascades.length, 1);
  const onlyCard = amitriptylineConstipation.possibleCascades[0];
  assert('the surviving card is CC013 with SYM001 folded in as provenance',
    onlyCard.rule_id === 'CC013' &&
    onlyCard.evidence.symptom_bridge_provenance.some((item) => item.rule_id === 'SYM001'));
  assert('CC070 no longer exists as an independent, firing rule',
    !amitriptylineConstipation.possibleCascades.some((c) => c.rule_id === 'CC070'));

  const r = summary(); console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`); return r.fail === 0;
}
module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
