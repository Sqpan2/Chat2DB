import assert from 'node:assert/strict';
import type { DatabaseTypeCode } from '@/constants';
import type { IBoundInfo } from '@/typings';
import {
  attachDataSourceExecutionId,
  captureDataSourceExecutionSnapshot,
  createDataSourceExecutionBoundInfo,
  createDataSourceExecutionSnapshot,
  createDataSourceExecutionSnapshotRegistry,
  getDataSourceExecutionSnapshot,
  getDataSourceExecutionTargetLabel,
  overrideDataSourceExecutionTarget,
  registerDataSourceExecutionSnapshot,
  releaseDataSourceExecutionSnapshot,
  type DataSourceExecutionSnapshot,
} from './dataSourceExecutionSnapshot';

const registry = createDataSourceExecutionSnapshotRegistry();
const boundInfo: IBoundInfo = {
  dataSourceId: 17,
  dataSourceName: 'orders-primary',
  identityColor: '#12AB34',
  environmentId: 3,
  environment: {
    id: 3,
    name: 'Production',
    shortName: 'PROD',
    color: '#FF0000',
  },
  databaseName: 'orders',
  schemaName: 'public',
  databaseType: 'MYSQL' as DatabaseTypeCode,
  connectable: true,
};

const snapshot = captureDataSourceExecutionSnapshot(registry, 4, boundInfo, 1234);
assert.equal(Object.isFrozen(snapshot), true);
assert.deepEqual(snapshot, {
  dataSourceId: 17,
  dataSourceName: 'orders-primary',
  environmentId: 3,
  environmentName: 'Production',
  environmentShortName: 'PROD',
  databaseName: 'orders',
  schemaName: 'public',
  databaseType: 'MYSQL',
  connectable: true,
  startedAt: 1234,
});
assert.equal(
  Object.prototype.hasOwnProperty.call(snapshot, 'identityColor'),
  false,
  'presentation color must remain dynamically resolved instead of being frozen into execution identity',
);

boundInfo.dataSourceName = 'renamed-after-start';
boundInfo.databaseName = 'switched-after-start';
boundInfo.environment!.shortName = 'STAGE';
assert.equal(snapshot.dataSourceName, 'orders-primary');
assert.equal(snapshot.databaseName, 'orders');
assert.equal(snapshot.environmentShortName, 'PROD');

assert.equal(attachDataSourceExecutionId(registry, 4, 'execution-4'), snapshot);
assert.equal(getDataSourceExecutionSnapshot(registry, { executionId: 'execution-4' }), snapshot);
assert.equal(getDataSourceExecutionSnapshot(registry, { executionSequence: 4 }), snapshot);
assert.equal(getDataSourceExecutionTargetLabel(snapshot), 'PROD / orders-primary / orders / public');

releaseDataSourceExecutionSnapshot(registry, { executionId: 'execution-4' });
assert.equal(getDataSourceExecutionSnapshot(registry, { executionId: 'execution-4' }), undefined);
assert.equal(getDataSourceExecutionSnapshot(registry, { executionSequence: 4 }), undefined);

const clickTarget = createDataSourceExecutionSnapshot(
  {
    dataSourceId: 21,
    dataSourceName: 'source-at-click',
    databaseName: 'database-at-click',
    schemaName: 'schema-at-click',
    databaseType: 'MYSQL' as DatabaseTypeCode,
  },
  6000,
);
const mutableEditorTarget: IBoundInfo = {
  dataSourceId: 22,
  dataSourceName: 'source-after-parser',
  databaseName: 'database-after-parser',
  schemaName: 'schema-after-parser',
  databaseType: 'POSTGRESQL' as DatabaseTypeCode,
};
const registeredClickTarget = registerDataSourceExecutionSnapshot(registry, 6, clickTarget);
assert.equal(registeredClickTarget, clickTarget, 'execution registration must preserve the click-time snapshot');
assert.notEqual(registeredClickTarget.dataSourceId, mutableEditorTarget.dataSourceId);
assert.deepEqual(getDataSourceExecutionSnapshot(registry, { executionSequence: 6 }), clickTarget);
releaseDataSourceExecutionSnapshot(registry, { executionSequence: 6 });

const parserBoundInfoSource: IBoundInfo = {
  consoleId: 71,
  dataSourceId: 21,
  dataSourceName: 'source-at-click',
  environment: { id: 3, name: 'Production', shortName: 'PROD', color: '#FF0000' },
};
const parserBoundInfo = createDataSourceExecutionBoundInfo(parserBoundInfoSource);
parserBoundInfoSource.consoleId = 72;
parserBoundInfoSource.dataSourceId = 22;
parserBoundInfoSource.environment!.shortName = 'STAGE';
assert.equal(Object.isFrozen(parserBoundInfo), true);
assert.equal(Object.isFrozen(parserBoundInfo.environment), true);
assert.equal(parserBoundInfo.consoleId, 71, 'quick parsing retains the click-time console id');
assert.equal(parserBoundInfo.dataSourceId, 21);
assert.equal(parserBoundInfo.environment?.shortName, 'PROD');

captureDataSourceExecutionSnapshot(registry, 5, boundInfo, 5678);
releaseDataSourceExecutionSnapshot(registry, { executionSequence: 5 });
assert.equal(getDataSourceExecutionSnapshot(registry, { executionSequence: 5 }), undefined);
assert.equal(attachDataSourceExecutionId(registry, 99, 'missing-execution'), undefined);
assert.equal(getDataSourceExecutionTargetLabel(undefined), '');


const runSnapshot: DataSourceExecutionSnapshot = {
  dataSourceId: 5,
  dataSourceName: 'test-ajk02',
  databaseName: 'db58_hbg_governance',
  databaseType: 'MYSQL' as DatabaseTypeCode,
  startedAt: 1000,
};

const untouched = overrideDataSourceExecutionTarget(runSnapshot, undefined);
assert.equal(untouched, runSnapshot, 'a result without an execution context keeps the run snapshot');

const localContext = overrideDataSourceExecutionTarget(runSnapshot, {
  databaseName: 'db58_hbg_governance',
  dataSourceId: 5,
});
assert.equal(localContext, runSnapshot, 'a result from the bound datasource keeps the run snapshot');

const routed = overrideDataSourceExecutionTarget(runSnapshot, {
  dataSourceId: 1791514442495999,
  dataSourceName: 'test-ajk-user02',
  databaseName: 'db58_hbg_ccf',
  autoLocated: true,
});
assert.notEqual(routed, runSnapshot, 'a routed result reports the target it ran on');
assert.equal(routed?.dataSourceId, 1791514442495999);
assert.equal(routed?.dataSourceName, 'test-ajk-user02');
assert.equal(routed?.databaseName, 'db58_hbg_ccf');
assert.equal(routed?.databaseType, 'MYSQL' as DatabaseTypeCode, 'the dialect of the run is kept');
assert.equal(routed?.environmentId, undefined, 'the routed target carries no environment of its own');

console.log('Data source execution snapshot tests passed');

