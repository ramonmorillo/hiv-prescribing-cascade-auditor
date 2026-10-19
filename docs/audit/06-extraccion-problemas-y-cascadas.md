# 06 — Auditoría y corrección estructural: extracción de problemas clínicos y motor de cascadas

**Rama:** `claude/compassionate-meitner-abrc8s` (base `643d520`). **Fecha:** 2026-10-19.
**Caso de regresión obligatorio:** PVVIH, varón de 58 años (Biktarvy, olmesartán/HCT, propranolol, amlodipino, metformina, rosuvastatina/ezetimiba, lormetazepam, silodosina; trazodona en 10/2026).

## 1. Reproducción de la incidencia (antes de modificar código)

| Dato objetivo (commit base) | Resultado |
|---|---|
| Problemas en el circuito de revisión | 2 de 7 (HTA, DM2) |
| Insomnio | sólo como etiqueta de síntoma («insomnia (insomnio) neurological»), fuera del circuito de revisión |
| Indicaciones explícitas extraídas | 0 de 12 medicamentos |
| Lormetazepam | no reconocido como medicamento |
| Fecha de inicio de olmesartán | «desde 2021» (de la línea anterior) |
| Fecha de inicio de Biktarvy | «desde 2021» (fecha del control virológico) |
| VIH003 bictegravir → metformina | `supported_possible_cascade` (apoyada sólo en las fechas erróneas anteriores) |
| Infección por VIH | ausente de la lista de problemas |

## 2. Causas raíz

**Errores confirmados (reproducidos y cubiertos por pruebas):**

1. **Vocabulario cerrado de problemas.** `detectGenericActiveProblems` sólo reconocía los 6 conceptos de `clinical_problems.json`, un catálogo diseñado para apoyar reglas de cascada, no como lista de problemas. Cualquier otro diagnóstico (temblor esencial, dislipemia, HBP, insomnio, VIH) era invisible.
2. **Indicaciones extraídas pero nunca convertidas en problemas, y extracción rota.** `extractExplicitIndicationForMedication` exigía el conector «por/para» a ≤40 caracteres del fármaco y sin comas, por lo que fallaba con la redacción habitual («X 10 mg, tres comprimidos cada 24 h desde … por Y»). Su resultado sólo se usaba para *descartar* cascadas.
3. **Tres vocabularios paralelos.** Problemas (`clinical_problems.json`), síntomas (`kb_symptoms.json`) y efectos adversos (`ade_treatment_map.json`) tenían sinónimos propios. Los síntomas se mostraban como etiquetas no editables (origen de la etiqueta aislada de la captura) y además alimentaban el puente de síntomas sin pasar por la revisión.
4. **El motor de cascadas releía el texto bruto.** `verifyIntermediateProblem` escaneaba la nota con los sinónimos de `ade_treatment_map` cuando la regla no estaba en el catálogo: reconocía problemas ausentes del formulario y seguía viéndolos aunque el profesional los excluyera.
5. **Desplazamiento de posiciones de medicamentos.** `resolveDrugMentions` trabaja sobre un texto normalizado que colapsa comas y espacios; el reanclaje buscaba la variante normalizada («olmesartan») en el texto con tilde («Olmesartán»), fallaba y usaba un offset desplazado → fecha, negación e indicación de otra frase.
6. **Atribución semántica de fechas.** Cualquier fecha de la frase se asignaba al medicamento («control virológico desde 2021» → inicio de Biktarvy) y la fecha de inicio del tratamiento se mostraba como «inicio documentado» del problema.
7. **Ventanas de negación/resolución que cruzaban frases** (`classifyMention`): «Hipertensión arterial. Hipertensión arterial resuelta.» podía leer «resuelta» de la frase siguiente.
8. **CM007 (carga depresora del SNC)** se disparaba con una sola palabra clave pese a que su propio mensaje afirma «≥2 depresores», y no reconocía agentes no listados literalmente (lormetazepam, trazodona).
9. **Falso «mismatch» de indicación.** Una indicación explícita compatible con la regla (rosuvastatina «por dislipemia» en VIH001) se trataba como incompatible porque sólo se comparaban identificadores del catálogo.
10. **Cue temporal por fecha re-admitida.** El fallback de `detectDrugPairTemporality` aceptaba «desde <fecha>» a ±40 caracteres como indicio de inicio, re-introduciendo fechas ya rechazadas.
11. **Huecos del diccionario:** lormetazepam, bromazepam, ketazolam, clorazepato, triazolam, flurazepam.
12. **Errores de equivalencia semántica latentes:** «diabetes insípida» → diabetes mellitus; «depresión respiratoria» → depresión; «hipertensión pulmonar/portal/ocular» → HTA; `kb_symptoms` trataba «trastorno del sueño» como sinónimo de insomnio.

**Limitaciones de diseño (corregidas):** VIH001 agrupaba IP potenciados e INSTI con la misma plausibilidad «high» y nivel A, aunque su propio campo `ade_mechanism` describe la vía INSTI como indirecta (ganancia de peso → dislipemia secundaria).

**Hipótesis no verificables desde este entorno:** equivalencia exacta entre la versión publicada en GitHub Pages y `main` (sin acceso de red, igual que en la auditoría 01).

## 3. Cambios arquitectónicos

```
Nota → resolveClassifiedMentions (offsets exactos + estado del fármaco)
     → extractClinicalProblems ──┬─ indicaciones documentadas (por fármaco, cláusula propia)
                                 ├─ menciones explícitas (una única pasada de la terminología)
                                 └─ inferencia contextual declarada en la KB (VIH)
       consolidación por concepto (broader→narrower sólo si la KB lo permite)
     → CaseModel.activeProblems  ← única fuente para: revisión (paso 2), motor de cascadas,
                                    puente de síntomas, alertas, informes
     → ProblemReview (traza de solo lectura) → ReviewedInputAdapter → motor → ReportContract
```

- **`kb/clinical_terminology.json` (nuevo, independiente de PROD/DEV):** 63 conceptos con término preferente, sinónimos, abreviaturas (se excluyen ambiguas: IC, FA, TAG, SCA, TE), términos coloquiales (confianza media), relación *broader* y términos `related_not_equivalent` con nota clínica. Códigos CIE-10 OMS **orientativos** (VIH sin código: depende del estadio). `kb_symptoms` y `ade_treatment_map` se resuelven **a través** de esta terminología: ya no son diccionarios paralelos.
- **Modelo de problema unificado** (`buildProblemRecord`): `id` estable (id de catálogo si existe, para no romper reglas), `concept_id`, denominación normalizada, textos originales, sinónimos reconocidos, código, `status`, `temporality`, `documented_onset` (sólo si consta como inicio), `first_active_date` con `semantics` (`documented_onset` / `documented_presence` / `treatment_start`), `related_medications`, `evidence_types` (`explicit_mention`, `documented_indication`, `contextual_inference`, `pharmacological_inference`, `manual_entry`), `certainty_level`, `events` completos, `validation_status`, `attributes` (p. ej. control virológico).
- **Regla fundamental aplicada:** un fármaco sin indicación nunca genera un diagnóstico; se registra como `undocumented_indication` en *información ausente*. La única inferencia farmacológica permitida es la declarada en la KB (VIH) y, sin contexto de apoyo, queda como **sospecha**.
- **Motor de cascadas:** el problema intermedio se busca en la lista de problemas (extraída o revisada), nunca en el texto bruto. Cada regla obtiene sus conceptos intermedios de su vínculo de catálogo, de `ade_treatment_map` y de su propio texto `ade_es/ade_en` resuelto por la terminología (sin coincidencia aproximada).
- **Evidencia por principio activo** (`index_drug_evidence`): un mecanismo `indirect` nunca produce `supported_possible_cascade` (motivo `index_drug_indirect_mechanism`). Aplicado a dolutegravir/bictegravir en VIH001 (PROD y DEV), derivado del propio campo `ade_mechanism` de la regla y marcado como pendiente de revisión farmacéutica.
- **Propiedades farmacológicas** en `drug_dictionary.json` (`pharmacological_properties: ["sedative"]`, 30 principios activos), independientes de la clase terapéutica: la trazodona sigue siendo «Antidepressant / SARI» y a la vez se reconoce como sedante. CM007 se calcula ahora con ≥2 agentes activos distintos, con cronología y con la indicación compartida, y se declara explícitamente como asociación temporal.
- **Categorías de hallazgo separadas** (`finding_category`): `potential_prescribing_cascade`, `insufficient_evidence`, `discarded` (cascadas); `pharmacotherapy_safety`, `therapeutic_duplication` (alertas); `undocumented_indication` (información ausente). No se combinan en una puntuación.
- **UI (paso 2):** desaparecen las etiquetas de síntomas desconectadas; todo problema entra en el mismo formulario, que muestra por qué aparece, toda la evidencia, fármacos relacionados con su fecha, «documentado al menos desde … (inicio del tratamiento, no del diagnóstico)», notas de normalización, código y consecuencias de incluir/excluir.
- **Informes:** `ReportContract` añade `clinical_problems` (lista efectiva) a pantalla (paso 6), texto clínico, CSV (`clinical_problems_json`) y JSON, indicando si procede de la revisión confirmada o de la extracción.

## 4. Resultados del caso obligatorio (motor real, KB PROD; idénticos en DEV)

| Problema | Evidencia | Certeza | Fechas | Medicamentos |
|---|---|---|---|---|
| Infección por VIH | inferencia contextual (TAR + «control virológico») | media | sin inicio inventado; atributo «control virológico desde 2021» | bictegravir/FTC/TAF |
| HTA (CPB001, I10) | indicación documentada ×3 | alta | documentada al menos desde 08/2023 (inicio de amlodipino) | olmesartán, HCT (02/2024), amlodipino (08/2023) |
| Temblor esencial (G25.0) | indicación documentada | alta | desde 07/2022 (inicio tto.) | propranolol |
| DM2 (CPB003, E11) | indicación documentada | alta | desde 02/2023 (inicio tto.) | metformina |
| Dislipemia (E78.5) | indicación documentada | alta | desde 02/2024 (inicio tto.) | rosuvastatina, ezetimiba |
| Insomnio (G47.0) | indicación documentada + mención explícita (consulta 10/2026) | alta | desde 09/2022 (inicio tto.) | lormetazepam (09/2022), trazodona (10/2026) |
| HBP (N40) | indicación documentada | alta | desde 11/2017 (inicio tto.) | silodosina |

Ningún problema recibe como «inicio documentado» una fecha de inicio de tratamiento. Un único registro para HTA y otro para insomnio.

**Cascadas:**
- **A. Lormetazepam → insomnio → trazodona:** ninguna señal de cascada (no existe regla BZD→insomnio→trazodona y no se infiere por coocurrencia). Alerta CM007 diferenciada (`pharmacotherapy_safety`, `temporal_association_only: true`): lormetazepam (09/2022) → trazodona (10/2026), indicación compartida «insomnio».
- **B. Bictegravir → dislipemia → rosuvastatina (VIH001):** problema verificado como activo, `possible_but_incomplete` / `insufficient_evidence` (inicio del TAR no documentado). Con fecha explícita de bictegravir previa, la clasificación queda limitada por `index_drug_indirect_mechanism`; con darunavir/cobicistat y la misma cronología, `supported_possible_cascade` (efecto lipídico directo según la KB).
- VIH003 bictegravir → metformina: de `supported` a `possible_but_incomplete` (la «fecha» era la del control virológico).
- Ninguna cascada «respaldada» en el caso.

**Variantes:** «problemas para dormir» (coloquial, certeza media), «dificultad para conciliar el sueño», «insomino» (aproximada, certeza baja), mayúsculas → un único insomnio, sin duplicados. «Trastorno del sueño» → «trastorno del sueño (no especificado)», **no** insomnio. «Temblor de acción» → temblor no especificado con nota de no equivalencia. HTA/DM2/HBP/dislipidemia por abreviatura, sin tildes y varias en una misma indicación («por HTA y diabetes tipo II»).

## 5. Pruebas ejecutadas (resultado real)

`npm test` → **24 suites, todas en verde** (incluida la nueva `tests/unified-problem-extraction.test.js`, 93 aserciones: caso obligatorio y variantes, abreviaturas, errores ortográficos, varios problemas por línea, fármacos sin indicación, negación, antecedente resuelto, sospecha, indicación con «posible», contradicción, fechas sólo con año, dosis decimales, indicación fuera de clase, prevención de falsas cascadas, IP vs INSTI, exclusión/alta manual/renombrado en la revisión con propagación al motor y al puente de síntomas, coherencia paso 2 ↔ motor, informes texto/CSV, KB DEV). `node kb/dev/validate_extended_kb.js` → PASS.
Prueba de mutación: desactivar el rechazo de fechas ajenas o el enmascaramiento de indicaciones hace fallar la suite nueva.
Comprobación en navegador (Chromium/Playwright, app real): 7 filas de revisión, 0 etiquetas huérfanas, la exclusión confirmada de «dislipemia» desaparece del informe del paso 6, sin errores de JavaScript.

**Cambios de comportamiento en las 406 notas existentes de pruebas/ejemplos** (comparación antes/después del motor): 13 notas cambian; todas son consecuencia de que el problema intermedio ahora es verificable o de la corrección de CM007: p. ej. «Toma lopinavir/ritonavir. Presenta dislipemia. Se inicia atorvastatina» pasa de *sólo coincidencia* a *respaldada*; «Chronic constipation on long-term lactulose. Started oxybutynin» pasa a *descartada* (problema crónico previo); en el ejemplo, VIH001 (darunavir/cobicistat 2019 → dislipemia 2020 → atorvastatina 2021) pasa a *respaldada* y CM007 deja de dispararse con un único sedante.

## 6. Limitaciones que permanecen

- Terminología curada y determinista: un sinónimo no incluido sigue como problema **no normalizado** (se conserva literal, `FREE_*`, visible para revisión), no se pierde, pero no se codifica.
- Coincidencia aproximada sólo para palabras únicas de ≥8 letras (distancia 1): errores en términos cortos o multipalabra no se corrigen.
- La extracción de indicaciones es por patrones (conector en la cláusula del fármaco; «consulta/diagnóstico … se inicia/recibe»). Redacciones tabulares sin conector (p. ej. «Atorvastatin – Dyslipidemia – since 2021») no generan indicación; el problema sólo aparece si está nombrado en otra parte.
- Códigos CIE-10 OMS orientativos; no sustituyen la codificación en CIE-10-ES.
- La sobrescritura INSTI de VIH001 es una corrección prudente derivada de la propia regla; requiere revisión farmacéutica con la bibliografía específica.
- El fallback temporal por indicios textuales («se inicia», «tras iniciar») sigue siendo heurístico; las cascadas respaldadas por indicio, sin fechas, deben validarse.
- No se ha podido comparar con la versión desplegada en GitHub Pages (sin acceso de red).

## 7. Riesgos de regresión

- Más problemas visibles ⇒ más reglas con problema intermedio verificable ⇒ algunas señales suben de *coincidencia* a *posible/respaldada* (ver §5). Es el efecto buscado, pero conviene revisarlo con casos reales.
- El `source_signature` de revisiones guardadas cambia si la extracción incorpora problemas nuevos: revisiones antiguas vuelven a borrador (comportamiento seguro ya previsto).
- Nuevos términos de la terminología pueden solapar con otros; la coincidencia más larga gana, por lo que los conceptos de desambiguación deben mantenerse.

## 8. Recomendaciones de mantenimiento

1. Añadir sinónimos **sólo** en `kb/clinical_terminology.json`; nunca en reglas ni en código.
2. Para términos relacionados pero no equivalentes, usar `related_not_equivalent` con nota clínica, no sinónimos.
3. Revisar periódicamente el listado de conceptos resueltos desde el texto ADE de cada regla (script en la sección 2 de esta auditoría: `resolveClinicalConcepts(ade_es)`), buscando resoluciones espurias como las del punto 12.
4. Extender `index_drug_evidence` a otras reglas que agrupen principios activos con evidencia heterogénea (p. ej. VIH003, VIH018), tras revisión bibliográfica.
5. Validar con un conjunto de notas reales seudonimizadas la sensibilidad/especificidad de la extracción por tipo de evidencia.
