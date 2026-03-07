# Referencia de la Base de Conocimiento (KB)

**HIV Prescribing Cascade Auditor** · Versión de referencia: 2026-03-07

---

## Introducción

La **base de conocimiento (KB)** es el componente editorial central de la herramienta. Contiene los patrones de cascadas de prescripción, las interacciones fármaco-fármaco y el diccionario de síntomas que la aplicación utiliza para el análisis. Está estructurada como ficheros JSON estáticos, versionados de forma independiente al código de la aplicación.

La KB se distribuye en dos entornos:

| Entorno | Ruta | Uso |
|---------|------|-----|
| **PROD** | `kb/prod/` | Producción — contenido validado y estable |
| **DEV** | `kb/dev/` | Desarrollo — revisión editorial en curso |

El entorno activo puede seleccionarse desde el panel ⚙ Tools de la interfaz. Por defecto se carga PROD.

---

## Criterios de inclusión de la KB

Un patrón de cascada se incluye en la KB cuando cumple los siguientes criterios editoriales:

1. **Evidencia publicada**: existe al menos una referencia bibliográfica de nivel A o B (ensayo clínico, cohorte prospectiva, metaanálisis o guía clínica de referencia internacional) que documenta la asociación fármaco índice → efecto adverso → fármaco cascada.
2. **Relevancia en PVVIH**: el patrón tiene especial relevancia en pacientes con VIH por la complejidad farmacológica del TAR, las comorbilidades asociadas o las interacciones CYP conocidas.
3. **Operacionalidad**: el patrón puede ser detectado automáticamente a partir de una nota clínica en texto libre, es decir, los tres elementos (fármaco índice, síntoma/efecto adverso, fármaco cascada) son mencionables de forma inequívoca en el texto.

Los patrones con evidencia observacional débil o muy contexto-dependiente se marcan como `"confidence": "low"` o se excluyen de la versión PROD.

---

## Fichero 1 — `kb_core_cascades.json`

**Descripción:** Cascadas de prescripción genéricas, aplicables a cualquier paciente polimedicado. No son exclusivas del contexto VIH pero son frecuentes en PVVIH con comorbilidades.

**Versión:** 2.0.0 · **Actualizado:** 2026-03-04 · **Entradas PROD:** 40 patrones

### Estructura de cada entrada

```json
{
  "id": "CC001",
  "name_es": "AINE → Hipertensión → Antihipertensivo",
  "name_en": "NSAID → Hypertension → Antihypertensive",
  "index_drug_classes": ["NSAID"],
  "index_drug_examples": ["ibuprofen", "naproxen", "diclofenac", ...],
  "ade_mechanism_en": "Prostaglandin inhibition → sodium/water retention ...",
  "ade_en": "Blood pressure elevation",
  "cascade_drug_class": "Antihypertensive",
  "cascade_drug_examples": ["amlodipine", "enalapril", "lisinopril", ...],
  "confidence": "high",
  "age_sensitivity": "medium",
  "risk_focus": ["cardiovascular", "renal"],
  "differential_hints": ["..."],
  "appropriateness": "context_dependent",
  "time_window_days_min": 7,
  "time_window_days_max": 90,
  "recommended_first_action_en": "...",
  "references": ["..."]
}
```

### Descripción de los campos

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | Identificador único. Formato `CC[NNN]`. |
| `name_es` / `name_en` | string | Nombre legible de la cascada en español e inglés. |
| `index_drug_classes` | array | Clases farmacológicas del fármaco desencadenante. |
| `index_drug_examples` | array | Ejemplos de fármacos índice (nombres genéricos). |
| `ade_mechanism_en` | string | Mecanismo del efecto adverso (texto libre, inglés). |
| `ade_en` | string | Nombre del efecto adverso. |
| `cascade_drug_class` | string | Clase del fármaco cascada. |
| `cascade_drug_examples` | array | Ejemplos de fármacos cascada (nombres genéricos). |
| `confidence` | enum | Nivel de evidencia del patrón: `"high"` / `"medium"` / `"low"`. |
| `age_sensitivity` | enum | Sensibilidad por edad: `"high"` / `"medium"` / `"low"`. |
| `risk_focus` | array | Sistemas/órganos de mayor riesgo en esta cascada. |
| `differential_hints` | array | Diagnósticos alternativos a considerar antes de confirmar la cascada. |
| `appropriateness` | enum | Adecuación habitual del fármaco cascada: `"often_inappropriate"` / `"context_dependent"` / `"often_appropriate"`. |
| `time_window_days_min` / `_max` | integer | Ventana temporal típica entre inicio del fármaco índice y aparición del ADE (días). |
| `recommended_first_action_en` | string | Sugerencia editorial de primera acción revisora (no prescriptiva). |
| `references` | array | Referencias bibliográficas de soporte. |

### Patrones incluidos (selección)

| ID | Cascada (ES) | Confianza |
|----|-------------|-----------|
| CC001 | AINE → Hipertensión → Antihipertensivo | Alta |
| CC002 | AINE → Síntomas GI → IBP | Alta |
| CC003 | IECA → Tos → Antitusivo / Cambio a ARA-II | Alta |
| CC004 | Antagonista del calcio → Edema maleolar → Diurético | Alta |
| CC005 | Diurético tiazídico → Gota → Antigotoso | Alta |
| CC006 | Antipsicótico → Síntomas extrapiramidales → Antiparkinsiano | Alta |
| … | *(34 patrones adicionales)* | |

---

## Fichero 2 — `kb_vih_modifiers.json`

**Descripción:** Cascadas de prescripción específicas de la farmacología antirretroviral. Documenta los efectos adversos propios de las distintas clases de ARVs y los fármacos que se prescriben habitualmente como respuesta a esos efectos.

**Versión:** 1.1.0 · **Actualizado:** 2025-01-01 · **Entradas PROD:** 8 patrones

### Estructura de cada entrada

```json
{
  "id": "VIH001",
  "name_es": "IP/r o INSTI (DTG/BIC) → Dislipidemia → Estatina",
  "name_en": "PI/r or INSTI (DTG/BIC) → Dyslipidemia → Statin",
  "index_drug_class": "Boosted PI / INSTI",
  "index_drugs_examples": ["lopinavir/ritonavir", "darunavir/cobicistat", ...],
  "ade_mechanism_es": "...",
  "ade_mechanism_en": "...",
  "ade_es": "Hipertrigliceridemia, hipercolesterolemia",
  "ade_en": "Hypertriglyceridemia, hypercholesterolemia",
  "cascade_drug_class": "Statin",
  "cascade_drugs_examples": ["rosuvastatin", "pravastatin", ...],
  "contraindicated_cascade_drugs": ["simvastatin", "lovastatin"],
  "plausibility": "high",
  "time_to_ade_typical_days_min": 30,
  "time_to_ade_typical_days_max": 365,
  "evidence_level": "A",
  "ddi_warning_es": "ATENCIÓN: Simvastatina y lovastatina están CONTRAINDICADAS ...",
  "ddi_warning_en": "WARNING: Simvastatin and lovastatin are CONTRAINDICATED ...",
  "clinical_note_es": "...",
  "clinical_note_en": "...",
  "references": ["DHHS Guidelines 2024", "..."]
}
```

### Campos adicionales respecto a `kb_core_cascades.json`

| Campo | Descripción |
|-------|-------------|
| `contraindicated_cascade_drugs` | Fármacos de la clase cascada que están contraindicados con el fármaco índice ARV. Se muestran con máxima prominencia visual. |
| `evidence_level` | Nivel de evidencia según clasificación de guías VIH: `"A"` / `"B"` / `"C"`. |
| `ddi_warning_es` / `_en` | Advertencia específica de interacción fármaco-fármaco (bilingüe). |
| `clinical_note_es` / `_en` | Nota editorial de contexto clínico (bilingüe). |

### Patrones incluidos

| ID | Cascada (ES) | Evidencia |
|----|-------------|-----------|
| VIH001 | IP/r o INSTI (DTG/BIC) → Dislipidemia → Estatina | A |
| VIH002 | TDF → Nefrotoxicidad → Suplementos fosfato / ajuste dosis | A |
| VIH003 | IP o INSTI → Ganancia de peso → Antidiabético / Antihipertensivo | B |
| VIH004 | INTI (AZT/d4T) → Lipoatrofia → Corrección estética | B |
| VIH005 | IP/r → Hiperglucemia → Antidiabético | A |
| VIH006 | IECA/ARA-II + TDF → Deterioro renal → Ajuste dosis TAR | B |
| VIH007 | IP → Urolitiasis (atazanavir) → Analgésico / Urólogo | A |
| VIH008 | Efavirenz → Síntomas neuropsiquiátricos → Hipnótico / Antidepresivo | A |

---

## Fichero 3 — `ddi_watchlist.json`

**Descripción:** Interacciones fármaco-fármaco (IFF) de relevancia clínica para las cascadas en PVVIH. Se muestran en la interfaz de forma independiente a la confirmación de la cascada y nunca se suprimen.

**Versión:** 1.1.0 · **Actualizado:** 2025-01-01 · **Entradas PROD:** 10 interacciones

### Estructura de cada entrada

```json
{
  "id": "DDI001",
  "drug_a": "Ritonavir / Cobicistat (PI boosters)",
  "drug_a_class": "CYP3A4 inhibitor",
  "drug_b": "Simvastatin / Lovastatin",
  "drug_b_class": "Statin (CYP3A4 substrate)",
  "severity": "CONTRAINDICATED",
  "mechanism_es": "Inhibición de CYP3A4 por RTV/COBI → aumento masivo de niveles de estatina → riesgo de rabdomiólisis",
  "mechanism_en": "CYP3A4 inhibition by RTV/COBI → massive increase in statin levels → rhabdomyolysis risk",
  "clinical_consequence_es": "...",
  "clinical_consequence_en": "...",
  "management_es": "...",
  "management_en": "...",
  "references": ["..."]
}
```

### Niveles de severidad

| Nivel | Definición |
|-------|-----------|
| `CONTRAINDICATED` | No usar juntos; riesgo de evento adverso grave o fatal. |
| `MAJOR` | Potencialmente grave; puede requerir cambio mayor de manejo. |
| `MODERATE` | Puede empeorar la condición del paciente; puede requerir ajuste de dosis o monitorización. |
| `MINOR` | Significancia clínica mínima; tener en cuenta. |

### Interacciones incluidas (selección)

| ID | Fármaco A | Fármaco B | Severidad |
|----|-----------|-----------|-----------|
| DDI001 | Ritonavir / Cobicistat | Simvastatina / Lovastatina | CONTRAINDICADA |
| DDI002 | Ritonavir / Cobicistat | Midazolam / Triazolam | CONTRAINDICADA |
| DDI003 | Rifampicina | ARVs (múltiples) | MAYOR |
| DDI004 | Cobicistat | Colchicina | MAYOR |
| DDI005 | Dolutegravir | Metformina (dosis altas) | MODERADA |
| … | *(5 interacciones adicionales)* | | |

---

## Fichero 4 — `kb_symptoms.json`

**Descripción:** Diccionario de síntomas y efectos adversos utilizados por el motor de detección por puente sintomático. Cada entrada asocia un síntoma con los fármacos que lo causan y los fármacos que habitualmente se prescriben para tratarlo, permitiendo identificar la tríada completa de la cascada cuando el síntoma está documentado en la nota clínica.

**Versión:** 1.2.0 · **Actualizado:** 2026-03-04 · **Entradas PROD:** 10 síntomas

### Estructura de cada entrada

```json
{
  "id": "SYM008",
  "term": "oedema",
  "synonyms": [
    "edema", "ankle swelling", "ankle oedema", "peripheral edema",
    "edema maleolar", "edema de tobillo", "tobillos hinchados", "..."
  ],
  "category": "cardiovascular",
  "cascade_relevance": "CCB-induced oedema — may trigger diuretic prescribing (cascade CC004)",
  "caused_by_drug_examples": ["amlodipine", "nifedipine", "gabapentin", "..."],
  "treated_by_drug_examples": ["furosemide", "hydrochlorothiazide", "spironolactone", "..."]
}
```

### Campos

| Campo | Descripción |
|-------|-------------|
| `id` | Identificador único. Formato `SYM[NNN]`. |
| `term` | Término principal del síntoma (inglés). |
| `synonyms` | Lista de sinónimos en inglés y español usados para la búsqueda en texto libre. Incluye variantes ortográficas habituales. |
| `category` | Categoría fisiopatológica: `cardiovascular`, `gastrointestinal`, `neurological`, `anticholinergic`, `metabolic`, `safety`, etc. |
| `cascade_relevance` | Descripción editorial de la relevancia del síntoma para la detección de cascadas, con referencia al patrón KB asociado cuando corresponde. |
| `caused_by_drug_examples` | Fármacos que típicamente causan este síntoma (lista orientativa, no exhaustiva). |
| `treated_by_drug_examples` | Fármacos que se prescriben habitualmente para tratar este síntoma. |

### Síntomas incluidos

| ID | Término | Categoría | Cascada principal |
|----|---------|-----------|------------------|
| SYM001 | Constipation / Estreñimiento | Gastrointestinal | Opioide / ACO / ACC → Laxante |
| SYM002 | Dry mouth / Boca seca | Anticolinérgico | Carga anticolinérgica → Sustitutos salivales |
| SYM003 | Dizziness / Mareo | Neurológico | Antihipertensivo → Antivertiginoso |
| SYM004 | Falls / Caídas | Seguridad | Sedación, hipotensión ortostática |
| SYM005 | Urinary incontinence / Incontinencia urinaria | Urológico | IECA → Incontinencia → Anticolinérgico |
| SYM006 | Nausea / Náuseas | Gastrointestinal | AINE / Estatina → Náuseas → Antiemético |
| SYM007 | Cough / Tos | Respiratorio | IECA → Tos → Antitusivo (CC003) |
| SYM008 | Oedema / Edema | Cardiovascular | ACC → Edema maleolar → Diurético (CC004) |
| SYM009 | Insomnia / Insomnio | Neurológico | Estimulantes / Corticoides → Hipnótico |
| SYM010 | Depression / Depresión | Psiquiátrico | Beta-bloqueante / Efavirenz → Antidepresivo |

---

## Proceso de actualización de la KB

Las actualizaciones de la KB siguen este proceso:

1. **Propuesta editorial**: nueva entrada o modificación propuesta con referencia bibliográfica de soporte.
2. **Revisión en DEV**: la entrada se añade a `kb/dev/` y se valida con `kb_validator.js`. El validador comprueba integridad de campos obligatorios, unicidad de IDs y coherencia de enumerados.
3. **Revisión clínica**: un revisor con experiencia en farmacología clínica VIH valida la plausibilidad del patrón y la adecuación de los ejemplos de fármacos.
4. **Promoción a PROD**: una vez validada, la entrada se copia a `kb/prod/` y se incrementa la versión del fichero.
5. **Registro en CHANGELOG.md**.

El validador de KB (`kb/dev/kb_validator.js`) es accesible desde el panel ⚙ Tools de la interfaz en modo DEV.

---

## Consideraciones sobre la cobertura de la KB

La KB cubre un subconjunto curado de patrones de cascada. **No es exhaustiva.** La ausencia de un patrón en la KB no significa que la cascada no exista; significa que no ha sido incorporada en la versión actual.

Quedan fuera del alcance de la versión 1.0:

- Cascadas mediadas por fármacos de uso reciente sin suficiente evidencia publicada.
- Patrones específicos de pediatría o embarazo.
- Cascadas relacionadas con medicación complementaria o fitoterapia.
- Interacciones de tres o más fármacos simultáneos (polifarmacia compleja).

Estas limitaciones deben comunicarse explícitamente al usuario clínico antes de interpretar un resultado negativo (ausencia de alerta) como ausencia de riesgo.
