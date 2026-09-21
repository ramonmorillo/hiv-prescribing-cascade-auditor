# 03 — Auditoría de la base de conocimiento (KB)

Metodología: verificación automatizada con dos vías independientes y cruzadas — (a) el validador de gobernanza ya existente en el repositorio (`kb/dev/kb_validator.js::validateKBOperational`, invocado como módulo Node sin dependencias externas) y `kb/dev/validate_extended_kb.js` (con CLI propia), y (b) scripts Node ad-hoc de solo lectura para los chequeos no cubiertos por las herramientas existentes. Ningún archivo del repositorio fue modificado; `kb/dev/merge_cascades.js` (destructivo, sobrescribe `kb_core_cascades.json` in-place) **no se ejecutó**, solo se leyó su código.

Todos los 17 ficheros JSON de `kb/` parsean como JSON válido — sin errores de carga en ningún archivo.

## 1. Resumen numérico por comprobación

| # | Comprobación | Resultado |
|---|---|---|
| 1a | IDs duplicados dentro de cada archivo (7 pares prod/dev: ade_treatment_map, clinical_problems, ddi_watchlist, kb_clinical_modifiers, kb_core_cascades, kb_symptoms, kb_vih_modifiers) | 0 en los 14 ficheros |
| 1b | `drug_dictionary.json` (246 entradas): `canonical` duplicados / variantes compartidas / variantes que coinciden con otro canonical | 0 / 0 / 0 |
| 1c | `drug_combinations.json` (12 FDC): brand/alias duplicados | 0 |
| 1d | Referencias cruzadas rotas (`source_cascade_ids`, `merged_into`/`merged_from`) | 0 en prod y dev |
| 2 | Campos "de facto" obligatorios ausentes de forma aislada/atípica | 0 (las ausencias reales son estructurales — ver §3 — no errores puntuales) |
| 3 | Ficheros PROD vs DEV idénticos byte a byte | 6 de 7 (todos excepto `kb_core_cascades.json`) |
| 4 | Reglas casi-duplicadas activas (validador, umbral idx≥0.75 ∧ casc≥0.75 ∧ problema≥0.5) | PROD: 9 pares · DEV: 5 pares (ver §4) |
| 5 | Asimetrías ES/EN en campos bilingües | PROD kb_core_cascades: 0 · DEV kb_core_cascades: 146 (estructural) · kb_vih_modifiers ddi_warning: 0 |
| 6 | Fármacos en ejemplos de reglas sin entrada en `drug_dictionary`/`drug_combinations` | 208 términos únicos → 151 fármacos simples genuinamente ausentes, 6 combinaciones no registradas como FDC, 51 falsos positivos (frases no farmacológicas) |
| 7 | FDC registrada también como principio activo simple (doble-registro incorrecto) | 0 casos |
| 8 | Reglas DDI con entidades requeridas no resolubles contra el diccionario | 63 términos (mezcla de clases genéricas y fármacos individuales ausentes) sobre 60 reglas, todas en formato texto libre `drug_a`/`drug_b` (sin campo estructurado de entidades, salvo 5/33 reglas VIH con `ddi_required_drugs`, 0 sin resolver) |
| 9 | Reglas activas sin referencia bibliográfica | `kb_core_cascades`: 50/90 (CC041–CC090) · `ddi_watchlist`: 60/60 (el esquema no tiene campo de referencia) · `clinical_problems`: 5/6 |

## 2. Diferencias PROD vs DEV (único archivo no idéntico: `kb_core_cascades.json`)

Mismo recuento (90=90) y mismos IDs en ambos tracks; difieren 5 campos en 246 celdas:

| Campo ausente en DEV (presente en PROD) | Nº de reglas | IDs |
|---|---|---|
| `ade_es` | 40 | CC001–CC040 |
| `ade_mechanism_es` | 40 | CC001–CC040 |
| `name_es` | 28 | CC013–CC040 |
| `recommended_first_action_es` | 88 | Todas excepto CC001, CC004 |
| `recommended_first_action_en` (ausente en **ambos** tracks) | 50 | CC041–CC090 — nunca mapeado desde `prescribing_cascades_CC041_CC090_FINAL.json` por `merge_cascades.js` |

Este patrón (DEV = borrador parcialmente traducido, PROD = versión completada) está reconocido de forma agregada en `kb/CHANGELOG.md` (v2.0.0, v2.3.0); esta auditoría aporta el detalle exhaustivo de IDs por primera vez. El validador operacional cubre estas ausencias con fallback EN→ES automático, por lo que la aplicación no se rompe en DEV — pero ver HAL-03 (doc 02) para el efecto colateral sobre la detección de casi-duplicados y la exposición sin aviso al usuario final.

`kb/dev/prescribing_cascades_CC041_CC090_FINAL.json` (50 entradas, CC041–CC090): sus 50 IDs están correctamente fusionados en ambos tracks, con 0 discrepancias de contenido en `index_drug_examples`/`cascade_drug_examples` — `merge_cascades.js` cumplió su función de integridad de fármacos correctamente, aunque no mapeó `recommended_first_action_en` (ver arriba).

## 3. Reglas casi-duplicadas — tabla de candidatos para revisión clínica (no fusionar automáticamente)

Ver tabla completa con solapamientos exactos y campos comparados en **HAL-02** (`02-registro-hallazgos.md`). Resumen de los 9 pares activos en PROD: **CC003/CC042** (tos por IECA), **CC007/CC045** (hiperuricemia por tiazida), **CC013/CC070** (estreñimiento anticolinérgico), **CC019/CC082** (disfunción sexual ISRS/ISRN), **CC023/CC053** (hiperprolactinemia antipsicótica), **CC025/CC079** (hipomagnesemia por diurético de asa), **CC026/CC068** (hipomagnesemia por IBP), **CC027/CC067** (edema por gabapentinoide), **CC028/CC065** (irritación GI por bisfosfonato). En 6 de los 9 pares, la lista de fármacos de cascada es prácticamente idéntica (solapamiento 1.00) y el problema intermedio es el mismo concepto clínico expresado con distinto nivel de detalle.

**Hallazgo adicional sobre el propio mecanismo de detección:** en DEV solo se detectan 5 de estos 9 pares porque (a) 4 de los 40 rules sin `ade_es` caen exclusivamente en la comparación por `ade_en`, y (b) esa comparación en inglés falla por una inconsistencia de ortografía UK/US dentro del propio `kb_core_cascades.json` (p. ej. `"Hyperprolactinaemia..."` en una regla vs `"hyperprolactinemia"` en su par, dando solapamiento de tokens = 0.00 pese a ser la misma palabra). Los pares CC023/CC053, CC025/CC079, CC026/CC068 y CC028/CC065 no generan aviso en DEV por este efecto compuesto — recomendación de bajo esfuerzo: normalizar la ortografía (`-ae-` vs `-e-`) en `ade_en` de todo `kb_core_cascades.json`, independientemente de la decisión de fusión.

`kb/kb_cascade_registry.md` — que se autodescribe como "generado automáticamente" durante una auditoría previa (2026-09-14) — solo documenta 2 pares ya fusionados (CC050→CC033, CC061→CC001) y **no** refleja estos 9 pares que el propio validador ya detecta y deja activos; ver HAL-16.

## 4. Coherencia de clases farmacológicas, principios activos y sinónimos

- **Diccionario de fármacos (`drug_dictionary.json`, 246 entradas) es internamente coherente:** sin `canonical` duplicados, sin variantes/sinónimos compartidos entre más de un principio activo, sin solapamiento entre `variants` y otro `canonical`.
- **Combinaciones a dosis fija (`drug_combinations.json`, 12 FDC):** ninguna registrada simultáneamente como principio activo simple (0 casos de doble-registro) — confirma y amplía lo ya cubierto por `tests/fixed-dose-classification.test.js`. 28 casos de un ingrediente de una FDC que también tiene entrada `canonical` propia son el comportamiento correcto y esperado (p. ej. darunavir existe tanto suelto como dentro de Symtuza/Rezolsta/Evotaz).
- **"Clase farmacológica inconsistente" entre reglas para el mismo fármaco índice:** 99 fármacos aparecen con ≥2 redacciones distintas de `index_drug_class(es)` entre `kb_core_cascades.json` y `kb_vih_modifiers.json` (p. ej. ibuprofen: "NSAID" en un fichero vs "NSAID / COX inhibitor" en otro). **Interpretación:** esto es variación de granularidad/redacción entre ficheros con propósito distinto (reglas generales vs VIH-específicas), no necesariamente un error editorial — pero rompe cualquier búsqueda exacta fármaco→clase que no pase por `drug_dictionary.json` (fuente autoritativa real de la clase, según `docs/remaining-clinical-engine-fixes.md`). **Contenido pendiente de validación clínica/terminológica**, no se declara aquí como error confirmado.
- **Fármacos en ejemplos de reglas sin entrada en el diccionario:** de 208 términos únicos hallados en `index_drug_examples`/`cascade_drug_examples` sin resolver contra `drug_dictionary.json` ni `drug_combinations.json`, 151 son nombres de fármaco simple genuinamente ausentes del diccionario (hallazgo real de cobertura — no bloquea el motor porque estos ejemplos son metadatos descriptivos de la regla, no lo que el resolvedor usa para detectar menciones en el texto, pero limitan la trazabilidad editorial de la KB) y 6 son combinaciones "X/Y" no registradas como FDC, incluyendo **darunavir/ritonavir** y **atazanavir/ritonavir** — combinaciones de uso real en VIH que merecerían entrada propia en `drug_combinations.json` por su frecuencia de uso clínico. Los 51 restantes son frases descriptivas no farmacológicas (procedimientos, monitorización) y no constituyen un hallazgo real.

## 5. Interacciones (DDI) — entidades requeridas

`ddi_watchlist.json` (60 reglas) almacena `drug_a`/`drug_b` como texto libre en el 100% de los casos, sin un campo estructurado de "entidades requeridas" equivalente al `ddi_required_drugs` ya introducido en 5/33 reglas de `kb_vih_modifiers.json` (0 sin resolver en ese subconjunto). La extracción heurística de nombres desde el texto libre de `ddi_watchlist.json` deja 63 términos sin resolver contra el diccionario, mezclando clases genéricas ("NSAIDs", "Macrolides" — uso legítimo de clase, no un error) con fármacos individuales genuinamente ausentes del diccionario (ej. metadona, voriconazol, irinotecán, ibrutinib, bedaquilina, dofetilida, riluzol, venetoclax). **Interpretación:** no se ha encontrado evidencia de que una alerta DDI se dispare sin que el motor exija sus participantes exactos — `evaluateCurrentInteractions` (`clinical-engine.js`) exige coincidencia exacta de participantes activos, verificado también en `tests/medication-status-interactions.test.js:30-32` — pero la falta de estructura en `drug_a`/`drug_b` de `ddi_watchlist.json` (a diferencia de `ddi_required_drugs`) es deuda técnica que dificulta auditar automáticamente esta garantía para las 60 reglas de ese fichero en particular, frente a las 33 de `kb_vih_modifiers.json` que sí están cubiertas por el campo estructurado.

## 6. Referencias bibliográficas

| Fichero | Reglas activas sin referencia | Nota |
|---|---|---|
| `kb_core_cascades.json` (prod y dev) | 50/90 (CC041–CC090) | Coincide exactamente con las importadas desde `prescribing_cascades_CC041_CC090_FINAL.json`, cuyo esquema de origen ya carecía de este campo — consistente con lo ya documentado en `kb/kb_cascade_registry.md` ("48 reglas activas sin referencia bibliográfica pendientes de revisión clínica"; la cifra de esta auditoría, 50, difiere ligeramente y debe conciliarse al regenerar el registro, HAL-16) |
| `ddi_watchlist.json` | 60/60 | El esquema no contiene ningún campo de referencia — no es una omisión puntual sino una decisión de diseño del fichero, a revisar |
| `clinical_problems.json` | 5/6 | CPB002–CPB006 declaran `references: []` (array vacío, no ausente); solo CPB001 tiene contenido |
| `kb_vih_modifiers.json`, `ade_treatment_map.json`, `kb_clinical_modifiers.json` | 0/total | 100% referenciados |

**Todas estas reglas siguen siendo funcionales y se presentan al usuario** (el motor no las desactiva por falta de referencia); la ausencia de referencia es un estado de **"pendiente de revisión clínica"**, ya reconocido explícitamente como tal por el propio proyecto (`kb_cascade_registry.md`), no un hallazgo nuevo de esta auditoría — se documenta aquí por completitud y para alimentar el registro actualizado (HAL-16).

## 7. Diferencias potenciales vs certeza en el paciente / recomendaciones que podrían generar otra cascada

No se ha realizado en esta auditoría una revisión regla-por-regla de las 90 reglas core + 33 VIH buscando sesgos de recomendación no ligados a mecanismo (ese trabajo ya se hizo parcialmente en una auditoría previa del propio repositorio — `docs/clinical-engine-fix-audit.md` §6.1, que corrigió un caso de sesgo "en PVVIH" no justificado en CC001, y dejó explícitamente como limitación pendiente no haber revisado el resto del catálogo). Esta auditoría no repite ese trabajo por estar fuera de su alcance temporal, pero confirma que sigue siendo una limitación abierta y la incluye como recomendación para una futura iteración (doc 05).

## 8. Limitaciones de esta fase

1. Los 17 ficheros JSON de `kb/` parsean sin error — sin limitación de tipo "JSON inválido".
2. `kb/dev/kb_validator.js` no expone CLI propia (sin `require.main` check); se invocó como módulo Node — funcionó sin problema.
3. `kb/dev/validate_extended_kb.js` sí tiene CLI y se ejecutó directamente: PASS (33 entradas VIH, 60 DDI, 0 errores/warnings).
4. `kb/dev/merge_cascades.js` **no se ejecutó** por ser destructivo (sobrescribe `kb_core_cascades.json` in-place); solo se leyó su código para entender el mapeo de esquema.
5. Los chequeos de resolución de nombres de fármaco en texto libre (§4, §5) usan heurística (minúsculas + strip de paréntesis + split por "/"), lo que genera falsos positivos para frases descriptivas no farmacológicas — se contabilizaron y separaron explícitamente, pero una revisión clínica manual sería necesaria para confirmar cada caso límite.
6. La comprobación de "clase farmacológica por idioma" (§4) interpretó `index_drug_classes`/`index_drug_class` como el campo relevante; este esquema no tiene un campo bilingüe `_es`/`_en` para la clase, por lo que la comparación real fue entre ficheros (`kb_core_cascades` vs `kb_vih_modifiers`), no entre idiomas de un mismo campo.
7. No se han ejercitado las 90+33 reglas una a una con notas sintéticas exhaustivas; el foco se puso en los casos de mayor riesgo (near-duplicados, con consecuencia demostrada) y en los explícitamente pedidos por el encargo (doc 04).
