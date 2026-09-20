# Changelog

## Unreleased — unified clinical report contract (PR 9)

- Added a DOM-free, versioned report contract shared by the on-screen report, clinical-record text, JSON and CSV.
- Added explicit source/effective input provenance, review-application state, professional changes, audit-only discarded findings and structured limitations.
- Replaced the duplicated inline CSV builder with one tested RFC 4180-compatible export schema.
- Added bilingual clinical-record output and parity tests across all report surfaces.
- Professionally discarded findings remain outside clinical findings and recommendations while retaining a minimal audit identifier.

## Unreleased — integral reviewed-input QA (PR 8)

- Added end-to-end coverage from extraction through confirmed professional review and renewed clinical reasoning.
- Added regression cases for drafts, stale reviews, partial confirmation, temporal corrections, JSON round-trips, DDIs, medication-burden alerts, multiple candidates, bilingual stability, malformed imports and duplicate KB identities.
- Added an explicit QA matrix linking each clinical risk to an automated test.
- No production logic, clinical rule or knowledge-base entry is changed in this PR.

## Unreleased — reviewed input activation (PR 7B)

- Confirmed, current medication and clinical-problem reviews now become the effective input to cascade reasoning.
- Draft, invalid, stale, or identity-ambiguous reviews continue to fall back safely to source extraction.
- Editing reviewed input invalidates cached findings and prior candidate verdicts.
- Reports and exports now state whether each review was applied and include its audit trail.

## Unreleased — reviewed-input adapter (PR 7A)

- Added a pure, versioned adapter for confirmed medication and clinical-problem reviews.
- Draft, invalid, or stale reviews safely retain the extracted clinical input.
- Added item-level provenance and separate change/addition/exclusion audit trails.
- No reviewed input is consumed by the clinical engine in this PR.

Todos los cambios notables de este proyecto se documentan en este fichero.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.0.0/).
El versionado del software sigue [Semantic Versioning](https://semver.org/lang/es/).

---

## [Unreleased]

### Revisión profesional de problemas y temporalidad (2026-09-17)

#### Añadido

- Modelo versionado e independiente para revisar problemas clínicos, estado, temporalidad y fecha de inicio.
- Valores controlados para evitar estados no válidos: activo, sospechado, resuelto, ausente o desconocido; actual, previo/crónico o no determinado.
- Editor bilingüe en el Paso 2 con corrección, exclusión, alta manual, evidencia original y confirmación profesional.
- Persistencia local e importación/exportación JSON con trazabilidad de valores originales y revisados.
- Invalidación automática de revisiones obsoletas cuando cambia la nota, la KB o la extracción de problemas.
- Pruebas específicas de edición, temporalidad, validación, saneamiento, confirmación e invalidación.

Esta fase registra la revisión, pero todavía no la utiliza como entrada del motor clínico. La interfaz y los informes estructurados lo declaran mediante `applied_to_engine: false` hasta la integración aislada del siguiente PR.

No se modifican `clinical-engine.js`, las reglas clínicas, la base de conocimiento ni los resultados actuales del motor.

### Revisión farmacéutica editable de medicamentos (2026-09-17)

#### Añadido

- Modelo versionado e independiente para revisar la medicación extraída, conservando valor original, procedencia, inclusión, correcciones y fecha de confirmación.
- Editor bilingüe en el Paso 2 para corregir nombre y grupo farmacológico, excluir menciones y añadir medicamentos omitidos.
- Persistencia local e importación/exportación segura de la revisión profesional.
- Invalidación automática de revisiones obsoletas cuando cambia la extracción de medicamentos.
- Pruebas unitarias específicas de creación, edición, exclusión, adición, confirmación, duplicados, saneamiento e invalidación.

Esta fase registra la revisión para trazabilidad, pero todavía no la utiliza como entrada del motor clínico. La interfaz lo advierte explícitamente; la integración con el análisis se realizará en un PR posterior y aislado.

No se modifican reglas clínicas, base de conocimiento, clasificación de señales ni resultados actuales del motor.

### Endurecimiento del navegador (2026-09-17)

#### Seguridad

- Política de seguridad de contenidos restrictiva: scripts, conexiones, fuentes y recursos ejecutables limitados al propio origen; marcos, objetos, formularios y workers bloqueados.
- Política de referencia `no-referrer` para evitar la divulgación de la URL de origen al abandonar la aplicación.
- Eliminados todos los controladores JavaScript inline; las acciones de ayuda, demo, clasificación, validación KB e informe usan delegación de eventos con valores permitidos explícitamente.
- Prueba automática que impide reintroducir eventos inline, scripts o estilos externos, URL JavaScript, conexiones HTTP externas o acciones sin controlador.

La política se implementa mediante una etiqueta `meta` compatible con GitHub Pages. Los encabezados HTTP de seguridad del dominio de producción se configurarán en la fase de alojamiento definitivo.

Este bloque no modifica el motor clínico, la base de conocimiento, los datos del caso ni los criterios de clasificación.

### Corrección: candidatos de cascada compartiendo identificador en el Paso 5, e informe final respetando el descarte clínico (2026-09-17)

#### Corregido

- **Colisión de identificador entre candidatos de una misma regla.** Cuando una regla (p. ej. VIH003, INSTI → ganancia de peso → antidiabético/antihipertensivo) generaba más de un candidato para la misma nota — uno por cada fármaco de cascada compatible presente (p. ej. metformina y atorvastatina) —, ambas tarjetas del Paso 5 compartían el mismo `cascade_id` como clave de estado. Clasificar una tarjeta ("Cascada confirmada", "Cascada posible", "Descartar") sobrescribía silenciosamente el veredicto de la otra, dando la apariencia de una cascada "duplicada" que además reaccionaba de forma acoplada. Se introduce `candidate_id` (identificador único por par fármaco índice/fármaco de cascada) como clave real de la revisión clínica en `clinical-engine.js` y `app.js`; `cascade_id` se mantiene sin cambios como referencia a la regla de la KB. Los veredictos ya guardados se migran automáticamente cuando la migración es inequívoca (la regla solo producía un candidato en esa nota).
- **Alerta de interacción (DDI) filtrada al candidato equivocado.** La alerta "Dolutegravir aumenta los niveles de metformina" de VIH003 se mostraba en cualquier candidato de esa regla — incluido uno sobre atorvastatina — en cuanto la metformina apareciera en cualquier parte de la nota, en vez de solo en el candidato cuyo fármaco de cascada es realmente la metformina. `allRequiredEntitiesPresent()` ahora exige que un fármaco requerido que también sea uno de los `cascade_drugs_examples` de la propia regla coincida con el fármaco de cascada de ESE candidato concreto; un fármaco requerido ajeno a esa lista (p. ej. simvastatina en VIH001, rifampicina en VIH011/VIH014) conserva la comprobación previa sobre toda la nota.
- **El informe final ignoraba el descarte clínico del Paso 5.** Una cascada marcada como "Descartada" por el farmacéutico en el Paso 5 seguía apareciendo íntegramente en el informe final (pantalla, copia al registro clínico, exportación JSON y CSV), porque `buildReport()` agrupaba por la clasificación automática del sistema sin considerar el veredicto profesional. Ahora se excluye toda cascada con veredicto `not_cascade`; las confirmadas y las posibles se mantienen, y una cascada aún sin revisar se conserva (nunca se oculta en silencio) para que una revisión incompleta siga siendo visible en el informe.

Este bloque no modifica los criterios clínicos de clasificación automática (`classification`) ni el contenido de la base de conocimiento; solo corrige cómo se identifica cada candidato y cómo el veredicto profesional del Paso 5 se traslada al informe final.

### Arquitectura bilingüe de la interfaz (2026-09-17)

#### Modificado

- El selector ES/EN traduce ahora toda la estructura persistente: cabecera, herramientas, avisos de seguridad, identificación del caso, ayuda, información científica, estado de la KB y pie legal.
- Los bloques que mostraban simultáneamente español e inglés se sustituyen por una única versión coherente con el idioma seleccionado.
- Metadescripción, atributos accesibles, ayudas, títulos y marcadores de posición cambian también de idioma.
- La información legal se alinea con la cotitularidad al 50%, el registro 04/2026/2614 y el estado regulatorio pendiente de evaluación formal.

#### Añadido

- Diccionario estático ES/EN independiente del DOM y prueba automática que exige paridad de claves y cobertura de todos los elementos traducibles.

Este bloque no modifica el motor clínico, la base de conocimiento, los datos del caso ni los criterios de clasificación.

### Sistema visual profesional (2026-09-17)

#### Modificado

- Nueva jerarquía visual del encabezado, espacio de trabajo, flujo por pasos, formularios, tablas, tarjetas clínicas, avisos e informe.
- Sistema de tokens propio del producto para color, tipografía, espaciado, radios, elevación y estados semánticos.
- Diseño adaptable reforzado para escritorio, tableta y móvil, con objetivos táctiles y navegación horizontal controlada.
- Foco de teclado uniforme, enlace para saltar al contenido y respeto a la preferencia de movimiento reducido.
- El idioma del documento se sincroniza con el selector ES/EN para que las tecnologías de asistencia pronuncien la interfaz correctamente.

#### Eliminado

- Dependencia de Google Fonts: la interfaz usa fuentes del sistema y mantiene el funcionamiento local-first sin solicitudes externas de tipografía.
- Referencia estética a una identidad institucional SEFH no formalmente atribuida al producto.

Este bloque modifica exclusivamente presentación y estructura semántica no funcional. No cambia el motor clínico, la base de conocimiento, los datos persistidos ni el significado de los informes.

### Gobierno y calidad (2026-09-17)

#### Añadido

- Línea base congelada de la versión 1.0.0 y matriz de controles de publicación en `docs/`.
- Flujo de GitHub Actions que ejecuta la suite completa de regresión en cada pull request y cambio de `main`.
- Plantilla de pull request con declaraciones explícitas de impacto clínico, KB, privacidad, bilingüismo, accesibilidad y reversibilidad.
- `package.json` mínimo para ofrecer `npm test` como comando estable y reproducible, sin añadir dependencias.

#### Documentación

- Autoría y titularidad actualizadas para reflejar la cotitularidad al 50% de Ramón Morillo Verdugo y Cecilia Solís Martín.
- El estado regulatorio se expresa como pendiente de cualificación y clasificación formal, sin afirmar conformidad ni una clasificación no evaluada.

Este bloque no modifica la interfaz, el motor clínico, la base de conocimiento ni el comportamiento de la aplicación.

### Auditoría del motor clínico (2026-09-14) — refactor de arquitectura

Auditoría completa del pipeline de extracción/normalización/inferencia/detección de cascadas, motivada por un caso índice real: una paciente en Dovato desde 2019, con AINE (naproxeno) y a la que se prescribe enalapril por una única lectura de TA 130/80 mmHg descrita como "hipertensión". La herramienta generaba la cascada AINE→hipertensión→enalapril sin verificar nunca que la hipertensión estuviera realmente documentada, no reconocía Dovato como dolutegravir+lamivudina, no detectaba anastrozol, mostraba alertas de carga anticolinérgica/depresora del SNC dentro de la tarjeta de esa cascada, e informaba de 7 posibles cascadas sin distinguir su nivel de certeza. Diagnóstico completo, mapa de flujo y diseño propuesto documentados en el informe de auditoría de esta sesión; cambios de base de conocimiento en `kb/CHANGELOG.md`.

#### Añadido

- **`clinical-engine.js`** (nuevo módulo raíz): toda la lógica clínica (normalización, resolución de fármacos, extracción de problemas activos, mediciones clínicas, evaluación de cascadas, alertas globales) se ha extraído de `app.js` a un módulo puro sin dependencias del DOM, cargable tanto en el navegador (`<script>` antes de `app.js`) como en Node (`module.exports`), lo que permite ejecutar la suite de pruebas automatizadas sin navegador. `app.js` pasa a ser una capa fina de UI/estado sobre `window.ClinicalEngine`.
- **Modelo de caso estructurado (`CaseModel`)**: `ClinicalEngine.buildCaseModel(noteText, kb, opts)` devuelve `medications`, `activeProblems`, `clinicalMeasurements`, `events`, `possibleCascades`, `globalMedicationAlerts` y `missingInformation` como colecciones independientes y trazables — nunca una lista plana de "cascadas detectadas".
- **Clasificación de cascadas en 5 niveles**, nunca "confirmada": `supported_possible_cascade`, `possible_but_incomplete`, `pharmacological_match_only`, `not_evaluable`, `discarded`. Cada señal incluye `classification_reason_es/en` y un objeto `evidence` con el estado de cada elemento (fármaco índice, problema intermedio, fármaco posterior, orden temporal, indicación alternativa, discordancia de medición) y su procedencia (`explicit` | `inferred` | `unavailable`).
- **Extracción de problemas clínicos activos genéricos** (`kb/{prod,dev}/clinical_problems.json`, nuevo): hipertensión/HTA, insuficiencia cardiaca, diabetes tipo 2, ERGE/dispepsia, artrosis, Parkinson — con estados `active`/`history`/`negated`/`suspected`, evidencia textual literal y enlace a las cascadas que verifican. Sustituye el `ALTERNATIVE_INDICATION_MAP` que vivía embebido en `app.js`.
- **Extracción de mediciones clínicas** (`extractClinicalMeasurements()`): captura lecturas de presión arterial (p. ej. "130/80 mmHg") y registra explícitamente si una única lectura alcanza o no el umbral diagnóstico habitual — nunca convierte una medición aislada en un diagnóstico confirmado.
- **Alertas globales de medicación** (`globalMedicationAlerts`), estructuralmente separadas de `possibleCascades`: carga anticolinérgica y carga depresora del SNC (antes inyectadas incorrectamente en la explicación de *cada* cascada, incluidas las no relacionadas) y duplicidad de AINE concurrentes (p. ej. naproxeno + etoricoxib), ahora mostradas en su propia sección tanto en el paso "Cascadas" como en el informe final.
- **Suite de pruebas automatizadas en Node** (`tests/`, sin dependencias — `node tests/run.js`): caso índice completo (Dovato→dolutegravir+lamivudina, anastrozol, calcio/colecalciferol, TA 130/80 con discordancia registrada, máximo una señal AINE-HTA-enalapril nunca presentada como confirmada, alertas anticolinérgicas/SNC excluidas de esa tarjeta, duplicidad AINE mostrada aparte, "si precisa" conservado), 8 casos negativos de la especificación de auditoría, regresión de la suite NLP previa, y validación estructural de la KB (sin IDs duplicados, reglas fusionadas correctamente excluidas de la detección activa).
- **`kb/kb_cascade_registry.md`**: tabla de auditoría de todas las reglas de cascada activas (fuente bibliográfica o "pendiente de revisión clínica", condiciones necesarias, exclusiones).

#### Corregido

- Dovato/Triumeq/Juluca/Kivexa/Epzicom/Truvada/Descovy estaban catalogados como fármacos de un solo principio activo; ahora se expanden correctamente a todos sus componentes (ver `kb/CHANGELOG.md`).
- Anastrozol, ausente del diccionario de fármacos, añadido.
- CC061 (duplicado de CC001) y CC050 (duplicado de CC033) fusionados — documentado, no eliminado silenciosamente.
- Las cascadas fármaco-fármaco ya no se dan por válidas solo por la coincidencia de dos clases farmacológicas: se verifica explícitamente la presencia, negación, cronicidad o sospecha del problema intermedio antes de clasificar la señal.

#### Migración

- Los veredictos de clasificación clínica (`state.cascadeClassifications`) guardados en `localStorage` bajo los identificadores fusionados `CC061`/`CC050` se migran automáticamente a `CC001`/`CC033` al cargar la aplicación.

---

Mejora de detección clínica y farmacológica: normalización conservadora del texto, reconocimiento de combinaciones de dosis fija y un nuevo módulo de problemas clínicos urológico/renales, motivados por un caso de regresión real (dolor de flanco + estudio urológico + tamsulosina no generaban ninguna señal).

### Añadido

- **`normalizeClinicalText()`**: normalización conservadora previa a la detección (corrección de erratas frecuentes por diccionario cerrado — "vral"→"viral", "izqueirdo/izuqierdo"→"izquierdo", "dolro"→"dolor", "palapcion"→"palpacion", "capo"→"comp", "q comp"→"1 comp" — y colapso de espacios). Se aplica al inicio de `extractDrugs()`, `extractSymptoms()` y `detectCascades()`; el texto original de la nota nunca se modifica.
- **Combinaciones de dosis fija** (`kb/drug_combinations.json`, nuevo fichero raíz de KB, independiente de track PROD/DEV): mapea una marca comercial a sus principios activos individuales conservando la trazabilidad (p. ej. "Biktarvy → bictegravir + emtricitabina + tenofovir alafenamida"). `buildDrugResolver()`/`resolveDrugMentions()` expanden la mención de marca en una mención por principio activo, cada una con `brand`/`brand_ingredients`/`brand_therapeutic_class` para uso en la interfaz. Altas iniciales: Biktarvy (bictegravir/emtricitabina/tenofovir alafenamida) y Gibiter Easyhaler (budesonida/formoterol).
- **Detección de problemas clínicos urológico/renales** (`detectClinicalProblems()` / `detectUrologicRenalProblem()`): nuevo módulo de reglas, independiente del diccionario de síntomas ADE existente, que identifica un problema "en estudio" a partir de hallazgos ancla (dolor de flanco, cólico renal, litiasis, hematuria, obstrucción urinaria, expulsión de cálculo) combinados con contexto de apoyo (urocultivo/sistemático/ecografía solicitados, puñopercusión, tira de orina, otros síntomas urinarios, y tamsulosina prescrita como señal puramente contextual — nunca como diagnóstico automático). Cada hallazgo incluye evidencia textual literal de la nota y un nivel de certeza (`symptom` | `suspected`; nunca `confirmed`). Los hallazgos negados (p. ej. "Tira de orina: NEGATIVO", "puñopercusión renal negativa", "No sintomatología miccional") se registran como `negatedFindings` y nunca generan falsos positivos.
- **Paso 2 — bloque "Problemas activos detectados"**: ahora muestra también los problemas clínicos del nuevo módulo (categoría, certeza, evidencia, hallazgos negativos), y una línea de trazabilidad marca→principios activos bajo los medicamentos detectados cuando aplica.
- **Tests de regresión** (`window.runNlpSelfTest()`, grupos I/J/K): normalización de erratas, resolución de combinaciones (Biktarvy, Gibiter Easyhaler) y los 5 casos de aceptación del módulo de problemas urológico/renales, incluyendo el caso real completo de regresión.

### Modificado

- `isNegatedSymptom()`: añadidos cues de negación POST-término para "negativo/negativa" a secas (antes solo se detectaba "negativo/negativa para X"), cubriendo el patrón muy frecuente en español "Tira de orina: NEGATIVO" / "puñopercusión renal negativa".
- Advertencia metodológica del Paso 2 actualizada para reflejar que la detección combina palabras clave, sinónimos, marcas comerciales y reglas clínicas simples, y que los problemas inferidos son sospecha/en estudio, no diagnóstico.

---

## [1.0.0] — 2026-03-07

Primera versión estable completa con interfaz clínica en español, detección robusta de cascadas y experiencia de usuario completa para revisión farmacoterapéutica.

### Añadido

- **Experiencia demo**: botón "Probar demo" con caso clínico precargado (PVVIH en TAR + amlodipino → edema maleolar → furosemida; cascada CC004). Panel de incorporación de tres pasos en el Paso 1 cuando no hay nota clínica activa.
- **Vocabulario clínico en la interfaz**: los seis pasos del asistente usan etiquetas clínicas en español (*Datos del caso / Medicación y problemas activos / Clasificación farmacológica / Posibles cascadas terapéuticas / Verificación clínica / Plan farmacoterapéutico e informe*) en lugar de nombres internos del pipeline.
- **Ciclo completo de carga de la KB**: indicador visual (spinner → chip verde/ámbar/rojo) en el pie de página que refleja el resultado de la carga de los cuatro ficheros JSON de la KB.
- **Panel de herramientas colapsable** (⚙ Tools) que agrupa: selector de modo KB (PROD/DEV), exportación de la KB, exportación JSON/CSV del caso, y eliminación de datos. El encabezado principal queda simplificado.
- **Banner de seguridad**: colapsado por defecto con resumen de una línea; expandible para el texto completo.
- **Botones de acción rápida** en la barra del paciente: Nuevo caso, Importar caso, Probar demo.
- **Spinner de carga silencioso**: sustituye el texto "Loading application..." durante la inicialización.
- **Detección por puente sintomático** (`detectSymptomCascades()`): segundo modo de detección que identifica síntomas en el texto libre que pueden ser efectos adversos de un fármaco activo tratados por otro fármaco activo.
- **NLP de fiabilidad**: detección de negación (`isNegatedSymptom()`), señales de temporalidad (`detectTimeCues()`), normalización Unicode NFC.
- **Exportación CSV** operativa (era un `alert()` de marcador de posición).
- **Restauración de `cascadeClassifications`** en importación (era pérdida silenciosa de datos en el ciclo exportar → importar).
- **`KB_REFERENCE.md`**: documento de referencia de la base de conocimiento.
- **`README.md`**: documentación completa del software (propósito, alcance, funcionamiento, limitaciones, autoría).
- **`CHANGELOG.md`**: este fichero.

### Modificado

- `loadKB()`: usa `Promise.allSettled()` para carga paralela tolerante a fallos con informe por fichero. Valida que el JSON raíz sea un objeto plano antes de asignarlo a `state.kb`.
- `loadState()`: validación de integridad del valor `step` (entero en [1..6]); guardas de tipo en todos los campos restaurados.
- `importCase()`: validación de tipo MIME y extensión `.json`; guardas de tipo sobre `patientId`, `clinicalNote` y `step`; manejo de `cascadeClassifications`; toast en todos los caminos de error.
- `exportJSON()`, `exportReport()`, `downloadJSON()`: envueltos en `try/catch` con toast de éxito y error.
- `saveState()`: detecta y notifica al usuario `QuotaExceededError` mediante toast en lugar de fallar silenciosamente.
- `detectCascades()`: el campo `confidence` usa `'low'` como valor de reserva en lugar de `'unknown'` (que no es un valor semafórico válido).
- `newCase()`: diálogo de confirmación si existe una nota activa; limpia el campo de ID de paciente en la UI.
- `loadDemoCase()`: nota clínica en español, mensajes en español, escenario clínico documentado (CC004 + CC001).
- Pie de página: eliminados "Loading KB..." y "KB version: unknown"; sustituidos por chip de estado KB.

### Eliminado

- `console.debug('[extractSymptoms]...')`: eliminado de producción (era código de depuración marcado explícitamente para borrar).
- Siete botones del encabezado principal: consolidados en el panel ⚙ Tools.
- Texto "Loading application..." del pie de página durante la inicialización.

### Corregido

- El valor `confidence: 'unknown'` ya no aparece en badges de la UI.
- La exportación CSV ya no muestra un `alert()` de marcador de posición.
- El campo `cascadeClassifications` ya no se pierde en el ciclo exportar → importar.
- Los valores `step` corruptos o fuera de rango en `localStorage` se ignoran y se reinicia a 1.

---

## [0.3.0] — 2026-03-04

### Añadido

- Base de conocimiento PROD v2.0.0 con 40 patrones de cascadas genéricas (`kb_core_cascades.json`).
- Diccionario de síntomas `kb_symptoms.json` v1.2.0 con 10 entradas y sinónimos en español e inglés.
- Validador de integridad de KB (`kb/dev/kb_validator.js`) con informe editorial y alertas operacionales.
- Módulo de extracción de fármacos ampliado: 200+ fármacos y 30+ clases farmacológicas indexados.
- Soporte de detección de negación y señales temporales en el NLP de extracción.

### Modificado

- `buildReport()`: reconciliación de fármacos detectados con fármacos de cascada antes de renderizar.
- Informe estructurado con secciones diferenciadas por tipo de hallazgo.

---

## [0.2.0] — 2026-02-15

### Añadido

- Wizard de seis pasos con máquina de estados (`goTo()`, `renderStepContent()`, `updateStepNav()`).
- Persistencia en `localStorage` con exportación JSON e importación de casos.
- Paso 5: clasificación interactiva de cascadas (confirmada / posible / descartada).
- Generación de informe estructurado bilingüe (Paso 6).
- Base de conocimiento inicial: `kb_vih_modifiers.json` v1.0 y `ddi_watchlist.json` v1.0.

---

## [0.1.0] — 2026-01-20

### Añadido

- Estructura inicial del proyecto: `index.html`, `app.js`, `styles.css`.
- Carga de KB desde ficheros JSON locales via `fetch()`.
- Extracción básica de fármacos desde nota clínica en texto libre.
- Detección de cascadas contra `kb_core_cascades.json` v1.0 (12 patrones iniciales).
- Almacenamiento local sin backend.
