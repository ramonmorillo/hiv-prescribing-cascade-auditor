'use strict';
/* ============================================================================
   Pruebas B-L — the remaining scenarios from the audit brief's Fase 9 test
   plan, not already exercised by index-case.test.js (Prueba A) or by the
   pre-existing negative-cases.test.js / regression.test.js suites.

   Cross-reference to where each letter's scenario already lives, so nothing
   below duplicates an assertion that already exists elsewhere:
     Prueba A — index case                         -> index-case.test.js
     Prueba B — current negation ("no presenta")    -> negative-cases.test.js Case 3
     Prueba C — prior/chronic hypertension          -> negative-cases.test.js Case 4, 8a
     Prueba D — problem without cascade drug        -> negative-cases.test.js Case 5
     Prueba E — cascade drug without problem        -> negative-cases.test.js Case 6
     Prueba L — duplicate suppression                -> index-case.test.js (pair-dedup check)

   This file covers the rest:
     Prueba F — metformin absent (DDI must stay hidden)
     Prueba G — metformin present (DDI must become visible)
     Prueba H — anticholinergic scoring with 2+ contributors (cumulative wording)
     Prueba I — temporal state change resolved via explicit dates
     Prueba J — unresolved contradiction (no dates, no directional cue)
     Prueba K — VIH003 with its required condition missing entirely
   ============================================================================ */
const { loadKB, CE, assert, reset, summary } = require('./helpers');

function run() {
  reset();
  console.log('== temporal-events.test.js ==');
  const kb = loadKB('prod');

  /* Common Spanish and English month abbreviations are literal dates; a
     month without a stated/anchoring year must remain yearless. */
  {
    const es = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'sept', 'oct', 'nov', 'dic'];
    es.forEach((month, index) => {
      const text = `Amlodipine desde ${month} 2021`;
      const date = CE.extractDateNear(text, 0, 10);
      assert(`Spanish abbreviated month ${month} is extracted`, date && date.year === 2021 && date.month === (index > 8 ? index : index + 1));
    });
    const english = CE.extractDateNear('Amlodipine since Jan 2021', 0, 10);
    assert('English abbreviated month Jan is extracted', english && english.value === 202101);
    const yearless = CE.extractDateNear('Amlodipine desde jul', 0, 10);
    assert('month-only text does not invent a year', yearless && yearless.year === null && yearless.value === 7);
  }

  /* ---- Prueba F: metformin absent -> VIH003's ddi_warning must stay hidden,
     even when dolutegravir + a diabetes diagnosis are both present. ---- */
  {
    const note = 'Paciente en tratamiento con dolutegravir. Presenta diabetes mellitus tipo 2 y ganancia de peso significativa. Se inicia enalapril.';
    const model = CE.buildCaseModel(note, kb, { lang: 'es' });
    const vih003 = model.possibleCascades.find((c) => c.cascade_id === 'VIH003');
    assert('Prueba F: VIH003 signal generated (dolutegravir + diabetes + enalapril all present)', !!vih003);
    assert('Prueba F: metformin not in detected medications', !model.medications.some((m) => m.normalized_name === 'metformin'));
    assert('Prueba F: ddi_warning_es stays empty when metformin is absent', !vih003 || !vih003.ddi_warning_es);
    assert('Prueba F: ddi_suppressed_missing_entities is true', !!vih003 && vih003.ddi_suppressed_missing_entities === true);
  }

  /* ---- Prueba G: metformin present -> VIH003's ddi_warning must become
     visible (the exact inverse of the bug reported: metformin interaction
     shown with NO metformin in the note). ---- */
  {
    const note = 'Paciente en tratamiento con dolutegravir y metformina 850 mg cada 12 horas para diabetes mellitus tipo 2. Presenta ganancia de peso significativa.';
    const model = CE.buildCaseModel(note, kb, { lang: 'es' });
    const meds = model.medications.map((m) => m.normalized_name);
    assert('Prueba G: metformin detected in this note', meds.includes('metformin'));
    const vih003 = model.possibleCascades.find((c) => c.cascade_id === 'VIH003');
    assert('Prueba G: VIH003 signal generated', !!vih003);
    assert('Prueba G: ddi_warning_es is populated when metformin IS present',
      !!vih003 && !!vih003.ddi_warning_es && /metformina/i.test(vih003.ddi_warning_es));
    assert('Prueba G: ddi_suppressed_missing_entities is false', !!vih003 && vih003.ddi_suppressed_missing_entities === false);
  }

  /* ---- Prueba H: two ACB-3 contributors -> cumulative wording is used
     (never for a single contributor, per Fase 6), both are listed, and an
     unrelated drug in the same note is never swept in. ---- */
  {
    const note = 'Paciente toma amitriptilina 25 mg por la noche e hidroxizina 25 mg cada 8 horas. Toma también enalapril 10 mg.';
    const model = CE.buildCaseModel(note, kb, { lang: 'es' });
    const acb = model.globalMedicationAlerts.find((a) => a.id === 'ACB_SCORE');
    assert('Prueba H: ACB_SCORE alert generated', !!acb);
    assert('Prueba H: both amitriptyline and hydroxyzine are contributors',
      !!acb && acb.drugs_involved.includes('amitriptyline') && acb.drugs_involved.includes('hydroxyzine'));
    assert('Prueba H: enalapril is not swept in as a contributor', !!acb && acb.drugs_involved.indexOf('enalapril') === -1);
    assert('Prueba H: total_score reflects both contributors (3+3=6)', !!acb && acb.total_score === 6);
    assert('Prueba H: cumulative/multi-drug wording IS used with 2+ contributors',
      !!acb && /efecto acumulado de (varios|m[uú]ltiples)/i.test(acb.message_es || ''));
  }

  /* ---- Prueba I: a problem's status changes over time, disambiguated by
     explicit dates (2020 diagnosis, 2024 resolution) -> the reconciled
     result must reflect the LATEST dated event, not silently keep the
     first one or flag a spurious contradiction. ---- */
  {
    const note = 'En enero de 2020 se diagnostica hipertensión arterial. En marzo de 2024 la hipertensión arterial está resuelta tras pérdida de peso.';
    const model = CE.buildCaseModel(note, kb, { lang: 'es' });
    const htn = model.activeProblems.find((p) => p.id === 'CPB001');
    assert('Prueba I: hypertension concept detected', !!htn);
    assert('Prueba I: two separate dated events are preserved', !!htn && htn.events.length === 2);
    assert('Prueba I: final reconciled status is "resolved" (the later, dated event wins)',
      !!htn && htn.status === 'resolved');
    assert('Prueba I: resolution is not flagged as a contradiction (dates disambiguate it)',
      !!htn && htn.contradiction === false);
  }

  /* ---- Prueba J: the same concept is stated as active and then as resolved
     with NO explicit dates and no directional cue connecting them -> this
     must be flagged as an unresolved contradiction requiring professional
     review, never silently resolved in either direction. ---- */
  {
    const note = 'Hipertensión arterial. Hipertensión arterial resuelta.';
    const model = CE.buildCaseModel(note, kb, { lang: 'es' });
    const htn = model.activeProblems.find((p) => p.id === 'CPB001');
    assert('Prueba J: hypertension concept detected', !!htn);
    assert('Prueba J: two conflicting, undated events are preserved', !!htn && htn.events.length === 2);
    assert('Prueba J: contradiction is explicitly flagged (never silently resolved)',
      !!htn && htn.contradiction === true);
    assert('Prueba J: status is "unknown", never a confident active/resolved/absent guess',
      !!htn && htn.status === 'unknown');
  }

  /* ---- Prueba K: VIH003's required intermediate condition (weight gain /
     diabetes / metabolic syndrome) is entirely absent from the note, with
     no explicit alternative indication for enalapril either -> the signal
     must degrade to a bare pharmacological coincidence, never a supported
     or incomplete cascade, and its DDI stays hidden (no metformin). ---- */
  {
    const note = 'Paciente en tratamiento con dolutegravir y enalapril, sin más hallazgos relevantes.';
    const model = CE.buildCaseModel(note, kb, { lang: 'es' });
    const vih003 = model.possibleCascades.find((c) => c.cascade_id === 'VIH003');
    assert('Prueba K: VIH003 signal generated (both drugs present)', !!vih003);
    assert('Prueba K: classification degrades to pharmacological_match_only (no intermediate-problem evidence at all)',
      !!vih003 && vih003.classification === 'pharmacological_match_only');
    assert('Prueba K: never supported or incomplete without evidence for the required condition',
      !vih003 || !['supported_possible_cascade', 'possible_but_incomplete'].includes(vih003.classification));
    assert('Prueba K: ddi_warning stays hidden (metformin absent)', !vih003 || !vih003.ddi_warning_es);
  }

  const r = summary();
  console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`);
  return r.fail === 0;
}

module.exports = { run };
if (require.main === module) { process.exit(run() ? 0 : 1); }
