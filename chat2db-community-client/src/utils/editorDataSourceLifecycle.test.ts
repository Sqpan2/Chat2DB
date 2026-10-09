import assert from 'node:assert/strict';
import type { IBoundInfo } from '@/typings';
import {
  adoptBoundDataSourceContext,
  getDataSourceRuntimeAvailabilityGeneration,
  getSqlExecutionBlockReason,
  mergeLiveDataSourceContext,
  resolveEditorDataSourceConnectable,
  resolveEditorDataSourceState,
  transitionDataSourceRuntimeAvailability,
} from './editorDataSourceLifecycle';

const dataSourceList = [{ extraParams: { dataSourceId: 7 } }];

assert.equal(resolveEditorDataSourceState(undefined, dataSourceList, {}), 'unbound');
assert.equal(resolveEditorDataSourceState(7, null, {}), 'loading');
assert.equal(resolveEditorDataSourceState(7, dataSourceList, {}), 'available');
assert.equal(resolveEditorDataSourceState(7, dataSourceList, { 7: 'unavailable' }), 'unavailable');
assert.equal(resolveEditorDataSourceState(9, dataSourceList, { 9: 'available' }), 'deleted');

assert.equal(resolveEditorDataSourceConnectable('loading', undefined), undefined);
assert.equal(resolveEditorDataSourceConnectable('loading', true), true);
assert.equal(resolveEditorDataSourceConnectable('available'), true);
assert.equal(resolveEditorDataSourceConnectable('unavailable'), false);
assert.equal(resolveEditorDataSourceConnectable('deleted'), false);

assert.equal(getSqlExecutionBlockReason(undefined, 'unbound'), 'missingDataSource');
assert.equal(getSqlExecutionBlockReason(7, 'deleted'), 'deletedDataSource');
assert.equal(getSqlExecutionBlockReason(7, 'unavailable'), undefined, 'unavailable connections may retry execution');
assert.equal(getSqlExecutionBlockReason(7, 'available'), undefined);

const unavailableState = {
  runtimeAvailabilityByDataSourceId: { 7: 'unavailable' as const },
  runtimeAvailabilityGenerationByDataSourceId: { 7: 3 },
};
const restoredState = transitionDataSourceRuntimeAvailability(unavailableState, 7, 'available', 3)!;
assert.equal(restoredState.runtimeAvailabilityByDataSourceId[7], 'available');
assert.equal(
  getDataSourceRuntimeAvailabilityGeneration(restoredState.runtimeAvailabilityGenerationByDataSourceId, 7),
  4,
);
assert.equal(
  transitionDataSourceRuntimeAvailability(restoredState, 7, 'available', 3),
  undefined,
  'an execution success cannot overwrite a newer availability mutation',
);
const deletedState = transitionDataSourceRuntimeAvailability(unavailableState, 7, undefined)!;
assert.equal(deletedState.runtimeAvailabilityByDataSourceId[7], undefined);
assert.equal(
  getDataSourceRuntimeAvailabilityGeneration(deletedState.runtimeAvailabilityGenerationByDataSourceId, 7),
  4,
  'clearing availability keeps a generation tombstone for stale executions',
);

const current: IBoundInfo = {
  dataSourceId: 7,
  dataSourceName: 'old-name',
  environmentId: 1,
  environment: { id: 1, name: 'Old environment' },
  identityColor: '#112233',
  watermarkEnabled: true,
  watermarkContent: 'Old watermark',
  databaseName: 'editor_database',
  schemaName: 'editor_schema',
  connectable: true,
};
const liveEnvironment = { id: 2, name: 'Production', shortName: 'PROD', color: '#FF0000' };
const merged = mergeLiveDataSourceContext(current, {
  dataSourceId: 7,
  dataSourceName: 'renamed-source',
  environmentId: 2,
  environment: liveEnvironment,
  identityColor: '#AABBCC',
  watermarkEnabled: false,
  watermarkContent: 'Finance',
  connectable: false,
});

assert.deepEqual(merged, {
  ...current,
  dataSourceName: 'renamed-source',
  environmentId: 2,
  environment: liveEnvironment,
  identityColor: '#AABBCC',
  watermarkEnabled: false,
  watermarkContent: 'Finance',
  connectable: false,
});
assert.equal(merged.databaseName, 'editor_database');
assert.equal(merged.schemaName, 'editor_schema');
assert.equal(
  mergeLiveDataSourceContext(merged, {
    dataSourceId: 7,
    dataSourceName: 'renamed-source',
    environmentId: 2,
    environment: liveEnvironment,
    identityColor: '#AABBCC',
    watermarkEnabled: false,
    watermarkContent: 'Finance',
    connectable: false,
  }),
  merged,
  'unchanged live context preserves the current object',
);


// A console the tree re-pointed at another datasource takes its dialect and database along.
const adopted = adoptBoundDataSourceContext(
  { dataSourceId: 5, dataSourceName: 'test-ajk-user03', databaseType: 'MYSQL' as any, databaseName: 'db58_hbg_audit' },
  {
    dataSourceId: 7,
    dataSourceName: 'test-ajk-user02',
    databaseType: 'MYSQL' as any,
    databaseName: 'db58_hbg_ccf',
    supportDatabase: true,
  },
);
assert.equal(adopted.dataSourceId, 7, 'the console follows the datasource the tree handed it');
assert.equal(adopted.dataSourceName, 'test-ajk-user02');
assert.equal(adopted.databaseName, 'db58_hbg_ccf', 'and the database holding the table it was handed');
assert.equal(adopted.supportDatabase, true, 'the dialect support of the new datasource comes with it');

// A write to the store that does not move the console must not drag its binding along.
const untouched = adoptBoundDataSourceContext(
  { dataSourceId: 5, dataSourceName: 'test-ajk-user03', databaseType: 'MYSQL' as any, databaseName: 'db58_hbg_audit' },
  { dataSourceId: 5, dataSourceName: 'renamed', databaseType: 'MYSQL' as any, databaseName: 'db58_hbg_audit' },
);
assert.equal(untouched.dataSourceName, 'renamed', 'the identity of the datasource record still reaches the console');
assert.equal(untouched.databaseName, 'db58_hbg_audit', 'and the console keeps the database it is holding');

console.log('Editor data source lifecycle tests passed');
