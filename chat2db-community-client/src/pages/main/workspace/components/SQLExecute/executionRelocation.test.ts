import assert from 'node:assert/strict';
import { DatabaseTypeCode } from '@/constants/common';
import { TreeNodeType } from '@/constants/tree';
import type { IBoundInfo, TreeNodeData } from '@/typings';
import {
  findDataSourceNode,
  isReadOnlyQuery,
  relocateBoundInfo,
  shouldResolveExecutionDatasource,
} from './executionRelocation';

assert.equal(isReadOnlyQuery('SELECT * FROM verify_task'), true, 'a query may move between datasources');
assert.equal(isReadOnlyQuery('  \n select 1'), true, 'leading blank space does not hide the query');
assert.equal(isReadOnlyQuery('WITH t AS (SELECT 1) SELECT * FROM t'), true, 'a CTE starts a query too');
assert.equal(isReadOnlyQuery('-- a note\nSELECT * FROM verify_task'), true, 'a comment does not hide the query');
assert.equal(isReadOnlyQuery('/* a note */ SELECT 1'), true, 'a block comment does not hide the query');
assert.equal(isReadOnlyQuery('UPDATE verify_task SET a = 1'), false, 'a write stays where the user pointed');
assert.equal(isReadOnlyQuery('delete from verify_task'), false, 'a delete stays where the user pointed');
assert.equal(isReadOnlyQuery('DROP TABLE verify_task'), false, 'ddl stays where the user pointed');
assert.equal(isReadOnlyQuery('EXPLAIN SELECT 1'), false, 'a statement the backend does not call a query stays');
assert.equal(isReadOnlyQuery('/* unterminated\nSELECT 1'), false, 'a statement that cannot be read stays');
assert.equal(isReadOnlyQuery('-- only a comment'), false, 'a comment is not a statement');
assert.equal(isReadOnlyQuery(''), false, 'an empty statement cannot move');
assert.equal(isReadOnlyQuery(undefined), false, 'a missing statement cannot move');

const consoleTab: IBoundInfo = { consoleId: 42, dataSourceId: 5, databaseType: DatabaseTypeCode.MYSQL };

assert.equal(
  shouldResolveExecutionDatasource(consoleTab, 'SELECT * FROM verify_task'),
  true,
  'a bound MySQL console asks where its query belongs',
);
assert.equal(
  shouldResolveExecutionDatasource({ ...consoleTab, dataSourceId: undefined }, 'SELECT * FROM verify_task'),
  false,
  'a console with no datasource cannot be moved anywhere yet',
);
assert.equal(
  shouldResolveExecutionDatasource({ ...consoleTab, databaseType: DatabaseTypeCode.POSTGRESQL }, 'SELECT 1'),
  false,
  'a dialect that cannot fan out keeps its own behaviour',
);
assert.equal(
  shouldResolveExecutionDatasource({ workspaceTabId: 99 }, 'SELECT 1'),
  false,
  'a local SQL file keeps its own behaviour',
);

const dataSourceNode = (dataSourceId: number, extra: Partial<TreeNodeData['extraParams']> = {}): TreeNodeData => ({
  key: `dataSource_${dataSourceId}`,
  originalTitle: `source-${dataSourceId}`,
  treeNodeType: TreeNodeType.DATA_SOURCE,
  extraParams: { dataSourceId, dataSourceName: `source-${dataSourceId}`, ...extra },
});

assert.equal(
  findDataSourceNode([dataSourceNode(1), dataSourceNode(7)], 7)?.extraParams?.dataSourceName,
  'source-7',
  'the node of a datasource is found by its id',
);
assert.equal(findDataSourceNode([dataSourceNode(1)], 9), undefined, 'a datasource outside the tree has no node');
assert.equal(findDataSourceNode(undefined, 7), undefined, 'a tree that is not loaded has no node');
assert.equal(findDataSourceNode([dataSourceNode(1)], undefined), undefined, 'no id, no node');

const relocated = relocateBoundInfo(
  {
    consoleId: 42,
    dataSourceId: 5,
    dataSourceName: 'test-ajk-user03',
    databaseType: DatabaseTypeCode.MYSQL,
    databaseName: 'db58_hbg_audit',
    schemaName: 'public',
    identityColor: '#111',
  },
  { dataSourceId: 7, dataSourceName: 'test-ajk-user02', databaseName: 'db58_hbg_ccf' },
  dataSourceNode(7, {
    dataSourceName: 'test-ajk-user02',
    databaseType: DatabaseTypeCode.MYSQL,
    environmentId: 3,
    identityColor: '#222',
  }),
);

assert.deepEqual(relocated, {
  consoleId: 42,
  dataSourceId: 7,
  dataSourceName: 'test-ajk-user02',
  databaseType: DatabaseTypeCode.MYSQL,
  databaseName: 'db58_hbg_ccf',
  schemaName: undefined,
  environmentId: 3,
  environment: undefined,
  identityColor: '#222',
});

const withoutNode = relocateBoundInfo(
  { consoleId: 42, dataSourceId: 5, dataSourceName: 'test-ajk-user03', databaseName: 'db58_hbg_audit' },
  { dataSourceId: 7, dataSourceName: 'test-ajk-user02', databaseName: 'db58_hbg_ccf' },
);
assert.equal(withoutNode.dataSourceId, 7, 'the target datasource wins even when the tree has no node for it');
assert.equal(withoutNode.dataSourceName, 'test-ajk-user02', 'the name comes from the response');
assert.equal(withoutNode.databaseName, 'db58_hbg_ccf');
assert.equal(withoutNode.schemaName, undefined, 'the schema of the old binding does not follow the statement');

const withoutDatabase = relocateBoundInfo(
  { consoleId: 42, dataSourceId: 7, dataSourceName: 'test-ajk-user02', databaseName: 'db58_hbg_ccf' },
  { dataSourceId: 7, dataSourceName: 'test-ajk-user02' },
);
assert.equal(withoutDatabase.databaseName, undefined, 'an answer without a database leaves the console without one');

console.log('Execution relocation tests passed');
