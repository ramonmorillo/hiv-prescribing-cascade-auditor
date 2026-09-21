# 00 — Resumen ejecutivo

**Objeto:** auditoría técnica, clínico-estructural y de producto del *HIV Prescribing Cascade Auditor*, previa a su rediseño web y ampliación de uso. Auditoría de solo análisis: no se ha modificado código de producción, no se han fusionado reglas de KB, no se ha abierto PR de corrección.

**Alcance auditado:** rama `claude/compassionate-ptolemy-tra64o`, equivalente en el commit auditado a `main` (`40feac2`). Working tree limpio en todo momento.

**Metodología:** ejecución completa de la suite de tests (dos veces, inicio y cierre), lectura directa y ejecución reproducible contra `clinical-engine.js`/`kb/` (no solo lectura de README/CHANGELOG), inspección línea a línea de `app.js` para verificar (no asumir) la separación motor/interfaz, y tres revisiones especializadas en paralelo (KB, seguridad/privacidad, usabilidad/accesibilidad/i18n) con evidencia archivo:línea reproducible en todos los casos.

## Qué funciona correctamente (con evidencia)

- **2045 aserciones automatizadas, 0 fallos, sin advertencias**, en las dos ejecuciones de esta auditoría (`node tests/run.js`). CI (`clinical-regression.yml`) exige lo mismo en cada PR/push a `main`.
- **La separación motor/interfaz es real, no solo declarada.** Se verificó exhaustivamente que `app.js` no reimplementa lógica clínica: es una capa de UI/estado que delega el 100% del razonamiento en `clinical-engine.js` (módulo DOM-free, exportado vía UMD, ejercitado por los mismos tests que corren en Node y en el navegador).
- **Una sola fuente de verdad para el informe**: `buildReport()` alimenta pantalla, texto clínico, JSON y CSV; el PDF es una impresión del propio DOM del informe, no una plantilla paralela. No se ha encontrado bifurcación de cálculo entre superficies.
- **El motor nunca confirma causalidad automáticamente.** La clasificación más fuerte posible es `supported_possible_cascade` ("posible cascada con evidencia suficiente para revisión"); la palabra "confirmada" está reservada exclusivamente al veredicto manual del clínico (Paso 5), estructuralmente separado de la clasificación automática (sistema de 4 dimensiones).
- **Postura de seguridad sólida para una app 100% cliente:** CSP restrictiva (`script-src 'self'`, sin `unsafe-eval`), función de escape (`escHtml`) aplicada consistentemente (88 usos) en todos los puntos de interpolación de texto clínico verificados, sin `innerHTML`/`insertAdjacentHTML` sin escapar, sin dependencias npm de terceros, sin secretos en el repositorio, sin riesgo práctico de contaminación de prototipo en la importación JSON.
- **Cobertura de test excepcionalmente densa** para un prototipo de investigación: casos negativos, temporalidad, revisión profesional confirmada/borrador/obsoleta, exportación/importación, paridad ES/EN — 23 suites especializadas.
- **Gobernanza documentada y activa**, no aspiracional: `RELEASE_GATES.md`, `PRODUCT_BASELINE.md` y un historial de auditorías previas del propio equipo (`docs/clinical-engine-fix-audit.md`, `docs/remaining-clinical-engine-fixes.md`) que ya corrigieron defectos de la misma naturaleza que los que esta auditoría busca — es decir, el proyecto ya tiene un proceso de mejora continua funcionando, no es la primera vez que se audita.

## Qué puede producir resultados incorrectos (con evidencia y reproducción)

- **HAL-01 (alta):** frases habituales de discontinuación en español — "dejó de tomar X", "ya no lo/la toma" — no se reconocen; el fármaco permanece clasificado como activo y puede generar una cascada con un fármaco que el propio texto dice que ya no se toma. Reproducido con entrada y salida exactas (doc 02).
- **HAL-02 (alta):** 9 pares de reglas de cascada casi-duplicadas siguen activas e independientes en el catálogo de producción; se ha demostrado con una nota reproducible que esto produce 3 tarjetas clínicas distintas y con clasificaciones contradictorias (`supported_possible_cascade`, `possible_but_incomplete`, `pharmacological_match_only`) para la misma relación fármaco-problema-fármaco.

## Qué puede confundir al profesional

- **HAL-04 (alta):** contraste insuficiente (WCAG 1.4.3) en la mayoría de estados de las insignias de las 4 dimensiones de clasificación — precisamente el componente que distingue a esta herramienta de un simple listado de alertas.
- **HAL-13/HAL-03 (baja/media):** doble conteo de "cascadas" entre el Paso 4 y el Informe sin aclaración textual; posible mezcla de contenido en inglés sin aviso si un usuario activa el entorno DEV desde el panel de herramientas.
- **HAL-05, HAL-12 (media/baja):** toasts que desaparecen a los 4s sin control, e indicador de guardado que nunca se activa — generan incertidumbre sobre si el trabajo se ha guardado, aunque el guardado real funciona correctamente.

## Qué requiere validación clínica (no confirmado ni descartado por esta auditoría)

- Las 9 decisiones de fusión/diferenciación de HAL-02.
- Las 50 reglas de `kb_core_cascades.json` (CC041–CC090) y 5/6 de `clinical_problems.json` sin referencia bibliográfica — ya reconocido como "pendiente de revisión clínica" por el propio proyecto, aquí cuantificado con exactitud.
- 99 fármacos con redacción de clase farmacológica inconsistente entre `kb_core_cascades.json`/`kb_vih_modifiers.json` (posible variación de granularidad legítima, no confirmada como error).
- Cualquier afirmación de sensibilidad/especificidad del motor — no medida en esta auditoría ni en el proyecto hasta la fecha; propuesta como trabajo futuro (matriz de validación, doc 05).

## Qué debe corregirse antes de la futura web

Ver bloqueadores obligatorios (§ Clasificación final) y roadmap completo en `05-roadmap-pre-web.md`.

## Veredicto

# LISTA CONDICIONADA

El núcleo clínico (motor + arquitectura de datos + suite de pruebas + gobernanza documental) es sólido, está verificado con evidencia reproducible y no requiere reescritura. **No es apto todavía** para presentarse sin condiciones como base de "una referencia internacional" porque existen contradicciones activas y demostrables en el catálogo clínico (HAL-02) y un defecto de reconocimiento de lenguaje con impacto clínico directo (HAL-01), ambos de esfuerzo de corrección bajo-medio y ya localizados con precisión archivo:línea. Ninguno de los 18 hallazgos alcanza severidad crítica: no hay pérdida de datos, mezcla de pacientes, ni un falso negativo estructural que oculte una cascada real: el patrón de riesgo dominante es el falso positivo o la confusión de interfaz, siempre bajo la salvaguarda de la revisión profesional obligatoria que el propio diseño exige.

### Bloqueadores obligatorios antes del rediseño

1. HAL-01 — patrones de discontinuación no reconocidos (motor clínico).
2. HAL-02 — revisión clínica y resolución de los 9 pares de reglas casi-duplicadas.
3. HAL-16 — regenerar el registro de gobernanza de la KB (paso previo barato e imprescindible para 2).
4. HAL-08 — corregir o retirar el documento de metodología que describe una arquitectura ficticia de "5 agentes".
5. HAL-04 — corregir el contraste de las insignias de clasificación clínica.

### Mejoras que pueden realizarse durante el rediseño

HAL-05, HAL-06, HAL-11, HAL-12, HAL-13, HAL-14, HAL-15, HAL-17, HAL-18, y el aislamiento formal de `UI_STRINGS`/esquemas de `CaseModel`/`report` (doc 05, §3-4).

### Mejoras que deben aplazarse

Cifrado en reposo de `localStorage` (HAL-09), detección activa de patrones de identificación personal (HAL-10), traducción completa del track DEV salvo el aviso XS inmediato (HAL-03), y — como decisión de producto separada, no una extensión incremental — la ampliación de alcance a una plataforma de seguimiento farmacoterapéutico longitudinal en VIH (doc 05, §10).

### Los cinco casos clínicos "golden"

1. Caso demo completo.
2. Amlodipino → edema → furosemida (CC004 canónica, CC041 fusionada, SYM008 como evidencia auxiliar).
3. Symtuza en sus 3 formas de escritura.
4. Indicación alternativa documentada (descarte correcto, no falso positivo).
5. Caso sin cascada / nota no clínica (camino negativo, `CaseModel` vacío bien formado).

## Verificación de cierre de esta auditoría

- `node tests/run.js` re-ejecutado al cierre: 2045 aserciones, 0 fallos, idéntico al resultado inicial.
- `git diff --stat` antes de publicar los documentos de auditoría: sin cambios (ningún archivo de producción fue modificado durante el análisis).
- Ningún PR de implementación fue abierto.

## Limitaciones generales de esta auditoría

- No se ha podido comparar la aplicación publicada en GitHub Pages con `main`: acceso de red bloqueado por la política del entorno de auditoría (`EGRESS_BLOCKED` a `ramonmorillo.github.io`). Pendiente de verificación manual por el equipo del proyecto.
- No se ha ejecutado verificación manual en navegador (Playwright/similar): toda la evidencia de comportamiento del motor es vía Node, igual que la suite oficial. El propio historial del repositorio documenta que al menos un defecto solo era visible en navegador — este tipo de defecto no puede descartarse sin esa verificación, fuera del alcance ejecutable de este entorno.
- No se han ejercitado las 90+33 reglas de cascada una por una con notas sintéticas exhaustivas; el foco se puso en los casos de mayor riesgo y en los explícitamente solicitados.
- No se ha medido sensibilidad/especificidad del motor frente a un corpus clínico anotado — no existe ese corpus todavía; se propone como trabajo futuro, no se inventa una cifra.
- Los hallazgos de contraste (HAL-04) y demás observaciones de accesibilidad son análisis estático (cálculo de ratio de luminancia sobre el código fuente), no una auditoría WCAG certificada con herramientas dinámicas ni con usuarios reales con discapacidad.
- Esta auditoría no constituye evaluación regulatoria (Reglamento UE 2017/745), ni evaluación RGPD formal, ni certificación de seguridad — se señalan explícitamente los puntos que las requerirían (doc 05, §9) sin sustituirlas.

## Índice de documentos de esta auditoría

1. `00-resumen-ejecutivo.md` (este documento)
2. `01-arquitectura-y-flujo-datos.md`
3. `02-registro-hallazgos.md`
4. `03-auditoria-kb.md`
5. `04-matriz-pruebas.md`
6. `05-roadmap-pre-web.md`
