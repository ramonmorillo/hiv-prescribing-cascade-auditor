# HIV Prescribing Cascade Auditor

**Auditor de Cascadas de Prescripción en VIH**

A static, local-first web application for detecting prescribing cascades in people living with HIV (PLHIV). Runs entirely in the browser — no backend, no paid APIs, no data leaves your device.

---

## What is a Prescribing Cascade?

A **prescribing cascade** occurs when an adverse drug effect (ADE) from Drug A is misidentified as a new medical condition, leading to the prescription of Drug B to treat the ADE — rather than reconsidering Drug A. This is particularly relevant in PLHIV, who often take multiple medications (ARVs + comorbidity drugs) and are at high risk.

**Example**: Lopinavir/ritonavir → hyperlipidemia → simvastatin prescribed *(with DDI risk of rhabdomyolysis)*.

---

## Quickstart

### Option 1: GitHub Pages (Recommended)
1. Fork this repository
2. Go to **Settings → Pages → Source: main branch, root folder**
3. Open your Pages URL (e.g., `https://yourusername.github.io/hiv-prescribing-cascade-auditor/`)

### Option 2: Local File
1. Clone or download this repository
2. Run a quick local server: `python3 -m http.server 8080`
3. Open `http://localhost:8080` in a modern browser

> **Note**: Opening `index.html` directly via `file://` may restrict `fetch()` for KB files in some browsers. A local server or GitHub Pages is recommended.

---

## How to Use: 5-Step Pipeline

### Step 1 — Input
1. Enter a **pseudonymized Patient ID** (e.g., `PAT-001`) — do NOT use real names
2. Paste the **clinical note** (free text) into the textarea
3. Paste or upload the **dispensing records CSV**
4. Click **"Parse Dispensing CSV"** to verify the table
5. Click **Next**

**Dispensing CSV format:**
```csv
drug_name,dose,quantity,dispense_date,end_date,prescriber
lopinavir/ritonavir,400/100mg,60,2022-03,ongoing,HIV clinic
atorvastatin,20mg,30,2023-01,,cardiology
amlodipine,5mg,30,2022-09,,cardiology
furosemide,40mg,30,2023-02,,cardiology
```

Accepted date formats: `YYYY-MM-DD`, `YYYY-MM`, `MM/YYYY`, `DD/MM/YYYY`

---

### Step 2 — Agent 1: Clinical Extractor
1. The app displays a **pre-written prompt** with your clinical note embedded
2. Click **"Copy Prompt"**
3. Paste into **Gemini / ChatGPT / Claude** in your own browser tab
4. Copy the JSON response from the LLM
5. Paste into the **"Paste LLM Output"** textarea in the app
6. The app validates the JSON and shows feedback
7. Click **Next**

---

### Step 3 — Agent 2: Temporal Normalizer
1. Copy the generated prompt → run in your LLM → paste JSON back
2. Review the temporal assessment level:
   - **T1**: Clear temporal order (index drug before cascade drug) — most convincing
   - **T2**: Probable order (overlap or uncertainty) — plausible
   - **TX**: Cannot determine — insufficient date information
   - **T0**: Incompatible (cascade drug started before index drug) — cascade unlikely
3. Click **Next**

---

### Step 4 — Agent 3: Cascade Detector
1. Copy prompt (includes KB data) → run in LLM → paste JSON
2. Review the **candidate cascades table** with DDI alerts
3. Note any **CONTRAINDICATED** DDI warnings (shown in red)
4. Click **Next**

---

### Step 5 — Plan & Verify
**5a — Clinical Plan (Agent 4):** Copy prompt → run in LLM → paste JSON → review bilingual recommendations

**5b — Verifier (Agent 5):** Copy prompt → run in LLM → paste JSON → review the **semaphore** (green/amber/red) and risk flags

---

### Step 6 — Report
- View the complete **bilingual report** (Spanish + English)
- **Export JSON** to save the full case for resuming later
- **Export CSV** to export the cascade table
- **Import Case** to resume a previously saved case

---

## Data Privacy

- All data stored **locally in your browser** (IndexedDB)
- **No data ever leaves your device** — no external calls except loading local KB files
- Click **"Delete All Data"** to wipe all stored data from your browser
- **Do not enter real patient-identifying information** — use pseudonymized IDs only

---

## Knowledge Base (`/kb/`)

| File | Contents |
|------|----------|
| `kb_core_cascades.json` | 12 core prescribing cascade patterns |
| `kb_vih_modifiers.json` | 8 HIV-specific cascade patterns (ARV-related) |
| `ddi_watchlist.json` | 10 critical DDIs relevant to cascades in PLHIV |

---

## Limitations & Safety

> **This tool is for clinical decision support only — not autonomous decision-making.**

- The KB is **not exhaustive** — not all cascades or DDIs are covered
- LLM output quality depends on the model and note quality — always verify
- All findings must be reviewed by a qualified clinician
- Consult current HIV guidelines (DHHS, EACS, BHIVA) for authoritative guidance
- Do not use real patient data — pseudonymized data only

---

## File Structure

```
/
├── index.html
├── styles.css
├── app.js
├── kb/
│   ├── kb_core_cascades.json
│   ├── kb_vih_modifiers.json
│   └── ddi_watchlist.json
├── examples/
│   ├── example_note.txt
│   ├── example_dispensing.csv
│   └── example_case.json
└── README.md
```

---

## Technical Details

- **Framework**: None — vanilla HTML5, CSS3, JavaScript (ES2020)
- **Storage**: IndexedDB
- **External calls**: Only local `fetch()` for KB JSON files — no external network
- **Offline**: Works offline after first load
- **Browser support**: Chrome 80+, Firefox 75+, Safari 14+, Edge 80+

---

## Disclaimer

This software is provided for **educational and clinical decision support purposes only**. It does not constitute medical advice. Always consult current clinical guidelines and qualified healthcare professionals.

*Esta herramienta es solo para apoyo a la decisión clínica y fines educativos. No constituye consejo médico. Consultar siempre las guías clínicas actuales y profesionales sanitarios cualificados.*
