#!/usr/bin/env node
/* merge_cascades.js
 * Merges CC041-CC090 from prescribing_cascades_CC041_CC090_FINAL.json
 * into kb_core_cascades.json, mapping the new schema to the existing KB schema.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DEV_DIR  = __dirname;
const CORE_PATH = path.join(DEV_DIR, 'kb_core_cascades.json');
const NEW_PATH  = path.join(DEV_DIR, 'prescribing_cascades_CC041_CC090_FINAL.json');
const OUT_PATH  = CORE_PATH; // write back in-place

const validator = require(path.join(DEV_DIR, 'kb_validator.js'));

/* ── Load source files ───────────────────────────────────────────────────── */
const core = JSON.parse(fs.readFileSync(CORE_PATH, 'utf8'));
const incoming = JSON.parse(fs.readFileSync(NEW_PATH, 'utf8')); // array

console.log(`[merge] Core cascades before merge: ${core.cascades.length}`);
console.log(`[merge] Incoming cascades to process: ${incoming.length}`);

/* ── evidence_strength → confidence ─────────────────────────────────────── */
function mapConfidence(ev) {
  if (ev === 'high')     return 'high';
  if (ev === 'moderate') return 'medium';
  if (ev === 'low')      return 'low';
  return 'medium'; // safe fallback
}

/* ── priority → age_sensitivity ─────────────────────────────────────────── */
function mapAgeSensitivity(priority) {
  if (priority === 'critical') return 'high';
  if (priority === 'high')     return 'high';
  if (priority === 'medium')   return 'medium';
  if (priority === 'low')      return 'low';
  return 'medium'; // safe fallback
}

/* ── Derive risk_focus from ADE + drug_class + treatment_class ────────────── */
function deriveRiskFocus(ade, drug_class, treatment_class) {
  const risks = new Set();
  const s = (ade + ' ' + drug_class + ' ' + treatment_class).toLowerCase();

  if (/hypertension|blood pressure|\bhp\b|cardiovascular|cardiac|arrhythmia|headache|edema|hypotension/.test(s))
    risks.add('cardiovascular');
  if (/renal|kidney|nephro|fanconi/.test(s))
    risks.add('renal');
  if (/\belectrolyte|potassium|sodium|magnesium|phosph|hypokalemi|hyponatremi|hypomagnesemi|hypophosph/.test(s))
    risks.add('electrolyte');
  if (/depress|neurolog|parkinson|tremor|extrapyramid|akathisi|bruxism|insomnia|psychiatric|neuropsychiatric|sialorrhea/.test(s))
    risks.add('neurological');
  if (/metabolic|diabet|hyperglycemi|dyslipidem|weight|insulin|vitamin b12|b12 deficiency/.test(s))
    risks.add('metabolic');
  if (/endocrine|thyroid|hypothyroid|hyperprolactin|prolactin|diabetes insipidus/.test(s))
    risks.add('endocrine');
  if (/muscl|myalgi|tendon|tendinopathy|gout|uric acid|hyperuricemi|musculoskeletal/.test(s))
    risks.add('musculoskeletal');
  if (/gastrointestinal|nausea|vomiting|constipation|\bgi\b|esophagitis|gastric/.test(s))
    risks.add('gastrointestinal');
  if (/cough|respiratory/.test(s))
    risks.add('respiratory');
  if (/erectile|sexual dysfunction|urolog/.test(s))
    risks.add('urological');
  if (/anticholinergic|sialorrhea/.test(s))
    risks.add('anticholinergic');

  // Ensure at least one risk bucket
  if (risks.size === 0) risks.add('safety');

  return [...risks];
}

/* ── Build differential_hints from ade_synonyms + clinical_concern ────────── */
function buildDifferentialHints(entry) {
  const hints = [];

  // Use ade_synonyms as alternative presentation hints (first up to 3)
  if (Array.isArray(entry.ade_synonyms) && entry.ade_synonyms.length > 0) {
    entry.ade_synonyms.slice(0, 3).forEach(syn => hints.push(syn));
  }

  // Pad to 3 using clinical_concern sentences if needed
  if (hints.length < 3 && entry.clinical_concern) {
    const sentences = entry.clinical_concern
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 10);
    for (const sent of sentences) {
      if (hints.length >= 3) break;
      if (!hints.includes(sent)) hints.push(sent);
    }
  }

  return hints.length > 0 ? hints : ['Alternative diagnoses should be considered'];
}

/* ── Map incoming entry to KB schema ─────────────────────────────────────── */
function mapEntry(e) {
  return {
    id:                      e.id,
    name_en:                 e.name,
    index_drug_classes:      [e.drug_class],
    index_drug_examples:     e.trigger_drug,
    ade_mechanism_en:        e.clinical_concern || '',
    ade_en:                  e.ade,
    cascade_drug_class:      e.treatment_class,
    cascade_drug_examples:   e.treatment_drug,
    confidence:              mapConfidence(e.evidence_strength),
    age_sensitivity:         mapAgeSensitivity(e.priority),
    risk_focus:              deriveRiskFocus(e.ade, e.drug_class, e.treatment_class),
    differential_hints:      buildDifferentialHints(e),
    appropriateness:         e.appropriateness
  };
}

/* ── Merge logic ─────────────────────────────────────────────────────────── */
const existingIds = new Set(core.cascades.map(c => c.id));

let duplicatesRemoved = 0;
const newEntries = [];

for (const entry of incoming) {
  if (existingIds.has(entry.id)) {
    console.warn(`[merge] WARNING: Duplicate ID ${entry.id} — skipping`);
    duplicatesRemoved++;
  } else {
    newEntries.push(mapEntry(entry));
    existingIds.add(entry.id);
  }
}

console.log(`[merge] New entries added: ${newEntries.length}`);
if (duplicatesRemoved > 0) {
  console.log(`[merge] Duplicates removed: ${duplicatesRemoved}`);
}

/* ── Merge and sort ──────────────────────────────────────────────────────── */
const merged = [...core.cascades, ...newEntries];
merged.sort((a, b) => a.id.localeCompare(b.id));

const mergedKB = Object.assign({}, core, {
  last_updated: '2026-03-10',
  cascades: merged
});

/* ── Validate ────────────────────────────────────────────────────────────── */
console.log('\n[validate] Running validateKBOperational…');
const result = validator.validateKBOperational(mergedKB, { requireTranslations: false });

if (result.errors.length > 0) {
  console.error('[validate] ERRORS:');
  result.errors.forEach(e => console.error('  ' + e));
}
if (result.warnings.length > 0) {
  console.warn('[validate] WARNINGS:');
  result.warnings.forEach(w => console.warn('  ' + w));
}
console.log(`[validate] ok=${result.ok} | fallbackCascadeCount=${result.fallbackCascadeCount} | fallbackFieldCount=${result.fallbackFieldCount}`);

if (!result.ok) {
  console.error('[merge] Validation failed — aborting write.');
  process.exit(1);
}

/* ── Write output ────────────────────────────────────────────────────────── */
fs.writeFileSync(OUT_PATH, JSON.stringify(mergedKB, null, 2) + '\n', 'utf8');
console.log(`\n[merge] Written → ${OUT_PATH}`);

/* ── Summary ─────────────────────────────────────────────────────────────── */
console.log('\n════════════════════════════════════════');
console.log('  MERGE SUMMARY');
console.log('════════════════════════════════════════');
console.log(`  Cascades before merge : ${core.cascades.length}`);
console.log(`  New cascades appended : ${newEntries.length}`);
console.log(`  Duplicates removed    : ${duplicatesRemoved}`);
console.log(`  Cascades after merge  : ${mergedKB.cascades.length}`);
console.log(`  Validation status     : ${result.ok ? 'PASS' : 'FAIL'}`);
console.log('════════════════════════════════════════');
