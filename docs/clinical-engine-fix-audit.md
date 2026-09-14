# Auditoría de causa raíz — motor clínico (2026-09-14, segunda ronda)

Caso índice de esta auditoría:

> Mujer de 56 años con infección por VIH, en tratamiento con Dovato desde 2019. Toma anastrozol 1 mg cada 24 horas y amitriptilina 25 mg por la noche. En mayo de 2026 inicia naproxeno 550 mg cada 12 horas por dolor articular. No tenía antecedentes de hipertensión. En agosto de 2026 presenta cifras repetidas de presión arterial de 165/95 y 160/92 mmHg, por lo que se diagnostica hipertensión arterial y se inicia enalapril 5 mg cada 24 horas.

Reproducido literalmente contra `clinical-engine.js` (rama `main` en el momento de iniciar esta auditoría, commit `affc21d`) mediante `node -e` con `ClinicalEngine.buildCaseModel()`. Salida completa archivada en el historial de la sesión; resumen relevante:

```
ACTIVE PROBLEMS: [{ id: "CPB001", concept: "hipertensión arterial", status: "negated",
                     evidence: "No tenía antecedentes de hipertensión" }]

CASCADES:
 - CC001 naproxen -> Elevación de la presión arterial -> enalapril
       class=discarded reason="El problema clínico intermedio aparece explícitamente negado..."
 - VIH003 dolutegravir -> Ganancia de peso.../diabetes -> enalapril
       class=pharmacological_match_only

GLOBAL ALERTS:
 - CM006 (carga anticolinérgica) drugs=[dolutegravir, lamivudine, anastrozole,
       amitriptyline, naproxen, enalapril]
```

Todos los defectos descritos en el encargo se reprodujeron exactamente como se reportaron.

---

## 1. Causa raíz por defecto

### 1.1 Negación con alcance temporal incorrecto (defectos 1 y 2 del encargo)

**Archivo/función:** `clinical-engine.js:405 classifyMention()`.

`classifyMention()` es una cadena de `if` con *early return*: primero comprueba una lista `negBefore` (`no`, `sin`, `niega`...) y, si hay match, devuelve `status:'negated'` **inmediatamente**, sin comprobar nunca la lista `histBefore` (`antecedentes de`, `previo`...). Como "No tenía antecedentes de hipertensión" contiene tanto `no` (línea 418, `/\bno\b/`) como `antecedentes de` (línea 439), pero `negBefore` se evalúa primero y corta la ejecución, la frase se clasifica como **negación actual**, exactamente igual que "No presenta hipertensión" — el motor no distingue entre ambas.

Consecuencia directa: `detectGenericActiveProblems()` (línea 593) sólo llama a `findTermInNote()` (que devuelve **la primera** coincidencia del término en toda la nota — no todas) para localizar "hipertensión", encuentra la mención dentro de "No tenía antecedentes de hipertensión" (aparece antes en el texto que la mención posterior "hipertensión arterial" del diagnóstico de agosto) y nunca vuelve a buscar. El segundo evento — la afirmación posterior explícita — **no se extrae en absoluto**. No existe ningún mecanismo de eventos múltiples ni de reconciliación temporal (Fase 2 del encargo, ausente por completo en el diseño anterior).

`verifyIntermediateProblem()` (línea 1044) y `classifyCascadeSignal()` (línea 1102) heredan el error: `problemCheck.status === 'negated' → classification:'discarded'`. De ahí el mensaje exacto reportado: *"El problema clínico intermedio aparece explícitamente negado en la nota"*.

Causa raíz: **(a)** `classifyMention()` conflaciona dos fenómenos lingüísticos distintos — negación actual ("no presenta X") y ausencia histórica ("no tenía antecedentes de X") — bajo el mismo resultado; **(b)** el extractor de problemas activos sólo captura una mención por concepto en toda la nota, sin modelo de eventos ni reconciliación temporal.

### 1.2 VIH003 se activa sin TDF ni problema intermedio (defectos 3, 4 y 5)

**Archivo:** `kb/prod/kb_vih_modifiers.json` (y `kb/dev/`), regla `VIH003`.
**Función:** `evaluateDrugDrugCascades()` (línea 1145).

```json
"name_es": "INSTI (DTG/BIC/RAL) + TDF → Ganancia de peso → Antidiabético/Antihipertensivo",
"index_drug_class": "INSTI",
"index_drugs_examples": ["dolutegravir", "bictegravir", "raltegravir"],
"cascade_drugs_examples": ["metformin", "sitagliptin", "liraglutide", "enalapril", "atorvastatin"]
```

El **nombre** exige "INSTI + TDF", pero la **lógica** (`index_drugs_examples`) sólo comprueba el INSTI — TDF no aparece en ningún campo evaluado por el motor. El mecanismo (`ade_mechanism_es`) dice explícitamente "no completamente establecido"; no hay una fuente en la KB que documente TDF como cofactor obligatorio (y la evidencia publicada real —ADVANCE, NAMSAL— apunta más bien a lo contrario: la ganancia de peso por INSTI es *más* marcada en pautas **sin** TDF/TAF). Por tanto la causa raíz es un **error editorial de nombre**, no una condición clínica no implementada: se corrige el nombre, no se inventa un requisito de TDF sin respaldo.

`enalapril` está en `cascade_drugs_examples` junto a fármacos realmente cardiometabólicos (metformina, sitagliptina, liraglutida, atorvastatina) porque un antihipertensivo *puede* tratar la hipertensión asociada a síndrome metabólico — pero el motor nunca comprueba si **este** enalapril tiene ya una indicación explícita incompatible en el texto (hipertensión, por AINE, no por síndrome metabólico). No existe ningún mecanismo de vinculación medicamento↔indicación (Fase 3, ausente). `evaluateDrugDrugCascades()` sólo mira si el fármaco aparece en la lista, nunca si su rol ya está explicado por otra causa mejor sustentada en la misma nota.

Además, `ddi_warning_es` de VIH003 ("Dolutegravir aumenta los niveles de metformina...") se copia sin condición al objeto de señal (línea 1216: `ddi_warning_es: cascade.ddi_warning_es || ''`) **independientemente de qué fármaco de `cascade_drugs_examples` fue realmente el que hizo match** — aquí fue enalapril, no metformina, y metformina no está en la nota en absoluto. Causa raíz: ausencia de comprobación `allRequiredEntitiesPresent` antes de mostrar cualquier alerta de interacción.

### 1.3 Carga anticolinérgica: todo el array de medicación como contribuyente (defecto 6)

**Archivo:** `clinical-engine.js:924 buildGlobalMedicationAlerts()`.

```js
var mentionCanonicals = (mentions || []).map(function (m) { return m.canonical; });
...
drugs_involved: mentionCanonicals,   // TODOS los fármacos detectados, sin filtrar
```

`detectClinicalContextModifiers()` (línea 862) activa CM006 si **cualquiera** de sus palabras clave (que incluyen nombres de fármacos anticolinérgicos como "amitriptilina", "hidroxizina") aparece en cualquier parte de la nota — correcto como disparador. Pero al construir la alerta, `drugs_involved` se rellena con **todas** las menciones de medicación del caso (línea 927), no con los fármacos que realmente dispararon CM006. No existe tabla de puntuación: es un modificador binario "aparece/no aparece", nunca un cálculo. Causa raíz: el diseño de `kb_clinical_modifiers.json`/CM006 es un disparador por palabra clave, no una escala; y el código reutiliza por error la lista global de medicación como si fuera la lista de contribuyentes.

### 1.4 Etiquetas sin dimensión (defecto 7)

**Archivo:** `clinical-engine.js` (`classificationRank`, `confidence` del KB) + `app.js` (`confidenceBadgeHtml`, `classificationBadgeHtml`, `state.cascadeClassifications`).

Actualmente coexisten tres conceptos independientes mostrados como insignias sueltas sin etiqueta de contexto:

| Insignia mostrada | Procedencia real | Significado real |
|---|---|---|
| "ALTO" | `cascade.confidence`/`plausibility` (campo KB) | Confianza/plausibilidad **de la asociación bibliográfica**, no del caso del paciente |
| "Confirmada" | `state.cascadeClassifications[id]` | Veredicto **manual del clínico** en el Paso 5 (independiente del sistema) |
| "Coincidencia farmacológica de baja certeza" / "Descartada por el sistema" | `signal.classification` | Evaluación **automática** de esta nota concreta |

Al mostrarse las tres seguidas sin indicar a qué pertenecen, el resultado "ALTO · Confirmada · Descartada por el sistema" parece contradictorio aunque cada dato sea correcto en su propia dimensión. Causa raíz: el modelo de datos nunca separó explícitamente `potentialClinicalRelevance` / `knowledgeValidationStatus` / `automatedCaseAssessment` / `professionalValidation` como cuatro campos con sus propias etiquetas.

### 1.5 Priorización sin criterios (defecto 8)

**Archivo:** `app.js` (bloque `buildReport()`, `topInterventions`).

`topInterventions` recorre `cascades` ya ordenadas por `classificationRank` y toma los primeros textos de recomendación únicos, **sin excluir explícitamente** `discarded` ni `pharmacological_match_only`. En este caso concreto, como CC001 estaba incorrectamente `discarded` (rank 1) y VIH003 en `pharmacological_match_only` (rank 3), VIH003 quedaba primero y su recomendación ("Evaluar si el cambio del INSTI...") se colaba como intervención principal. Corregir 1.1 ya resuelve la mayoría de este síntoma para el caso índice, pero el filtro explícito sigue siendo necesario como regla general (no depender sólo del orden).

---

## 2. Diseño de la solución

1. **`classifyMention()` → `{assertion, temporality, status}`** en vez de un único `status`. `assertion ∈ {affirmed, negated, suspected}`, `temporality ∈ {historical, current}`. Se detectan **ambas** señales en la misma ventana de contexto (ya no hay *early return* que oculte la segunda). `status` derivado: `negated+historical → absent` (ausencia histórica, ≠ negación actual), `affirmed+historical → active` (crónico/antecedente afirmado), `negated+current → absent`, `resuelto → resolved`, `suspected → suspected`, por defecto `affirmed+current → active`.
2. **Modelo de eventos**: `detectGenericActiveProblems()` pasa de "primera coincidencia" a **todas las coincidencias** (`findAllTermOccurrences`), cada una como evento con fecha/marcador relativo cuando existe, y se reconcilian por orden temporal explícito (fecha comparable o marcador relativo "posteriormente"/"previamente"/"tras"); si ninguno de los eventos contradictorios es ordenable, el resultado se marca como no resuelto (`status:'unknown'`, `contradiction:true`) en vez de elegir arbitrariamente.
3. **Fechas en medicación**: extracción de fecha/año-mes explícito junto a cada mención de fármaco (`desde 2019`, `en mayo de 2026`); usada para comparar el orden fármaco-índice / problema / fármaco-cascada en las reglas `drug_drug` (Fase 4, condiciones de CC001).
4. **Vinculación medicamento↔indicación**: extracción genérica por patrones de conector ("por/para/debido a") y por el patrón "se diagnostica X ... se inicia/pauta Y", nunca hardcodeada a un fármaco concreto. Si el fármaco-cascada de una regla tiene una indicación explícita que no coincide con el problema propuesto por esa regla, y la regla no tiene evidencia propia independiente, la candidata se descarta (`medication_indication_mismatch`).
5. **VIH003**: se corrige el nombre (se retira "+ TDF", sin base en la KB para exigirlo) y se documenta el cambio en `kb/CHANGELOG.md`.
6. **DDI centralizada**: nuevo campo `ddi_required_drugs` en cada regla con `ddi_warning` (extraído mecánicamente del propio texto del aviso mediante el resolutor de fármacos, no inventado) + función única `allRequiredEntitiesPresent()` que condiciona la visualización del aviso en todo el sistema.
7. **Carga anticolinérgica real**: tabla `ANTICHOLINERGIC_BURDEN_SCALE` (escala ACB — Anticholinergic Cognitive Burden, Boustani et al. 2008) limitada a fármacos de puntuación bien establecida; `drugs_involved` pasa a ser sólo los fármacos realmente puntuados, con puntuación individual/total/escala/interpretación; formulación prudente cuando no se alcanza el umbral o sólo hay un contribuyente.
8. **Cuatro dimensiones de etiqueta**: nuevos campos `potential_clinical_relevance`, `knowledge_validation_status` (derivado de si la regla tiene `references`), `automated_case_assessment` (=`classification` existente, sólo renombrado en la interfaz), `professional_validation` (=`state.cascadeClassifications`, renombrado en la interfaz). Cada insignia se renderiza con su etiqueta de dimensión.
9. **Priorización explícita**: función `selectTopInterventions()` con exclusión explícita de `discarded`/`pharmacological_match_only`/alertas DDI sin todos los participantes/alertas no calculadas.

## 3. Archivos y funciones afectados

- `clinical-engine.js`: `classifyMention`, `detectGenericActiveProblems`, `detectActiveProblems`, `verifyIntermediateProblem`, `classifyCascadeSignal`, `evaluateDrugDrugCascades`, `buildGlobalMedicationAlerts`, `checkMeasurementDiscordance` (ajuste de firma), `buildCaseModel` (nuevos campos de salida); nuevas: `findAllTermOccurrences`, `extractDateNear`, `reconcileProblemEvents`, `extractExplicitIndicationForMedication`, `allRequiredEntitiesPresent`, `scoreAnticholinergicBurden`, `selectTopInterventions`.
- `kb/prod/kb_vih_modifiers.json` + `kb/dev/`: nombre de VIH003; `ddi_required_drugs` en las 19 reglas con `ddi_warning`.
- `kb/prod/kb_core_cascades.json` + `kb/dev/`: `ddi_required_drugs` donde aplique.
- `kb/prod/kb_clinical_modifiers.json` + `kb/dev/`: posible ajuste de CM006/CM007 o sustitución por la nueva tabla ACB dedicada.
- `kb/anticholinergic_burden_scale.json` (nuevo, prod+dev): tabla de puntuación.
- `app.js`: renderizado de las cuatro dimensiones de etiqueta, sección de carga anticolinérgica, gating de DDI.
- `tests/`: nuevo `temporal-events.test.js`; actualización de `index-case.test.js` con el caso índice de este encargo.
- `docs/clinical-engine-fix-audit.md`: este documento.

## 4. Riesgos de regresión

- Cambiar `classifyMention()` afecta a **todo** lo que dependía de `status:'history'` como "descartar" (incluido el caso de HTA previa genuina de la auditoría anterior) — mitigado manteniendo `affirmed+historical → status:'active'` con `temporality:'historical'` expuesta aparte, de forma que la comparación de orden temporal (no el status) es la que decide si descarta.
- La extracción de fechas es deliberadamente conservadora (año, o mes+año explícitos); notas sin fechas siguen cayendo en los mecanismos heurísticos previos (`detectTimeCues`), sin regresión para el comportamiento ya probado.
- La tabla ACB se limita a entradas de alta confianza para no inventar puntuaciones; esto reduce la sensibilidad frente al diseño anterior (que marcaba "elevada" con cualquier palabra clave) — es un cambio de comportamiento deliberado y requerido por el encargo, no un error.
- Renombrar VIH003 no cambia su `id`, por lo que no rompe `state.cascadeClassifications` guardadas ni `kb_cascade_registry.md` (se regenera).

## 5. Plan de pruebas

`node tests/run.js` (suite existente, no debe romperse) + nuevo `tests/temporal-events.test.js` cubriendo Pruebas A–L del encargo + actualización de `tests/index-case.test.js` con el caso índice literal de este encargo. Verificación manual final en navegador (Playwright contra servidor estático) reproduciendo el caso índice paso a paso.

---

## 6. Resultados de la implementación (cierre)

Todo lo descrito en la sección 2 se implementó tal como estaba previsto, con dos hallazgos adicionales detectados **durante** la implementación (no anticipados en el diagnóstico inicial de la sección 1), documentados aquí por trazabilidad:

### 6.1 Hallazgo adicional — recomendación de CC001 con sesgo "en PVVIH" no justificado

`kb/{prod,dev}/kb_core_cascades.json`, regla CC001 (`AINE → Hipertensión → Antihipertensivo`), campo `recommended_first_action_es/en`, contenía: *"Valorar si los AINE son realmente necesarios. **En PVVIH, preferir paracetamol cuando sea posible.**"*

CC001 es una regla **general**, sin ningún `index_drug_class`/`ade_mechanism` específico de VIH — el mecanismo (inhibición de prostaglandinas → retención de sodio/vasoconstricción → elevación de PA) es idéntico en cualquier paciente. No existe ninguna base farmacológica en la propia regla para singularizar "en PVVIH" frente a paracetamol. Esto es exactamente el patrón que el encargo prohíbe explícitamente ("no recomendar universalmente paracetamol en PVVIH"), y se detectó en vivo al reproducir el caso índice en navegador (el texto aparecía tal cual en el Paso 4 y en "Principales intervenciones sugeridas").

**Corrección aplicada:** se sustituyó por una recomendación general, no hardcodeada al caso índice, alineada con la interpretación clínica correcta que pide el encargo (revisar necesidad/duración del AINE, relación temporal, otras causas de HTA, retirada/sustitución con reevaluación de cifras tensionales) — sin mención a VIH, aplicable a cualquier paciente con esta cascada. Se corrigió en `kb/prod/` y `kb/dev/`; `kb/dev/` además carecía por completo del campo `_es` (sólo tenía `_en`), que se añadió.

Se hizo una revisión dirigida (`grep`) de todas las menciones "PVVIH"/"PLHIV" en `kb_core_cascades.json` (que debe ser agnóstico de VIH, a diferencia de `kb_vih_modifiers.json`): el resto de menciones sí están justificadas mecanísticamente (interacciones ARV específicas, diagnóstico diferencial de hallazgos más prevalentes en PVVIH, ajuste de dosis con potenciadores) y no se modificaron. No se ha hecho una revisión exhaustiva del resto del catálogo (90 reglas) buscando otros sesgos de recomendación no ligados a mecanismo; se deja como limitación pendiente (ver sección 7 del informe final de entrega).

### 6.2 Hallazgo adicional — regresión: el Paso 3 ("Clasificación") de la app quebraba tras el rediseño del modelo temporal

El rediseño de `detectGenericActiveProblems()` (sección 2, punto 2) cambió la forma del objeto que devuelve cada problema activo (pasó a `{status, assertion, temporality, events, ...}`). `app.js`, en el Paso 3 (`renderProblemCard`), seguía leyendo la forma **anterior** a esa reescritura (`p.problem`, `p.certainty`, `p.category_label`, `p.evidence.length`, `p.negatedFindings.length`), heredada de antes de esta sesión de auditoría. El resultado era una excepción no controlada (`Cannot read properties of undefined (reading 'length')`) al llegar al Paso 3 con cualquier nota que contuviera un problema activo del diccionario `clinical_problems.json` — es decir, con el propio caso índice. Este defecto **no lo detectaba la suite de Node** porque ésta ejercita `buildCaseModel()` directamente, nunca la ruta de renderizado de `app.js`; se descubrió al validar visualmente en navegador con Playwright, que es precisamente el motivo por el que el encargo pide esa verificación manual además de los tests automáticos.

**Corrección aplicada:** en vez de crear una segunda vía de detección o traducir la forma en `app.js` (duplicando lógica), se añadieron a `detectGenericActiveProblems()` los campos que el Paso 3 necesita (`problem`, `category_label`, `certainty`, `evidence[]`, `negatedFindings[]`), calculados a partir de los mismos eventos reconciliados — de forma que `CaseModel.activeProblems` (usado por el razonamiento de cascadas y por los tests) y la pantalla del Paso 3 quedan respaldados por exactamente los mismos datos, sin bifurcar la lógica.

### 6.3 Hallazgo adicional — "Principales intervenciones sugeridas" sin filtrar por clasificación

Ya señalado en la sección 1.5 como causa raíz, pero confirmado en vivo durante la implementación: `buildReport()` construía `topInterventions` recorriendo **todas** las cascadas (ordenadas por rango, pero sin excluir `discarded`/`pharmacological_match_only`/`not_evaluable`), de modo que si había menos de 3 señales realmente accionables, la recomendación de una señal **descartada por el propio sistema** (en el caso índice, VIH003: "Evaluar si el cambio del INSTI...") aparecía igualmente como intervención principal. Verificado en navegador antes y después de la corrección.

**Corrección aplicada:** la lógica de selección se extrajo a `clinical-engine.js` como `selectTopInterventions(signals, lang, limit)` (Fase 8), sin dependencias del DOM y por tanto verificable con Node — con criterio explícito y documentado (`ACTIONABLE_CLASSIFICATIONS = ['supported_possible_cascade', 'possible_but_incomplete']`), en vez de vivir como lógica de interfaz en `app.js`. Cubierto por una aserción dedicada en `tests/index-case.test.js`.

### 6.4 Verificación final

- `node tests/run.js`: 6 suites, 0 fallos (índice: 39, negativos: 18, temporales B–L: 25, regresión: 14, legacy-nlp: 44, auditoría-KB: 1528).
- Verificación manual en navegador (Chromium vía Playwright, servidor estático local) reproduciendo el caso índice paso a paso (Pasos 1→6): CC001 se genera como única señal, nunca "confirmada"; VIH003 se descarta explícitamente por `medication_indication_mismatch`; no aparece ninguna alerta de interacción con metformina; la alerta de carga anticolinérgica sólo señala amitriptilina, con redacción prudente sin lenguaje acumulativo; las cuatro dimensiones de etiqueta se muestran, cada una con su rótulo, en el Paso 4 y en el Paso 6 (Informe); "Principales intervenciones sugeridas" contiene únicamente la recomendación de CC001.
