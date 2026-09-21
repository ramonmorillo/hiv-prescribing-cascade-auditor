# 04 — Matriz de pruebas y casos de regresión priorizados

## 1. Estado de la suite automatizada

`node tests/run.js` (Node v22.22.2, sin dependencias npm), ejecutado dos veces durante esta auditoría (inicio y cierre), mismo resultado ambas veces:

| Suite | Resultado |
|---|---|
| index-case.test.js | 39 passed, 0 failed |
| negative-cases.test.js | 18 passed, 0 failed |
| temporal-events.test.js | 40 passed, 0 failed |
| regression.test.js | 14 passed, 0 failed |
| demo-case-regression.test.js | 12 passed, 0 failed |
| legacy-nlp.test.js | 44 passed, 0 failed |
| fixed-dose-classification.test.js | 14 passed, 0 failed |
| kb-audit.test.js | 1526 passed, 0 failed |
| kb-validation-presentation.test.js | 10 passed, 0 failed |
| medication-status-interactions.test.js | 33 passed, 0 failed |
| multi-candidate-cascades.test.js | 16 passed, 0 failed |
| final-adjustments.test.js | 36 passed, 0 failed |
| static-i18n.test.js | 104 passed, 0 failed |
| browser-security.test.js | 18 passed, 0 failed |
| medication-review.test.js | 19 passed, 0 failed |
| problem-review.test.js | 22 passed, 0 failed |
| reviewed-input-adapter.test.js | 21 passed, 0 failed |
| reviewed-input-integration.test.js | 11 passed, 0 failed |
| reviewed-input-wiring.test.js | 8 passed, 0 failed |
| reviewed-input-e2e.test.js | 19 passed, 0 failed |
| reviewed-input-edge-cases.test.js | 13 passed, 0 failed |
| report-contract.test.js | 20 passed, 0 failed |
| report-wiring.test.js | 8 passed, 0 failed |
| **Total** | **2045 aserciones, 0 fallos, sin advertencias, sin errores de carga** |

No se han detectado archivos de producción/desarrollo cruzados incorrectamente: `tests/helpers.js:loadKB(track)` carga explícitamente `kb/prod/*` o `kb/dev/*` según parámetro, y `kb/drug_dictionary.json`/`kb/drug_combinations.json` son deliberadamente compartidos (no hay copia dev separada de estos dos ficheros).

## 2. Casos de regresión priorizados (Fase 4 del encargo) — resultado observado vs esperado

Cada caso se ejecutó con `ClinicalEngine.buildCaseModel()` vía Node (reproducible con `node -e "..."` cargando `tests/helpers.js`), salvo que ya exista un test dedicado citado como evidencia — en ese caso se cita el test en vez de duplicar la reproducción.

| # | Caso | Entrada (resumen) | Resultado observado | Resultado esperado | Conclusión |
|---|---|---|---|---|---|
| 1 | Caso demo completo | Nota literal de `loadDemoCase()` (app.js) | 10 medicamentos activos, 0 sin clasificar, 3 problemas activos, 8 señales de cascada (incl. duplicados legítimos de intensificación CC001×2), 1 alerta global (CM007), sin excepciones | Ejecución sin errores, medicación totalmente clasificada | ✅ Conforme. Test dedicado: `demo-case-regression.test.js`, `fixed-dose-classification.test.js` |
| 2 | Amlodipino→edema→furosemida | Nota demo | 1 sola tarjeta clínica, `cascade_id=CC004`/`rule_id=CC004`; CC041 nunca aparece como señal independiente; SYM008 no se renderiza aparte, sólo como `symptom_bridge_provenance` dentro de la tarjeta CC004; cronología `explicit_dates_compatible` con fechas 2021-07/2023-02 | Exactamente lo observado | ✅ Conforme. Test dedicado: `demo-case-regression.test.js:23-44` (4 aserciones específicas) |
| 3 | Meses abreviados ES (ene…dic) | `MONTHS_ES` en `clinical-engine.js:736-742` | Los 13 tokens del encargo (`ene, feb, mar, abr, may, jun, jul, ago, sep, sept, oct, nov, dic`) están presentes en el diccionario; verificado además con nota sintética ("desde ene 2020"/"En sept 2021"/"En dic 2021") → cascada CC004 detectada correctamente con las 3 fechas abreviadas | Reconocimiento de las 13 abreviaturas | ✅ Conforme. Test dedicado: `temporal-events.test.js:34` |
| 4-6 | Symtuza (3 variantes) + clasificación | (a) `"Symtuza"`; (b) `"darunavir/cobicistat/emtricitabina/tenofovir alafenamida"`; (c) `"darunavir/cobicistat/emtricitabina/tenofovir alafenamida (Symtuza)"` | Las 3 variantes expanden a exactamente 4 principios activos (darunavir, cobicistat, emtricitabina, tenofovir alafenamide), sin duplicados ni entidad compuesta añadida; clases: darunavir=Antiretroviral/PI, cobicistat=Pharmacokinetic Booster, emtricitabine=Antiretroviral/NRTI, TAF=Antiretroviral/NRTI | Exactamente lo observado | ✅ Conforme para (a) y (c) con test dedicado (`fixed-dose-classification.test.js:17-38`). **(b) verificada manualmente en esta auditoría (no tiene aserción propia en la suite — ver hallazgo de cobertura de test, doc 02)** |
| 7 | FDC adicionales: Biktarvy, Dovato, Triumeq, Juluca, Truvada, Descovy, Kivexa/Epzicom, Rezolsta, Evotaz, Kaletra | Cada marca en solitario | Las 10 marcas expanden a sus principios activos correctos, todos clasificados (ninguno sin `drug_class`) | Expansión correcta y clasificación completa | ✅ Conforme. Rezolsta/Evotaz/Kaletra: `fixed-dose-classification.test.js:47-49`. Resto verificado manualmente en esta auditoría — coincide |
| 8 | Medicamentos negados/suspendidos/históricos/PRN/duplicados | Múltiples notas sintéticas + `negative-cases.test.js`, `medication-status-interactions.test.js` | Negación actual, histórico afirmado, condicional/futuro, PRN y duplicados se distinguen correctamente en los casos cubiertos por la suite existente (37 aserciones dedicadas) | Clasificación correcta de assertion/status/temporality | ⚠️ **Conforme en los patrones cubiertos, con una brecha real encontrada fuera de la suite: ver Hallazgo HAL-01 (doc 02) — "dejó de tomar X" y "ya no lo/la toma" no se reconocen como discontinuación y el fármaco queda activo** |
| 9-10 | Reglas con candidatos múltiples / reglas distintas que comparten fármacos | `multi-candidate-cascades.test.js` (16 aserciones): candesartán tras antihipertensivo suspendido, VIH003 con metformina y atorvastatina como candidatos independientes, reglas no-equivalentes no deduplicadas por error | Comportamiento documentado y verificado por test | Conforme al diseño | ✅ Conforme para los pares ya cubiertos por la suite. **Ver también Hallazgo HAL-02 (doc 02/03): una tríada de reglas casi-duplicadas (CC013/CC070/SYM001) SÍ produce 3 tarjetas para la misma pareja clínica con clasificaciones contradictorias — caso no cubierto por la suite existente, descubierto en esta auditoría** |
| 11 | Interacciones con/sin todas las entidades | `medication-status-interactions.test.js:30-32` (DDI003 exige DTG+metformina exactos; BIC no activa el aviso específico de DTG) | Conforme | `allRequiredEntitiesPresent` exige coincidencia exacta | ✅ Conforme |
| 12 | Casos sin cascada | `negative-cases.test.js` Caso 7 (nota no clínica) | 0 medicamentos, 0 cascadas, 0 problemas | Vacío bien formado | ✅ Conforme |
| 13 | Indicación alternativa válida | `negative-cases.test.js` Caso 2 (enalapril por insuficiencia cardíaca) | `discarded`, `reason_code=alternative_indication_found` | Descartado, no presentado como hallazgo | ✅ Conforme |
| 14 | Cronología incompatible | `regression.test.js`, `temporal-events.test.js` | Cubierto extensamente (40 aserciones temporales) | Descartado con `reason_code` de incompatibilidad temporal | ✅ Conforme |
| 15 | Exportación/importación JSON y persistencia de validaciones | `report-contract.test.js`, `reviewed-input-e2e.test.js`, e inspección directa de `importCase()`/`exportJSON()` (app.js:2656-2684, 3271-3356) | Guardas de tipo campo a campo; `cascadeClassifications` se restaura; `MR.sanitize`/`ProblemReview.sanitize` reconstruyen campo a campo (sin `Object.assign` masivo → sin riesgo de contaminación de prototipo) | Round-trip fiel, sin corrupción de estado con JSON malformado | ✅ Conforme. Nota menor: `clinicalNote` importado no tiene límite de longitud (a diferencia de `patientId`, ≤200) — ver doc 02, hallazgo de severidad baja |
| 16 | Concordancia pantalla / informe / PDF / JSON / CSV | Inspección de `buildReport()` (app.js:3006) y `report-contract.js` | Una única construcción de `report` alimenta las 4 superficies vía `ReportContract`; el PDF es `window.print()` del DOM del Paso 6, no una plantilla independiente | Fuente única, sin bifurcación de cálculo | ✅ Conforme |

## 3. Los cinco casos "golden" recomendados (ver también doc 05, §6)

Ver documento `05-roadmap-pre-web.md` para la lista final justificada.

## 4. Limitaciones de esta fase

- No se ha ejecutado el sistema en un navegador real (Playwright) durante esta auditoría; toda la verificación de `buildCaseModel()` es vía Node, igual que la suite oficial. La auditoría previa del repositorio (`docs/clinical-engine-fix-audit.md` §6.4) documenta que al menos una regresión (ruptura del Paso 3) sólo fue visible en navegador, no en Node — este tipo de defecto **no puede descartarse** sin verificación manual en navegador, que queda fuera del alcance ejecutable de este entorno de auditoría.
- No se han ejercitado exhaustivamente las 90 reglas de `kb_core_cascades.json` ni las 33 reglas VIH una por una con notas sintéticas; se han verificado los casos explícitamente pedidos por el encargo más los descubiertos como de mayor riesgo (near-duplicados). Una cobertura completa regla-por-regla es el contenido natural de la "matriz de validación" propuesta en doc 05.
