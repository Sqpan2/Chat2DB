import assert from 'node:assert/strict';
import {
  MAX_RECENT_EXECUTED_DATA_SOURCE_IDS,
  UNBOUND_COMPLETION_MAX_SCOPES,
  buildUnboundCompletionScopes,
  recordExecutedDataSource,
} from './unboundCompletion';

assert.deepEqual(recordExecutedDataSource([], 7), [7], 'the first execution starts the recency list');
assert.deepEqual(recordExecutedDataSource([1, 2, 3], 2), [2, 1, 3], 'a remembered datasource moves to the front');
assert.deepEqual(recordExecutedDataSource([1], 2), [2, 1], 'a new datasource leads the list');
assert.deepEqual(recordExecutedDataSource(undefined, 5), [5], 'a missing list is treated as empty');
assert.deepEqual(recordExecutedDataSource([1, 2], undefined), [1, 2], 'an unusable id leaves the order untouched');
assert.deepEqual(recordExecutedDataSource([1, 2], 0), [1, 2], 'a datasource id below one is not remembered');
assert.deepEqual(recordExecutedDataSource([1, 2], Number.NaN), [1, 2], 'a non-numeric id is not remembered');

const existing = [1, 2];
assert.notEqual(recordExecutedDataSource(existing, 3), existing, 'recording must not mutate the stored list');
assert.deepEqual(existing, [1, 2], 'the stored list stays untouched');

const many = Array.from({ length: MAX_RECENT_EXECUTED_DATA_SOURCE_IDS }, (_, index) => index + 1);
assert.equal(
  recordExecutedDataSource(many, 999).length,
  MAX_RECENT_EXECUTED_DATA_SOURCE_IDS,
  'the recency list stays bounded',
);
assert.equal(recordExecutedDataSource(many, 999)[0], 999, 'the newest datasource survives the trim');

assert.deepEqual(
  buildUnboundCompletionScopes([3, 1], [1, 2, 3, 4]),
  [{ dataSourceId: 3 }, { dataSourceId: 1 }, { dataSourceId: 2 }, { dataSourceId: 4 }],
  'recently executed datasources lead, the rest follow in tree order',
);
assert.deepEqual(
  buildUnboundCompletionScopes([], [2, null, undefined, 0, Number.NaN, 5]),
  [{ dataSourceId: 2 }, { dataSourceId: 5 }],
  'only usable datasource ids become scopes',
);
assert.deepEqual(buildUnboundCompletionScopes(undefined, undefined), [], 'no datasource means no scope');

const crowded = Array.from({ length: UNBOUND_COMPLETION_MAX_SCOPES + 5 }, (_, index) => index + 1);
assert.equal(
  buildUnboundCompletionScopes([], crowded).length,
  UNBOUND_COMPLETION_MAX_SCOPES,
  'the fan-out stays bounded',
);
assert.deepEqual(
  buildUnboundCompletionScopes([99], crowded).at(-1),
  { dataSourceId: UNBOUND_COMPLETION_MAX_SCOPES - 1 },
  'the recently executed datasource is kept and the tree order fills the budget',
);

assert.deepEqual(
  buildUnboundCompletionScopes([5, 3], [1, 5, 3], 5),
  [{ dataSourceId: 3 }, { dataSourceId: 1 }],
  'the datasource the editor is bound to is supplied as its own scope and never listed twice',
);
assert.deepEqual(
  buildUnboundCompletionScopes([1, 2], [1, 2], undefined),
  [{ dataSourceId: 1 }, { dataSourceId: 2 }],
  'without a bound datasource nothing is excluded',
);
assert.deepEqual(
  buildUnboundCompletionScopes([], [1, 2], 0),
  [{ dataSourceId: 1 }, { dataSourceId: 2 }],
  'an unusable bound datasource excludes nothing',
);

console.log('Unbound completion tests passed');
