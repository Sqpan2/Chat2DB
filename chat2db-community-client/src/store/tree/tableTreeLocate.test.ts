import assert from 'node:assert/strict';
import { TreeNodeType } from '@/constants/tree';
import type { TreeNodeData } from '@/typings';
import type { Key } from 'react';
import { locateTableInDatabaseTree, type TableTreeLocateStore } from './tableTreeLocate';

function makeNode(params: Partial<TreeNodeData> & { key: string }): TreeNodeData {
  return { isLeaf: false, ...params } as TreeNodeData;
}

function dataSourceNode(dataSourceId: number): TreeNodeData {
  return makeNode({
    key: `dataSource_${dataSourceId}`,
    treeNodeType: TreeNodeType.DATA_SOURCE,
    extraParams: { dataSourceId },
  });
}

function databaseNode(dataSourceId: number, databaseName: string): TreeNodeData {
  return makeNode({
    key: `dataSource_${dataSourceId}-database_${databaseName}`,
    treeNodeType: TreeNodeType.DATABASE,
    extraParams: { dataSourceId, databaseName },
  });
}

function tablesFolder(dataSourceId: number, databaseName: string, schemaName?: string): TreeNodeData {
  return makeNode({
    key: `dataSource_${dataSourceId}-database_${databaseName}${schemaName ? `-schema_${schemaName}` : ''}-tables`,
    treeNodeType: TreeNodeType.TABLES,
    extraParams: { dataSourceId, databaseName, ...(schemaName ? { schemaName } : {}) },
  });
}

function schemaNode(dataSourceId: number, databaseName: string, schemaName: string): TreeNodeData {
  return makeNode({
    key: `dataSource_${dataSourceId}-database_${databaseName}-schema_${schemaName}`,
    treeNodeType: TreeNodeType.SCHEMA,
    extraParams: { dataSourceId, databaseName, schemaName },
  });
}

function tableNode(dataSourceId: number, databaseName: string, tableName: string, schemaName?: string): TreeNodeData {
  return makeNode({
    key: `dataSource_${dataSourceId}-database_${databaseName}-table_${tableName}`,
    treeNodeType: TreeNodeType.TABLE,
    extraParams: { dataSourceId, databaseName, ...(schemaName ? { schemaName } : {}), tableName },
  });
}

/**
 * A store whose nodes load their children on demand: every node starts unloaded, and a load fills the
 * children the provider serves for its key, the way the lazy tree does.
 */
function createLazyStore(rootNodes: TreeNodeData[], childrenProvider: (key: string) => TreeNodeData[] | undefined) {
  let treeData = rootNodes;
  let expandedKeys: Key[] = [];
  let selectedKeys: Key[] = [];
  let scrolledTo: Key | null = null;
  let currentTreeNode: TreeNodeData | null = null;
  const loadedKeys: string[] = [];
  const store: TableTreeLocateStore = {
    get treeData() {
      return treeData;
    },
    get expandedKeys() {
      return expandedKeys;
    },
    searchBarValue: '',
    handleLoadData(loaded) {
      loadedKeys.push(String(loaded.key));
      loaded.children = childrenProvider(String(loaded.key)) ?? [];
      return { committed: true };
    },
    setExpandedKeys(keys) {
      expandedKeys = Array.from(new Set(keys));
    },
    setCurrentTreeNode(node) {
      currentTreeNode = node;
    },
    setSelectedKeys(keys) {
      selectedKeys = keys;
    },
    setScrollTargetKey(key) {
      scrolledTo = key;
    },
  };
  return {
    store,
    get expandedKeys() {
      return expandedKeys;
    },
    get selectedKeys() {
      return selectedKeys;
    },
    get scrolledTo() {
      return scrolledTo;
    },
    get currentTreeNode() {
      return currentTreeNode;
    },
    get loadedKeys() {
      return loadedKeys;
    },
  };
}

async function testLocatesATableAcrossTheFolderLayers() {
  const table = tableNode(1, 'db58_hbg_ccf', 'review_orders');
  const folder = tablesFolder(1, 'db58_hbg_ccf');
  const database = databaseNode(1, 'db58_hbg_ccf');
  const dataSource = dataSourceNode(1);
  const harness = createLazyStore([dataSource], (key) =>
    key === dataSource.key ? [database] : key === database.key ? [folder] : key === folder.key ? [table] : [],
  );

  const status = await locateTableInDatabaseTree(
    { dataSourceId: 1, databaseName: 'db58_hbg_ccf', tableName: 'review_orders' },
    () => harness.store,
  );

  assert.equal(status, 'hit');
  assert.deepEqual(harness.loadedKeys, [dataSource.key, database.key, folder.key]);
  assert.deepEqual(harness.selectedKeys, [table.key]);
  assert.equal(harness.scrolledTo, table.key);
  assert.equal(harness.currentTreeNode, table);
  assert.ok(harness.expandedKeys.includes(database.key));
  assert.ok(harness.expandedKeys.includes(folder.key));
}

async function testMatchesTableNameCaseInsensitively() {
  const table = tableNode(1, 'db', 'Review_Orders');
  const folder = tablesFolder(1, 'db');
  const database = databaseNode(1, 'db');
  const dataSource = dataSourceNode(1);
  const harness = createLazyStore([dataSource], (key) =>
    key === dataSource.key ? [database] : key === database.key ? [folder] : key === folder.key ? [table] : [],
  );

  const status = await locateTableInDatabaseTree(
    { dataSourceId: 1, databaseName: 'db', tableName: 'review_orders' },
    () => harness.store,
  );

  assert.equal(status, 'hit');
  assert.deepEqual(harness.selectedKeys, [table.key]);
}

async function testFindsTheTableWithoutADatabaseName() {
  const table = tableNode(1, 'db58_hbg_ccf', 'review_orders');
  const folder = tablesFolder(1, 'db58_hbg_ccf');
  const database = databaseNode(1, 'db58_hbg_ccf');
  const dataSource = dataSourceNode(1);
  const harness = createLazyStore([dataSource], (key) =>
    key === dataSource.key ? [database] : key === database.key ? [folder] : key === folder.key ? [table] : [],
  );

  const status = await locateTableInDatabaseTree({ dataSourceId: 1, tableName: 'review_orders' }, () => harness.store);

  assert.equal(status, 'hit');
  assert.deepEqual(harness.selectedKeys, [table.key]);
}

async function testPrefersTheSchemaTheTargetNames() {
  const otherSchemaTable = tableNode(1, 'db', 'review_orders', 'other_schema');
  const schemaTable = tableNode(1, 'db', 'review_orders', 'db58_hbg_ccf');
  const otherSchemaFolder = tablesFolder(1, 'db', 'other_schema');
  const schemaFolder = tablesFolder(1, 'db', 'db58_hbg_ccf');
  const schemaOther = schemaNode(1, 'db', 'other_schema');
  const schemaTarget = schemaNode(1, 'db', 'db58_hbg_ccf');
  const database = databaseNode(1, 'db');
  const dataSource = dataSourceNode(1);
  const harness = createLazyStore([dataSource], (key) => {
    if (key === dataSource.key) return [database];
    if (key === database.key) return [schemaOther, schemaTarget];
    if (key === schemaOther.key) return [otherSchemaFolder];
    if (key === schemaTarget.key) return [schemaFolder];
    if (key === otherSchemaFolder.key) return [otherSchemaTable];
    if (key === schemaFolder.key) return [schemaTable];
    return [];
  });

  const status = await locateTableInDatabaseTree(
    { dataSourceId: 1, databaseName: 'db', schemaName: 'db58_hbg_ccf', tableName: 'review_orders' },
    () => harness.store,
  );

  assert.equal(status, 'hit');
  assert.deepEqual(harness.selectedKeys, [schemaTable.key]);
  assert.deepEqual(harness.loadedKeys, [dataSource.key, database.key, schemaTarget.key, schemaFolder.key]);
}

async function testMissesWhenNoFolderHoldsTheTable() {
  const folder = tablesFolder(1, 'db58_hbg_ccf');
  const database = databaseNode(1, 'db58_hbg_ccf');
  const dataSource = dataSourceNode(1);
  const harness = createLazyStore([dataSource], (key) =>
    key === dataSource.key ? [database] : key === database.key ? [folder] : [],
  );

  const status = await locateTableInDatabaseTree(
    { dataSourceId: 1, databaseName: 'db58_hbg_ccf', tableName: 'missing_table' },
    () => harness.store,
  );

  assert.equal(status, 'miss');
  assert.deepEqual(harness.selectedKeys, []);
}

async function testMissesWithoutATableNameOrAnUnknownDatasource() {
  const harness = createLazyStore([dataSourceNode(1)], () => []);

  assert.equal(await locateTableInDatabaseTree({ dataSourceId: 1, tableName: '' }, () => harness.store), 'miss');
  assert.equal(
    await locateTableInDatabaseTree({ dataSourceId: 99, tableName: 'anything' }, () => harness.store),
    'miss',
  );
  assert.deepEqual(harness.loadedKeys, []);
}

async function testMissesWhenTheDatabaseLivesOnAnotherDatasource() {
  const dataSource = dataSourceNode(1);
  const harness = createLazyStore([dataSource], () => []);

  const status = await locateTableInDatabaseTree(
    { dataSourceId: 1, databaseName: 'db58_hbg_ccf', tableName: 'review_orders' },
    () => harness.store,
  );

  assert.equal(status, 'miss');
  assert.deepEqual(harness.loadedKeys, [dataSource.key]);
}

async function run() {
  await testLocatesATableAcrossTheFolderLayers();
  await testMatchesTableNameCaseInsensitively();
  await testFindsTheTableWithoutADatabaseName();
  await testPrefersTheSchemaTheTargetNames();
  await testMissesWhenNoFolderHoldsTheTable();
  await testMissesWithoutATableNameOrAnUnknownDatasource();
  await testMissesWhenTheDatabaseLivesOnAnotherDatasource();
  console.log('Table tree locate tests passed');
}

void run();
