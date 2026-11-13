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
var POLYVALENT_CATIONS = ['calcium carbonate', 'calcium acetate', 'magnesium hydroxide', 'magnesium oxide',
  'aluminum hydroxide', 'almagate', 'magaldrate'];
var NON_NRTI_ARVS = ['darunavir', 'atazanavir', 'lopinavir', 'ritonavir', 'cobicistat',
  'dolutegravir', 'raltegravir', 'bictegravir', 'elvitegravir', 'cabotegravir',
  'efavirenz', 'rilpivirine', 'nevirapine', 'doravirine', 'etravirine'];

/* id -> { a: [...], b: [...], note_es?, note_en? } */
var PARTICIPANTS = {
  DDI001: { a: BOOSTERS, b: ['simvastatin', 'lovastatin'] },
  DDI002: { a: BOOSTERS, b: ['sildenafil', 'tadalafil', 'vardenafil'] },
  DDI003: { a: ['dolutegravir'], b: ['metformin'] },
  DDI004: { a: ['efavirenz', 'nevirapine', 'rifampicin'], b: ['warfarin'].concat(DOACS) },
  DDI005: { a: BOOSTERS, b: ['midazolam', 'triazolam'],
    note_es: 'La regla aplica a midazolam/triazolam ORALES; la vía no se verifica en la nota.',
    note_en: 'The rule applies to ORAL midazolam/triazolam; route is not verified from the note.' },
  DDI006: { a: ['ritonavir'], b: ['colchicine'] },
  DDI007: { a: ['efavirenz'], b: ['methadone'] },
  DDI008: { a: ['tenofovir disoproxil fumarate'], b: NSAIDS.concat(AMINOGLYCOSIDES),
    note_es: 'Los contrastes yodados no se detectan en la nota: valorar si hay exposición prevista.',
    note_en: 'Iodinated contrast agents are not detected from the note: check for planned exposure.' },
  DDI009: { a: ['saquinavir', 'lopinavir'], b: MACROLIDES.concat(FLUOROQUINOLONES, AZOLES, ANTIPSYCHOTICS, TCAS),
    note_es: 'Rilpivirina solo prolonga el QT a dosis supraterapéuticas: no se incluye como desencadenante. Revisar ECG y electrolitos.',
    note_en: 'Rilpivirine prolongs QT only at supratherapeutic doses and is not used as a trigger. Check ECG and electrolytes.' },
  DDI010: { a: ['cobicistat'], b: ['fluticasone', 'budesonide'] },
  DDI011: { a: BOOSTERS, b: ['atorvastatin'] },
  DDI012: { a: ['efavirenz', 'nevirapine', 'etravirine'], b: HORMONAL_CONTRACEPTIVES },
  DDI013: { a: BOOSTERS, b: ['tacrolimus', 'cyclosporine', 'sirolimus'] },
  DDI014: { a: ['dolutegravir', 'bictegravir', 'raltegravir'], b: POLYVALENT_CATIONS },
  DDI015: { a: BOOSTERS, b: ['rifampicin'] },
  DDI016: { a: ['elvitegravir'], b: ['rifampicin', 'rifabutin'] },
  DDI017: { a: ['atazanavir'], b: PPIS },
  DDI018: { a: ['rilpivirine'], b: PPIS.concat(H2),
    note_es: 'Contraindicada con IBP. Con anti-H2 no está contraindicada: separar la toma (anti-H2 ≥12 h antes o ≥4 h después). Aplica a rilpivirina ORAL, no a la intramuscular.',
    note_en: 'Contraindicated with PPIs. With H2 blockers it is not contraindicated: separate dosing (H2 blocker ≥12 h before or ≥4 h after). Applies to ORAL rilpivirine, not the intramuscular form.' },
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
  DDI031: { a: ['efavirenz', 'etravirine'], b: ['warfarin'] },
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

module.exports = { PARTICIPANTS: PARTICIPANTS, CLASS_EXPANSIONS: CLASS_EXPANSIONS };

if (require.main === module) {
  var fs = require('fs');
  var path = require('path');
  ['prod', 'dev'].forEach(function (track) {
    var file = path.join(__dirname, '..', track, 'ddi_watchlist.json');
    var kb = JSON.parse(fs.readFileSync(file, 'utf8'));
    kb.interactions.forEach(function (rule) {
      var p = PARTICIPANTS[rule.id];
      if (!p) throw new Error('No participants defined for ' + rule.id);
      rule.participants_a = p.a.slice();
      rule.participants_b = p.b.slice();
      if (p.note_es) { rule.applicability_note_es = p.note_es; rule.applicability_note_en = p.note_en; }
      else { delete rule.applicability_note_es; delete rule.applicability_note_en; }
    });
    var missing = Object.keys(PARTICIPANTS).filter(function (id) {
      return !kb.interactions.some(function (r) { return r.id === id; });
    });
    if (missing.length) throw new Error('Participants for unknown rules: ' + missing.join(', '));
    fs.writeFileSync(file, JSON.stringify(kb, null, 2) + '\n');
    console.log('updated ' + path.relative(process.cwd(), file) + ' (' + kb.interactions.length + ' rules)');
  });
}
