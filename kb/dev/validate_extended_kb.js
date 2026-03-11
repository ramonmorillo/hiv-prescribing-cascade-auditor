#!/usr/bin/env node
/**
 * validate_extended_kb.js
 * Validates kb_vih_modifiers.json and ddi_watchlist.json against their schemas.
 * Usage: node kb/dev/validate_extended_kb.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

/* ── helpers ──────────────────────────────────────────────────────────────── */

function loadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return { data: JSON.parse(raw), error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
}

function checkString(entry, field, errors, label) {
  if (!(field in entry) || entry[field] === null || entry[field] === undefined) {
    errors.push(`[${label}] Missing required field: "${field}"`);
  } else if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
    errors.push(`[${label}] Field "${field}" must be a non-blank string`);
  }
}

function checkArray(entry, field, errors, label) {
  if (!(field in entry) || !Array.isArray(entry[field])) {
    errors.push(`[${label}] Field "${field}" must be an array`);
  } else if (entry[field].length === 0) {
    errors.push(`[${label}] Array field "${field}" must not be empty`);
  }
}

function checkNumber(entry, field, errors, label) {
  if (!(field in entry) || typeof entry[field] !== 'number') {
    errors.push(`[${label}] Field "${field}" must be a number`);
  }
}

function checkEnum(entry, field, validValues, errors, label) {
  if (!(field in entry)) {
    errors.push(`[${label}] Missing required field: "${field}"`);
  } else if (!validValues.includes(entry[field])) {
    errors.push(`[${label}] Field "${field}" must be one of [${validValues.join(', ')}], got: "${entry[field]}"`);
  }
}

/* ── Modifier validator ───────────────────────────────────────────────────── */

function validateModifiers(filePath) {
  console.log(`\n── Validating: ${path.basename(filePath)} ──`);
  const { data, error } = loadJson(filePath);
  if (error) {
    console.error(`  ✗ JSON parse error: ${error}`);
    return { ok: false, count: 0 };
  }

  const errors = [];
  const warnings = [];

  if (!data.version)      warnings.push('Missing top-level "version" field');
  if (!data.last_updated) warnings.push('Missing top-level "last_updated" field');

  if (!Array.isArray(data.art_related_cascades)) {
    errors.push('Missing "art_related_cascades" array at top level');
    printResult(errors, warnings, 0);
    return { ok: false, count: 0 };
  }

  const seenIds = {};
  data.art_related_cascades.forEach((entry, idx) => {
    const label = entry && entry.id ? entry.id : `art_related_cascades[${idx}]`;

    // Duplicate ID check
    if (entry && entry.id) {
      if (seenIds[entry.id]) errors.push(`[${label}] Duplicate ID "${entry.id}"`);
      seenIds[entry.id] = true;
    }

    // Required string fields
    ['id','name_es','name_en','index_drug_class','ade_mechanism_es','ade_mechanism_en',
     'ade_es','ade_en','cascade_drug_class','clinical_note_es','clinical_note_en'].forEach(f => {
      checkString(entry, f, errors, label);
    });

    // Required array fields
    ['index_drugs_examples','cascade_drugs_examples','references'].forEach(f => {
      checkArray(entry, f, errors, label);
    });

    // Required number fields
    checkNumber(entry, 'time_to_ade_typical_days_min', errors, label);
    checkNumber(entry, 'time_to_ade_typical_days_max', errors, label);

    // Enum fields
    checkEnum(entry, 'plausibility', ['high','medium','low'], errors, label);
    checkEnum(entry, 'evidence_level', ['A','B','C'], errors, label);

    // Optional bilingual DDI warning: if one present, both should be present
    if (entry.ddi_warning_es || entry.ddi_warning_en) {
      if (!entry.ddi_warning_es) warnings.push(`[${label}] Has ddi_warning_en but missing ddi_warning_es`);
      if (!entry.ddi_warning_en) warnings.push(`[${label}] Has ddi_warning_es but missing ddi_warning_en`);
    }
  });

  return printResult(errors, warnings, data.art_related_cascades.length);
}

/* ── DDI validator ─────────────────────────────────────────────────────────── */

function validateDDI(filePath) {
  console.log(`\n── Validating: ${path.basename(filePath)} ──`);
  const { data, error } = loadJson(filePath);
  if (error) {
    console.error(`  ✗ JSON parse error: ${error}`);
    return { ok: false, count: 0 };
  }

  const errors = [];
  const warnings = [];

  if (!data.version)      warnings.push('Missing top-level "version" field');
  if (!data.last_updated) warnings.push('Missing top-level "last_updated" field');

  if (!Array.isArray(data.interactions)) {
    errors.push('Missing "interactions" array at top level');
    printResult(errors, warnings, 0);
    return { ok: false, count: 0 };
  }

  const seenIds  = {};
  const seenPairs = {};

  data.interactions.forEach((entry, idx) => {
    const label = entry && entry.id ? entry.id : `interactions[${idx}]`;

    // Duplicate ID check
    if (entry && entry.id) {
      if (seenIds[entry.id]) errors.push(`[${label}] Duplicate ID "${entry.id}"`);
      seenIds[entry.id] = true;
    }

    // Duplicate drug pair check (order-insensitive)
    if (entry && entry.drug_a && entry.drug_b) {
      const pairKey = [entry.drug_a, entry.drug_b].sort().join(' :: ');
      if (seenPairs[pairKey]) {
        warnings.push(`[${label}] Possible duplicate drug pair: "${entry.drug_a}" + "${entry.drug_b}" (existing: ${seenPairs[pairKey]})`);
      }
      seenPairs[pairKey] = entry.id;
    }

    // Required string fields
    ['id','drug_a','drug_a_class','drug_b','drug_b_class',
     'mechanism_es','mechanism_en','consequence_es','consequence_en',
     'management_es','management_en','cascade_relevance_es','cascade_relevance_en'].forEach(f => {
      checkString(entry, f, errors, label);
    });

    // Severity enum
    checkEnum(entry, 'severity',
      ['CONTRAINDICATED','MAJOR','MODERATE','MINOR'], errors, label);
  });

  return printResult(errors, warnings, data.interactions.length);
}

/* ── Print helper ─────────────────────────────────────────────────────────── */

function printResult(errors, warnings, count) {
  warnings.forEach(w => console.warn(`  ⚠  ${w}`));
  if (errors.length === 0) {
    console.log(`  ✓ OK — ${count} entries, 0 errors, ${warnings.length} warning(s)`);
    return { ok: true, count };
  } else {
    errors.forEach(e => console.error(`  ✗ ${e}`));
    console.error(`  FAIL — ${errors.length} error(s), ${warnings.length} warning(s)`);
    return { ok: false, count };
  }
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

const DEV = path.join(__dirname);

const modResult = validateModifiers(path.join(DEV, 'kb_vih_modifiers.json'));
const ddiResult = validateDDI(path.join(DEV, 'ddi_watchlist.json'));

console.log('\n═══════════════════════════════════════════');
console.log(`Modifiers : ${modResult.ok ? '✓ PASS' : '✗ FAIL'} — ${modResult.count} entries`);
console.log(`DDI rules : ${ddiResult.ok ? '✓ PASS' : '✗ FAIL'} — ${ddiResult.count} entries`);
console.log('═══════════════════════════════════════════');

process.exit(modResult.ok && ddiResult.ok ? 0 : 1);
