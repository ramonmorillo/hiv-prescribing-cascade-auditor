'use strict';
/* ============================================================================
   DDI reachability — every interaction rule must be able to fire.

   Defect this guards against (Fase 0 audit, 2026-11): participants used to be
   derived by splitting the free-text drug_a/drug_b labels, so labels naming a
   class ("Proton pump inhibitors") or a medicine missing from the dictionary
   could never match a real note. 27/60 rules — 8 CONTRAINDICATED — were
   unreachable while the whole suite stayed green, because no test asked
   "can this rule fire at all?". This suite asks it for every participant of
   every rule, in Spanish and English, through the real buildCaseModel().
   ============================================================================ */
const { loadKB, CE, assert, reset, summary } = require('./helpers');

const N = CE.normalizeDrugText;

function dictionaryIndex(kb) {
  const byCanonical = {};
  kb.drugDictionary.entries.forEach((e) => { byCanonical[N(e.canonical)] = e; });
  return byCanonical;
}

/** A Spanish-looking written form of a canonical drug, if the dictionary has one. */
function spanishForm(entry) {
  const variants = (entry.variants || []).filter((v) => /^[a-záéíóúñü][a-záéíóúñü\s-]+$/i.test(v));
  return variants.find((v) => /(o|a|ina|ol|ib|an)$/.test(v) && N(v) !== N(entry.canonical)) || entry.canonical;
}

function note(drugA, drugB) {
  return 'Paciente con infección por VIH en seguimiento. Tratamiento activo: ' + drugA +
    ' 1 comprimido cada 24 horas. ' + drugB + ' 1 comprimido cada 24 horas.';
}

function fires(kb, text, id, lang) {
  return CE.buildCaseModel(text, kb, { lang: lang || 'es' }).currentInteractions.some((i) => i.id === id);
}

function run() {
  reset();
  console.log('== kb-ddi-coverage.test.js ==');

  ['prod', 'dev'].forEach((track) => {
    const kb = loadKB(track);
    const dict = dictionaryIndex(kb);
    const rules = kb.ddiWatchlist.interactions;

    /* 1. Structural: explicit participants, all resolvable. */
    rules.forEach((r) => {
      const a = r.participants_a, b = r.participants_b;
      assert(`[${track}] ${r.id} declares participants_a and participants_b`,
        Array.isArray(a) && a.length > 0 && Array.isArray(b) && b.length > 0);
      (a || []).concat(b || []).forEach((name) => {
        assert(`[${track}] ${r.id} participant "${name}" is a drug_dictionary canonical`, !!dict[N(name)]);
      });
      assert(`[${track}] ${r.id} applicability notes are bilingual or absent`,
        !!r.applicability_note_es === !!r.applicability_note_en);
    });

    /* 2. Behavioural: every participant activates its rule end to end. Each
       side is exercised against the first member of the other side. */
    rules.forEach((r) => {
      if (!Array.isArray(r.participants_a) || !Array.isArray(r.participants_b)) return;
      const firstA = dict[N(r.participants_a[0])], firstB = dict[N(r.participants_b[0])];
      if (!firstA || !firstB) return;
      r.participants_a.forEach((name) => {
        const e = dict[N(name)]; if (!e) return;
        assert(`[${track}] ${r.id} fires for ${name} (ES) + ${firstB.canonical}`,
          fires(kb, note(spanishForm(e), spanishForm(firstB)), r.id));
      });
      r.participants_b.forEach((name) => {
        const e = dict[N(name)]; if (!e) return;
        assert(`[${track}] ${r.id} fires for ${firstA.canonical} + ${name} (ES)`,
          fires(kb, note(spanishForm(firstA), spanishForm(e)), r.id));
      });
      assert(`[${track}] ${r.id} fires for English canonical names`,
        fires(kb, 'Current medication: ' + firstA.canonical + ' once daily. ' + firstB.canonical + ' once daily.', r.id, 'en'));
    });
  });

  /* 3. Fixed-dose combinations must expose every ingredient — a regimen that
     loses its booster silently loses every booster interaction. */
  const kb = loadKB('prod');
  const regimens = [
    ['Genvoya', ['elvitegravir', 'cobicistat', 'emtricitabine', 'tenofovir alafenamide']],
    ['Stribild', ['elvitegravir', 'cobicistat', 'emtricitabine', 'tenofovir disoproxil fumarate']],
    ['Odefsey', ['rilpivirine', 'emtricitabine', 'tenofovir alafenamide']],
    ['Eviplera', ['rilpivirine', 'emtricitabine', 'tenofovir disoproxil fumarate']],
    ['Atripla', ['efavirenz', 'emtricitabine', 'tenofovir disoproxil fumarate']],
    ['Delstrigo', ['doravirine', 'lamivudine', 'tenofovir disoproxil fumarate']],
    ['Prezcobix', ['darunavir', 'cobicistat']],
    ['Darunavir/ritonavir', ['darunavir', 'ritonavir']],
    ['DRV/r', ['darunavir', 'ritonavir']],
    ['ATV/r', ['atazanavir', 'ritonavir']],
    ['Atazanavir/ritonavir', ['atazanavir', 'ritonavir']],
    ['Tenofovir disoproxilo', ['tenofovir disoproxil fumarate']],
    ['Maraviroc', ['maraviroc']],
    ['Rekambys', ['rilpivirine']]
  ];
  regimens.forEach(([written, expected]) => {
    const meds = CE.buildCaseModel('Tratamiento antirretroviral: ' + written + '.', kb, { lang: 'es' })
      .activeMedications.map((m) => m.normalized_name).sort();
    assert(`"${written}" expands to exactly ${expected.join(' + ')} (got ${meds.join(' + ') || 'nothing'})`,
      JSON.stringify(meds) === JSON.stringify(expected.slice().sort()));
  });

  /* 4. The concrete false negatives reported by the audit, as written by clinicians. */
  [
    ['Darunavir/ritonavir 800/100 mg. Simvastatina 40 mg.', 'DDI001'],
    ['DRV/r + simvastatina 20 mg', 'DDI001'],
    ['Genvoya 1 comp/24h. Simvastatina 40 mg.', 'DDI001'],
    ['Stribild. Midazolam oral 7,5 mg.', 'DDI005'],
    ['Darunavir/ritonavir. Quetiapina 100 mg.', 'DDI019'],
    ['Odefsey. Omeprazol 20 mg por pirosis.', 'DDI018'],
    ['Edurant 25 mg. Pantoprazol 40 mg.', 'DDI018'],
    ['Norvir 100 mg. Sildenafilo 50 mg a demanda.', 'DDI002'],
    ['Efavirenz 600 mg. Metadona 80 mg/día.', 'DDI007'],
    ['Kaletra. Pimozida.', 'DDI019'],
    ['Dolutegravir 50 mg. Dofetilida.', 'DDI047'],
    ['Biktarvy. Hipérico (hierba de San Juan) como suplemento.', 'DDI036'],
    ['Dolutegravir 50 mg. Carbonato cálcico 1,5 g.', 'DDI014'],
    ['Atazanavir/ritonavir. Tenofovir disoproxilo 245 mg.', 'DDI041']
  ].forEach(([text, id]) => {
    assert(`audit false negative closed: "${text}" -> ${id}`, fires(kb, text, id));
  });

  /* 5. The composite label from a cascade rule must never reappear as a
     medication of its own (CaseModel stores distinct ingredients). */
  const composite = CE.buildCaseModel('Darunavir/ritonavir 800/100 mg.', kb, { lang: 'es' });
  assert('no slash-composite canonical in activeMedications',
    composite.activeMedications.every((m) => m.normalized_name.indexOf('/') === -1));

  /* 6. Ratchet on cascade-rule names the dictionary does not know. Fixing
     all of them is a KB editorial task (some are not even medicines); the
     guarantee here is that the backlog can only shrink. */
  const { unresolvedCascadeNames } = require('../kb/dev/unresolved_cascade_names.js');
  const baseline = require('./fixtures/unresolved-cascade-names.json').names;
  const current = unresolvedCascadeNames(kb, N);
  const added = current.filter((n) => baseline.indexOf(n) === -1);
  const stale = baseline.filter((n) => current.indexOf(n) === -1);
  assert('no NEW unresolved cascade-rule drug names (add them to drug_dictionary.json): ' + added.join(', '), added.length === 0);
  assert('ratchet baseline has no names that now resolve (run node kb/dev/unresolved_cascade_names.js --write): ' + stale.join(', '),
    stale.length === 0);

  const r = summary();
  console.log('  -> ' + r.pass + ' passed, ' + r.fail + ' failed');
  return r.fail === 0;
}

module.exports = { run };
