# Auditoría de los defectos restantes del motor clínico

Fecha: 2026-09-14. Rama de trabajo: `fix/medication-negation-interaction-specificity`.

## Alcance revisado y reproducción

Se revisaron `clinical-engine.js`, la presentación y exportación de `app.js`, el diccionario de medicamentos, las combinaciones, las reglas de cascada y DDI de los tracks `prod` y `dev`, y el ejecutor completo de pruebas. El caso obligatorio reproducía los defectos descritos antes de este cambio: el resolver devolvía toda coincidencia léxica como medicamento y `buildCaseModel` asignaba incondicionalmente `current_status: "active"`; por ello «No toma metformina» entraba en cascadas, carga, grupos y alertas.

## Causas raíz

1. **Estado de la medicación:** `resolveDrugMentions` era un resolver léxico sin análisis de aserción. El modelo final era una lista plana, deduplicada por principio activo, y fijaba todos los estados a activo. No existía un filtro central anterior al razonamiento.
2. **Interacción específica:** `VIH003` admitía como fármaco índice dolutegravir, bictegravir o raltegravir, pero adjuntaba un texto fijo de dolutegravir si encontraba metformina. Además, `DDI003` agrupaba DTG/BIC en una regla que no declaraba formalmente su alcance.
3. **Taxonomía:** las clases de rol de las cascadas podían ganar al diccionario aun cuando este era más específico. La etiqueta de regla conjunta `Boosted PI / INSTI` llegaba así a la presentación.
4. **Acciones:** el texto estático `recommended_first_action`/`clinical_note` se renderizaba directamente en las tarjetas de los pasos 4 y 5 y se copiaba directamente al informe, sin considerar la clasificación automatizada. El resumen ya filtraba parcialmente, pero las demás superficies no compartían esa política.
5. **Desfase de posiciones:** los offsets del resolver corresponden al texto normalizado (sin diacríticos), por lo que no podían usarse directamente para determinar el alcance contextual. Ahora se proyectan sobre el texto clínico antes de clasificar la mención.

## Diseño aplicado

- Cada mención conserva nombre original y normalizado, identificador, marca, aserción, estado, temporalidad, fechas, evidencia, fuente, confianza y clase. `isActiveMedication` es la única puerta de actividad.
- El modelo expone `allMedicationMentions`, `activeMedications`/`medications` e `inactiveOrNegatedMedications`. Solo las menciones activas se entregan a cascadas, alertas, carga anticolinérgica, duplicidad, clases e interacciones.
- El alcance se calcula por cláusulas y conjunciones adversativas: una coordinación con «ni» conserva la negación, mientras «pero (sí)» abre una cláusula afirmativa. Suspensión, historia, propuesta y condición se distinguen de tratamiento actual.
- `evaluateCurrentInteractions` exige coincidencia exacta de participantes para `ingredient_specific`; las reglas de clase solo pueden usar esa vía si declaran `class_based`, y las de régimen quedan reservadas a un matcher explícito. `DDI003` y el aviso embebido de `VIH003` exigen dolutegravir y metformina activos.
- El diccionario es autoritativo para la taxonomía visible. Bictegravir, dolutegravir y raltegravir son `Unboosted INSTI`; lopinavir/ritonavir es `Boosted PI`.
- `getRecommendationPresentation` centraliza la acción aplicable. Solo una señal sustentada o validada profesionalmente expone la acción específica. Las incompletas solicitan verificación; las coincidencias farmacológicas piden problema y cronología; las no evaluables solicitan datos esenciales; las descartadas indican que no procede intervenir. La acción teórica se conserva separada en el objeto de presentación.

## Límites y validación clínica pendiente

El análisis es deliberadamente determinista y local, no un parser clínico completo. Construcciones anafóricas complejas, listas extensas con puntuación atípica o múltiples cambios de estado del mismo principio activo pueden requerir revisión profesional. Las reglas marcadas `regimen_based` no se activan hasta disponer de un matcher de régimen explícito. La decisión bibliográfica de incorporar en el futuro una interacción propia de bictegravir debe realizarse como una regla distinta, respaldada y con texto propio; no se infiere aquí. Las traducciones visibles de clases se mantienen en la nomenclatura técnica actual de la aplicación y pueden requerir validación terminológica clínica.
