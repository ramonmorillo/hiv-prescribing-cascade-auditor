# Fase 0 — Validación clínica de los cambios en la base de conocimiento

**Estado:** pendiente de validación clínica · **Revisor clínico:** Ramón Morillo Verdugo · **Fecha de los cambios:** 2026-11-13
**Rama:** `claude/upbeat-ramanujan-5fo3bt` · **Versiones:** `ddi_watchlist` 1.5.0 · `drug_dictionary` 1.3.0 · `drug_combinations` 1.3.0

Este documento separa lo que se ha cambiado (dato), lo que se ha interpretado al transcribir (interpretación) y las decisiones que quedan abiertas (para el revisor). **Ninguna gravedad, mecanismo, consecuencia ni texto de manejo de las reglas de interacción se ha modificado.** Todas las entradas nuevas del diccionario y de combinaciones llevan `review_status: "pending_clinical_validation"`.

## 1. Qué problema corrige (datos objetivos)

| Hallazgo | Evidencia antes del cambio | Después |
|---|---|---|
| 27/60 reglas de interacción **no podían activarse nunca** (8 CONTRAINDICADAS); 9 más solo para parte de sus fármacos | Los participantes se obtenían partiendo el texto libre (`"Proton pump inhibitors"`), que no coincide con ningún medicamento | Todas las reglas tienen `participants_a/b` explícitos (61 tras D1; 59 activas tras D3); cada participante dispara su regla de extremo a extremo en ES y EN (`tests/kb-ddi-coverage.test.js`) |
| Genvoya/Stribild perdían cobicistat; Odefsey quedaba solo en rilpivirina; "darunavir/ritonavir", "DRV/r", "ATV/r" no se separaban | p. ej. Genvoya + simvastatina → 0 alertas | Se expanden a todos sus principios activos |
| Las interacciones calculadas **no se mostraban** en pantalla ni en el informe clínico | Prezista + Norvir + simvastatina: el motor calculaba DDI001 y el paso 4 mostraba solo "Sin señales de cascada" (verificado renderizando el `app.js` previo) | Sección de interacciones en pasos 4 y 6, texto clínico y CSV, contraindicadas primero |
| Medicamentos no reconocidos se descartaban en silencio | `missingInformation` vacío; paso 5: "no se requiere plan de actuación" | Aviso de cobertura incompleta en pasos 2, 4, 5 e informe |
| HAL-01 y alcance de la suspensión | "Dejó de tomar amlodipino" → activo; "se suspendió atorvastatina y se inició rosuvastatina" → rosuvastatina **inactiva** | Suspensión limitada al fármaco al que se refiere (34 casos de prueba) |

## 2. Reglas de transcripción aplicadas (interpretación — confirmar)

1. Dentro de cada lado, la pertenencia es **disyuntiva** (basta un fármaco presente). Ambos lados deben cumplirse con **fármacos distintos**.
2. Cada lista transcribe lo que nombra el propio texto de la regla. Donde el texto nombra una **clase**, se han enumerado sus miembros (columna *Expansión de clase*): esos miembros son una propuesta, no un dato de la fuente.
3. Donde el texto nombra una **pauta combinada** se ha tomado como lado A el principio que la define: DDI016 "Elvitegravir / Cobicistat" → `elvitegravir` (para que darunavir/cobicistat + rifabutina no herede una contraindicación de EVG/c); DDI028, DDI033, DDI054 "Lopinavir/ritonavir" → `lopinavir`; DDI044 → `cobicistat`.
4. Condiciones de dosis, vía o duración que la nota no permite verificar **no se descartan**: se muestran junto a la alerta como *Aplicabilidad*.
5. La clase de cada fármaco nuevo es la que se muestra en la interfaz; no interviene en la detección de interacciones.

## 3. Decisiones clínicas abiertas (para el revisor)

Cada punto indica qué dato lo origina y qué cambia según la decisión.

- [x] **D1 · RESUELTA (revisor, 2026-11-13): separar la toma 12 h.** DDI018 queda solo para IBP (CONTRAINDICADA). Nueva regla **DDI061** rilpivirina oral + anti-H2 (famotidina, ranitidina, cimetidina), **MODERATE**, manejo: «Separar la toma 12 h entre el anti-H2 y la rilpivirina oral». *Interpretación a confirmar:* la gravedad MODERATE la he asignado yo (la decisión indica solo el manejo); el texto anterior «≥12 h antes o ≥4 h después» se ha sustituido por la pauta indicada por el revisor.
- [ ] **D2 · Rekambys (rilpivirina IM) se resuelve como `rilpivirine`.** DDI018 es una interacción de absorción oral y se dispararía con la forma intramuscular (la nota de aplicabilidad lo advierte). *Propuesta:* canónico propio `rilpivirine (long-acting injectable)` excluido de DDI018. Lo mismo aplica a "cabotegravir/rilpivirina IM", ya existente.
- [x] **D3 · RESUELTA (revisor, 2026-11-13): eliminar las reglas duplicadas.** Una prueba exige ahora que ningún par de medicamentos active dos reglas. Criterio: una regla totalmente redundante se **retira** (se conserva con `status: "merged"` y `merged_into` por trazabilidad, igual que las cascadas fusionadas, y no se ejecuta); en un solapamiento parcial **gana la regla más específica** y el par duplicado se quita de la general.
  - DDI007 → retirada en DDI024 (mismo par, gravedad y manejo).
  - DDI054 → retirada en DDI002; la contraindicación de sildenafilo a dosis de HAP con LPV/r se conserva como nota de aplicabilidad de DDI002.
  - DDI004: excluye efavirenz + warfarina/acenocumarol (lo cubre DDI031).
  - DDI012: sin nevirapina (lo cubre DDI039).
  - DDI009: sin quetiapina ni pimozida (lo cubre DDI019).
  - DDI014: sin acetato cálcico, que es un quelante del fósforo (lo cubre DDI059, MODERATE). *A confirmar:* con este criterio, bictegravir/dolutegravir + acetato cálcico pasa a mostrarse como MODERATE en vez de MAJOR.
- [ ] **D4 · DDI009 ("cualquier ARV que prolonga el QT"):** el texto incluye "rilpivirina a dosis altas", indetectable en la nota; se ha **excluido** rilpivirina para no alertar con la dosis estándar. Se han enumerado macrólidos, fluoroquinolonas, azoles, antipsicóticos y tricíclicos.
- [ ] **D5 · DDI024 nombra "NNRTIs":** se ha restringido a efavirenz y nevirapina (más rifampicina, nombrada en la regla). Etravirina, rilpivirina y doravirina quedan fuera.
- [ ] **D6 · DDI036 (hipérico) "cualquier pauta ARV (IP/r, INSTI, INNTI)":** enumerados IP, potenciadores, INSTI e INNTI. Quedan fuera los INTI (cubiertos por DDI053 para TAF), lenacapavir, maraviroc y fostemsavir.
- [ ] **D7 · DDI014 (cationes polivalentes):** solo se han incluido los antiácidos y sales nombrados (calcio, magnesio, aluminio). **Hierro y zinc no se incluyen** porque la regla no los nombra.
- [ ] **D8 · DDI020 (amiodarona/dronedarona) solo nombra ritonavir**, no cobicistat. Transcrito tal cual.
- [ ] **D9 · DDI042 rotula ketoconazol como "triazol"** (es un imidazol). Posaconazol e isavuconazol no se nombran y no se han incluido.
- [x] **D10 · RESUELTA (revisor, 2026-11-13): acenocumarol es un fármaco distinto de warfarina.** Nuevo canónico `acenocoumarol` (acenocumarol, Sintrom); retirado de las variantes de warfarina. Añadido a DDI004 y DDI031 (antes se activaban con Sintrom porque se leía como warfarina, así que se conserva la cobertura). *A confirmar:* inclusión de acenocumarol en esas dos reglas.
- [ ] **D11 · Propiedad `sedative` no añadida** a metadona, alfentanilo, clorpromazina, clozapina, doxepina, imipramina, nortriptilina ni fenobarbital. Añadirla cambia la alerta global de carga depresora del SNC (CM007).
- [ ] **D12 · Pendiente: 178 nombres en ejemplos de reglas de cascada** no están en el diccionario (`tests/fixtures/unresolved-cascade-names.json`). Mezcla de fármacos sin variante española (p. ej. bumetanida, prednisolona, doxazosina, metilfenidato) y texto que no es un fármaco ("lithotripsy referral", "airway management"). La prueba impide que la lista crezca.

## 4. Participantes por regla de interacción (generado de `kb/prod/ddi_watchlist.json`, v1.5.0)

| Regla | Estado | Gravedad | Lado A (activa si alguno presente) | Lado B | Pares excluidos (los cubre otra regla) | Expansión de clase | Nota de aplicabilidad | Validado |
|---|---|---|---|---|---|---|---|---|
| DDI001 | Activa | CONTRAINDICATED | ritonavir, cobicistat | simvastatin, lovastatin | — | — | — | ☐ |
| DDI002 | Activa | MAJOR | ritonavir, cobicistat | sildenafil, tadalafil, vardenafil | — | — | Con lopinavir/ritonavir, el sildenafilo a dosis de hipertensión arterial pulmonar (>20 mg) está CONTRAINDICADO (antigua DDI054, fusionada aquí): considerar un TAR sin IP/r o, si no es posible, bosentán o iloprost. La dosis no se verifica en la nota. | ☐ |
| DDI003 | Activa | MODERATE | dolutegravir | metformin | — | — | — | ☐ |
| DDI004 | Activa | MAJOR | efavirenz, nevirapine, rifampicin | warfarin, acenocoumarol, dabigatran, rivaroxaban, apixaban, edoxaban | efavirenz + warfarin; efavirenz + acenocoumarol | **Sí** | — | ☐ |
| DDI005 | Activa | CONTRAINDICATED | ritonavir, cobicistat | midazolam, triazolam | — | — | La regla aplica a midazolam/triazolam ORALES; la vía no se verifica en la nota. | ☐ |
| DDI006 | Activa | MAJOR | ritonavir | colchicine | — | — | — | ☐ |
| DDI007 | **Retirada → DDI024** | MAJOR | efavirenz | methadone | — | — | — | ☐ |
| DDI008 | Activa | MODERATE | tenofovir disoproxil fumarate | ibuprofen, naproxen, diclofenac, dexketoprofen, ketoprofen, indomethacin, meloxicam, piroxicam, aceclofenac, celecoxib, etoricoxib, gentamicin, amikacin, tobramycin | — | **Sí** | Los contrastes yodados no se detectan en la nota: valorar si hay exposición prevista. | ☐ |
| DDI009 | Activa | MAJOR | saquinavir, lopinavir | clarithromycin, erythromycin, azithromycin, levofloxacin, moxifloxacin, ciprofloxacin, ofloxacin, norfloxacin, fluconazole, itraconazole, ketoconazole, voriconazole, posaconazole, haloperidol, olanzapine, risperidone, aripiprazole, ziprasidone, chlorpromazine, amisulpride, paliperidone, clozapine, amitriptyline, nortriptyline, imipramine, clomipramine, doxepin | — | **Sí** | Rilpivirina solo prolonga el QT a dosis supraterapéuticas: no se incluye como desencadenante. Revisar ECG y electrolitos. | ☐ |
| DDI010 | Activa | MAJOR | cobicistat | fluticasone, budesonide | — | — | — | ☐ |
| DDI011 | Activa | MODERATE | ritonavir, cobicistat | atorvastatin | — | — | — | ☐ |
| DDI012 | Activa | MAJOR | efavirenz, etravirine | ethinylestradiol, levonorgestrel, desogestrel, norethisterone, drospirenone, norgestimate, gestodene, dienogest | — | **Sí** | — | ☐ |
| DDI013 | Activa | MAJOR | ritonavir, cobicistat | tacrolimus, cyclosporine, sirolimus | — | — | — | ☐ |
| DDI014 | Activa | MAJOR | dolutegravir, bictegravir, raltegravir | calcium carbonate, magnesium hydroxide, magnesium oxide, aluminum hydroxide, almagate, magaldrate | — | **Sí** | — | ☐ |
| DDI015 | Activa | CONTRAINDICATED | ritonavir, cobicistat | rifampicin | — | — | — | ☐ |
| DDI016 | Activa | CONTRAINDICATED | elvitegravir | rifampicin, rifabutin | — | — | — | ☐ |
| DDI017 | Activa | MAJOR | atazanavir | omeprazole, esomeprazole, pantoprazole, lansoprazole, rabeprazole | — | **Sí** | — | ☐ |
| DDI018 | Activa | CONTRAINDICATED | rilpivirine | omeprazole, esomeprazole, pantoprazole, lansoprazole, rabeprazole | — | **Sí** | Aplica a rilpivirina ORAL, no a la intramuscular. | ☐ |
| DDI019 | Activa | CONTRAINDICATED | ritonavir, cobicistat | quetiapine, pimozide, lurasidone | — | — | — | ☐ |
| DDI020 | Activa | CONTRAINDICATED | ritonavir | amiodarone, dronedarone | — | — | — | ☐ |
| DDI021 | Activa | MAJOR | ritonavir, cobicistat | salmeterol | — | — | — | ☐ |
| DDI022 | Activa | CONTRAINDICATED | efavirenz, nevirapine | voriconazole | — | — | — | ☐ |
| DDI023 | Activa | MAJOR | ritonavir, cobicistat | carbamazepine, phenytoin, phenobarbital | — | — | — | ☐ |
| DDI024 | Activa | MAJOR | efavirenz, nevirapine, rifampicin | methadone | — | **Sí** | — | ☐ |
| DDI025 | Activa | MAJOR | dolutegravir | rifampicin | — | — | — | ☐ |
| DDI026 | Activa | CONTRAINDICATED | bictegravir | rifampicin, rifabutin | — | — | — | ☐ |
| DDI027 | Activa | MODERATE | ritonavir, cobicistat | clarithromycin | — | — | — | ☐ |
| DDI028 | Activa | MODERATE | lopinavir | rosuvastatin | — | — | — | ☐ |
| DDI029 | Activa | MAJOR | ritonavir, cobicistat | trazodone | — | — | — | ☐ |
| DDI030 | Activa | MODERATE | ritonavir, cobicistat | amlodipine, felodipine, nifedipine | — | — | — | ☐ |
| DDI031 | Activa | MAJOR | efavirenz, etravirine | warfarin, acenocoumarol | — | — | — | ☐ |
| DDI032 | Activa | MAJOR | ritonavir, cobicistat | fentanyl, alfentanil, buprenorphine | — | — | La regla se refiere a vía parenteral/transdérmica; la vía no se verifica en la nota. | ☐ |
| DDI033 | Activa | MODERATE | lopinavir | lamotrigine | — | — | — | ☐ |
| DDI034 | Activa | MODERATE | efavirenz | clopidogrel | — | — | — | ☐ |
| DDI035 | Activa | MAJOR | ritonavir, cobicistat | dexamethasone, methylprednisolone | — | — | La regla se refiere a uso sistémico prolongado; la duración no se verifica en la nota. | ☐ |
| DDI036 | Activa | CONTRAINDICATED | darunavir, atazanavir, lopinavir, ritonavir, cobicistat, dolutegravir, raltegravir, bictegravir, elvitegravir, cabotegravir, efavirenz, rilpivirine, nevirapine, doravirine, etravirine | hypericum | — | **Sí** | — | ☐ |
| DDI037 | Activa | MODERATE | ritonavir, cobicistat | alprazolam, clonazepam, diazepam | — | — | — | ☐ |
| DDI038 | Activa | MAJOR | atazanavir | irinotecan | — | — | — | ☐ |
| DDI039 | Activa | MAJOR | nevirapine | ethinylestradiol, levonorgestrel, desogestrel, norethisterone, drospirenone, norgestimate, gestodene, dienogest, etonogestrel | — | **Sí** | — | ☐ |
| DDI040 | Activa | MAJOR | ritonavir, cobicistat | ibrutinib | — | — | — | ☐ |
| DDI041 | Activa | MODERATE | atazanavir | tenofovir disoproxil fumarate | — | — | — | ☐ |
| DDI042 | Activa | MAJOR | ritonavir, cobicistat | itraconazole, ketoconazole, voriconazole | — | — | — | ☐ |
| DDI043 | Activa | MAJOR | raltegravir | rifampicin | — | — | — | ☐ |
| DDI044 | Activa | MODERATE | cobicistat | ethinylestradiol, norgestimate | — | **Sí** | — | ☐ |
| DDI045 | Activa | MODERATE | ritonavir, cobicistat | dabigatran | — | — | — | ☐ |
| DDI046 | Activa | MAJOR | ritonavir, cobicistat | rivaroxaban, apixaban | — | — | — | ☐ |
| DDI047 | Activa | CONTRAINDICATED | dolutegravir | dofetilide | — | — | — | ☐ |
| DDI048 | Activa | MODERATE | efavirenz | etoposide, cyclophosphamide | — | — | — | ☐ |
| DDI049 | Activa | CONTRAINDICATED | ritonavir, cobicistat | ergotamine, dihydroergotamine | — | — | — | ☐ |
| DDI050 | Activa | MODERATE | efavirenz, nevirapine | sertraline, citalopram, escitalopram | — | — | — | ☐ |
| DDI051 | Activa | CONTRAINDICATED | ritonavir, cobicistat | alfuzosin | — | — | — | ☐ |
| DDI052 | Activa | MODERATE | ritonavir, cobicistat | rifabutin | — | — | — | ☐ |
| DDI053 | Activa | MAJOR | tenofovir alafenamide | rifampicin, carbamazepine, hypericum | — | — | — | ☐ |
| DDI054 | **Retirada → DDI002** | CONTRAINDICATED | lopinavir | sildenafil | — | — | Contraindicada solo a dosis de hipertensión arterial pulmonar (>20 mg); la dosis no se verifica. Para uso en disfunción eréctil véase DDI002. | ☐ |
| DDI055 | Activa | MODERATE | dolutegravir | riluzole | — | — | — | ☐ |
| DDI056 | Activa | CONTRAINDICATED | ritonavir, cobicistat | venetoclax | — | — | — | ☐ |
| DDI057 | Activa | MAJOR | efavirenz, etravirine | imatinib, dasatinib, nilotinib | — | — | — | ☐ |
| DDI058 | Activa | MAJOR | ritonavir, cobicistat | bedaquiline | — | — | — | ☐ |
| DDI059 | Activa | MODERATE | dolutegravir, bictegravir | sevelamer, calcium acetate, lanthanum | — | — | — | ☐ |
| DDI060 | Activa | MODERATE | ritonavir, cobicistat | digoxin | — | — | — | ☐ |
| DDI061 | Activa | MODERATE | rilpivirine | famotidine, ranitidine, cimetidine | — | **Sí** | Aplica a rilpivirina ORAL, no a la intramuscular. | ☐ |

## 5. Principios activos añadidos al diccionario (`kb/drug_dictionary.json`)

No se han añadido como variante términos que también son palabras clínicas habituales (p. ej. *Luminal*, que colisionaría con "contenido luminal") ni abreviaturas de tres letras.

| Principio activo (canónico) | Clase asignada | Variantes / marcas añadidas | Validado |
|---|---|---|---|
| sildenafil | PDE5 Inhibitor | sildenafilo, viagra, revatio | ☐ |
| tadalafil | PDE5 Inhibitor | tadalafilo, cialis, adcirca | ☐ |
| vardenafil | PDE5 Inhibitor | vardenafilo, levitra | ☐ |
| methadone | Opioid | metadona, metasedin | ☐ |
| alfentanil | Opioid | alfentanilo, limifen | ☐ |
| aceclofenac | NSAID | aceclofenaco, airtal | ☐ |
| dexketoprofen | NSAID | dexketoprofeno, enantyum | ☐ |
| ketoprofen | NSAID | ketoprofeno | ☐ |
| indomethacin | NSAID | indometacina, indomethacine | ☐ |
| piroxicam | NSAID | feldene | ☐ |
| etoricoxib | NSAID / COX-2 Inhibitor | arcoxia | ☐ |
| amikacin | Antibiotic / Aminoglycoside | amikacina | ☐ |
| gentamicin | Antibiotic / Aminoglycoside | gentamicina | ☐ |
| tobramycin | Antibiotic / Aminoglycoside | tobramicina | ☐ |
| erythromycin | Antibiotic / Macrolide | eritromicina | ☐ |
| moxifloxacin | Antibiotic / Fluoroquinolone | moxifloxacino | ☐ |
| norfloxacin | Antibiotic / Fluoroquinolone | norfloxacino | ☐ |
| ofloxacin | Antibiotic / Fluoroquinolone | ofloxacino | ☐ |
| itraconazole | Antifungal / Azole | itraconazol | ☐ |
| ketoconazole | Antifungal / Azole | ketoconazol | ☐ |
| posaconazole | Antifungal / Azole | posaconazol, noxafil | ☐ |
| voriconazole | Antifungal / Azole | voriconazol, vfend | ☐ |
| chlorpromazine | Antipsychotic | clorpromazina, largactil | ☐ |
| clozapine | Antipsychotic | clozapina, leponex | ☐ |
| amisulpride | Antipsychotic | amisulprida, solian | ☐ |
| paliperidone | Antipsychotic | paliperidona, invega, xeplion | ☐ |
| ziprasidone | Antipsychotic | ziprasidona, zeldox | ☐ |
| pimozide | Antipsychotic | pimozida, orap | ☐ |
| lurasidone | Antipsychotic | lurasidona, latuda | ☐ |
| doxepin | Tricyclic Antidepressant | doxepina | ☐ |
| imipramine | Tricyclic Antidepressant | imipramina, tofranil | ☐ |
| nortriptyline | Tricyclic Antidepressant | nortriptilina | ☐ |
| phenobarbital | Antiepileptic / Barbiturate | fenobarbital, phenobarbitone | ☐ |
| dronedarone | Antiarrhythmic | dronedarona, multaq | ☐ |
| dofetilide | Antiarrhythmic | dofetilida | ☐ |
| felodipine | Calcium Channel Blocker | felodipino, plendil | ☐ |
| ergotamine | Ergot Alkaloid / Antimigraine | ergotamina, cafergot | ☐ |
| dihydroergotamine | Ergot Alkaloid / Antimigraine | dihidroergotamina | ☐ |
| ethinylestradiol | Hormonal Contraceptive / Estrogen | etinilestradiol, ethinyl estradiol | ☐ |
| levonorgestrel | Hormonal Contraceptive / Progestogen | — | ☐ |
| desogestrel | Hormonal Contraceptive / Progestogen | cerazet | ☐ |
| norethisterone | Hormonal Contraceptive / Progestogen | noretisterona, norethindrone | ☐ |
| drospirenone | Hormonal Contraceptive / Progestogen | drospirenona | ☐ |
| norgestimate | Hormonal Contraceptive / Progestogen | norgestimato | ☐ |
| gestodene | Hormonal Contraceptive / Progestogen | gestodeno | ☐ |
| dienogest | Hormonal Contraceptive / Progestogen | — | ☐ |
| etonogestrel | Hormonal Contraceptive / Progestogen Implant | implanon, nexplanon | ☐ |
| calcium acetate | Phosphate Binder | acetato calcico, acetato de calcio, royen | ☐ |
| sevelamer | Phosphate Binder | sevelamero, renagel, renvela | ☐ |
| lanthanum | Phosphate Binder | lantano, carbonato de lantano, lanthanum carbonate, fosrenol | ☐ |
| magnesium oxide | Antacid / Mineral Supplement | oxido de magnesio | ☐ |
| almagate | Antacid | almagato, almax | ☐ |
| magaldrate | Antacid | magaldrato | ☐ |
| cimetidine | H2 Blocker | cimetidina | ☐ |
| hypericum | Herbal / Enzyme Inducer | hiperico, hierba de san juan, st johns wort, st. johns wort, hypericum perforatum | ☐ |
| ibrutinib | Antineoplastic / Kinase Inhibitor | imbruvica | ☐ |
| imatinib | Antineoplastic / Kinase Inhibitor | glivec | ☐ |
| dasatinib | Antineoplastic / Kinase Inhibitor | sprycel | ☐ |
| nilotinib | Antineoplastic / Kinase Inhibitor | tasigna | ☐ |
| venetoclax | Antineoplastic / BCL-2 Inhibitor | venclyxto | ☐ |
| irinotecan | Antineoplastic / Topoisomerase Inhibitor | irinotecano, campto | ☐ |
| etoposide | Antineoplastic / Topoisomerase Inhibitor | etoposido, vepesid | ☐ |
| cyclophosphamide | Antineoplastic / Alkylating Agent | ciclofosfamida, genoxal | ☐ |
| bedaquiline | Antitubercular | bedaquilina, sirturo | ☐ |
| riluzole | Neuroprotective / ALS | riluzol, rilutek | ☐ |
| saquinavir | Antiretroviral / PI | invirase | ☐ |
| maraviroc | Antiretroviral / CCR5 Antagonist | celsentri | ☐ |

Variantes añadidas a entradas existentes: `tenofovir disoproxil fumarate` ← "tenofovir disoproxilo", "tenofovir disoproxilo fumarato"; `rilpivirine` ← "rekambys" (ver D2).
Variantes **retiradas** (eran combinaciones mal catalogadas como monofármaco): `elvitegravir` ← "genvoya", "stribild"; `rilpivirine` ← "odefsey".

## 6. Combinaciones y pautas coadministradas añadidas (`kb/drug_combinations.json`)

| Unidad | Principios activos | Alias reconocidos | Validado |
|---|---|---|---|
| Genvoya | elvitegravir + cobicistat + emtricitabine + tenofovir alafenamide | genvoya, evg/c/ftc/taf, elvitegravir/cobicistat/emtricitabina/tenofovir alafenamida, elvitegravir/cobicistat/emtricitabine/tenofovir alafenamide | ☐ |
| Stribild | elvitegravir + cobicistat + emtricitabine + tenofovir disoproxil fumarate | stribild, evg/c/ftc/tdf, elvitegravir/cobicistat/emtricitabina/tenofovir disoproxilo, elvitegravir/cobicistat/emtricitabine/tenofovir disoproxil fumarate | ☐ |
| Odefsey | rilpivirine + emtricitabine + tenofovir alafenamide | odefsey, rpv/ftc/taf, rilpivirina/emtricitabina/tenofovir alafenamida, rilpivirine/emtricitabine/tenofovir alafenamide | ☐ |
| Eviplera | rilpivirine + emtricitabine + tenofovir disoproxil fumarate | eviplera, complera, rpv/ftc/tdf, rilpivirina/emtricitabina/tenofovir disoproxilo, rilpivirine/emtricitabine/tenofovir disoproxil fumarate | ☐ |
| Atripla | efavirenz + emtricitabine + tenofovir disoproxil fumarate | atripla, efv/ftc/tdf, efavirenz/emtricitabina/tenofovir disoproxilo, efavirenz/emtricitabine/tenofovir disoproxil fumarate | ☐ |
| Delstrigo | doravirine + lamivudine + tenofovir disoproxil fumarate | delstrigo, dor/3tc/tdf, doravirina/lamivudina/tenofovir disoproxilo, doravirine/lamivudine/tenofovir disoproxil fumarate | ☐ |
| Darunavir + ritonavir *(coadministración)* | darunavir + ritonavir | drv/r, drv/rtv, darunavir/ritonavir, darunavir/rtv, darunavir potenciado con ritonavir | ☐ |
| Atazanavir + ritonavir *(coadministración)* | atazanavir + ritonavir | atv/r, atv/rtv, atazanavir/ritonavir, atazanavir/rtv, atazanavir potenciado con ritonavir | ☐ |

Alias añadido: Rezolsta ← "prezcobix".

## 7. Cómo revisar y cerrar

1. Marque ☐ → ☑ en las tablas y resuelva las decisiones abiertas (D2, D4–D9, D11, D12) (basta con una línea de decisión por punto).
2. Los cambios se aplican editando `kb/dev/ddi_participants.js` y `kb/dev/fase0_dictionary_additions.js` y ejecutando ambos scripts. Así la KB se regenera de forma reproducible y nunca se edita a mano.
3. `npm test` verifica que cada participante sigue resolviéndose y activando su regla.
4. Cuando todo esté validado, sustituya `review_status: "pending_clinical_validation"` por `"clinically_validated"` con fecha y revisor, y registre la validación en `kb/CHANGELOG.md`.
