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
  false,
  'a console bound to a database keeps using its own request',
);
assert.equal(
  shouldFanOutSqlCompletion({ ...consoleTab, dataSourceId: 5, databaseType: DatabaseTypeCode.MYSQL }),
  true,
  'a MySQL console without a database cannot complete against its own binding',
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
  resolveSqlCompletionScopes({ ...consoleTab, dataSourceId: 5, databaseType: DatabaseTypeCode.MYSQL }, sources),
  [{ dataSourceId: 5 }],
  'a bound datasource without a database is the only scope: the server expands it to its databases',
);
assert.deepEqual(
  resolveSqlCompletionScopes(
    { ...consoleTab, dataSourceId: 5, databaseType: DatabaseTypeCode.MYSQL, databaseName: 'app' },
    sources,
  ),
  [],
  'a console that can answer the request itself gets no scope',
);

console.log('SQL completion scope tests passed');
