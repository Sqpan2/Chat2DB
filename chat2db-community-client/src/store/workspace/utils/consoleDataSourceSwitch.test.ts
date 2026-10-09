import assert from 'node:assert/strict';
import { DatabaseTypeCode } from '@/constants/common';
import { TreeNodeType } from '@/constants/tree';
import { WorkspaceTabType } from '@/constants/workspace';
import type { IWorkspaceTab, TreeNodeData } from '@/typings';
import { resolveConsoleDataSourceSwitch, resolveSwitchTargetTab } from './consoleDataSourceSwitch';

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
assert.deepEqual(
  resolveConsoleDataSourceSwitch(
    consoleTab,
    {
      key: 'database_db58_hbg_ccf',
      originalTitle: 'db58_hbg_ccf',
      treeNodeType: TreeNodeType.DATABASE,
      extraParams: {
        dataSourceId: 7,
        dataSourceName: 'test-ajk-user02.db.58dns.org',
        databaseType: DatabaseTypeCode.MYSQL,
        databaseName: 'db58_hbg_ccf',
      },
    },
  ),
  {
    workspaceTabId: 11,
    dataSourceId: 7,
    dataSourceName: 'test-ajk-user02.db.58dns.org',
    databaseType: DatabaseTypeCode.MYSQL,
    databaseName: 'db58_hbg_ccf',
    schemaName: undefined,
    environmentId: undefined,
    environment: undefined,
    identityColor: undefined,
  },
  'double-clicking a database points the console at that database',
);
assert.equal(
  resolveConsoleDataSourceSwitch(consoleTab, {
    key: 'view_order_view',
    originalTitle: 'order_view',
    treeNodeType: TreeNodeType.VIEW,
    extraParams: { dataSourceId: 7, databaseName: 'db58_hbg_ccf' },
  })?.dataSourceId,
  7,
  'a view names a datasource as readily as a table does',
);
assert.equal(
  resolveConsoleDataSourceSwitch(consoleTab, {
    key: 'dataSource_7',
    originalTitle: 'test-ajk-user02.db.58dns.org',
    treeNodeType: TreeNodeType.DATA_SOURCE,
    extraParams: { dataSourceId: 7, databaseName: 'db58_hbg_ccf' },
  }),
  null,
  'browsing the tree by expanding a datasource must not re-point the console',
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

const otherConsole: IWorkspaceTab = { id: 22, type: WorkspaceTabType.CONSOLE, title: '[test-ajk-user02]' };
const dataTab: IWorkspaceTab = { id: 33, type: WorkspaceTabType.EditTableData, title: 'verify_task' };

assert.equal(
  resolveSwitchTargetTab(consoleTab, null, [consoleTab, dataTab])?.id,
  11,
  'the console the user is looking at is the one that follows the tree',
);
assert.equal(
  resolveSwitchTargetTab(dataTab, 11, [consoleTab, dataTab, otherConsole])?.id,
  11,
  'a data tab holding the focus still re-points the console the user last worked in',
);
assert.equal(
  resolveSwitchTargetTab(dataTab, 99, [consoleTab, dataTab])?.id,
  undefined,
  'a console that is no longer open cannot be re-pointed',
);
assert.equal(
  resolveSwitchTargetTab(dataTab, null, [dataTab])?.id,
  undefined,
  'with no console open there is nothing to follow the tree',
);

console.log('Console data source switch tests passed');
