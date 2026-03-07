# HIV Prescribing Cascade Auditor

**Auditor de Cascadas de Prescripción en VIH**

Versión de software: **1.0.0** · Base de conocimiento: **2.0.0 (PROD)**
Autor: **Ramón Morillo** · Licencia: consulte `LICENSE` si existe, o contacte al autor.

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

1. **Extracción de medicación y síntomas** desde una nota clínica en texto libre (NLP local, sin IA externa). Identifica fármacos por nombre genérico, sus clases farmacológicas y síntomas/efectos adversos mencionados en el texto.

2. **Clasificación farmacológica** de la medicación detectada: asigna clase terapéutica a cada fármaco usando la base de conocimiento local.

3. **Detección de posibles cascadas** mediante dos mecanismos complementarios:
   - *Detección directa*: cruce del par (fármaco índice, fármaco cascada) con los patrones documentados en la KB.
   - *Puente sintomático*: identificación de síntomas en el texto que pueden ser efectos adversos de un fármaco activo y que a su vez son tratados por otro fármaco activo.

4. **Verificación clínica interactiva**: el clínico puede clasificar cada hallazgo como "confirmado", "posible" o "descartado", añadir notas y señales de alerta.

5. **Generación de informe estructurado**: informe bilingüe exportable (JSON, CSV) con los hallazgos, clasificaciones, alertas de IFF y notas clínicas.

6. **Persistencia local**: el estado del caso se guarda automáticamente en el almacenamiento local del navegador (`localStorage`). No se transmite ningún dato a servidores externos.

---

## Qué no hace esta herramienta

- **No toma decisiones clínicas ni emite recomendaciones de tratamiento.** Toda propuesta del sistema es un punto de partida para la revisión clínica, no una instrucción.
- **No se conecta a ningún servicio externo** durante su uso: no hay llamadas a APIs de LLM, no hay telemetría, no hay sincronización en la nube.
- **No valida la completitud de la nota clínica.** Si el texto es incompleto o ambiguo, los hallazgos serán necesariamente parciales.
- **No sustituye la consulta de guías clínicas actualizadas** (DHHS, EACS, BHIVA, GeSIDA u otras) ni el juicio del profesional sanitario cualificado.
- **No está validada como dispositivo médico.** La herramienta no ha sido sometida a evaluación regulatoria como producto sanitario en ninguna jurisdicción.
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
├── app.js                      # Lógica de negocio (ES2020, ~2700 líneas)
├── styles.css                  # Estilos (CSS3, sin frameworks)
├── kb/
│   ├── prod/                   # Base de conocimiento de producción
│   │   ├── kb_core_cascades.json       # Cascadas genéricas (40 patrones, v2.0.0)
│   │   ├── kb_vih_modifiers.json       # Cascadas VIH-específicas (8 patrones, v1.1.0)
│   │   ├── ddi_watchlist.json          # Vigilancia de IFF (10 interacciones, v1.1.0)
│   │   └── kb_symptoms.json            # Diccionario de síntomas (10 entradas, v1.2.0)
│   └── dev/                    # Base de conocimiento de desarrollo (en revisión)
│       ├── kb_core_cascades.json
│       ├── kb_vih_modifiers.json
│       ├── ddi_watchlist.json
│       ├── kb_symptoms.json
│       └── kb_validator.js             # Validador de integridad de la KB
├── methodology/
│   └── pipeline_spec_v1.0.md   # Especificación técnica del pipeline de detección
├── examples/
│   └── example_note.txt        # Nota clínica de ejemplo para pruebas
├── README.md                   # Este fichero
└── CHANGELOG.md                # Registro de cambios por versión
```

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

La herramienta no ha sido evaluada ni registrada como producto sanitario. No cumple los requisitos de los Reglamentos (UE) 2017/745 (MDR) ni 2017/746 (IVDR), ni de ninguna otra normativa equivalente. Su uso es de exclusiva responsabilidad del profesional que la emplea.

*This tool is for clinical decision support purposes only. It does not constitute medical advice, clinical diagnosis, or prescribing guidance. All outputs must be reviewed by a qualified healthcare professional. The tool has not been evaluated or registered as a medical device under any regulatory framework.*

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

## Autoría

**Autor:** Ramón Morillo

Esta herramienta fue diseñada y desarrollada por Ramón Morillo como instrumento de apoyo a la decisión clínica en el contexto de la farmacia especializada en VIH. La base de conocimiento ha sido elaborada a partir de evidencia publicada en guías clínicas internacionales y literatura científica revisada por pares.

Para consultas sobre licencia, reutilización o colaboración, contacte directamente con el autor.
