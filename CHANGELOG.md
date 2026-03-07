# Changelog

Todos los cambios notables de este proyecto se documentan en este fichero.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.0.0/).
El versionado del software sigue [Semantic Versioning](https://semver.org/lang/es/).

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
