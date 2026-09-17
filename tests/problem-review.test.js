'use strict';

const PR = require('../problem-review.js');
const { assert, assertEqual, reset, summary } = require('./helpers');

function run() {
  reset(); console.log('== problem-review.test.js ==');
  const extracted = [
    { id: 'CP_HTN', problem: 'Hipertensión arterial', status: 'active', temporality: 'historical', source: 'explicit', evidence_span: 'HTA desde 2020', first_active_date: { raw: '2020' } },
    { id: 'CP_EDEMA', problem: 'Edema periférico', status: 'suspected', temporality: 'current', source: 'explicit', evidence_span: 'Edema desde mayo de 2024' }
  ];
  const review = PR.create(extracted, '2026-09-17T12:00:00.000Z');
  assertEqual('review contains extracted problems', review.items.map((item) => item.concept), ['Hipertensión arterial', 'Edema periférico']);
  assert('original status and temporality are preserved', review.items[0].original_status === 'active' && review.items[0].original_temporality === 'historical');
  assert('extracted onset date is preserved', review.items[0].onset_date === '2020');
  assert('signature does not depend on extraction order', PR.sourceSignature(extracted) === PR.sourceSignature(extracted.slice().reverse()));
  const translated = extracted.map((problem, index) => Object.assign({}, problem, { problem: index ? 'Peripheral oedema' : 'Hypertension' }));
  assert('signature is stable when the interface language changes', PR.sourceSignature(extracted) === PR.sourceSignature(translated));

  const corrected = PR.updateItem(review, 'extracted-2', { status: 'active', temporality: 'historical', onset_date: '2022' }, '2026-09-17T12:01:00.000Z');
  assert('status, temporality, and onset can be corrected', corrected.items[1].status === 'active' && corrected.items[1].temporality === 'historical' && corrected.items[1].onset_date === '2022');
  assert('correction is detected', PR.hasChanges(corrected));

  const excluded = PR.updateItem(corrected, 'extracted-1', { included: false });
  assertEqual('excluded problem does not enter reviewed problems', PR.reviewedProblems(excluded).map((item) => item.concept), ['Edema periférico']);

  const added = PR.addManualItem(excluded, '2026-09-17T12:02:00.000Z');
  const manualId = added.items[added.items.length - 1].id;
  const completed = PR.updateItem(added, manualId, { concept: 'Insuficiencia renal', status: 'active', temporality: 'current', onset_date: '2026' });
  assert('manual problem retains provenance', completed.items.some((item) => item.id === manualId && item.source === 'manual' && item.concept === 'Insuficiencia renal'));

  const confirmed = PR.confirm(completed, '2026-09-17T12:03:00.000Z');
  assert('valid review can be confirmed', confirmed.ok && confirmed.review.status === 'confirmed');
  assert('confirmation timestamp is stored', confirmed.review.confirmed_at === '2026-09-17T12:03:00.000Z');

  const invalidStatus = PR.updateItem(completed, manualId, { status: 'invented', temporality: 'tomorrow' });
  assert('unrecognized controlled values are downgraded safely', invalidStatus.items.find((item) => item.id === manualId).status === 'unknown' && invalidStatus.items.find((item) => item.id === manualId).temporality === 'undetermined');

  const duplicate = PR.updateItem(completed, manualId, { concept: 'Edema periférico' });
  assert('duplicate included problem blocks confirmation', !PR.confirm(duplicate).ok);
  const blank = PR.updateItem(completed, manualId, { concept: '' });
  assert('blank included problem blocks confirmation', !PR.validate(blank).valid);
  assert('blank excluded problem is valid', PR.validate(PR.updateItem(blank, manualId, { included: false })).valid);

  const stale = PR.ensureCurrent(confirmed.review, [{ id: 'CP_DM', problem: 'Diabetes mellitus', status: 'active', temporality: 'historical' }]);
  assertEqual('changed extraction invalidates stale review', stale.items.map((item) => item.concept), ['Diabetes mellitus']);
  assert('invalidated review returns to draft', stale.status === 'draft');

  const sanitized = PR.sanitize({
    version: 1, source_signature: 'safe', status: 'confirmed', confirmed_at: null,
    items: [{ id: 'manual-1', source: 'manual', concept: '  Test\u0000 problem  ', status: 'bad', temporality: 'bad', included: true }]
  });
  assert('sanitizer removes control characters', sanitized.items[0].concept === 'Test problem');
  assert('confirmed state without timestamp is downgraded', sanitized.status === 'draft' && sanitized.confirmed_at === null);
  assert('malformed review is rejected', PR.sanitize({ version: 99, items: [] }) === null);

  const removed = PR.removeManualItem(completed, manualId);
  assert('manual problem can be removed', !removed.items.some((item) => item.id === manualId));
  assert('extracted problem cannot be deleted from audit trail', PR.removeManualItem(completed, 'extracted-1').items.some((item) => item.id === 'extracted-1'));

  const r = summary(); console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`); return r.fail === 0;
}

module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
