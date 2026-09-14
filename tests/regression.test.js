'use strict';
/* ============================================================================
   Regression suite — ports the key assertions from the pre-audit in-browser
   window.runNlpSelfTest() (negation, historical/resolved context, symptom
   bridge with temporality) onto the extracted clinical-engine.js, so the
   audit's refactor cannot silently break behaviour that already worked.
   ============================================================================ */
const { loadKB, CE, assert, reset, summary } = require('./helpers');

function run() {
  reset();
  console.log('== regression.test.js ==');
  const kb = loadKB('prod');

  /* ---- Negation / historical (English) ---- */
  let syms = CE.extractSymptoms('Patient denies constipation and diarrhoea.', kb);
  let c = syms.find((s) => s.term === 'constipation');
  assert('EN: "denies constipation" -> active=false', c && c.active === false);

  syms = CE.extractSymptoms('Constipation resolved on prior admission.', kb);
  c = syms.find((s) => s.term === 'constipation');
  assert('EN: "constipation resolved" -> active=false', c && c.active === false);

  syms = CE.extractSymptoms('History of constipation. No current complaint.', kb);
  c = syms.find((s) => s.term === 'constipation');
  assert('EN: "history of constipation" -> active=false', c && c.active === false);

  syms = CE.extractSymptoms('No urinary retention noted today.', kb);
  c = syms.find((s) => s.term === 'urinary retention');
  assert('EN: "no urinary retention" -> active=false', c && c.active === false);

  /* ---- Active detection ---- */
  syms = CE.extractSymptoms('Patient reports dry mouth and fatigue.', kb);
  c = syms.find((s) => s.term === 'dry mouth');
  assert('EN: "dry mouth" -> active=true', c && c.active === true);

  /* ---- Cascade firing with temporality (symptom bridge) ---- */
  function probeCascades(note) {
    const resolver = CE.buildDrugResolver(kb);
    const mentions = CE.resolveDrugMentions(note, resolver);
    const mentionByCanonical = {};
    mentions.forEach((m) => {
      const key = CE.normalizeDrugText(m.canonical);
      (mentionByCanonical[key] = mentionByCanonical[key] || []).push(m);
    });
    const symptoms = CE.extractSymptoms(note, kb);
    const model = CE.buildCaseModel(note, kb, { lang: 'es' });
    return { syms: symptoms, sigs: model.possibleCascades.filter((s) => s.signal_type === 'symptom_bridge') };
  }

  let r1 = probeCascades('After starting oxybutynin patient developed constipation. Lactulose was added.');
  let s1 = r1.sigs.find((s) => s.ade_en === 'constipation');
  assert('EN: oxybutynin -> constipation -> lactulose fires', !!s1);
  assert('EN: confidence is high (supportive temporality)', s1 && s1.confidence === 'high');

  let r2 = probeCascades('Chronic constipation on long-term lactulose. Started oxybutynin for incontinence.');
  let s2 = r2.sigs.find((s) => s.ade_en === 'constipation');
  assert('EN: chronic constipation+lactulose -> not a supported cascade',
    !s2 || s2.classification !== 'supported_possible_cascade');

  let rA = probeCascades('New onset oedema noted after amlodipine was started. Furosemide prescribed.');
  let sA = rA.sigs.find((s) => s.ade_en === 'oedema' || s.ade_en === 'peripheral oedema');
  assert('EN: amlodipine -> oedema -> furosemide fires', !!sA);

  /* ---- Spanish negation / historical ---- */
  syms = CE.extractSymptoms('Niega estreñimiento. No caídas.', kb);
  let esCon = syms.find((s) => s.term === 'constipation');
  let esFal = syms.find((s) => s.term === 'falls');
  assert('ES: "Niega estreñimiento" -> constipation active=false', esCon && esCon.active === false);
  assert('ES: "No caídas" -> falls active=false', esFal && esFal.active === false);

  syms = CE.extractSymptoms('Estreñimiento desde hace 2 semanas.', kb);
  esCon = syms.find((s) => s.term === 'constipation');
  assert('ES: "Estreñimiento desde hace 2 semanas" -> active=true', esCon && esCon.active === true);

  syms = CE.extractSymptoms('Estreñimiento resuelto tras el alta.', kb);
  esCon = syms.find((s) => s.term === 'constipation');
  assert('ES: "Estreñimiento resuelto" -> active=false', esCon && esCon.active === false);

  /* ---- Spanish cascade with temporality ---- */
  let es5 = probeCascades('Tras iniciar oxibutinina el paciente presenta estreñimiento. Se pauta lactulosa.');
  let es5s = es5.sigs.find((s) => s.ade_en === 'constipation');
  assert('ES: oxibutinina -> estreñimiento -> lactulosa fires', !!es5s);

  const r = summary();
  console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`);
  return r.fail === 0;
}

module.exports = { run };
if (require.main === module) { process.exit(run() ? 0 : 1); }
