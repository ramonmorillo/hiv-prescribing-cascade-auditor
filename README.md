# HIV Prescribing Cascade Auditor

**Auditor de Cascadas de Prescripción en VIH**

Versión de software: **1.0.0** · Base de conocimiento: **2.0.0 (PROD)**
Autores: **Ramón Morillo Verdugo y Cecilia Solís Martín** · Licencia: consulte `LICENSE` si existe, o contacte con los autores.

---

## Propósito

El **HIV Prescribing Cascade Auditor** es una herramienta de apoyo a la decisión clínica diseñada para ayudar a farmacéuticos clínicos, médicos especialistas en VIH y equipos multidisciplinares a identificar posibles cascadas de prescripción en personas que viven con el VIH (PVVIH).

Una **cascada de prescripción** ocurre cuando un efecto adverso de un fármaco A se interpreta erróneamente como una nueva condición clínica, lo que lleva a prescribir un fármaco B para tratar dicho efecto — en lugar de reconsiderar el fármaco A.

> **Ejemplo canónico:** amlodipino (antihipertensivo, antagonista del calcio) → edema maleolar → furosemida prescrita como diurético para el edema. La causa del edema es el propio antihipertensivo; el diurético añade polimedicación, efectos adversos y coste sin resolver la causa raíz.

En el contexto VIH, este problema es especialmente relevante: las PVVIH suelen recibir regímenes antirretrovirales (TAR) con interacciones farmacológicas complejas junto a fármacos para comorbilidades (cardiovascular, metabólica, ósea, etc.), lo que aumenta el riesgo de cascadas y de interacciones fármaco-fármaco (IFF) clínicamente significativas.

---

## Alcance clínico

La herramienta está orientada a la revisión farmacoterapéutica de:

- PVVIH en tratamiento antirretroviral estable con comorbilidades asociadas.
- Casos de polimedicación donde se sospecha que algún fármaco activo puede ser consecuencia de un efecto adverso de otro.
- Detección de interacciones fármaco-fármaco relevantes para la cascada (especialmente aquellas mediadas por CYP3A4 con inhibidores farmacocinéticos como ritonavir o cobicistat).

**Idiomas soportados:** español e inglés (interfaz y base de conocimiento bilingüe).

---

## Qué hace esta herramienta

1. **Extracción de medicación, problemas clínicos activos y mediciones** desde una nota clínica en texto libre (NLP local, sin IA externa). Identifica fármacos por nombre genérico/marca (incluyendo combinaciones de dosis fija, expandidas a sus principios activos), problemas clínicos explícitos (p. ej. hipertensión, diabetes) con su estado (activo/antecedente/negado/sospechado), y mediciones simples como lecturas de presión arterial.

2. **Clasificación farmacológica** de la medicación detectada: asigna clase terapéutica a cada fármaco usando la base de conocimiento local.

3. **Evaluación de posibles cascadas** mediante dos mecanismos complementarios, cada señal clasificada en uno de cinco niveles de certeza (nunca "confirmada" por el sistema):
   - *Fármaco-fármaco*: para cada candidata (fármaco índice, problema intermedio, fármaco posterior) se verifica explícitamente si el problema intermedio está documentado, negado, es un antecedente, o solo se infiere de la coincidencia de clases — antes de asignar `supported_possible_cascade`, `possible_but_incomplete`, `pharmacological_match_only`, `not_evaluable` o `discarded`.
   - *Puente sintomático*: identificación de síntomas en el texto que pueden ser efectos adversos de un fármaco activo y que a su vez son tratados por otro fármaco activo.
   - Las alertas que dependen del conjunto de la medicación (carga anticolinérgica, carga depresora del SNC, duplicidad de AINE) se muestran por separado, nunca dentro de la explicación de una cascada concreta.

4. **Verificación clínica interactiva**: el clínico puede clasificar cada hallazgo como "confirmado", "posible" o "descartado", añadir notas y señales de alerta — esta validación profesional es independiente de (y prevalece sobre) la clasificación automática del sistema.

5. **Generación de informe estructurado**: informe bilingüe exportable (JSON, CSV) con los hallazgos, clasificaciones, alertas de IFF y notas clínicas.

6. **Persistencia local**: el estado del caso se guarda automáticamente en el almacenamiento local del navegador (`localStorage`). No se transmite ningún dato a servidores externos.

---

## Qué no hace esta herramienta

- **No toma decisiones clínicas ni emite recomendaciones de tratamiento.** Toda propuesta del sistema es un punto de partida para la revisión clínica, no una instrucción.
- **No se conecta a ningún servicio externo** durante su uso: no hay llamadas a APIs de LLM, no hay telemetría, no hay sincronización en la nube.
- **No valida la completitud de la nota clínica.** Si el texto es incompleto o ambiguo, los hallazgos serán necesariamente parciales.
- **No sustituye la consulta de guías clínicas actualizadas** (DHHS, EACS, BHIVA, GeSIDA u otras) ni el juicio del profesional sanitario cualificado.
- **Su situación regulatoria está en evaluación.** La herramienta no ha completado una evaluación regulatoria formal ni dispone de marcado CE. Su cualificación y clasificación deben establecerse a partir de la finalidad prevista antes de un despliegue clínico abierto.
- **No gestiona datos reales de pacientes.** Está diseñada para notas pseudonimizadas; no debe introducirse información identificable de pacientes reales.
- **No cubre todos los fármacos ni todas las cascadas posibles.** La KB es curada y representa un subconjunto de cascadas con evidencia documentada; muchos patrones no están aún incorporados.

---

## Funcionamiento local-first

Toda la lógica de la aplicación se ejecuta en el navegador del usuario. No existe backend propio:

- Los ficheros JSON de la base de conocimiento se cargan mediante `fetch()` desde la misma ubicación que la aplicación (servidor estático o disco local con servidor HTTP).
- El estado del caso se persiste en `localStorage` bajo la clave `hiv_cascade_state`.
- No se realizan peticiones de red más allá de la carga inicial de los ficheros JSON de la KB.
- La aplicación funciona completamente sin conexión a internet una vez cargada.

**Requisitos de despliegue:** cualquier servidor de ficheros estáticos (GitHub Pages, nginx, Apache, `python3 -m http.server`). No se requiere ningún servidor de aplicaciones.

> **Nota sobre `file://`**: cargar `index.html` directamente desde el sistema de ficheros (`file://`) puede bloquear las peticiones `fetch()` en algunos navegadores por restricciones CORS. Se recomienda un servidor HTTP local o GitHub Pages.

---

## Exportar e importar casos

| Acción | Descripción |
|--------|-------------|
| **Exportar JSON** | Guarda el estado completo del caso (nota clínica, fármacos detectados, cascadas, clasificaciones, notas) como fichero `.json`. |
| **Exportar CSV** | Exporta la tabla de cascadas detectadas como fichero `.csv` para análisis externo. |
| **Importar caso** | Restaura un caso desde un fichero `.json` exportado previamente. Incluye validación de formato y de rangos de campos. |
| **Eliminar datos** | Borra todos los datos del caso del almacenamiento local del navegador. Irreversible. |

Los ficheros exportados no contienen identificadores de la herramienta ni metadatos de red; son portables entre instancias de la aplicación.

---

## Instalación y arranque

### Opción A — GitHub Pages
1. Haga fork de este repositorio.
2. Vaya a **Settings → Pages → Source: rama `main`, carpeta raíz**.
3. Acceda a la URL de Pages generada.

### Opción B — Servidor local
```bash
git clone <url-del-repositorio>
cd hiv-prescribing-cascade-auditor
python3 -m http.server 8080
# Abrir http://localhost:8080 en un navegador moderno
```

**Compatibilidad de navegadores:** Chrome 80+, Firefox 75+, Safari 14+, Edge 80+.

---

## Estructura del repositorio

```
hiv-prescribing-cascade-auditor/
├── index.html                  # Aplicación principal (SPA estática)
├── clinical-engine.js          # Motor clínico puro (sin DOM): normalización, extracción,
│                                #   problemas activos, clasificación de cascadas. Testeable con Node.
├── app.js                      # Capa de UI/estado sobre ClinicalEngine (wizard, render, i18n)
├── styles.css                  # Estilos (CSS3, sin frameworks)
├── kb/
│   ├── drug_dictionary.json            # Diccionario de fármacos (genéricos/marcas), track-independiente
│   ├── drug_combinations.json          # Combinaciones de dosis fija (marca → principios activos)
│   ├── kb_cascade_registry.md          # Auditoría de todas las reglas de cascada (fuente/estado)
│   ├── prod/                   # Base de conocimiento de producción
│   │   ├── kb_core_cascades.json       # Cascadas genéricas
│   │   ├── kb_vih_modifiers.json       # Cascadas VIH-específicas
│   │   ├── ddi_watchlist.json          # Vigilancia de IFF
│   │   ├── kb_symptoms.json            # Diccionario de síntomas (puente sintomático)
│   │   ├── kb_clinical_modifiers.json  # Modificadores de contexto clínico (edad, ERC, carga anticolinérgica…)
│   │   ├── ade_treatment_map.json      # Enlace efecto adverso ↔ fármacos que lo tratan, por cascada
│   │   └── clinical_problems.json      # Diccionario de problemas clínicos activos (HTA, IC, DM2, ERGE…)
│   └── dev/                    # Base de conocimiento de desarrollo (en revisión), mismo esquema que prod/
│       └── kb_validator.js             # Validador de integridad bilingüe de la KB
├── tests/                      # Suite de pruebas automatizadas (Node puro, sin dependencias)
│   ├── run.js                          # `node tests/run.js` ejecuta toda la suite
│   ├── index-case.test.js              # Caso índice de la auditoría clínica
│   ├── negative-cases.test.js          # 8 casos negativos (negación, antecedente, indicación alternativa…)
│   ├── regression.test.js              # Regresión de la capa NLP (negación, puente sintomático)
│   ├── legacy-nlp.test.js              # Resolución de fármacos, combos, typo-correction, urológico/renal
│   └── kb-audit.test.js                # Validación estructural de la KB
├── methodology/
│   └── pipeline_spec_v1.0.md   # Especificación técnica del pipeline de detección
├── examples/
│   └── example_note.txt        # Nota clínica de ejemplo para pruebas
├── README.md                   # Este fichero
├── CHANGELOG.md                # Registro de cambios por versión
└── KB_REFERENCE.md             # Referencia detallada de la base de conocimiento
```

### Ejecutar las pruebas automatizadas

```bash
node tests/run.js
```

No requiere dependencias ni navegador: `clinical-engine.js` se carga vía `require()` directamente.

También puede ejecutarse mediante el comando estable utilizado por integración continua:

```bash
npm test
```

## Gobierno y calidad

- [`docs/PRODUCT_BASELINE.md`](docs/PRODUCT_BASELINE.md): línea base congelada, límites del producto y titularidad.
- [`docs/RELEASE_GATES.md`](docs/RELEASE_GATES.md): clasificación de cambios, evidencias y revisiones obligatorias.
- [`.github/pull_request_template.md`](.github/pull_request_template.md): declaración de impacto clínico, privacidad, bilingüismo y verificación para cada cambio.

La rama principal debe aceptar cambios mediante pull request y exigir que la suite completa de regresión finalice correctamente.

---

## Base de conocimiento (KB)

La base de conocimiento es el componente editorial central de la herramienta. Se distribuye como ficheros JSON estáticos y puede actualizarse de forma independiente al código de la aplicación. Para una descripción detallada de la estructura, los campos y los criterios de inclusión de cada fichero, consulte **[`KB_REFERENCE.md`](KB_REFERENCE.md)**.

Resumen de los cuatro ficheros PROD:

| Fichero | Contenido | Entradas | Versión |
|---------|-----------|----------|---------|
| `kb_core_cascades.json` | Cascadas de prescripción genéricas, aplicables a cualquier paciente poliedicado | 40 | 2.0.0 |
| `kb_vih_modifiers.json` | Cascadas específicas de la farmacología antirretroviral | 8 | 1.1.0 |
| `ddi_watchlist.json` | Interacciones fármaco-fármaco relevantes para las cascadas en PVVIH | 10 | 1.1.0 |
| `kb_symptoms.json` | Diccionario de síntomas/efectos adversos para detección por puente sintomático | 10 | 1.2.0 |

---

## Limitaciones y descargo de responsabilidad

### Limitaciones técnicas

1. **Cobertura limitada de la KB.** La base de conocimiento contiene un conjunto curado de patrones con evidencia publicada. Numerosas cascadas clínicamente relevantes no están representadas en la versión actual.
2. **Extracción NLP basada en coincidencia de términos.** La detección de fármacos y síntomas se basa en búsqueda de términos sobre texto libre. No utiliza modelos de lenguaje ni análisis semántico avanzado; es sensible a variaciones ortográficas, abreviaturas y nombres comerciales no indexados.
3. **Sin validación temporal automática.** La herramienta no infiere automáticamente la cronología de la prescripción a partir del texto. La valoración de la plausibilidad temporal es responsabilidad del clínico revisor.
4. **Solo español e inglés.** La interfaz y la KB no dan soporte a otros idiomas.
5. **Sin integración con sistemas de historia clínica (HCE/EHR).** La entrada de datos es manual (copiar y pegar nota clínica pseudonimizada).
6. **Almacenamiento local limitado.** El uso de `localStorage` impone un límite de aproximadamente 5 MB por origen en la mayoría de navegadores.

### Descargo de responsabilidad clínica

> **Esta herramienta es exclusivamente un instrumento de apoyo a la revisión farmacoterapéutica. No constituye consejo médico, diagnóstico clínico ni prescripción. Ninguna salida de esta herramienta debe utilizarse como única base para tomar decisiones clínicas.**

Los hallazgos generados por el auditor son hipótesis de trabajo que requieren validación por un profesional sanitario cualificado con acceso a la historia completa del paciente, los datos analíticos actualizados y las guías clínicas vigentes.

La herramienta no ha completado una evaluación regulatoria formal ni dispone de marcado CE. Su cualificación y clasificación bajo el Reglamento (UE) 2017/745 (MDR) deben determinarse a partir de la finalidad prevista antes de un despliegue clínico abierto. Hasta entonces, su uso se limita a evaluación y apoyo supervisado por profesionales cualificados.

*This tool is for clinical decision support purposes only. It does not constitute medical advice, clinical diagnosis, or prescribing guidance. All outputs must be reviewed by a qualified healthcare professional. It has not completed formal regulatory assessment and does not bear CE marking; qualification and classification under Regulation (EU) 2017/745 must be determined from its intended purpose before open clinical deployment.*

---

## Detalles técnicos

| Parámetro | Valor |
|-----------|-------|
| Versión de software | 1.0.0 |
| Versión KB PROD | 2.0.0 (core) / 1.1.0 (VIH, DDI) / 1.2.0 (síntomas) |
| Lenguaje | JavaScript ES2020 (vanilla) |
| Frameworks | Ninguno |
| Almacenamiento | `localStorage` (clave: `hiv_cascade_state`) |
| Llamadas de red en tiempo de ejecución | Ninguna (solo carga inicial de KB via `fetch()`) |
| Dependencias externas de producción | Ninguna |
| Compatibilidad de navegadores | Chrome 80+, Firefox 75+, Safari 14+, Edge 80+ |
| Modo offline | Sí, tras primera carga |

---

## Autoría y titularidad

**Coautores y cotitulares:** Ramón Morillo Verdugo y Cecilia Solís Martín, al 50% cada uno.

**Registro de propiedad intelectual:** 04/2026/2614.

La herramienta se desarrolla como instrumento de apoyo a la decisión clínica en el contexto de la atención farmacéutica especializada en VIH. La base de conocimiento se elabora a partir de guías clínicas y literatura científica, con trazabilidad y revisión clínica progresivas.

Para consultas sobre licencia, reutilización o colaboración, contacte con los autores.
