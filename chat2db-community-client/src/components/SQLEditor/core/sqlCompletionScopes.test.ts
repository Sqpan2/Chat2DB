import assert from 'node:assert/strict';
import { DatabaseTypeCode } from '@/constants/common';
import { TreeNodeType } from '@/constants/tree';
import type { IBoundInfo, TreeNodeData } from '@/typings';
import { resolveSqlCompletionScopes, shouldFanOutSqlCompletion } from './sqlCompletionScopes';

const dataSourceNode = (dataSourceId: number, hasPermission = true): TreeNodeData => ({
  key: `dataSource_${dataSourceId}`,
  originalTitle: `source-${dataSourceId}`,
  treeNodeType: TreeNodeType.DATA_SOURCE,
  extraParams: { dataSourceId, hasPermission },
});

const sources = {
  executedDataSourceIds: [7],
  dataSourceNodes: [dataSourceNode(1), dataSourceNode(7), dataSourceNode(9, false)],
};

const consoleTab: IBoundInfo = { consoleId: 42 };

assert.equal(
  shouldFanOutSqlCompletion({ ...consoleTab, dataSourceId: 5, databaseType: DatabaseTypeCode.MYSQL, databaseName: 'app' }),
  true,
  'a bound MySQL console reaches the other datasources as well',
);
assert.equal(
  shouldFanOutSqlCompletion({ ...consoleTab, dataSourceId: 5, databaseType: DatabaseTypeCode.MYSQL }),
  true,
  'a MySQL console without a database reaches the other datasources as well',
);
assert.equal(
  shouldFanOutSqlCompletion({ ...consoleTab, dataSourceId: 5, databaseType: DatabaseTypeCode.POSTGRESQL }),
  false,
  'a dialect without backend completion keeps its own behaviour',
);
assert.equal(
  shouldFanOutSqlCompletion({ consoleId: 42, workspaceTabId: 99 }),
  true,
  'a console with nothing bound fans out',
);
assert.equal(
  shouldFanOutSqlCompletion({ workspaceTabId: 99 }),
  false,
  'a local SQL file keeps its own behaviour even when nothing is bound',
);
assert.equal(shouldFanOutSqlCompletion({ workspaceTabId: 'local-file-tab' }), false, 'a terminal keeps its own behaviour');
assert.equal(shouldFanOutSqlCompletion(undefined), false, 'a missing binding cannot be fanned out');

assert.deepEqual(
  resolveSqlCompletionScopes(consoleTab, sources),
  [{ dataSourceId: 7 }, { dataSourceId: 1 }],
  'an unbound console completes against the recently executed datasource first and skips unreadable ones',
);
assert.deepEqual(
  resolveSqlCompletionScopes(
    { ...consoleTab, dataSourceId: 5, databaseType: DatabaseTypeCode.MYSQL, databaseName: 'app', schemaName: 's1' },
    sources,
  ),
  [{ dataSourceId: 5, databaseName: 'app', schemaName: 's1' }, { dataSourceId: 7 }, { dataSourceId: 1 }],
  'the bound datasource leads, narrowed to the chosen database, and the rest of the tree follows',
);
assert.deepEqual(
  resolveSqlCompletionScopes({ ...consoleTab, dataSourceId: 5, databaseType: DatabaseTypeCode.MYSQL }, sources),
  [{ dataSourceId: 5 }, { dataSourceId: 7 }, { dataSourceId: 1 }],
  'without a chosen database the bound datasource leads with every database of its own',
);
assert.deepEqual(
  resolveSqlCompletionScopes({ ...consoleTab, dataSourceId: 5, databaseType: DatabaseTypeCode.POSTGRESQL }, sources),
  [],
  'a console whose dialect cannot fan out keeps the bound request',
);
assert.deepEqual(
  resolveSqlCompletionScopes(
    { ...consoleTab, dataSourceId: 7, databaseType: DatabaseTypeCode.MYSQL },
    sources,
  ),
  [{ dataSourceId: 7 }, { dataSourceId: 1 }],
  'the bound datasource is not listed a second time when it is also the most recently executed one',
);

const crowded = Array.from({ length: 15 }, (_, index) => dataSourceNode(index + 1));
assert.deepEqual(
  resolveSqlCompletionScopes(
    { ...consoleTab, dataSourceId: 99, databaseType: DatabaseTypeCode.MYSQL },
    { executedDataSourceIds: [], dataSourceNodes: crowded },
  ).slice(-1),
  [{ dataSourceId: 11 }],
  'the leading bound scope does not push the fan-out past its bound',
);

console.log('SQL completion scope tests passed');
