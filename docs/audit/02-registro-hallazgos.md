# 02 — Registro de hallazgos

Convención de severidad: **crítica** (riesgo de daño al paciente o pérdida/mezcla de datos no mitigado), **alta** (afecta la fiabilidad o accesibilidad de la pantalla clínica central, mitigado parcialmente por la revisión profesional obligatoria), **media** (afecta usabilidad/coherencia de forma perceptible pero acotada), **baja** (mejora, deuda técnica o riesgo teórico/residual).

No se ha clasificado ningún hallazgo como **crítico**: no se ha encontrado pérdida de datos, mezcla de casos/pacientes, confirmación automática de causalidad, ni un defecto que oculte silenciosamente una cascada real (falso negativo estructural). Los hallazgos de mayor severidad son falsos positivos o de confusión de interfaz, siempre sujetos a la revisión profesional que el propio diseño exige antes de cualquier acción clínica.

---

### HAL-01 — Patrones de suspensión de medicación no reconocidos ("dejó de tomar X", "ya no lo/la toma")

- **Severidad:** Alta
- **Categoría:** Motor clínico / NLP
- **Archivos afectados:** `clinical-engine.js:442-456` (`classifyMedicationMention`)
- **Evidencia:** `classifyMedicationMention` solo reconoce como discontinuación las formas `suspendi[oó]/suspendido/retirado/interrumpi[oó]` o `tomó...hasta` (línea 452-453). No contempla `dejó de tomar` ni la forma anafórica `ya no lo/la toma`.
- **Pasos de reproducción:**
  ```js
  const { loadKB, CE } = require('./tests/helpers');
  const kb = loadKB('prod');
  CE.buildCaseModel('Dejó de tomar amlodipino en enero de 2020 por edema en miembros inferiores. En marzo de 2020 se inicia furosemida 40 mg cada 24 horas.', kb, {lang:'es'});
  ```
- **Salida observada:** `amlodipine` aparece en `medications` (activo) y se genera `CC004` con `classification: 'supported_possible_cascade'` y `amlodipine` como fármaco índice activo.
- **Salida esperada:** `amlodipine` debería quedar en `inactiveOrNegatedMedications` con `status:'discontinued'` (igual que ocurre correctamente con la redacción "Amlodipino suspendido en enero de 2020...", verificado en el mismo entorno), y la cascada debería surgir, si acaso, vía `symptom_bridge` (SYM008) como evidencia histórica, no presentando amlodipino como medicación activa.
- **Impacto clínico/técnico:** El informe puede mostrar como "medicación activa" un fármaco que el propio texto de la nota dice explícitamente que se dejó de tomar. Riesgo de confusión sobre el estado real del tratamiento y de sugerir revisión de un fármaco que ya no se toma.
- **Solución recomendada:** Añadir `dej[oó]\s+de\s+tomar|ya\s+no\s+(lo|la|los|las)?\s*(toma|tomaba)` al patrón de discontinuación (línea 452) y, para la forma anafórica ("ya no lo toma" sin repetir el nombre del fármaco), evaluar si el modelo de eventos (`reconcileProblemEvents`, ya usado para problemas) puede extenderse a medicación en una iteración futura — la forma no anafórica ("dejó de tomar X") es corregible de inmediato con una regla léxica simple.
- **Archivos afectados por el fix:** `clinical-engine.js`; test nuevo en `negative-cases.test.js` o `medication-status-interactions.test.js`.
- **Esfuerzo:** XS (forma no anafórica) / M (forma anafórica, requiere diseño de resolución de referencia).
- **Riesgo de regresión:** Bajo — adición de patrón léxico aislado; la suite existente (2045 aserciones) debe seguir pasando sin cambios.
- **Dependencia de validación clínica:** No para la corrección léxica; sí sería recomendable una revisión lingüística por un hablante clínico para confirmar que no introduce falsos positivos con otras construcciones ("ya no lo necesita", "ya no le sienta bien").
- **Criterio de aceptación:** Un caso de test que reproduzca exactamente el ejemplo de este hallazgo debe pasar (`amlodipine` en `inactiveOrNegatedMedications`, no en `medications`; `CC004` no debe presentar amlodipina activa).

---

### HAL-02 — Nueve pares de reglas de cascada casi-duplicadas activas en `kb_core_cascades.json`, con consecuencia demostrada de tarjetas contradictorias

- **Severidad:** Alta
- **Categoría:** Base de conocimiento / Coherencia clínica
- **Archivos afectados:** `kb/prod/kb_core_cascades.json`, `kb/dev/kb_core_cascades.json`; `clinical-engine.js:1693` (`suppressDuplicateSignals`, que por diseño no fusiona reglas con `rule_id` distinto aunque compartan fármacos); `kb/kb_cascade_registry.md` (desactualizado, ver HAL-16).
- **Evidencia:** El propio validador de gobernanza del proyecto (`kb/dev/kb_validator.js::runValidation`, umbral solapamiento índice≥0.75 ∧ cascada≥0.75 ∧ problema≥0.5) detecta automáticamente 9 pares activos en PROD — confirmado de forma independiente tanto por esta auditoría como por `tests/kb-audit.test.js` (`assertEqual(...,9)`):

  | Par | Fármaco índice (solapamiento) | Problema intermedio | Fármaco de cascada (solapamiento) |
  |---|---|---|---|
  | CC003 / CC042 | IECA — idx=1.00 | "Tos seca persistente" / "Tos seca" | antitusivo — casc=0.75 |
  | CC007 / CC045 | Tiazida — idx=1.00 | "Hiperuricemia/gota" (ambas) | alopurinol/AINE — casc=1.00 (idéntica) |
  | CC013 / CC070 | Anticolinérgico — idx=0.78 | "Estreñimiento inducido..." / "Estreñimiento" | laxante — casc=1.00 |
  | CC019 / CC082 | ISRS/ISRN — idx=1.00 | "Disfunción sexual" (ambas) | inhibidor PDE5 — casc=1.00 (idéntica) |
  | CC023 / CC053 | Antipsicótico — idx=0.80 | "Hiperprolactinemia" (ambas) | agonista dopaminérgico — casc=1.00 (idéntica) |
  | CC025 / CC079 | Diurético de asa — idx=1.00 (idéntica) | "Hipomagnesemia" (ambas) | suplemento Mg — casc=0.75 |
  | CC026 / CC068 | IBP — idx=1.00 | "Hipomagnesemia" (ambas) | suplemento Mg — casc=1.00 (idéntica) |
  | CC027 / CC067 | Gabapentinoide — idx=1.00 (idéntica) | "Edema periférico" (ambas) | diurético — casc=0.75 |
  | CC028 / CC065 | Bisfosfonato oral — idx=1.00 | "Irritación GI alta/esofagitis" (ambas) | IBP — casc=1.00 (idéntica) |

  Solo 2 pares históricos distintos a estos 9 están ya fusionados y documentados (CC050→CC033, CC061→CC001, ver `kb_cascade_registry.md`); los 9 de la tabla permanecen activos e independientes.
- **Pasos de reproducción (consecuencia práctica, no solo advertencia estática):**
  ```js
  const { loadKB, CE } = require('./tests/helpers');
  const kb = loadKB('prod');
  CE.buildCaseModel('Toma amitriptilina 25 mg por la noche desde enero de 2020. En marzo de 2020 presenta estreñimiento. Se inicia macrogol.', kb, {lang:'es'});
  ```
- **Salida observada:** 3 señales en `possibleCascades` para la MISMA pareja canónica (amitriptyline → macrogol): `CC070` (`supported_possible_cascade`), `SYM001` (`possible_but_incomplete`), `CC013` (`pharmacological_match_only`) — tres clasificaciones distintas para la misma evidencia de nota.
- **Salida esperada:** Una única tarjeta clínica por relación fármaco-problema-fármaco realmente distinta; si CC013/CC070 son clínicamente la misma cascada (alto solapamiento, ver tabla), deberían fusionarse o diferenciarse explícitamente (p. ej. por matiz de mecanismo) tras revisión clínica — nunca coexistir con clasificaciones contradictorias sin explicación visible al usuario.
- **Impacto clínico/técnico:** Confunde al profesional (¿hay evidencia suficiente o no, para el mismo hallazgo?), infla artificialmente el número de "problemas detectados" en pantalla, y erosiona la confianza en el sistema de clasificación de 4 dimensiones que la propia app promueve como su seña de rigor.
- **Solución recomendada:** Revisión clínica caso por caso de los 9 pares (tabla de candidatos, ampliada en doc `03-auditoria-kb.md`) para decidir, por cada par: (a) fusionar (patrón ya usado con CC050/CC061), (b) diferenciar explícitamente el mecanismo/ventana temporal si clínicamente lo justifican, o (c) mantener ambas pero enlazarlas para que `suppressDuplicateSignals` las trate como equivalentes cuando coincida el par canónico exacto. **No fusionar automáticamente** — esta auditoría no toma esa decisión.
- **Esfuerzo:** M (revisión clínica) + S (cambio KB/registro tras la decisión).
- **Riesgo de regresión:** Medio — toca contenido clínico activo; requiere caso de aceptación y regresión completa por cada regla modificada (`RELEASE_GATES.md`, fila "Knowledge base").
- **Dependencia de validación clínica:** Sí, explícita — revisor clínico independiente del autor, según gobernanza ya definida en el propio repositorio.
- **Criterio de aceptación:** Para cada par resuelto, un caso de test que demuestre una única tarjeta coherente (o, si se decide mantener diferenciadas, una justificación clínica documentada en `kb_cascade_registry.md` explicando por qué no se fusionan).

---

### HAL-03 — `kb/dev/kb_core_cascades.json` con bloques completos sin traducción española, accesible desde la interfaz sin aviso adicional

- **Severidad:** Media
- **Categoría:** Base de conocimiento / Internacionalización
- **Archivos afectados:** `kb/dev/kb_core_cascades.json`; `kb/dev/kb_validator.js` (relleno automático EN→ES); `app.js:4057-4063` (selector de entorno sin gating ni aviso adicional más allá de la etiqueta "DEV").
- **Evidencia (recuento exacto, confirmado por auditoría independiente):**
  - `ade_es` ausente en 40 reglas (CC001–CC040).
  - `ade_mechanism_es` ausente en las mismas 40.
  - `name_es` ausente en 28 reglas (CC013–CC040).
  - `recommended_first_action_es` ausente en 88 de 90 reglas (todas excepto CC001 y CC004).
  - `recommended_first_action_en` inexistente en 50 reglas (CC041–CC090) en **ambos** tracks (nunca se mapeó desde el fichero de origen `prescribing_cascades_CC041_CC090_FINAL.json`).
  - PROD, por contraste, tiene 0 asimetrías ES/EN en este mismo fichero.
- **Efecto colateral adicional detectado:** por esta laguna de traducción combinada con una inconsistencia de ortografía UK/US en `ade_en` (p. ej. "hyperprolactinaemia" vs "hyperprolactinemia", "hypomagnesaemia" vs "hypomagnesemia"), el detector de solapamiento del validador pierde 4 de los 9 avisos de HAL-02 cuando se ejecuta sobre DEV (solo detecta 5/9) — el propio mecanismo de gobernanza queda degradado en el track que más lo necesitaría (contenido menos maduro).
- **Pasos de reproducción:** `node -e "console.log(require('./kb/dev/kb_validator.js').validateKBOperational(require('./kb/dev/kb_core_cascades.json')).fallbackByFieldIds)"`.
- **Impacto clínico/técnico:** Cualquier usuario puede activar el track DEV desde "Herramientas → Entorno" sin autenticación. Si lo hace, una interfaz declarada en español (`<html lang="es">`) mostrará contenido en inglés sin aviso para 40+ reglas, y perderá 4 avisos de gobernanza sobre casi-duplicados.
- **Solución recomendada:** Dos niveles — (1) inmediato/XS: añadir un aviso visible al seleccionar DEV explicando que el contenido puede estar parcial o no traducido y no debe usarse en escenarios reales; (2) más esfuerzo/L: completar las traducciones pendientes o eliminar la exposición de DEV a usuarios finales (limitarla a un flag de desarrollo/URL, no a un desplegable visible en producción).
- **Esfuerzo:** XS (aviso) / L (traducción completa).
- **Riesgo de regresión:** Bajo (aviso) / Medio (traducción, requiere revisión terminológica).
- **Dependencia de validación clínica:** Sí, para las traducciones (terminología clínica en español).
- **Criterio de aceptación:** El aviso aparece antes de poder usar DEV para generar un informe, o bien `fallbackFieldCount` de `validateKBOperational(kb/dev/kb_core_cascades.json)` es 0.

---

### HAL-04 — Contraste insuficiente (WCAG 1.4.3) sistemático en las insignias de clasificación/relevancia/validación

- **Severidad:** Alta
- **Categoría:** Accesibilidad
- **Archivos afectados:** `app.js:2704-2786` (`CLASSIFICATION_STYLE`, `relevanceBadgeHtml`, `knowledgeValidationBadgeHtml`, `professionalValidationBadgeHtml`) y >15 usos adicionales de grises hardcoded (`#aaa`, `#bbb`, `#888`, `#7f8c8d`) fuera del sistema de variables del tema.
- **Evidencia:** Cálculo de ratio de contraste (luminancia relativa WCAG) sobre los pares color/fondo del código:
  - `relevanceBadgeHtml`: blanco sobre `#7f8c8d` ≈ 3.48:1; sobre `#e67e22` ≈ 2.85:1; sobre `#27ae60` ≈ 2.87:1 — las tres variantes de "baja/moderada/alta relevancia" fallan 4.5:1.
  - `CLASSIFICATION_STYLE`: `possible_but_incomplete` ≈ 2.85:1; `pharmacological_match_only` ≈ 3.48:1; `not_evaluable` ≈ 2.56:1; `discarded` ≈ 4.19:1 (falla por poco). Solo `supported_possible_cascade` (≈4.72:1) aprueba.
  - `knowledgeValidationBadgeHtml`: "pendiente de revisión" ≈ 2.56:1; "fuente revisada" ≈ 4.30:1 (falla por poco).
  - `professionalValidationBadgeHtml`: "posible" ≈ 2.85:1; "no es cascada" ≈ 1.78:1; "pendiente" ≈ 3.96:1. Solo "confirmada" (≈4.72:1) aprueba.
  - Las variables de tema equivalentes (`--color-text-muted` en `styles.css:23`/`theme-siafcmo.css:23`) sí cumplen AA (~4.5–5.5:1); el problema es específicamente el uso de colores hardcoded en `app.js` que evita el sistema de diseño ya conforme.
- **Impacto:** Afecta precisamente las 4 dimensiones de etiqueta (relevancia potencial, validación de conocimiento, evaluación automática, validación profesional) que la auditoría previa del propio repositorio (`docs/clinical-engine-fix-audit.md`) diseñó como corrección de un defecto anterior — el contenido es correcto, pero su presentación visual no cumple el estándar de accesibilidad para la mayoría de sus estados.
- **Solución recomendada:** Sustituir los colores hardcoded de las funciones de insignia por las variables del tema (o una paleta nueva validada a ≥4.5:1) conservando la codificación semántica de color; no depende de lógica clínica.
- **Esfuerzo:** S–M.
- **Riesgo de regresión:** Bajo (solo CSS/color).
- **Dependencia de validación clínica:** No. Sí revisión de diseño/producto.
- **Criterio de aceptación:** Todas las combinaciones texto/fondo de las 4 dimensiones ≥4.5:1 (texto normal) verificado con una herramienta de contraste estándar.

---

### HAL-05 — Notificaciones toast con auto-cierre fijo de 4s sin control de tiempo (WCAG 2.2.1)

- **Severidad:** Media
- **Categoría:** Accesibilidad
- **Archivos afectados:** `app.js:3770-3785` (`showToast`).
- **Evidencia:** El toast se autodestruye a los 4000 ms sin pausa al hover/foco ni extensión, incluyendo mensajes de fallo de exportación o almacenamiento lleno (`toast_storage_full`).
- **Impacto:** Usuarios con dislexia, baja visión o discapacidad cognitiva pueden no llegar a leer un mensaje importante antes de que desaparezca.
- **Solución recomendada:** Pausar el temporizador al hover/foco del toast y/o aumentar el tiempo mínimo para mensajes de tipo `error`.
- **Esfuerzo:** XS–S. **Riesgo de regresión:** Bajo. **Dependencia clínica:** No.
- **Criterio de aceptación:** Un toast de error permanece visible mientras tiene el foco/hover y al menos 6–8 s en reposo, con cierre manual siempre disponible (ya existe).

---

### HAL-06 — Caso de demostración disponible solo en español, independientemente del idioma de interfaz

- **Severidad:** Media
- **Categoría:** Internacionalización
- **Archivos afectados:** `app.js:3386-3417` (`loadDemoCase`).
- **Evidencia:** `state.clinicalNote` se asigna a un array de líneas en español codificado de forma fija, sin ninguna rama condicionada por `currentLanguage`.
- **Impacto:** Un usuario que cambie la interfaz a EN y pulse "Try demo" (la llamada a la acción del propio panel de onboarding) recibe una nota clínica íntegramente en español dentro de una interfaz en inglés; además, dado que parte de la detección depende de coincidencias textuales sensibles al idioma, la calidad de la demostración en modo EN puede degradarse (riesgo razonable, no confirmado con ejecución completa).
- **Solución recomendada:** Añadir una versión EN clínicamente equivalente del caso demo, seleccionada por `currentLanguage`.
- **Esfuerzo:** S (redacción) + validación de que dispara las mismas cascadas que la versión ES.
- **Riesgo de regresión:** Bajo–Medio. **Dependencia de validación clínica:** Sí (equivalencia clínica de la nota en inglés).
- **Criterio de aceptación:** `loadDemoCase()` en modo EN produce un `CaseModel` con la misma cascada canónica (CC004) que la versión ES.

---

### HAL-07 — Variante "composición completa sin marca" de Symtuza sin aserción dedicada en la suite

- **Severidad:** Baja
- **Categoría:** Cobertura de test
- **Archivos afectados:** `tests/fixed-dose-classification.test.js`.
- **Evidencia:** La suite solo etiqueta explícitamente `'Symtuza brand'` (solo marca) y `'full composition plus brand'` (composición + marca entre paréntesis); la forma intermedia `'darunavir/cobicistat/emtricitabina/tenofovir alafenamida'` sola se verificó manualmente en esta auditoría (comportamiento correcto: 4 ingredientes, clases correctas) pero no tiene aserción propia.
- **Solución recomendada:** Añadir una llamada `expectSymtuza('full composition only', 'darunavir/cobicistat/emtricitabina/tenofovir alafenamida', kb)`.
- **Esfuerzo:** XS. **Riesgo de regresión:** Ninguno (solo añade cobertura). **Dependencia clínica:** No.

---

### HAL-08 — Documento de metodología desactualizado describe una arquitectura de "5 agentes" que no existe en la implementación real

- **Severidad:** Baja (pero con riesgo de propagarse a la futura web si no se corrige antes)
- **Categoría:** Documentación / Coherencia de producto
- **Archivos afectados:** `methodology/pipeline_spec_v1.0.md` (§1-3).
- **Evidencia:** El documento describe un "Five-Agent Workflow" (Extractor, Normaliser, Detector, Planner, Verifier) y una escala temporal T0/T1/T2/TX. La implementación real es un motor determinista de reglas en JavaScript puro, sin LLM ni agentes de ningún tipo — confirmado por inspección de `clinical-engine.js` y por el propio §4 del documento, que reconoce parcialmente ("Updated 2026-09-14 ... ha sido superseded") que ese diseño quedó obsoleto, sin reescribir §1-3.
- **Impacto:** Si se usa este documento como base de copy para la futura web pública, describiría una arquitectura ficticia (agentes de IA que no existen), lo cual sería engañoso para usuarios y revisores.
- **Solución recomendada:** Reescribir §1-3 para reflejar el motor determinista real, o marcar explícitamente el documento completo como histórico/obsoleto y sustituirlo por una referencia a `docs/clinical-engine-fix-audit.md` y a este propio documento de auditoría.
- **Esfuerzo:** XS. **Riesgo de regresión:** Ninguno (solo documentación). **Dependencia clínica:** No.

---

### HAL-09 — Persistencia sin cifrar de datos potencialmente identificables en `localStorage`, sin expiración automática

- **Severidad:** Baja (riesgo residual, mitigado por diseño local-first y aviso textual)
- **Categoría:** Seguridad / Privacidad
- **Archivos afectados:** `app.js:944-956` (`saveState`).
- **Evidencia:** `localStorage.setItem('hiv_cascade_state', JSON.stringify({..., clinicalNote, patientId, ...}))` en texto plano, sin TTL. La nota clínica es texto completamente libre y puede contener datos identificables si el usuario no sigue el aviso de la interfaz.
- **Mitigantes existentes:** sin transmisión a servidor (app 100% cliente), aviso textual explícito en dos ubicaciones de la interfaz, botón "Eliminar todos los datos" que limpia completamente el estado.
- **Solución recomendada:** Ninguna obligatoria dado el modelo local-first; documentar el riesgo residual explícitamente en el aviso de privacidad. Cifrado en reposo sería desproporcionado para un MVP (aumenta complejidad sin servidor que gestione claves de forma segura).
- **Esfuerzo:** — (aceptar y documentar) — **Dependencia clínica:** No. **Dependencia de evaluación:** RGPD/legal, fuera del alcance de esta auditoría técnica.

---

### HAL-10 — Sin control técnico activo contra introducción de datos identificables (solo aviso textual)

- **Severidad:** Baja
- **Categoría:** Seguridad / Privacidad / UX
- **Archivos afectados:** `index.html:104-105` (`patient-id`, sin `pattern=`), `app.js` (`note-input`, sin validación de contenido).
- **Evidencia:** No existe ninguna heurística (DNI/NIE, fecha de nacimiento completa, nombre propio) que advierta dinámicamente. Solo `maxlength="50"` en el ID (limita longitud, no contenido).
- **Solución recomendada (opcional, no urgente):** Aviso no bloqueante si se detecta un patrón sospechoso (p. ej. formato de DNI/NIE) al escribir el ID de paciente. No debe bloquear la entrada (cambiaría el comportamiento determinista y podría generar falsos positivos molestos).
- **Esfuerzo:** M. **Riesgo de regresión:** Bajo si es solo advertencia no bloqueante. **Dependencia clínica:** No.

---

### HAL-11 — Sin protección frente a "CSV injection" en la exportación CSV

- **Severidad:** Baja
- **Categoría:** Seguridad
- **Archivos afectados:** `report-contract.js:163-166` (`csvCell`).
- **Evidencia:** `csvCell()` solo escapa comillas dobles; no antepone comilla simple ni neutraliza prefijos `=,+,-,@` en campos controlados por el usuario (p. ej. `patient_id`), que Excel/Sheets podrían interpretar como fórmula al abrir el CSV exportado.
- **Solución recomendada:** Anteponer `'` (comilla simple) a cualquier valor que empiece por `=`, `+`, `-` o `@` antes de escapar comillas.
- **Esfuerzo:** XS. **Riesgo de regresión:** Ninguno. **Dependencia clínica:** No.

---

### HAL-12 — Indicador de guardado (`#save-indicator`) nunca se actualiza desde `app.js`

- **Severidad:** Baja
- **Categoría:** Usabilidad
- **Archivos afectados:** `index.html:106`; ausencia de referencias en `app.js`.
- **Evidencia:** Búsqueda exhaustiva de `save-indicator`/`saveIndicator` en `app.js`: cero resultados. El elemento existe en el DOM y tiene estilo propio pero ningún código lo actualiza.
- **Impacto:** El guardado automático sí funciona (verificado), pero el usuario no recibe confirmación visual, lo que puede generar desconfianza sobre si su trabajo se está guardando.
- **Solución recomendada:** Conectar el indicador a `saveState()` (p. ej. mostrar "Guardado ✓" brevemente tras cada guardado exitoso).
- **Esfuerzo:** XS. **Riesgo de regresión:** Ninguno. **Dependencia clínica:** No.

---

### HAL-13 — Doble semántica de "número de cascadas" entre el Paso 4 y el Informe (Paso 6), sin aclaración textual

- **Severidad:** Baja
- **Categoría:** Usabilidad
- **Archivos afectados:** `app.js:1690-1692` / `app.js:2190` (Paso 4, todas las detectadas) vs `app.js:3016-3018` / `app.js:3089` (Informe, excluye las que el clínico marcó "no es cascada").
- **Evidencia:** Es un diseño intencional y documentado en el propio código (comentario `app.js:3010-3015`), no un error de cálculo — pero el mismo caso puede mostrar cifras distintas de "cascadas" en dos pantallas sin que el usuario entienda por qué.
- **Solución recomendada:** Añadir un rótulo aclaratorio en cada paso ("N detectadas automáticamente" vs "N no descartadas tras su revisión").
- **Esfuerzo:** XS. **Riesgo de regresión:** Ninguno. **Dependencia clínica:** No.

---

### HAL-14 — `#safety-toggle` sin `aria-controls`

- **Severidad:** Baja
- **Categoría:** Accesibilidad
- **Archivos afectados:** `index.html:75` (comparar con `#help-toggle`, `index.html:170`, que sí tiene `aria-controls="help-content"`).
- **Solución recomendada:** Añadir `aria-controls="safety-content"` al botón.
- **Esfuerzo:** XS. **Riesgo de regresión:** Ninguno. **Dependencia clínica:** No.

---

### HAL-15 — Invalidación de caché de `CaseModel` dependiente de disciplina manual, no de un mecanismo estructural

- **Severidad:** Baja / informativa (sin evidencia de fallo real en el commit auditado)
- **Categoría:** Robustez estructural
- **Archivos afectados:** `app.js:1411-1419` (`invalidateDetectedCascades`, `invalidateReviewedClinicalInput`).
- **Evidencia:** `state.caseModel`/`state.detectedCascades` se invalidan explícitamente en cada punto donde cambia la nota/KB/revisión — verificados todos los puntos actuales de reasignación de `state.clinicalNote`, todos invalidan correctamente hoy. El riesgo es de regresión **futura**: un nuevo punto de mutación que olvide invalidar produciría un informe con datos obsoletos sin ningún error visible.
- **Solución recomendada (para el rediseño, no urgente ahora):** Derivar la invalidación de un hash/versión del input en vez de depender de que cada punto de mutación recuerde invalidar manualmente.
- **Esfuerzo:** M. **Riesgo de regresión:** Bajo si se hace con tests de caracterización previos. **Dependencia clínica:** No.

---

### HAL-16 — `kb/kb_cascade_registry.md` desactualizado respecto a lo que el propio validador ya detecta

- **Severidad:** Baja
- **Categoría:** Documentación / Gobernanza
- **Archivos afectados:** `kb/kb_cascade_registry.md`.
- **Evidencia:** El registro (que se autodescribe como "generado automáticamente") solo documenta 2 pares fusionados (CC050→CC033, CC061→CC001) y no refleja los 9 pares que `kb_validator.js` detecta activamente hoy (ver HAL-02).
- **Solución recomendada:** Regenerar el registro incorporando la salida actual del validador antes de cualquier decisión de fusión (HAL-02), para que el documento de gobernanza refleje el estado real.
- **Esfuerzo:** XS (es un script "generado automáticamente" según su propia cabecera). **Riesgo de regresión:** Ninguno. **Dependencia clínica:** No (es un paso preparatorio para la revisión clínica de HAL-02).

---

### HAL-17 — Sin límite de longitud en `clinicalNote` al importar JSON

- **Severidad:** Baja
- **Categoría:** Seguridad / Robustez
- **Archivos afectados:** `app.js:3298-3301` (`importCase`).
- **Evidencia:** `patientId` importado se limita a ≤200 caracteres; `clinicalNote` importado no tiene límite equivalente.
- **Solución recomendada:** Añadir un límite razonable (p. ej. 20.000-50.000 caracteres) por coherencia con el resto de guardas de `importCase`.
- **Esfuerzo:** XS. **Riesgo de regresión:** Ninguno. **Dependencia clínica:** No.

---

### HAL-18 — Utilidad de auto-test de NLP (`runNlpSelfTest`) presente en el bundle de producción

- **Severidad:** Baja / informativa
- **Categoría:** Higiene de código
- **Archivos afectados:** `app.js` (~línea 3431 en adelante).
- **Evidencia:** Batería de self-tests invocable manualmente desde consola (`runNlpSelfTest()`), no alcanzable desde el flujo normal de usuario, pero presente en el código fuente servido a cualquier visitante (incluye notas clínicas sintéticas de prueba, no de pacientes reales).
- **Solución recomendada (no urgente):** Considerar moverla a un fichero de desarrollo separado no incluido en el bundle servido, en el marco del rediseño.
- **Esfuerzo:** S. **Riesgo de regresión:** Bajo. **Dependencia clínica:** No.

---

## Resumen por severidad

| Severidad | Nº hallazgos | IDs |
|---|---|---|
| Crítica | 0 | — |
| Alta | 3 | HAL-01, HAL-02, HAL-04 |
| Media | 3 | HAL-03, HAL-05, HAL-06 |
| Baja | 12 | HAL-07 a HAL-18 |
