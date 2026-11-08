import test from 'node:test';
import assert from 'node:assert/strict';
import { selectVisibleReport } from '../public/view-selection.js';

const fixture = { id: 'test', status: 'operator-reviewed', simulated: true };
const real = { id: 'real', status: 'hub-received', simulated: false };
test('a filtered-out old fixture is replaced by the first visible hardware report', () => {
  const view = selectVisibleReport([real, fixture], 'unreviewed', 'test');
  assert.deepEqual(view.reports, [real]); assert.equal(view.selectedId, 'real'); assert.equal(view.selectedReport, real);
});
test('empty filter clears detail selection rather than retaining an invisible report', () => {
  const view = selectVisibleReport([fixture], 'unreviewed', 'test');
  assert.deepEqual(view.reports, []); assert.equal(view.selectedId, null); assert.equal(view.selectedReport, null);
  assert.equal(selectVisibleReport([], 'all', 'missing').selectedReport, null);
});
test('new report arrival preserves the operator currently reading a visible real report', () => {
  const newer = { id: 'new', status: 'hub-received', simulated: false };
  const view = selectVisibleReport([newer, real, fixture], 'unreviewed', 'real');
  assert.deepEqual(view.reports, [newer, real]); assert.equal(view.selectedId, 'real');
});
test('reviewing the selected incident removes it from the awaiting queue and chooses another visible report', () => {
  const remaining = { id: 'remaining', status: 'hub-received', simulated: false };
  const reviewed = { ...real, status: 'operator-reviewed' };
  const view = selectVisibleReport([reviewed, remaining, fixture], 'unreviewed', 'real');
  assert.equal(view.selectedId, 'remaining'); assert.equal(view.selectedReport, remaining);
  assert.equal(selectVisibleReport([reviewed, fixture], 'unreviewed', 'real').selectedReport, null);
});
test('switching to reviewed chooses a visible reviewed incident and does not mutate source order', () => {
  const source = [real, fixture]; const view = selectVisibleReport(source, 'reviewed', 'real');
  assert.equal(view.selectedId, 'test'); assert.deepEqual(source, [real, fixture]);
  assert.equal(selectVisibleReport(source, 'all', 'test').selectedId, 'test');
});
