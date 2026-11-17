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

    /* 2. Behavioural: every participant of every ACTIVE rule activates it end
       to end, paired with the first counterpart that is not an excluded pair
       (excluded pairs belong to a more specific rule). */
    const active = rules.filter((r) => r.status !== 'merged');
    const excluded = (r, x, y) => (r.excluded_pairs || []).some(([p, q]) =>
      (N(p) === N(x) && N(q) === N(y)) || (N(p) === N(y) && N(q) === N(x)));
    active.forEach((r) => {
      if (!Array.isArray(r.participants_a) || !Array.isArray(r.participants_b)) return;
      const counterpart = (name, side) => side.find((o) => o !== name && !excluded(r, name, o));
      r.participants_a.forEach((name) => {
        const e = dict[N(name)], other = dict[N(counterpart(name, r.participants_b) || '')]; if (!e || !other) return;
        assert(`[${track}] ${r.id} fires for ${name} (ES) + ${other.canonical}`,
          fires(kb, note(spanishForm(e), spanishForm(other)), r.id));
      });
      r.participants_b.forEach((name) => {
        const e = dict[N(name)], other = dict[N(counterpart(name, r.participants_a) || '')]; if (!e || !other) return;
        assert(`[${track}] ${r.id} fires for ${other.canonical} + ${name} (ES)`,
          fires(kb, note(spanishForm(other), spanishForm(e)), r.id));
      });
      const a0 = r.participants_a[0], b0 = counterpart(a0, r.participants_b);
      assert(`[${track}] ${r.id} fires for English canonical names`,
        fires(kb, 'Current medication: ' + a0 + ' once daily. ' + b0 + ' once daily.', r.id, 'en'));
      (r.excluded_pairs || []).forEach(([x, y]) => {
        assert(`[${track}] ${r.id} does NOT fire for its excluded pair ${x} + ${y}`,
          !fires(kb, note(spanishForm(dict[N(x)]), spanishForm(dict[N(y)])), r.id));
      });
    });

    /* 2b. D3 — no medicine pair activates two active rules. */
    const owners = new Map();
    active.forEach((r) => r.participants_a.forEach((x) => r.participants_b.forEach((y) => {
      if (x === y || excluded(r, x, y)) return;
      const key = [N(x), N(y)].sort().join(' + ');
      owners.set(key, (owners.get(key) || []).concat(r.id));
    })));
    const shared = [...owners].filter(([, ids]) => new Set(ids).size > 1).map(([k, ids]) => k + ' (' + ids.join(', ') + ')');
    assert(`[${track}] no medicine pair activates two interaction rules: ${shared.join('; ')}`, shared.length === 0);

    /* 2c. Retired duplicates are traceable and never fire. */
    rules.filter((r) => r.status === 'merged').forEach((r) => {
      const target = active.find((x) => x.id === r.merged_into);
      assert(`[${track}] retired ${r.id} points to an active rule (${r.merged_into}) with a bilingual reason`,
        !!target && !!r.merge_reason_es && !!r.merge_reason_en);
      assert(`[${track}] retired ${r.id} never fires`,
        !fires(kb, note(spanishForm(dict[N(r.participants_a[0])]), spanishForm(dict[N(r.participants_b[0])])), r.id));
    });
  });

  /* 2d. Reviewer decisions D1, D3, D10 (2026-11-13). */
  {
    const kb = loadKB('prod');
    const ids = (text) => CE.buildCaseModel(text, kb, { lang: 'es' }).currentInteractions.map((i) => i.id + '/' + i.severity);
    const has = (text, expected) => JSON.stringify(ids(text).sort()) === JSON.stringify(expected.slice().sort());
    assert('D1: rilpivirine + PPI → only DDI018 CONTRAINDICATED', has('Odefsey. Omeprazol 20 mg.', ['DDI018/CONTRAINDICATED']));
    assert('D1: rilpivirine + H2 blocker → only DDI061 MODERATE (separate 12 h)',
      has('Rilpivirina 25 mg. Famotidina 20 mg.', ['DDI061/MODERATE']) &&
      /12 h/.test(kb.ddiWatchlist.interactions.find((r) => r.id === 'DDI061').management_es));
    assert('D3: efavirenz + methadone → one alert (DDI024)', has('Efavirenz 600 mg. Metadona 80 mg.', ['DDI024/MAJOR']));
    assert('D3: Kaletra + sildenafil → one alert (DDI002) carrying the PAH contraindication note',
      has('Kaletra. Sildenafilo 20 mg/8h.', ['DDI002/MAJOR']) &&
      /CONTRAINDICADO/.test(kb.ddiWatchlist.interactions.find((r) => r.id === 'DDI002').applicability_note_es));
    assert('D3: Kaletra + quetiapine → DDI019 only (QT rule no longer duplicates it)', has('Kaletra. Quetiapina 100 mg.', ['DDI019/CONTRAINDICATED']));
    assert('D3: nevirapine + oral contraceptive → DDI039 only', has('Nevirapina 200 mg. Etinilestradiol/levonorgestrel.', ['DDI039/MAJOR']));
    assert('D3: efavirenz + warfarin → DDI031 only', has('Efavirenz 600 mg. Warfarina 5 mg.', ['DDI031/MAJOR']));
    assert('D3: dolutegravir + calcium acetate → DDI059 only', has('Dolutegravir 50 mg. Acetato cálcico 500 mg.', ['DDI059/MODERATE']));
    const sintrom = CE.buildCaseModel('Sintrom 4 mg según INR.', kb, { lang: 'es' }).activeMedications.map((m) => m.normalized_name);
    assert('D10: Sintrom resolves to acenocoumarol, never to warfarin', sintrom.includes('acenocoumarol') && !sintrom.includes('warfarin'));
    assert('D10: efavirenz + acenocoumarol → DDI031; nevirapine + acenocoumarol → DDI004',
      has('Efavirenz 600 mg. Acenocumarol 4 mg.', ['DDI031/MAJOR']) && has('Nevirapina 200 mg. Acenocumarol 4 mg.', ['DDI004/MAJOR']));
  }

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
    ['Rilpivirina 25 mg. Ranitidina 150 mg.', 'DDI061'],
    ['Norvir 100 mg. Sildenafilo 50 mg a demanda.', 'DDI002'],
    ['Efavirenz 600 mg. Metadona 80 mg/día.', 'DDI024'],
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
