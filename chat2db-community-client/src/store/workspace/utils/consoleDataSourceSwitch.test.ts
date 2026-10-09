import assert from 'node:assert/strict';
import { DatabaseTypeCode } from '@/constants/common';
import { TreeNodeType } from '@/constants/tree';
import { WorkspaceTabType } from '@/constants/workspace';
import type { IWorkspaceTab, TreeNodeData } from '@/typings';
import { resolveConsoleDataSourceSwitch } from './consoleDataSourceSwitch';

const tableNode = (extraParams: TreeNodeData['extraParams']): TreeNodeData => ({
  key: 'table_verify_task',
  originalTitle: 'verify_task',
  treeNodeType: TreeNodeType.TABLE,
  extraParams,
});

const consoleTab: IWorkspaceTab = { id: 11, type: WorkspaceTabType.CONSOLE, title: '[test-ajk-user03.db.58dns.org]' };

assert.deepEqual(
  resolveConsoleDataSourceSwitch(
    consoleTab,
    tableNode({
      dataSourceId: 7,
      dataSourceName: 'test-ajk-user02.db.58dns.org',
      databaseType: DatabaseTypeCode.MYSQL,
      databaseName: 'db58_hbg_ccf',
      environmentId: 3,
      environment: { id: 3, name: 'Release' } as any,
      identityColor: '#222',
    }),
  ),
  {
    workspaceTabId: 11,
    dataSourceId: 7,
    dataSourceName: 'test-ajk-user02.db.58dns.org',
    databaseType: DatabaseTypeCode.MYSQL,
    databaseName: 'db58_hbg_ccf',
    schemaName: undefined,
    environmentId: 3,
    environment: { id: 3, name: 'Release' },
    identityColor: '#222',
  },
  'a console follows the table to the datasource and database holding it',
);

assert.equal(
  resolveConsoleDataSourceSwitch(
    { ...consoleTab, type: WorkspaceTabType.LocalSQLFile },
    tableNode({ dataSourceId: 7, databaseName: 'db58_hbg_ccf' }),
  ),
  null,
  'a local SQL file keeps its own binding',
);
assert.equal(
  resolveConsoleDataSourceSwitch(
    { ...consoleTab, type: WorkspaceTabType.EditTableData },
    tableNode({ dataSourceId: 7, databaseName: 'db58_hbg_ccf' }),
  ),
  null,
  'the table data tab the double-click opens is not re-pointed',
);
assert.equal(
  resolveConsoleDataSourceSwitch(consoleTab, {
    key: 'database_db58_hbg_ccf',
    originalTitle: 'db58_hbg_ccf',
    treeNodeType: TreeNodeType.DATABASE,
    extraParams: { dataSourceId: 7, databaseName: 'db58_hbg_ccf' },
  }),
  null,
  'only a table names a datasource and a database to point a console at',
);
assert.equal(
  resolveConsoleDataSourceSwitch(consoleTab, tableNode({ databaseName: 'db58_hbg_ccf' })),
  null,
  'a node that carries no datasource cannot re-point a console',
);
assert.equal(resolveConsoleDataSourceSwitch(consoleTab, undefined), null, 'a double-click with no node does nothing');
assert.equal(
  resolveConsoleDataSourceSwitch(undefined, tableNode({ dataSourceId: 7, databaseName: 'db58_hbg_ccf' })),
  null,
  'with no tab open there is no console to re-point',
);

console.log('Console data source switch tests passed');
