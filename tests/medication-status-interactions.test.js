'use strict';
const { loadKB, CE, assert, reset, summary } = require('./helpers');

function run() {
  reset(); console.log('== medication-status-interactions.test.js ==');
  const kb = loadKB('prod');
  const primary = 'Varón de 61 años con infección por VIH, en tratamiento con Biktarvy desde 2022. Mantiene peso estable, sin diabetes ni síndrome metabólico. Toma amitriptilina 25 mg por la noche. No tenía antecedentes de hipertensión arterial. En enero de 2026 inicia ibuprofeno 600 mg cada 8 horas por lumbalgia. En marzo de 2026 presenta cifras repetidas de presión arterial de 168/96 y 164/94 mmHg, se diagnostica hipertensión arterial y se inicia amlodipino 5 mg cada 24 horas. No toma metformina.';
  const m = CE.buildCaseModel(primary, kb, {lang:'es'});
  const active = m.medications.map(x => x.normalized_name);
  ['bictegravir','emtricitabine','tenofovir alafenamide','amitriptyline','ibuprofen','amlodipine'].forEach(n => assert('primary active: '+n, active.includes(n)));
  assert('negated metformin is not active', !active.includes('metformin'));
  const met = m.inactiveOrNegatedMedications.find(x => x.normalized_name === 'metformin');
  assert('metformin trace retained as negated/not_taking', met && met.assertion === 'negated' && met.status === 'not_taking');
  assert('negated metformin creates no DDI', m.currentInteractions.length === 0);
  assert('NSAID hypertension cascade remains supported', m.possibleCascades.some(c => c.index_drug === 'ibuprofen' && c.cascade_drug === 'amlodipine' && c.classification === 'supported_possible_cascade'));
  assert('discarded signal presentation is not therapeutic', m.possibleCascades.filter(c => c.classification === 'discarded').every(c => !c.recommendation_presentation.applicable));

  const cases = [
    ['Paciente tratado con dolutegravir. No toma metformina.', 'negated', 'not_taking'],
    ['Tomó metformina hasta enero de 2025, cuando fue suspendida. Actualmente recibe dolutegravir.', 'affirmed', 'discontinued'],
    ['Si desarrolla diabetes, se valorará iniciar metformina.', 'conditional', 'planned']
  ];
  cases.forEach(([note,a,s]) => { const x=CE.buildCaseModel(note,kb); const mm=x.allMedicationMentions.find(v=>v.normalized_name==='metformin'); assert(note, mm && mm.assertion===a && mm.status===s && !x.medications.some(v=>v.normalized_name==='metformin') && x.currentInteractions.length===0); });
  const coordinated=CE.buildCaseModel('No toma metformina ni insulina, pero sí sitagliptina.',kb);
  assert('coordinated negation', ['metformin','insulin'].every(n=>coordinated.inactiveOrNegatedMedications.some(x=>x.normalized_name===n)) && coordinated.medications.some(x=>x.normalized_name==='sitagliptin'));
  const contrast=CE.buildCaseModel('No toma metformina, pero toma amlodipino 5 mg cada 24 horas.',kb);
  assert('adversative resets negation', contrast.medications.some(x=>x.normalized_name==='amlodipine') && !contrast.medications.some(x=>x.normalized_name==='metformin'));

  const dtg=CE.buildCaseModel('Paciente en tratamiento activo con dolutegravir 50 mg cada 24 horas y metformina 850 mg cada 12 horas.',kb);
  assert('exact DTG-metformin DDI activates', dtg.currentInteractions.some(x=>x.id==='DDI003' && x.active_participants.includes('dolutegravir') && x.active_participants.includes('metformin')));
  const bic=CE.buildCaseModel('Paciente en tratamiento con Biktarvy y metformina.',kb);
  assert('BIC does not activate DTG-specific DDI', !bic.currentInteractions.some(x=>x.id==='DDI003') && bic.possibleCascades.every(x=>!/Dolutegravir aumenta/i.test(x.ddi_warning_es||'')));
  ['bictegravir','dolutegravir','raltegravir'].forEach(n => { const x=CE.buildCaseModel('Toma '+n+'.',kb); assert(n+' unboosted taxonomy', x.medications[0].drug_class==='Antiretroviral / Unboosted INSTI'); });
  const pi=CE.buildCaseModel('Toma lopinavir/ritonavir.',kb); assert('boosted PI taxonomy', pi.medications.some(x=>x.drug_class==='Antiretroviral / Boosted PI'));

  ['possible_but_incomplete','pharmacological_match_only','not_evaluable','discarded'].forEach(c => assert(c+' suppresses direct therapy', !CE.getRecommendationPresentation(c,{clinical_note_es:'Suspender tratamiento'}).applicable));
  assert('supported permits specific action', CE.getRecommendationPresentation('supported_possible_cascade',{clinical_note_es:'Revisar'}).applicable);
  const old='Mujer de 56 años con infección por VIH, en tratamiento con Dovato desde 2019. Toma anastrozol 1 mg cada 24 horas y amitriptilina 25 mg por la noche. En mayo de 2026 inicia naproxeno 550 mg cada 12 horas por dolor articular. No tenía antecedentes de hipertensión. En agosto de 2026 presenta cifras repetidas de presión arterial de 165/95 y 160/92 mmHg, por lo que se diagnostica hipertensión arterial y se inicia enalapril 5 mg cada 24 horas.';
  const oldM=CE.buildCaseModel(old,kb); assert('prior regression cascade retained', oldM.possibleCascades.some(c=>c.index_drug==='naproxen'&&c.cascade_drug==='enalapril'&&c.classification==='supported_possible_cascade'));
  const r=summary(); console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`); return r.fail===0;
}
module.exports={run}; if(require.main===module) process.exit(run()?0:1);
