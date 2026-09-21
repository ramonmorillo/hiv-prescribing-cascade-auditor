# 01 — Arquitectura y flujo de datos

**Rama auditada:** `claude/compassionate-ptolemy-tra64o` (idéntica en el momento de la auditoría a `main`, commit `40feac2`, merge de PR #69 "Fix authoritative drug classification and FDC expansion"). `git status`: working tree limpio, sin cambios pendientes.

## 1. Naturaleza del sistema

Aplicación 100% cliente (HTML/CSS/JS estático, sin build step, sin bundler, sin framework), pensada para GitHub Pages. No hay backend, no hay llamadas a red en tiempo de ejecución (confirmado por `tests/browser-security.test.js`, que hace `assert(!/https?:\/\//i.test(app))` sobre `app.js`), no hay dependencias npm de terceros (`package.json` no declara `dependencies` ni `devDependencies`; `node tests/run.js` es el único script). Carga de módulos por `<script>` clásicos, en este orden fijo (`index.html:230-237`):

```
kb/dev/kb_validator.js → clinical-engine.js → medication-review.js → problem-review.js
→ reviewed-input-adapter.js → report-contract.js → ui-static-i18n.js → app.js
```

Cada módulo se expone como `window.<Nombre>` y también como `module.exports` (patrón UMD), lo que permite que la suite de tests de Node (`tests/*.test.js`) ejercite exactamente el mismo código que corre en el navegador — no hay una segunda implementación paralela para tests.

## 2. Flujo de datos, extremo a extremo

```
Paso 1 (UI)                    nota clínica en texto libre + ID seudonimizado
        │
        ▼
clinical-engine.js             normalizeClinicalText() → normaliza tipografía/diacríticos
buildCaseModel()                (clinical-engine.js:2459, función única de entrada)
        │
        ├─ buildDrugResolver(kb) + resolveDrugMentions()      → menciones léxicas de fármaco
        ├─ classifyMedicationMention() por mención             → {assertion, status, temporality}
        │      (afirmado/negado/condicional × activo/suspendido/nunca_iniciado/futuro
        │       × actual/histórico) — isActiveMedication() es la ÚNICA puerta de actividad
        │
        ├─ detectActiveProblems() / detectGenericActiveProblems() + reconcileProblemEvents()
        │      → modelo de EVENTOS (no "primera mención"), reconciliados por fecha explícita
        │        o marcador relativo; ambigüedad → status:'unknown', contradiction:true
        │      (ver clinical-engine.js:917-1213; extractDateNear() sólo acepta fecha explícita,
        │       nunca infiere)
        │
        ├─ extractClinicalMeasurements(), extractSymptoms()
        │
        ├─ [Paso 2 opcional] revisión profesional de medicación/problemas
        │      → reviewed-input-adapter.js, ÚNICA frontera permitida entre la revisión
        │        farmacéutica y el motor. Sólo se activa si la revisión está CONFIRMADA,
        │        es estructuralmente válida y su firma de origen coincide con la extracción
        │        actual (docs/REVIEWED_INPUT_CONTRACT.md). Nunca muta CaseModel ni el objeto
        │        de revisión.
        │
        ├─ evaluateDrugDrugCascades()      → candidatas por regla KB (kb_core_cascades.json
        │      (clinical-engine.js:2132)     + kb_vih_modifiers.json), con
        │                                     verifyIntermediateProblem(), detectDrugPairTemporality(),
        │                                     detectAlternativeIndication(), checkMeasurementDiscordance()
        │                                     → classifyCascadeSignal() (2041) asigna UNA de 5
        │                                     clasificaciones (nunca "confirmada")
        │
        ├─ evaluateSymptomBridgeCascades() → candidatas vía kb_symptoms.json cuando no hay
        │      (clinical-engine.js:2328)     coincidencia fármaco-fármaco directa pero sí un
        │                                     síntoma puente documentado
        │
        ├─ detectClinicalContextModifiers() + applyPatientLevelModifiers()
        │      → kb_clinical_modifiers.json (edad, fragilidad, función renal/hepática...)
        │
        ├─ suppressDuplicateSignals()      → consolida señales EQUIVALENTES (misma regla +
        │      (clinical-engine.js:1693)     mismo tipo + mismo par canónico); un symptom_bridge
        │                                     se fusiona en su regla drug_drug SOLO si la declara
        │                                     explícitamente (linked_rule_ids) — nunca dos reglas
        │                                     drug_drug distintas, aunque compartan fármacos
        │                                     (ver Hallazgo sobre casi-duplicados, doc 02/03)
        │
        ├─ prioritizeCascadeCandidates()
        ├─ buildGlobalMedicationAlerts()   → carga anticolinérgica (ANTICHOLINERGIC_BURDEN_SCALE,
        │                                     escala ACB real, Boustani 2008) y otros modificadores
        │                                     "de conjunto de medicación", estructuralmente
        │                                     separados de possibleCascades
        │
        ▼
CaseModel  { medications, activeMedications, allMedicationMentions,
             inactiveOrNegatedMedications, currentInteractions, activeProblems,
             clinicalMeasurements, events, possibleCascades, globalMedicationAlerts,
             missingInformation, drug_classes }
        │
        ▼
app.js (capa de UI, "thin bridge")     — ver §3
        │
        ├─ Paso 3-5 (pantalla)          renderCascadeCardHtml(), renderGlobalAlertsSection()...
        ├─ state.cascadeClassifications  veredicto MANUAL del clínico (Paso 5), independiente
        │                                 de la clasificación automática; nunca se mezcla con ella
        │                                 sin etiqueta propia (4 dimensiones, ver docs/clinical-
        │                                 engine-fix-audit.md §2.8)
        │
        ▼
buildReport() (app.js:3006)     construye UN objeto `report` — única fuente para:
        │
        ├─ pantalla (Paso 6)
        ├─ ReportContract.toClinicalText()  → texto para historia clínica / portapapeles
        ├─ ReportContract.toCsv()           → exportación CSV
        ├─ exportJSON()                      → exportación JSON completa (incluye
        │                                      cascadeClassifications, medicationReview,
        │                                      problemReview)
        └─ window.print() (btn_save_pdf)     → imprime el MISMO DOM del Paso 6, no una
                                                plantilla PDF independiente
```

## 3. `app.js` como capa fina — verificación, no supuesto

El propio código se autodocumenta como puente sin lógica clínica propia (`app.js:1375-1392`): *"All clinical logic ... now lives in clinical-engine.js as pure, DOM-free functions ... Nothing below this comment block re-implements clinical logic"*. Se ha verificado esta afirmación, no asumido:

- Se listaron todas las funciones de nivel superior de `app.js` (`awk` sobre las 4180 líneas). Las únicas funciones con lógica no trivial son: persistencia (`saveState`/`loadState`/`clearState`/`deepFreeze`), renderizado HTML (`render*Html`), orquestación de exportación (`exportJSON`, `downloadJSON`, `importCase`), manejo de eventos delegados (`wireEvents`, `handleDelegatedAction`) e i18n estático (`tUI`, `updateStaticUI`). Ninguna reimplementa extracción, clasificación o priorización clínica.
- Todas las funciones que antes (según `docs/clinical-engine-fix-audit.md`) contenían lógica clínica (`normalizeClinicalText`, `resolveDrugMentions`, `detectClinicalProblems`, `extractSymptoms`, `getDetectedCascades`...) son ahora wrappers de una línea que delegan en `window.ClinicalEngine` (`CE`), cacheando el resultado en `state` cuando procede (`getCaseModel`, `getDrugResolver`).
- **No se ha encontrado ninguna función "antigua" que compita con `clinical-engine.js`.** La preocupación explícita del encargo ("funciones antiguas que compitan con clinical-engine.js") no se confirma como hallazgo activo en el commit auditado — sí existió históricamente (ver §6) y fue corregida en una auditoría previa documentada en el propio repositorio.

## 4. Fuentes de verdad (tabla)

| Dato | Fuente original | Transformación | Función responsable | Consumidores | Fuente de verdad definitiva |
|---|---|---|---|---|---|
| Medicación activa | Texto libre (Paso 1) o revisión profesional confirmada (Paso 2) | Resolución léxica → clasificación assertion/status/temporality → (opcional) sustitución por `reviewed-input-adapter` | `resolveDrugMentions`, `classifyMedicationMention`, `ReviewedInputAdapter.apply` | Cascadas, alertas globales, informe, exportaciones | `CaseModel.medications` (post-adaptador si hay revisión confirmada) |
| Problemas activos | Texto libre o revisión de problemas (Paso 2) | Eventos múltiples reconciliados temporalmente | `detectActiveProblems`, `reconcileProblemEvents`, `ReviewedInputAdapter.apply` | Verificación de problema intermedio en cascadas | `CaseModel.activeProblems` |
| Clase farmacológica | `kb/drug_dictionary.json` (única, compartida PROD/DEV — ver `tests/helpers.js:25`) | Ninguna — el diccionario es autoritativo; el motor nunca "adivina" clase a partir del nombre de regla | `buildDrugResolver`, expansión de combinaciones a dosis fija | Presentación, agrupación de reglas, exclusión NSAID | `kb/drug_dictionary.json` |
| Combinación a dosis fija (FDC) | `kb/drug_combinations.json` (única, compartida) | Expansión a principios activos individuales antes de cualquier razonamiento | `buildDrugResolver` | Todo el motor (nunca razona sobre "Symtuza" como entidad) | `kb/drug_combinations.json` |
| Señal de cascada | `kb_core_cascades.json` + `kb_vih_modifiers.json` (PROD o DEV según selector) | Emparejamiento fármaco índice/cascada + verificación de problema intermedio + cronología + indicación alternativa | `evaluateDrugDrugCascades`, `classifyCascadeSignal` | Pantalla, informe, exportaciones | `CaseModel.possibleCascades` (post `suppressDuplicateSignals`/`prioritizeCascadeCandidates`) |
| Interacción (DDI) | `ddi_watchlist.json` | Requiere coincidencia EXACTA de todos los participantes (`allRequiredEntitiesPresent`) | `evaluateCurrentInteractions` | Pantalla, informe | `CaseModel.currentInteractions` |
| Veredicto profesional | Entrada manual del clínico (Paso 5) | Ninguna | — | Informe final, exportación JSON | `state.cascadeClassifications` (nunca se fusiona con `signal.classification`; se muestran como dimensiones separadas) |
| Informe final (pantalla/texto/CSV/JSON) | `CaseModel` + `state.cascadeClassifications` + revisiones | `buildReport()` construye un único objeto; `ReportContract` lo formatea por superficie | `buildReport`, `ReportContract.toClinicalText/toCsv`, `exportJSON` | Usuario | El objeto `report` de `buildReport()` — una sola construcción para las 4 superficies |
| PDF | — | Ninguna: `window.print()` imprime el DOM del Paso 6 ya renderizado | `printReportAsPDF` (`app.js:3222`) | Usuario | Idéntico a pantalla por construcción (no hay plantilla PDF separada) |

## 5. Comprobaciones específicas pedidas por el encargo

| Comprobación | Resultado | Evidencia |
|---|---|---|
| ¿Funciones antiguas compitiendo con `clinical-engine.js`? | No, en el estado actual. Corregido en una auditoría previa (`docs/clinical-engine-fix-audit.md`, hallazgo 6.2: una regresión de este tipo SÍ ocurrió durante esa refactorización y fue corregida en la misma sesión). | `app.js:1375-1392` + inspección exhaustiva de funciones de nivel superior |
| ¿Lógica duplicada `app.js` / KB? | No se ha encontrado. `app.js` no contiene reglas clínicas embebidas; toda regla vive en `kb/`. | Búsqueda de literales de nombres de fármaco/clasificación fuera de `clinical-engine.js`/`kb/` — sin resultados relevantes |
| ¿Cálculos distintos para pantalla/informe/exportación? | No. Una sola función `buildReport()` alimenta las 4 superficies vía `ReportContract`. | `app.js:3006-3114`, `report-contract.js` |
| ¿Cachés que puedan quedar obsoletas? | `state.caseModel`/`state.detectedCascades`/`state.drugResolver`. Invalidación MANUAL (no basada en hash del contenido) en cada punto donde cambia la nota/KB/revisión (`invalidateDetectedCascades`, `invalidateReviewedClinicalInput`). Se han verificado todos los puntos de reasignación de `state.clinicalNote` y todos invalidan correctamente. Ver Hallazgo de robustez estructural (doc 02): el mecanismo es correcto hoy pero frágil ante nuevos puntos de mutación futuros que olviden invalidar. | `app.js:1411-1419`, confirmado también por el agente de seguridad |
| ¿Estados manuales ligados a IDs inestables? | `state.cascadeClassifications` se indexa por `candidate_id` (no por índice de array). Existe migración explícita `migrateClassificationsToCandidateId` y un mapa `CASCADE_ID_MIGRATIONS` para IDs de regla renombrados/fusionados (p. ej. CC050→CC033, CC061→CC001, ver `kb/kb_cascade_registry.md`). | `app.js:1675-1691`, `app.js:988-989` |
| ¿Diferencia medicamentos extraídos vs revisados? | Sí, modelada explícitamente: `CaseModel.allMedicationMentions` (todo lo detectado) vs `.medications`/`.activeMedications` (activos, post-revisión si aplica) vs `.inactiveOrNegatedMedications` (traza de lo excluido, con `exclusion_reason`). | `clinical-engine.js:2492-2536` |
| ¿Campos recalculados en vez de reutilizar la fuente canónica? | Un caso identificado y ya corregido documentado (Paso 3 leía una forma de datos obsoleta tras un rediseño — `docs/clinical-engine-fix-audit.md` §6.2); no se ha encontrado un caso equivalente sin corregir en el commit auditado. | — |

## 6. Limitación de esta fase

No se ha podido comparar la aplicación publicada en GitHub Pages con `main`: el acceso saliente a `ramonmorillo.github.io` está bloqueado por la política de red del entorno de auditoría (`EGRESS_BLOCKED`). No hay workflow de despliegue en `.github/workflows/` (sólo `clinical-regression.yml`, que ejecuta tests, no despliega); si GitHub Pages está activo, es por configuración del repositorio (Settings → Pages) sirviendo `main` directamente, no verificable desde este entorno. **Recomendación:** el equipo del proyecto debe confirmar manualmente que la página publicada coincide con el commit `40feac2` antes de dar por buena esta auditoría como representativa de producción.
