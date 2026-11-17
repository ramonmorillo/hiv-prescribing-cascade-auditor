'use strict';
/* Explicit, reviewable participant lists for every rule in ddi_watchlist.json.
 *
 * WHY: the engine used to derive participants by splitting the free-text
 * drug_a / drug_b labels. Labels that name a class ("Proton pump inhibitors")
 * or a medicine absent from drug_dictionary.json produced names that could
 * never match a real note: 27/60 rules — 8 of them CONTRAINDICATED — could
 * never fire. Participants are now explicit canonical names (drug_dictionary
 * `canonical`), and tests/kb-ddi-coverage.test.js fails if any of them does
 * not resolve.
 *
 * RULES OF THIS TRANSCRIPTION (see docs/validation/fase0-ddi-participants.md):
 *   - Within one side, membership is OR (any listed medicine activates it).
 *   - Each list transcribes what the rule text itself names. Where the text
 *     names a CLASS, members are enumerated and the rule is listed in
 *     `CLASS_EXPANSIONS` for clinical validation.
 *   - Where the text names a combined regimen ("Elvitegravir / Cobicistat",
 *     "Lopinavir/ritonavir"), side A is the regimen-defining ingredient, so a
 *     different booster alone does not inherit that rule.
 *   - Severity, mechanism and management texts are NOT changed here.
 *   - `applicability_note_*` carries a dose/route/duration condition the text
 *     states but that a free-text note cannot verify; it is displayed with
 *     the alert instead of being silently dropped.
 *
 * Usage: node kb/dev/ddi_participants.js   (rewrites kb/prod and kb/dev)
 */

var BOOSTERS = ['ritonavir', 'cobicistat'];
var PPIS = ['omeprazole', 'esomeprazole', 'pantoprazole', 'lansoprazole', 'rabeprazole'];
var H2 = ['famotidine', 'ranitidine', 'cimetidine'];
var NSAIDS = ['ibuprofen', 'naproxen', 'diclofenac', 'dexketoprofen', 'ketoprofen', 'indomethacin',
  'meloxicam', 'piroxicam', 'aceclofenac', 'celecoxib', 'etoricoxib'];
var AMINOGLYCOSIDES = ['gentamicin', 'amikacin', 'tobramycin'];
var MACROLIDES = ['clarithromycin', 'erythromycin', 'azithromycin'];
var FLUOROQUINOLONES = ['levofloxacin', 'moxifloxacin', 'ciprofloxacin', 'ofloxacin', 'norfloxacin'];
var AZOLES = ['fluconazole', 'itraconazole', 'ketoconazole', 'voriconazole', 'posaconazole'];
var ANTIPSYCHOTICS = ['haloperidol', 'quetiapine', 'olanzapine', 'risperidone', 'aripiprazole',
  'ziprasidone', 'chlorpromazine', 'amisulpride', 'paliperidone', 'clozapine', 'pimozide'];
var TCAS = ['amitriptyline', 'nortriptyline', 'imipramine', 'clomipramine', 'doxepin'];
var DOACS = ['dabigatran', 'rivaroxaban', 'apixaban', 'edoxaban'];
var HORMONAL_CONTRACEPTIVES = ['ethinylestradiol', 'levonorgestrel', 'desogestrel', 'norethisterone',
  'drospirenone', 'norgestimate', 'gestodene', 'dienogest'];
/* calcium acetate is a phosphate binder: covered by the more specific DDI059 (D3). */
var POLYVALENT_CATIONS = ['calcium carbonate', 'magnesium hydroxide', 'magnesium oxide',
  'aluminum hydroxide', 'almagate', 'magaldrate'];
var NON_NRTI_ARVS = ['darunavir', 'atazanavir', 'lopinavir', 'ritonavir', 'cobicistat',
  'dolutegravir', 'raltegravir', 'bictegravir', 'elvitegravir', 'cabotegravir',
  'efavirenz', 'rilpivirine', 'nevirapine', 'doravirine', 'etravirine'];

/* id -> { a: [...], b: [...], note_es?, note_en? } */
var PARTICIPANTS = {
  DDI001: { a: BOOSTERS, b: ['simvastatin', 'lovastatin'] },
  DDI002: { a: BOOSTERS, b: ['sildenafil', 'tadalafil', 'vardenafil'],
    note_es: 'Con lopinavir/ritonavir, el sildenafilo a dosis de hipertensión arterial pulmonar (>20 mg) está CONTRAINDICADO (antigua DDI054, fusionada aquí): considerar un TAR sin IP/r o, si no es posible, bosentán o iloprost. La dosis no se verifica en la nota.',
    note_en: 'With lopinavir/ritonavir, sildenafil at pulmonary arterial hypertension doses (>20 mg) is CONTRAINDICATED (former DDI054, merged here): consider a PI/r-free ART or, if impossible, bosentan or iloprost. Dose is not verified from the note.' },
  DDI003: { a: ['dolutegravir'], b: ['metformin'] },
  DDI004: { a: ['efavirenz', 'nevirapine', 'rifampicin'], b: ['warfarin', 'acenocoumarol'].concat(DOACS),
    /* D3: efavirenz + vitamin K antagonist is handled by the specific DDI031. */
    excluded_pairs: [['efavirenz', 'warfarin'], ['efavirenz', 'acenocoumarol']] },
  DDI005: { a: BOOSTERS, b: ['midazolam', 'triazolam'],
    note_es: 'La regla aplica a midazolam/triazolam ORALES; la vía no se verifica en la nota.',
    note_en: 'The rule applies to ORAL midazolam/triazolam; route is not verified from the note.' },
  DDI006: { a: ['ritonavir'], b: ['colchicine'] },
  DDI007: { a: ['efavirenz'], b: ['methadone'] },
  DDI008: { a: ['tenofovir disoproxil fumarate'], b: NSAIDS.concat(AMINOGLYCOSIDES),
    note_es: 'Los contrastes yodados no se detectan en la nota: valorar si hay exposición prevista.',
    note_en: 'Iodinated contrast agents are not detected from the note: check for planned exposure.' },
  /* D3: quetiapine and pimozide with a boosted PI are covered by DDI019. */
  DDI009: { a: ['saquinavir', 'lopinavir'], b: MACROLIDES.concat(FLUOROQUINOLONES, AZOLES,
    ANTIPSYCHOTICS.filter(function (d) { return d !== 'quetiapine' && d !== 'pimozide'; }), TCAS),
    note_es: 'Rilpivirina solo prolonga el QT a dosis supraterapéuticas: no se incluye como desencadenante. Revisar ECG y electrolitos.',
    note_en: 'Rilpivirine prolongs QT only at supratherapeutic doses and is not used as a trigger. Check ECG and electrolytes.' },
  DDI010: { a: ['cobicistat'], b: ['fluticasone', 'budesonide'] },
  DDI011: { a: BOOSTERS, b: ['atorvastatin'] },
  /* D3: nevirapine is covered by the specific DDI039. */
  DDI012: { a: ['efavirenz', 'etravirine'], b: HORMONAL_CONTRACEPTIVES },
  DDI013: { a: BOOSTERS, b: ['tacrolimus', 'cyclosporine', 'sirolimus'] },
  DDI014: { a: ['dolutegravir', 'bictegravir', 'raltegravir'], b: POLYVALENT_CATIONS },
  DDI015: { a: BOOSTERS, b: ['rifampicin'] },
  DDI016: { a: ['elvitegravir'], b: ['rifampicin', 'rifabutin'] },
  DDI017: { a: ['atazanavir'], b: PPIS },
  /* D1 (reviewer, 2026-11-13): PPIs only; H2 blockers moved to DDI061. */
  DDI018: { a: ['rilpivirine'], b: PPIS,
    note_es: 'Aplica a rilpivirina ORAL, no a la intramuscular.',
    note_en: 'Applies to ORAL rilpivirine, not the intramuscular form.' },
  DDI019: { a: BOOSTERS, b: ['quetiapine', 'pimozide', 'lurasidone'] },
  DDI020: { a: ['ritonavir'], b: ['amiodarone', 'dronedarone'] },
  DDI021: { a: BOOSTERS, b: ['salmeterol'] },
  DDI022: { a: ['efavirenz', 'nevirapine'], b: ['voriconazole'] },
  DDI023: { a: BOOSTERS, b: ['carbamazepine', 'phenytoin', 'phenobarbital'] },
  DDI024: { a: ['efavirenz', 'nevirapine', 'rifampicin'], b: ['methadone'] },
  DDI025: { a: ['dolutegravir'], b: ['rifampicin'] },
  DDI026: { a: ['bictegravir'], b: ['rifampicin', 'rifabutin'] },
  DDI027: { a: BOOSTERS, b: ['clarithromycin'] },
  DDI028: { a: ['lopinavir'], b: ['rosuvastatin'] },
  DDI029: { a: BOOSTERS, b: ['trazodone'] },
  DDI030: { a: BOOSTERS, b: ['amlodipine', 'felodipine', 'nifedipine'] },
  DDI031: { a: ['efavirenz', 'etravirine'], b: ['warfarin', 'acenocoumarol'] },
  DDI032: { a: BOOSTERS, b: ['fentanyl', 'alfentanil', 'buprenorphine'],
    note_es: 'La regla se refiere a vía parenteral/transdérmica; la vía no se verifica en la nota.',
    note_en: 'The rule refers to parenteral/transdermal routes; route is not verified from the note.' },
  DDI033: { a: ['lopinavir'], b: ['lamotrigine'] },
  DDI034: { a: ['efavirenz'], b: ['clopidogrel'] },
  DDI035: { a: BOOSTERS, b: ['dexamethasone', 'methylprednisolone'],
    note_es: 'La regla se refiere a uso sistémico prolongado; la duración no se verifica en la nota.',
    note_en: 'The rule refers to prolonged systemic use; duration is not verified from the note.' },
  DDI036: { a: NON_NRTI_ARVS, b: ['hypericum'] },
  DDI037: { a: BOOSTERS, b: ['alprazolam', 'clonazepam', 'diazepam'] },
  DDI038: { a: ['atazanavir'], b: ['irinotecan'] },
  DDI039: { a: ['nevirapine'], b: HORMONAL_CONTRACEPTIVES.concat(['etonogestrel']) },
  DDI040: { a: BOOSTERS, b: ['ibrutinib'] },
  DDI041: { a: ['atazanavir'], b: ['tenofovir disoproxil fumarate'] },
  DDI042: { a: BOOSTERS, b: ['itraconazole', 'ketoconazole', 'voriconazole'] },
  DDI043: { a: ['raltegravir'], b: ['rifampicin'] },
  DDI044: { a: ['cobicistat'], b: ['ethinylestradiol', 'norgestimate'] },
  DDI045: { a: BOOSTERS, b: ['dabigatran'] },
  DDI046: { a: BOOSTERS, b: ['rivaroxaban', 'apixaban'] },
  DDI047: { a: ['dolutegravir'], b: ['dofetilide'] },
  DDI048: { a: ['efavirenz'], b: ['etoposide', 'cyclophosphamide'] },
  DDI049: { a: BOOSTERS, b: ['ergotamine', 'dihydroergotamine'] },
  DDI050: { a: ['efavirenz', 'nevirapine'], b: ['sertraline', 'citalopram', 'escitalopram'] },
  DDI051: { a: BOOSTERS, b: ['alfuzosin'] },
  DDI052: { a: BOOSTERS, b: ['rifabutin'] },
  DDI053: { a: ['tenofovir alafenamide'], b: ['rifampicin', 'carbamazepine', 'hypericum'] },
  DDI061: { a: ['rilpivirine'], b: H2,
    note_es: 'Aplica a rilpivirina ORAL, no a la intramuscular.',
    note_en: 'Applies to ORAL rilpivirine, not the intramuscular form.' },
  DDI054: { a: ['lopinavir'], b: ['sildenafil'],
    note_es: 'Contraindicada solo a dosis de hipertensión arterial pulmonar (>20 mg); la dosis no se verifica. Para uso en disfunción eréctil véase DDI002.',
    note_en: 'Contraindicated only at pulmonary arterial hypertension doses (>20 mg); dose is not verified. For erectile dysfunction use see DDI002.' },
  DDI055: { a: ['dolutegravir'], b: ['riluzole'] },
  DDI056: { a: BOOSTERS, b: ['venetoclax'] },
  DDI057: { a: ['efavirenz', 'etravirine'], b: ['imatinib', 'dasatinib', 'nilotinib'] },
  DDI058: { a: BOOSTERS, b: ['bedaquiline'] },
  DDI059: { a: ['dolutegravir', 'bictegravir'], b: ['sevelamer', 'calcium acetate', 'lanthanum'] },
  DDI060: { a: BOOSTERS, b: ['digoxin'] }
};

/* Rules whose text names a class: the enumerated members need clinical validation. */
var CLASS_EXPANSIONS = ['DDI004', 'DDI008', 'DDI009', 'DDI012', 'DDI014', 'DDI017', 'DDI018',
  'DDI024', 'DDI036', 'DDI039', 'DDI044'];

/* D3 (reviewer, 2026-11-13): fully redundant rules are retired, not deleted:
 * kept for traceability with the same status/merged_into convention used for
 * cascade rules, and never evaluated. */
var RETIRED = {
  DDI007: { merged_into: 'DDI024',
    reason_es: 'Duplicada: efavirenz + metadona está incluida en DDI024 con la misma gravedad y manejo.',
    reason_en: 'Duplicate: efavirenz + methadone is included in DDI024 with the same severity and management.' },
  DDI054: { merged_into: 'DDI002',
    reason_es: 'Duplicada a nivel de pauta con DDI002 (lopinavir/ritonavir + sildenafilo); la contraindicación a dosis de HAP se conserva como nota de aplicabilidad de DDI002.',
    reason_en: 'Regimen-level duplicate of DDI002 (lopinavir/ritonavir + sildenafil); the PAH-dose contraindication is kept as a DDI002 applicability note.' }
};

/* D1 (reviewer, 2026-11-13): rilpivirine + H2 blockers is not contraindicated. */
var NEW_RULES = [{
  id: 'DDI061',
  drug_a: 'Rilpivirine (oral)',
  drug_a_class: 'NNRTI (pH-dependent absorption)',
  drug_b: 'H2 blockers (famotidine, ranitidine, cimetidine)',
  drug_b_class: 'H2 receptor antagonist',
  severity: 'MODERATE',
  mechanism_es: 'Aumento del pH gástrico → reducción de absorción de rilpivirina (pH-dependiente) → niveles subóptimos',
  mechanism_en: 'Raised gastric pH → reduced rilpivirine absorption (pH-dependent) → subtherapeutic levels',
  consequence_es: 'Riesgo de fracaso virológico y selección de resistencias a INNTI si las tomas no se separan.',
  consequence_en: 'Risk of virological failure and NNRTI resistance selection if intakes are not separated.',
  management_es: 'Separar la toma 12 h entre el anti-H2 y la rilpivirina oral.',
  management_en: 'Separate H2 blocker and oral rilpivirine intake by 12 h.',
  cascade_relevance_es: 'Cascada: RPV → síntomas dispépticos → anti-H2 → eficacia del TAR comprometida si no se separan las tomas.',
  cascade_relevance_en: 'Cascade: RPV → dyspeptic symptoms → H2 blocker → compromised ART efficacy if intakes are not separated.',
  source: 'Clinical reviewer decision D1, 2026-11-13 (split from DDI018)'
}];

/* Label/management texts aligned with the decisions above. */
var TEXT_OVERRIDES = {
  DDI018: {
    drug_b: 'Proton pump inhibitors',
    drug_b_class: 'Proton pump inhibitor',
    management_es: 'Contraindicado con IBP. Considerar cambiar a régimen alternativo. Para anti-H2 véase DDI061.',
    management_en: 'Contraindicated with PPIs. Consider switching to alternative regimen. For H2 blockers see DDI061.'
  },
  DDI004: { drug_b: 'Warfarin / Acenocoumarol / Direct oral anticoagulants' },
  DDI031: { drug_b: 'Warfarin / Acenocoumarol' },
  DDI012: { drug_a: 'Efavirenz / Etravirine (nevirapine: see DDI039)' }
};

module.exports = { PARTICIPANTS: PARTICIPANTS, CLASS_EXPANSIONS: CLASS_EXPANSIONS, RETIRED: RETIRED, NEW_RULES: NEW_RULES };

if (require.main === module) {
  var fs = require('fs');
  var path = require('path');
  ['prod', 'dev'].forEach(function (track) {
    var file = path.join(__dirname, '..', track, 'ddi_watchlist.json');
    var kb = JSON.parse(fs.readFileSync(file, 'utf8'));
    NEW_RULES.forEach(function (nr) {
      if (!kb.interactions.some(function (r) { return r.id === nr.id; })) kb.interactions.push(JSON.parse(JSON.stringify(nr)));
    });
    kb.interactions.forEach(function (rule) {
      Object.assign(rule, TEXT_OVERRIDES[rule.id] || {});
      var retired = RETIRED[rule.id];
      if (retired) {
        rule.status = 'merged'; rule.merged_into = retired.merged_into;
        rule.merge_reason_es = retired.reason_es; rule.merge_reason_en = retired.reason_en;
      } else { delete rule.status; delete rule.merged_into; delete rule.merge_reason_es; delete rule.merge_reason_en; }
      var p = PARTICIPANTS[rule.id];
      if (!p) throw new Error('No participants defined for ' + rule.id);
      rule.participants_a = p.a.slice();
      rule.participants_b = p.b.slice();
      if (p.excluded_pairs) rule.excluded_pairs = p.excluded_pairs.map(function (x) { return x.slice(); });
      else delete rule.excluded_pairs;
      if (p.note_es) { rule.applicability_note_es = p.note_es; rule.applicability_note_en = p.note_en; }
      else { delete rule.applicability_note_es; delete rule.applicability_note_en; }
    });
    var missing = Object.keys(PARTICIPANTS).filter(function (id) {
      return !kb.interactions.some(function (r) { return r.id === id; });
    });
    if (missing.length) throw new Error('Participants for unknown rules: ' + missing.join(', '));
    kb.version = '1.5.0';
    kb.last_updated = '2026-11-13';
    fs.writeFileSync(file, JSON.stringify(kb, null, 2) + '\n');
    console.log('updated ' + path.relative(process.cwd(), file) + ' (' + kb.interactions.length + ' rules)');
  });
}
