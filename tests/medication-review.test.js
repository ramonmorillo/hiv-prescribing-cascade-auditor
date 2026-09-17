'use strict';

const MR = require('../medication-review.js');
const { assert, assertEqual, reset, summary } = require('./helpers');

function run() {
  reset(); console.log('== medication-review.test.js ==');
  const extracted = [
    { normalized_name: 'amlodipine', drug_class: 'Calcium channel blocker' },
    { normalized_name: 'furosemide', drug_class: 'Loop diuretic' }
  ];
  const review = MR.create(extracted, '2026-09-17T10:00:00.000Z');

  assertEqual('new review records both extracted medicines', review.items.map((item) => item.normalized_name), ['amlodipine', 'furosemide']);
  assert('new review starts as draft', review.status === 'draft' && review.confirmed_at === null);
  assert('source signature is independent of extraction order',
    MR.sourceSignature(extracted) === MR.sourceSignature(extracted.slice().reverse()));

  const corrected = MR.updateItem(review, 'extracted-1', {
    normalized_name: 'nifedipine', drug_class: 'Calcium channel blocker', included: true
  }, '2026-09-17T10:01:00.000Z');
  assert('editing preserves the original extracted value for traceability',
    corrected.items[0].original_name === 'amlodipine' && corrected.items[0].normalized_name === 'nifedipine');
  assert('editing marks a confirmed review as draft', corrected.status === 'draft');
  assert('edited extracted medicine is recognized as a change', MR.hasChanges(corrected));

  const excluded = MR.updateItem(corrected, 'extracted-2', { included: false }, '2026-09-17T10:02:00.000Z');
  assertEqual('excluded medicines do not enter the reviewed list',
    MR.reviewedMedications(excluded).map((item) => item.normalized_name), ['nifedipine']);

  const added = MR.addManualItem(excluded, '2026-09-17T10:03:00.000Z');
  const manualId = added.items[added.items.length - 1].id;
  const completed = MR.updateItem(added, manualId, {
    normalized_name: 'bictegravir', drug_class: 'Antiretroviral / Unboosted INSTI'
  }, '2026-09-17T10:04:00.000Z');
  assert('manual medicine is retained with its provenance',
    completed.items.some((item) => item.id === manualId && item.source === 'manual' && item.normalized_name === 'bictegravir'));

  const confirmed = MR.confirm(completed, '2026-09-17T10:05:00.000Z');
  assert('valid review can be confirmed', confirmed.ok && confirmed.review.status === 'confirmed');
  assert('confirmation timestamp is recorded', confirmed.review.confirmed_at === '2026-09-17T10:05:00.000Z');

  const duplicate = MR.updateItem(completed, manualId, { normalized_name: 'nifedipine' });
  const duplicateResult = MR.confirm(duplicate);
  assert('duplicate included medicine blocks confirmation', !duplicateResult.ok && duplicateResult.errors.some((error) => error.startsWith('duplicate_name:')));

  const blank = MR.updateItem(completed, manualId, { normalized_name: '' });
  assert('blank included medicine blocks confirmation', !MR.validate(blank).valid);
  const blankExcluded = MR.updateItem(blank, manualId, { included: false });
  assert('blank excluded medicine does not block confirmation', MR.validate(blankExcluded).valid);

  const stale = MR.ensureCurrent(confirmed.review, [{ normalized_name: 'metformin', drug_class: 'Biguanide' }], '2026-09-17T11:00:00.000Z');
  assertEqual('changed extraction invalidates stale review', stale.items.map((item) => item.normalized_name), ['metformin']);
  assert('invalidated review returns to draft', stale.status === 'draft');

  const hostile = MR.sanitize({
    version: 1,
    source_signature: 'safe',
    status: 'confirmed',
    confirmed_at: '2026-09-17T10:00:00.000Z',
    items: [{ id: 'manual-1', source: 'manual', normalized_name: '  test\u0000 drug  ', drug_class: 12, included: true }]
  });
  assert('import sanitizer removes control characters and rejects non-string class values',
    hostile.items[0].normalized_name === 'test drug' && hostile.items[0].drug_class === '');
  assert('malformed saved review is rejected', MR.sanitize({ version: 99, items: [] }) === null);

  const removed = MR.removeManualItem(completed, manualId, '2026-09-17T10:06:00.000Z');
  assert('manual item can be removed', !removed.items.some((item) => item.id === manualId));
  const protectedExtracted = MR.removeManualItem(completed, 'extracted-1');
  assert('extracted items cannot be deleted from the audit trail', protectedExtracted.items.some((item) => item.id === 'extracted-1'));

  const r = summary(); console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`); return r.fail === 0;
}

module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
