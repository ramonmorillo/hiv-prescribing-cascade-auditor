'use strict';
/* Fase 0 (2026-11) — dictionary and fixed-dose-combination additions needed
 * so every ddi_watchlist.json participant, and every antiretroviral regimen
 * in common use, resolves to its real active ingredients.
 *
 * Every added entry carries review_status: "pending_clinical_validation"
 * until the clinical reviewer signs it off in
 * docs/validation/fase0-ddi-participants.md. Deliberately NOT added:
 * pharmacological_properties (e.g. "sedative") — that changes global
 * medication alerts and is a separate clinical decision.
 *
 * Idempotent: re-running it does not duplicate entries.
 * Usage: node kb/dev/fase0_dictionary_additions.js
 */
var fs = require('fs');
var path = require('path');

var REVIEW = 'pending_clinical_validation';

var NEW_ENTRIES = [
  ['sildenafil', 'PDE5 Inhibitor', ['sildenafilo', 'viagra', 'revatio']],
  ['tadalafil', 'PDE5 Inhibitor', ['tadalafilo', 'cialis', 'adcirca']],
  ['vardenafil', 'PDE5 Inhibitor', ['vardenafilo', 'levitra']],
  ['methadone', 'Opioid', ['metadona', 'metasedin']],
  ['alfentanil', 'Opioid', ['alfentanilo', 'limifen']],
  ['aceclofenac', 'NSAID', ['aceclofenaco', 'airtal']],
  ['dexketoprofen', 'NSAID', ['dexketoprofeno', 'enantyum']],
  ['ketoprofen', 'NSAID', ['ketoprofeno']],
  ['indomethacin', 'NSAID', ['indometacina', 'indomethacine']],
  ['piroxicam', 'NSAID', ['feldene']],
  ['etoricoxib', 'NSAID / COX-2 Inhibitor', ['arcoxia']],
  ['amikacin', 'Antibiotic / Aminoglycoside', ['amikacina']],
  ['gentamicin', 'Antibiotic / Aminoglycoside', ['gentamicina']],
  ['tobramycin', 'Antibiotic / Aminoglycoside', ['tobramicina']],
  ['erythromycin', 'Antibiotic / Macrolide', ['eritromicina']],
  ['moxifloxacin', 'Antibiotic / Fluoroquinolone', ['moxifloxacino']],
  ['norfloxacin', 'Antibiotic / Fluoroquinolone', ['norfloxacino']],
  ['ofloxacin', 'Antibiotic / Fluoroquinolone', ['ofloxacino']],
  ['itraconazole', 'Antifungal / Azole', ['itraconazol']],
  ['ketoconazole', 'Antifungal / Azole', ['ketoconazol']],
  ['posaconazole', 'Antifungal / Azole', ['posaconazol', 'noxafil']],
  ['voriconazole', 'Antifungal / Azole', ['voriconazol', 'vfend']],
  ['chlorpromazine', 'Antipsychotic', ['clorpromazina', 'largactil']],
  ['clozapine', 'Antipsychotic', ['clozapina', 'leponex']],
  ['amisulpride', 'Antipsychotic', ['amisulprida', 'solian']],
  ['paliperidone', 'Antipsychotic', ['paliperidona', 'invega', 'xeplion']],
  ['ziprasidone', 'Antipsychotic', ['ziprasidona', 'zeldox']],
  ['pimozide', 'Antipsychotic', ['pimozida', 'orap']],
  ['lurasidone', 'Antipsychotic', ['lurasidona', 'latuda']],
  ['doxepin', 'Tricyclic Antidepressant', ['doxepina']],
  ['imipramine', 'Tricyclic Antidepressant', ['imipramina', 'tofranil']],
  ['nortriptyline', 'Tricyclic Antidepressant', ['nortriptilina']],
  ['phenobarbital', 'Antiepileptic / Barbiturate', ['fenobarbital', 'phenobarbitone']],
  ['dronedarone', 'Antiarrhythmic', ['dronedarona', 'multaq']],
  ['dofetilide', 'Antiarrhythmic', ['dofetilida']],
  ['felodipine', 'Calcium Channel Blocker', ['felodipino', 'plendil']],
  ['ergotamine', 'Ergot Alkaloid / Antimigraine', ['ergotamina', 'cafergot']],
  ['dihydroergotamine', 'Ergot Alkaloid / Antimigraine', ['dihidroergotamina']],
  ['ethinylestradiol', 'Hormonal Contraceptive / Estrogen', ['etinilestradiol', 'ethinyl estradiol']],
  ['levonorgestrel', 'Hormonal Contraceptive / Progestogen', []],
  ['desogestrel', 'Hormonal Contraceptive / Progestogen', ['cerazet']],
  ['norethisterone', 'Hormonal Contraceptive / Progestogen', ['noretisterona', 'norethindrone']],
  ['drospirenone', 'Hormonal Contraceptive / Progestogen', ['drospirenona']],
  ['norgestimate', 'Hormonal Contraceptive / Progestogen', ['norgestimato']],
  ['gestodene', 'Hormonal Contraceptive / Progestogen', ['gestodeno']],
  ['dienogest', 'Hormonal Contraceptive / Progestogen', []],
  ['etonogestrel', 'Hormonal Contraceptive / Progestogen Implant', ['implanon', 'nexplanon']],
  ['calcium acetate', 'Phosphate Binder', ['acetato calcico', 'acetato de calcio', 'royen']],
  ['sevelamer', 'Phosphate Binder', ['sevelamero', 'renagel', 'renvela']],
  ['lanthanum', 'Phosphate Binder', ['lantano', 'carbonato de lantano', 'lanthanum carbonate', 'fosrenol']],
  ['magnesium oxide', 'Antacid / Mineral Supplement', ['oxido de magnesio']],
  ['almagate', 'Antacid', ['almagato', 'almax']],
  ['magaldrate', 'Antacid', ['magaldrato']],
  ['cimetidine', 'H2 Blocker', ['cimetidina']],
  ['hypericum', 'Herbal / Enzyme Inducer', ['hiperico', 'hierba de san juan', 'st johns wort', 'st. johns wort', 'hypericum perforatum']],
  ['ibrutinib', 'Antineoplastic / Kinase Inhibitor', ['imbruvica']],
  ['imatinib', 'Antineoplastic / Kinase Inhibitor', ['glivec']],
  ['dasatinib', 'Antineoplastic / Kinase Inhibitor', ['sprycel']],
  ['nilotinib', 'Antineoplastic / Kinase Inhibitor', ['tasigna']],
  ['venetoclax', 'Antineoplastic / BCL-2 Inhibitor', ['venclyxto']],
  ['irinotecan', 'Antineoplastic / Topoisomerase Inhibitor', ['irinotecano', 'campto']],
  ['etoposide', 'Antineoplastic / Topoisomerase Inhibitor', ['etoposido', 'vepesid']],
  ['cyclophosphamide', 'Antineoplastic / Alkylating Agent', ['ciclofosfamida', 'genoxal']],
  ['bedaquiline', 'Antitubercular', ['bedaquilina', 'sirturo']],
  ['riluzole', 'Neuroprotective / ALS', ['riluzol', 'rilutek']],
  ['saquinavir', 'Antiretroviral / PI', ['invirase']],
  ['maraviroc', 'Antiretroviral / CCR5 Antagonist', ['celsentri']]
];

/* Variants to add to EXISTING entries. */
var EXTRA_VARIANTS = {
  'tenofovir disoproxil fumarate': ['tenofovir disoproxilo', 'tenofovir disoproxilo fumarato'],
  'rilpivirine': ['rekambys']
};

/* Single-ingredient variants that are in fact fixed-dose combinations: they
 * collapsed Genvoya/Stribild to elvitegravir only (losing cobicistat) and
 * Odefsey to rilpivirine only. Same defect class as Dovato/Truvada (kb 1.1.0). */
var REMOVE_VARIANTS = {
  'elvitegravir': ['genvoya', 'stribild'],
  'rilpivirine': ['odefsey']
};

var NEW_COMBINATIONS = [
  { brand: 'Genvoya', aliases: ['genvoya', 'evg/c/ftc/taf', 'elvitegravir/cobicistat/emtricitabina/tenofovir alafenamida', 'elvitegravir/cobicistat/emtricitabine/tenofovir alafenamide'],
    activeIngredients: ['elvitegravir', 'cobicistat', 'emtricitabine', 'tenofovir alafenamide'],
    therapeuticClass_es: 'INSTI potenciado + pareja de INTI', therapeuticClass_en: 'Boosted INSTI + NRTI backbone' },
  { brand: 'Stribild', aliases: ['stribild', 'evg/c/ftc/tdf', 'elvitegravir/cobicistat/emtricitabina/tenofovir disoproxilo', 'elvitegravir/cobicistat/emtricitabine/tenofovir disoproxil fumarate'],
    activeIngredients: ['elvitegravir', 'cobicistat', 'emtricitabine', 'tenofovir disoproxil fumarate'],
    therapeuticClass_es: 'INSTI potenciado + pareja de INTI', therapeuticClass_en: 'Boosted INSTI + NRTI backbone' },
  { brand: 'Odefsey', aliases: ['odefsey', 'rpv/ftc/taf', 'rilpivirina/emtricitabina/tenofovir alafenamida', 'rilpivirine/emtricitabine/tenofovir alafenamide'],
    activeIngredients: ['rilpivirine', 'emtricitabine', 'tenofovir alafenamide'],
    therapeuticClass_es: 'INNTI + pareja de INTI', therapeuticClass_en: 'NNRTI + NRTI backbone' },
  { brand: 'Eviplera', aliases: ['eviplera', 'complera', 'rpv/ftc/tdf', 'rilpivirina/emtricitabina/tenofovir disoproxilo', 'rilpivirine/emtricitabine/tenofovir disoproxil fumarate'],
    activeIngredients: ['rilpivirine', 'emtricitabine', 'tenofovir disoproxil fumarate'],
    therapeuticClass_es: 'INNTI + pareja de INTI', therapeuticClass_en: 'NNRTI + NRTI backbone' },
  { brand: 'Atripla', aliases: ['atripla', 'efv/ftc/tdf', 'efavirenz/emtricitabina/tenofovir disoproxilo', 'efavirenz/emtricitabine/tenofovir disoproxil fumarate'],
    activeIngredients: ['efavirenz', 'emtricitabine', 'tenofovir disoproxil fumarate'],
    therapeuticClass_es: 'INNTI + pareja de INTI', therapeuticClass_en: 'NNRTI + NRTI backbone' },
  { brand: 'Delstrigo', aliases: ['delstrigo', 'dor/3tc/tdf', 'doravirina/lamivudina/tenofovir disoproxilo', 'doravirine/lamivudine/tenofovir disoproxil fumarate'],
    activeIngredients: ['doravirine', 'lamivudine', 'tenofovir disoproxil fumarate'],
    therapeuticClass_es: 'INNTI + pareja de INTI', therapeuticClass_en: 'NNRTI + NRTI backbone' },
  /* Co-administered boosted PIs (not a single product): written as one unit
     in clinical notes, so they must expand like a combination. */
  { brand: 'Darunavir + ritonavir', aliases: ['drv/r', 'drv/rtv', 'darunavir/ritonavir', 'darunavir/rtv', 'darunavir potenciado con ritonavir'],
    activeIngredients: ['darunavir', 'ritonavir'], coadministration: true,
    therapeuticClass_es: 'IP potenciado', therapeuticClass_en: 'Boosted PI' },
  { brand: 'Atazanavir + ritonavir', aliases: ['atv/r', 'atv/rtv', 'atazanavir/ritonavir', 'atazanavir/rtv', 'atazanavir potenciado con ritonavir'],
    activeIngredients: ['atazanavir', 'ritonavir'], coadministration: true,
    therapeuticClass_es: 'IP potenciado', therapeuticClass_en: 'Boosted PI' }
];

/* Aliases to add to EXISTING combinations. */
var EXTRA_COMBO_ALIASES = { 'Rezolsta': ['prezcobix'] };

function run() {
  var dictFile = path.join(__dirname, '..', 'drug_dictionary.json');
  var comboFile = path.join(__dirname, '..', 'drug_combinations.json');
  var dict = JSON.parse(fs.readFileSync(dictFile, 'utf8'));
  var combos = JSON.parse(fs.readFileSync(comboFile, 'utf8'));
  var byCanonical = {};
  dict.entries.forEach(function (e) { byCanonical[e.canonical] = e; });

  NEW_ENTRIES.forEach(function (row) {
    if (byCanonical[row[0]]) return;
    var entry = { canonical: row[0], drug_class: row[1], variants: row[2].slice(), review_status: REVIEW };
    dict.entries.push(entry);
    byCanonical[row[0]] = entry;
  });
  Object.keys(EXTRA_VARIANTS).forEach(function (canonical) {
    var e = byCanonical[canonical];
    if (!e) throw new Error('Unknown canonical ' + canonical);
    EXTRA_VARIANTS[canonical].forEach(function (v) { if (e.variants.indexOf(v) === -1) e.variants.push(v); });
  });
  Object.keys(REMOVE_VARIANTS).forEach(function (canonical) {
    var e = byCanonical[canonical];
    e.variants = e.variants.filter(function (v) { return REMOVE_VARIANTS[canonical].indexOf(v) === -1; });
  });

  NEW_COMBINATIONS.forEach(function (c) {
    if (combos.combinations.some(function (x) { return x.brand === c.brand; })) return;
    combos.combinations.push(Object.assign({}, c, { hivDrug: true, review_status: REVIEW }));
  });
  Object.keys(EXTRA_COMBO_ALIASES).forEach(function (brand) {
    var c = combos.combinations.find(function (x) { return x.brand === brand; });
    EXTRA_COMBO_ALIASES[brand].forEach(function (a) { if (c.aliases.indexOf(a) === -1) c.aliases.push(a); });
  });

  dict.version = '1.3.0';
  dict.last_updated = '2026-11-13';
  combos.version = '1.3.0';
  combos.last_updated = '2026-11-13';
  var note = '1.3.0 (2026-11-13): Fase 0 — added Genvoya, Stribild, Odefsey, Eviplera, Atripla, Delstrigo and the ' +
    'co-administered DRV/r and ATV/r units; Prezcobix as alias of Rezolsta; removed the single-ingredient aliases ' +
    'that collapsed Genvoya/Stribild to elvitegravir (losing cobicistat) and Odefsey to rilpivirine. Pending clinical validation.';
  if (combos.changelog.indexOf(note) === -1) combos.changelog.unshift(note);

  fs.writeFileSync(dictFile, JSON.stringify(dict, null, 2) + '\n');
  fs.writeFileSync(comboFile, JSON.stringify(combos, null, 2) + '\n');
  console.log('dictionary entries: ' + dict.entries.length + ' · combinations: ' + combos.combinations.length);
}

module.exports = { NEW_ENTRIES: NEW_ENTRIES, NEW_COMBINATIONS: NEW_COMBINATIONS, EXTRA_VARIANTS: EXTRA_VARIANTS, REMOVE_VARIANTS: REMOVE_VARIANTS };
if (require.main === module) run();
