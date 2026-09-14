'use strict';
/* ============================================================================
   Ported from the pre-audit in-browser window.runNlpSelfTest() (Groups
   H/I/J/K): drug resolver aliasing/combos, typo correction, and the
   urologic/renal clinical-problem detector. Adapted to clinical-engine.js's
   explicit (noteText, resolver/kb) signatures — no browser, no globals.
   ============================================================================ */
const { loadKB, CE, assert, reset, summary } = require('./helpers');

function run() {
  reset();
  console.log('== legacy-nlp.test.js ==');
  const kb = loadKB('prod');
  const resolver = CE.buildDrugResolver(kb);
  const resolve = (text) => CE.resolveDrugMentions(text, resolver);

  /* ---- H. Drug resolver: alias / brand / abbreviation / combo / normalized ---- */
  const h1 = resolve('Paciente en Kaletra por TAR.').map((m) => m.canonical);
  assert('H1: brand name Kaletra -> lopinavir/ritonavir', h1.includes('lopinavir/ritonavir'));

  const h2 = resolve('Se inicia AZT por disponibilidad.');
  const h2m = h2.find((m) => m.canonical === 'zidovudine');
  assert('H2: abbreviation AZT resolved to zidovudine', !!h2m);
  /* match_type is 'dict' rather than 'alias' because drug_dictionary.json
     also lists "azt" as a variant of zidovudine (a more authoritative,
     centrally-curated source than the small MANUAL_ALIASES fallback table)
     -- either provenance is a correct high-confidence resolution. */
  assert('H2: abbreviation resolved at high confidence via dict or alias',
    h2m && h2m.confidence === 'high' && ['dict', 'alias'].indexOf(h2m.match_type) !== -1);

  const h3 = resolve('Regimen actual: atazanavir / ritonavir.').map((m) => m.canonical);
  assert('H3: slash combination resolved', h3.includes('atazanavir/ritonavir'));

  const h4 = resolve('Paciente con oxibutinína y estreñimiento.').map((m) => m.canonical);
  assert('H4: orthographic variant (accent) resolves to oxybutynin', h4.includes('oxybutynin'));

  /* ---- I. normalizeClinicalText — conservative typo correction ---- */
  assert('I1: "vral" -> "viral"', CE.normalizeClinicalText('carga vral indetectable').includes('viral'));
  assert('I2: "izqueirdo" -> "izquierdo"', CE.normalizeClinicalText('flanco izqueirdo').includes('izquierdo'));
  assert('I3: "izuqierdo" -> "izquierdo"', CE.normalizeClinicalText('flanco izuqierdo').includes('izquierdo'));
  assert('I4: "dolro" -> "dolor"', CE.normalizeClinicalText('dolro a la palapcion').includes('dolor'));
  assert('I6: "q comp" -> "1 comp"', CE.normalizeClinicalText('enalapril 20 mg q comp al dia').includes('1 comp'));
  assert('I7: idempotent -- correcting twice = correcting once',
    CE.normalizeClinicalText(CE.normalizeClinicalText('vral izqueirdo dolro')) === CE.normalizeClinicalText('vral izqueirdo dolro'));
  assert('I8: does not touch unrelated words', CE.normalizeClinicalText('paciente estable sin cambios').includes('paciente estable sin cambios'));

  /* ---- J. Combination-product resolution (Biktarvy, Gibiter Easyhaler) ---- */
  const j1 = resolve('Biktarvy 1 comp al dia desde 2019.').map((m) => m.canonical);
  assert('J1: Biktarvy -> bictegravir present', j1.includes('bictegravir'));
  assert('J2: Biktarvy -> emtricitabine present', j1.includes('emtricitabine'));
  assert('J3: Biktarvy -> tenofovir alafenamide present', j1.includes('tenofovir alafenamide'));

  const j2m = resolve('Biktarvy 1 comp al dia.').find((m) => m.canonical === 'bictegravir');
  assert('J4: Biktarvy mention carries brand traceability', j2m && j2m.brand === 'Biktarvy');

  const j3 = resolve('GIBITER EASYHALER 1 inhalacion al dia.').map((m) => m.canonical);
  assert('J5: Gibiter Easyhaler -> budesonide present', j3.includes('budesonide'));
  assert('J6: Gibiter Easyhaler -> formoterol present', j3.includes('formoterol'));

  const j5mentions = resolve('GIBITER EASYHALER 1 inhalacion al dia.');
  const j5budesonide = j5mentions.find((m) => m.canonical === 'budesonide');
  const j5formoterol = j5mentions.find((m) => m.canonical === 'formoterol');
  assert('J7: budesonide ingredient classified (from drug_dictionary.json)',
    j5budesonide && j5budesonide.drug_class === 'Corticosteroid / Inhaled');
  assert('J8: formoterol ingredient classified (from drug_dictionary.json)',
    j5formoterol && j5formoterol.drug_class === 'Bronchodilator / LABA');
  assert('J9: combo brand therapeutic class shown at brand level',
    j5budesonide && j5budesonide.brand_therapeutic_class_es === 'Corticoide inhalado + broncodilatador de acción prolongada (ICS/LABA)');

  /* ---- K. Clinical problem detection -- urologic/renal rule ---- */
  const REAL_CASE_NOTE = [
    'Mujer de 54 años VIH en tratamiento con Biktarvy y carga vral indetectable.',
    'Tratamiento habitual de la paciente:',
    '- Biktarvy 1 comp al dia desde 2019',
    '- Omeprazol 1 capo al dia desde 2022',
    '- Enalapril 20 mg q comp al día desde 2019',
    '- Metamizol y paracetamol si precisa por dolores',
    '- Loratadina 10 mg 1 comprimido si precisa',
    '- GIBITER EASYHALER 1 inhalacion al día desde 2018',
    '',
    'Consulta por dolor intermitente de flanco izqueirdo desde hace varios meses. No sintomatologia miccional, no lo relaciona con las comidas. No rectorragia, no melenas.',
    'Exploración: Abdomen blando, depresible, dolro a la palapcion de flanco izuqierdo, puñopercusión renal negativa.',
    'Solicitud de urocultivo y sistematico y ecografia abdominal.',
    'Exploracion: Buen estado general. Eupneica. Bien hidratada y perfundida. Abdomen blando, depresible, dolro a la palapcion de flanco izuqierdo, puñopercusión renal negativa.',
    '',
    'Tira de orina: NEGATIVO.',
    '',
    'Tratamiento prescrito: tamsulosina 400 mcg 1 comprimido al día.'
  ].join('\n');

  const k1drugs = CE.extractDrugs(REAL_CASE_NOTE, resolver);
  ['bictegravir', 'emtricitabine', 'tenofovir alafenamide', 'omeprazole', 'enalapril',
    'metamizole', 'paracetamol', 'loratadine', 'budesonide', 'formoterol', 'tamsulosin'
  ].forEach((drug) => assert('K1: real case detects "' + drug + '"', k1drugs.includes(drug)));

  const k1all = CE.detectActiveProblems(REAL_CASE_NOTE, kb, 'es');
  const k1problems = k1all.filter((p) => p.category === 'urologic_renal_problem');
  assert('K2: real case detects exactly one urologic/renal problem', k1problems.length === 1);
  assert('K4: certainty = suspected (flank pain + urine work-up + tamsulosin)',
    k1problems[0] && k1problems[0].certainty === 'suspected');
  assert('K5: evidence mentions flank pain ("flanco")',
    k1problems[0] && k1problems[0].evidence.some((e) => /flanco/i.test(e)));
  assert('K6: evidence mentions tamsulosin as context',
    k1problems[0] && k1problems[0].evidence.some((e) => /tamsulosina/i.test(e)));
  assert('K7: negated findings include miccional symptoms (not a false-positive UTI)',
    k1problems[0] && k1problems[0].negatedFindings.some((e) => /miccional/i.test(e)));
  assert('K8: negated findings include the negative dipstick ("Tira de orina")',
    k1problems[0] && k1problems[0].negatedFindings.some((e) => /tira de orina/i.test(e)));
  assert('K9: negated findings include the negative punch sign ("puñopercusión")',
    k1problems[0] && k1problems[0].negatedFindings.some((e) => /pu.opercusi.n/i.test(e)));
  assert('K10: no finding text leaks "no rectorragia" (unrelated negated GI symptom)',
    k1problems[0] && !k1problems[0].evidence.concat(k1problems[0].negatedFindings).some((e) => /rectorragia/i.test(e)));

  const k2problems = CE.detectActiveProblems('Paciente sin disuria, sin polaquiuria, tira de orina negativa.', kb, 'es')
    .filter((p) => p.category === 'urologic_renal_problem');
  assert('K11: negation-only note detects zero urologic/renal problems', k2problems.length === 0);

  const k3problems = CE.detectActiveProblems('Consulta por dolor de flanco derecho. Se solicita ecografía renal.', kb, 'es')
    .filter((p) => p.category === 'urologic_renal_problem');
  assert('K12: flank pain + imaging order detects a urologic/renal problem', k3problems.length === 1);
  assert('K13: certainty is "symptom" or "suspected" (never "confirmed")',
    k3problems[0] && (k3problems[0].certainty === 'symptom' || k3problems[0].certainty === 'suspected'));

  const k4problems = CE.detectActiveProblems('Tratamiento habitual: tamsulosina 400 mcg al día.', kb, 'es')
    .filter((p) => p.category === 'urologic_renal_problem');
  assert('K14: tamsulosin alone creates NO urologic/renal problem', k4problems.length === 0);

  const r = summary();
  console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`);
  return r.fail === 0;
}

module.exports = { run };
if (require.main === module) { process.exit(run() ? 0 : 1); }
