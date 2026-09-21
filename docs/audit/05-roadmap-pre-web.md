# 05 — Preparación para la futura web y roadmap

## 1. Qué partes del núcleo clínico pueden conservarse

Sin reservas: **la arquitectura de separación motor/KB/interfaz/informe ya existe y funciona** — no es una aspiración, es el estado verificado del commit auditado.

- `clinical-engine.js` (2783 líneas, DOM-free, exportado vía UMD): puede conservarse íntegramente como motor de razonamiento. Es la única fuente de lógica clínica, ya verificado (doc 01 §3).
- `report-contract.js`: contrato único, versionado, DOM-free, que alimenta pantalla/texto-clínico/CSV/JSON. Reutilizable tal cual detrás de cualquier interfaz nueva.
- `reviewed-input-adapter.js`, `medication-review.js`, `problem-review.js`: módulos independientes, con contrato documentado (`docs/REVIEWED_INPUT_CONTRACT.md`) y cobertura de test propia. Reutilizables.
- `kb/prod/*.json` + `kb/drug_dictionary.json` + `kb/drug_combinations.json`: contenido clínico curado, reutilizable, con las reservas de HAL-02 (near-duplicados pendientes de revisión clínica antes de presentarse como "referencia internacional") y HAL-03 (DEV no debe exponerse tal cual).
- La suite de 2045 aserciones (`tests/`): es el activo más valioso para un rediseño seguro — permite reescribir la interfaz sin miedo a romper el razonamiento clínico, siempre que se mantenga verde en cada paso.

**No se recomienda reescribir el motor clínico.** No hay evidencia técnica que lo justifique: es DOM-free, está probado exhaustivamente, y su diseño (nunca confirma causalidad, siempre exige revisión profesional) es exactamente el que un producto de apoyo a la decisión necesita. Reescribirlo sin necesidad introduciría riesgo sin beneficio.

## 2. Deuda técnica a corregir antes del rediseño (no durante, no después)

Estos son los hallazgos que, si se dejan para "arreglar sobre la marcha" durante el rediseño de la interfaz, contaminarían el punto de partida de la nueva web:

1. **HAL-01** (fármacos discontinuados mal clasificados como activos) — es un defecto del motor, no de la interfaz; corregirlo después de rediseñar la UI significaría rediseñar sobre datos potencialmente incorrectos.
2. **HAL-02** (9 pares de reglas casi-duplicadas) — si la nueva web se presenta como "referencia internacional", debe partir de un catálogo clínico sin contradicciones demostrables como la del caso amitriptilina/estreñimiento/macrogol.
3. **HAL-16** (registro de gobernanza desactualizado) — paso previo barato (script ya existe) e imprescindible para poder ejecutar HAL-02 con información completa.
4. **HAL-08** (documento de metodología describe una arquitectura de "5 agentes" ficticia) — si no se corrige antes, es el tipo de documento que fácilmente se convierte en la base del "cómo funciona" de la web pública, propagando una descripción falsa de la arquitectura real.
5. **HAL-04** (contraste insuficiente en las insignias clínicas) — si el rediseño reutiliza o migra estos componentes visuales sin corregirlos primero, arrastra el incumplimiento de accesibilidad a la nueva base de código.

## 3. Componentes a aislar (ya lo están en gran medida; formalizar el contrato)

| Componente | Estado actual | Acción recomendada antes de exponerlo a un rediseño de interfaz |
|---|---|---|
| Motor clínico (`clinical-engine.js`) | Aislado, DOM-free, UMD | Ninguna estructural; corregir HAL-01 |
| KB (`kb/`) | Aislada en JSON versionado | Resolver HAL-02/HAL-03/HAL-16 antes de "congelar" el catálogo como base pública |
| Informe (`report-contract.js`) | Aislado, contrato versionado | Ninguna; es el mejor candidato para reutilizar sin cambios |
| Persistencia (`saveState`/`loadState`) | Acoplada a `app.js` (no es un módulo propio) | Extraer a un módulo de persistencia con la misma interfaz, para poder sustituir `localStorage` por otra estrategia (p. ej. IndexedDB para notas largas) sin tocar el resto |
| Traducciones (`ui-static-i18n.js` + `UI_STRINGS` embebido en `app.js`) | Parcialmente aislado — `ui-static-i18n.js` es un módulo propio (67 claves, 100% paridad ES/EN verificada), pero `UI_STRINGS` (339 claves, también 100% paridad) vive dentro de `app.js` | Antes del rediseño, extraer `UI_STRINGS` a su propio módulo junto a `ui-static-i18n.js`, para que la nueva interfaz pueda consumir las traducciones sin heredar el resto de `app.js` |
| Interfaz (`app.js` UI/estado/render) | Deliberadamente NO reutilizable — es el código a sustituir en el rediseño | Ninguna acción de aislamiento necesaria; es justo lo que cambia |

## 4. Contratos de datos que deben estabilizarse antes del rediseño

- **`CaseModel`** (salida de `buildCaseModel`): ya es el contrato de facto entre motor e interfaz. Recomendación: documentarlo formalmente (tipos/JSDoc o esquema JSON) como haría cualquier API pública, dado que la nueva interfaz dependerá de él igual que `app.js` hoy.
- **Objeto `report`** (salida de `buildReport()` + `ReportContract.enrich`): ya versionado internamente; formalizar su esquema como contrato estable de cara a la nueva interfaz y a cualquier futura integración (p. ej. exportación a un sistema externo, si algún día se decide, lo cual está fuera del alcance actual).
- **Formato de exportación JSON de caso** (`exportJSON`/`importCase`): ya tiene guardas de tipo; formalizarlo como esquema documentado (JSON Schema) es la mejora de esfuerzo XS-S recomendada también en HAL-17.
- **`state.cascadeClassifications` y `CASCADE_ID_MIGRATIONS`**: el mecanismo de migración de IDs de regla renombradas/fusionadas debe mantenerse operativo durante todo el proceso HAL-02 (cada fusión clínica nueva necesita su entrada de migración, igual que CC050→CC033 y CC061→CC001).

## 5. Pruebas que deben impedir regresiones durante el rediseño

- **Mantener `node tests/run.js` en verde en cada PR** (ya forzado por CI, `RELEASE_GATES.md`) — es la única protección real de que el rediseño de interfaz no altera el razonamiento clínico.
- Añadir los tests puntuales identificados como huecos de cobertura durante esta auditoría antes de tocar la interfaz: HAL-01 (discontinuación), HAL-07 (Symtuza sin marca).
- Verificación manual en navegador (no solo Node) en cada paso del rediseño: la propia auditoría previa del repositorio (`docs/clinical-engine-fix-audit.md` §6.2) documenta una regresión que **solo era visible en navegador**, nunca en la suite de Node. El rediseño de interfaz es exactamente el escenario de mayor riesgo para este tipo de defecto.
- Los 5 casos "golden" del §6 deben ejecutarse, en Node y en navegador, contra cada versión candidata de la nueva interfaz.

## 6. Los cinco casos clínicos "golden"

Seleccionados por cubrir, entre los cinco, la mayor superficie de capacidades del motor con el menor solapamiento entre sí — no son los únicos casos de regresión importantes (ver doc 04 para la lista completa), pero son el conjunto mínimo que, si se mantiene estable, da garantía razonable de que el motor sigue funcionando correctamente durante toda la evolución del proyecto:

1. **Caso demo completo** (`loadDemoCase()`) — valida la integración de múltiples fármacos, FDC, clasificación completa y ausencia de excepciones en un caso realista de complejidad media-alta.
2. **Amlodipino → edema → furosemida** — valida la consolidación de señales casi-duplicadas/relacionadas (CC004 canónica, CC041 fusionada inactiva, SYM008 como evidencia auxiliar) en una única tarjeta con cronología explícita — la capacidad más compleja y más frágil del motor.
3. **Symtuza en sus 3 formas de escritura** (marca sola / composición sola / composición + marca) — valida la expansión de combinaciones a dosis fija y la resolución de sinónimos ES/EN, con clasificación farmacológica autoritativa del diccionario.
4. **Indicación alternativa documentada** (p. ej. enalapril por insuficiencia cardíaca, no por HTA inducida por AINE) — valida que el motor descarta correctamente una cascada cuando existe una explicación clínica alternativa explícita, en vez de presentar un falso positivo.
5. **Caso sin cascada / nota no clínica** — valida el camino negativo: `CaseModel` vacío y bien formado, sin errores, sin medicación ni problemas ni cascadas inventadas.

## 7. Funcionalidades esenciales para una versión pública inicial (MVP web)

- Los 6 pasos actuales del wizard (Datos → Medicación → Clasificación → Cascadas → Plan → Informe), con las correcciones de accesibilidad de HAL-04/HAL-05/HAL-14.
- Bilingüismo ES/EN completo (ya al 100% en los diccionarios estáticos; corregir HAL-06 para el caso demo).
- Exportación JSON/CSV/texto-clínico/PDF-por-impresión (ya funcional, con la mejora XS de HAL-11).
- El sistema de 4 dimensiones de etiqueta (relevancia potencial / validación de conocimiento / evaluación automática / validación profesional) — es la seña de rigor diferencial del producto; debe llegar a la web con el contraste corregido (HAL-04), no simplificado.
- Aviso de privacidad/seudonimización y modelo local-first, tal cual existen hoy (HAL-09/HAL-10 documentan el riesgo residual, no exigen rediseño del modelo de datos).

## 8. Funcionalidades que deben aplazarse

- Cifrado en reposo de `localStorage` (HAL-09) — desproporcionado sin una necesidad demostrada; revisar solo si la validación RGPD formal lo exige.
- Detección activa de patrones de identificación personal (HAL-10) — mejora de esfuerzo medio, prioridad baja, no bloqueante.
- Traducción completa del track DEV (HAL-03) — solo si se decide seguir exponiendo DEV a usuarios finales; alternativa de esfuerzo XS (aviso) resuelve el riesgo inmediato sin necesitar la traducción completa.
- Cualquier forma de integración con historia clínica electrónica, backend, cuentas de usuario o sincronización entre dispositivos — fuera del baseline actual (`docs/PRODUCT_BASELINE.md`) y sin justificación de privacidad/seguridad presentada; no se recomienda introducir sin ese análisis explícito.
- Ampliación del alcance de auditor de cascadas a plataforma de seguimiento longitudinal del paciente — ver §9, es un proyecto distinto, no una extensión incremental.

## 9. Qué requeriría validación clínica multicéntrica

- Las 9 decisiones de fusión/diferenciación de HAL-02 (revisor clínico independiente del autor, por regla, según `RELEASE_GATES.md`).
- Las 50 reglas de `kb_core_cascades.json` (CC041–CC090) sin referencia bibliográfica, y las 5/6 de `clinical_problems.json` — antes de presentar el catálogo como "revisado" en cualquier comunicación pública.
- Cualquier afirmación de sensibilidad/especificidad del motor: esta auditoría **no ha medido** falsos positivos/negativos de forma sistemática frente a un corpus anotado por expertos — solo ha verificado comportamiento puntual en los casos priorizados. Una matriz de validación formal (positivos, negativos, límite, adversariales) es trabajo futuro, no un resultado de esta auditoría.
- La propia tesis doctoral de fundamento (SANPAT, mencionada en `index.html`) y el registro de comité de ética citado (SICEIA-2025-002829) son la vía natural para ese trabajo — no evaluados aquí por ser documentación externa al repositorio.

## 10. Qué se necesitaría para pasar de "auditor de cascadas" a una plataforma de seguimiento farmacoterapéutico más amplia en VIH

**Esto es una ampliación de alcance, no una extensión incremental del producto actual — se separa aquí explícitamente por instrucción del encargo, y su necesidad debe justificarse de forma independiente antes de planificarla:**

- Requeriría persistencia longitudinal por paciente (hoy el modelo es deliberadamente "un caso a la vez", sin histórico entre visitas) — esto por sí solo es un cambio de modelo de datos y muy probablemente de arquitectura (¿sigue siendo local-first viable con múltiples pacientes y múltiples visitas por paciente en el tiempo, o empieza a justificarse un backend con las implicaciones de seguridad/RGPD que eso conlleva?).
- Requeriría una decisión explícita de privacidad/seguridad para ese backend (contradiría el actual "sin servidor, sin transmisión" que hoy es una garantía de privacidad fuerte y sencilla de auditar).
- Requeriría clasificación regulatoria bajo el Reglamento (UE) 2017/745 revisada desde cero, dado que el alcance de "apoyo a la decisión puntual" es clínicamente distinto de "seguimiento longitudinal" (`docs/PRODUCT_BASELINE.md` ya señala que la clasificación regulatoria está pendiente incluso para el alcance actual).
- Requeriría ampliar la KB más allá de cascadas de prescripción (adherencia, resultados en salud, otros dominios de MAPEX/CMO) — contenido no existente hoy y fuera de la curación actual.
- **No se recomienda planificar esta ampliación como parte del rediseño web actual.** Debe tratarse como una decisión de producto separada, con su propio análisis de necesidad, alcance y viabilidad — mezclarla con el rediseño de la web del auditor de cascadas arriesga retrasar o complicar innecesariamente ambos objetivos.

## 11. Roadmap dividido en PRs pequeños

| Orden | PR | Objetivo único | Archivos previstos | Pruebas necesarias | Riesgo |
|---|---|---|---|---|---|
| 1 | PR-A | Corregir patrones de discontinuación no reconocidos (HAL-01) | `clinical-engine.js` | Nuevo caso en `negative-cases.test.js` o `medication-status-interactions.test.js` + regresión completa | Bajo |
| 2 | PR-B | Regenerar `kb/kb_cascade_registry.md` desde el validador (HAL-16) | `kb/kb_cascade_registry.md` (o el script que lo genera) | Ninguna (solo documentación) | Ninguno |
| 3 | PR-C | Normalizar ortografía UK/US en `ade_en` de `kb_core_cascades.json` (soporte técnico de HAL-02) | `kb/prod/kb_core_cascades.json`, `kb/dev/kb_core_cascades.json` | Regresión completa; revalidar que el validador detecta los 9 pares en ambos tracks | Bajo |
| 4 | PR-D | Decisión clínica y edición de los 9 pares casi-duplicados (HAL-02) | `kb/prod/kb_core_cascades.json`, `kb/dev/kb_core_cascades.json`, `kb_cascade_registry.md` | Caso de aceptación por par + regresión completa | Medio — requiere revisor clínico independiente |
| 5 | PR-E | Corregir contraste de insignias de clasificación (HAL-04) | `app.js` (funciones de insignia), posiblemente `styles.css`/`theme-siafcmo.css` | Verificación de contraste (herramienta estándar) + regresión visual manual | Bajo |
| 6 | PR-F | Toast con pausa/tiempo mínimo + `#save-indicator` conectado + `aria-controls` en `#safety-toggle` (HAL-05, HAL-12, HAL-14) | `app.js`, `index.html` | Regresión completa + verificación manual en navegador | Bajo |
| 7 | PR-G | Protección CSV injection en `csvCell()` (HAL-11) | `report-contract.js` | `report-contract.test.js` ampliado | Ninguno |
| 8 | PR-H | Aviso al seleccionar entorno DEV (HAL-03, parte XS) | `app.js`, `index.html` | Verificación manual | Bajo |
| 9 | PR-I | Reescribir/retirar `methodology/pipeline_spec_v1.0.md` (HAL-08) | `methodology/pipeline_spec_v1.0.md` | Ninguna | Ninguno |
| 10 | PR-J | Test dedicado para Symtuza sin marca + límite de longitud en `clinicalNote` importado (HAL-07, HAL-17) | `tests/fixed-dose-classification.test.js`, `app.js` | Regresión completa | Ninguno |
| 11 | PR-K | Caso demo en inglés (HAL-06) | `app.js` | Nuevo caso en `demo-case-regression.test.js` para la variante EN | Bajo-Medio — requiere validación clínica de la nota EN |
| 12 | PR-L (posterior, no bloqueante) | Extraer `UI_STRINGS` a módulo propio junto a `ui-static-i18n.js`; formalizar esquema de `CaseModel`/`report` (§3-4) | `app.js`, nuevo módulo de traducciones, documentación de esquema | Regresión completa | Bajo — refactor mecánico con red de pruebas existente |
| 13 | PR-M (posterior, no bloqueante) | Traducción completa del track DEV o retirada de su exposición pública (HAL-03, parte L) | `kb/dev/kb_core_cascades.json` o `app.js`/`index.html` | Regresión completa + revisión terminológica | Medio |

Los PR 1-9 son los recomendados **antes** de iniciar el rediseño visual (bloqueadores según doc "Clasificación final"); 10-11 pueden hacerse en paralelo; 12-13 son limpieza estructural recomendada durante el rediseño, no antes.
