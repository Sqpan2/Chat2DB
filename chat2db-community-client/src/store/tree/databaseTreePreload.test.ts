import assert from 'node:assert/strict';
import { TreeNodeType } from '@/constants/tree';
import type { TreeNodeData } from '@/typings';
import {
  hasPreloadedDatabaseTables,
  preloadAllDatabaseTables,
  resetDatabaseTreePreload,
  scheduleDatabaseTreePreload,
  type PreloadTreeStore,
} from './databaseTreePreload';

function makeNode(params: Partial<TreeNodeData> & { key: string }): TreeNodeData {
  return { isLeaf: false, ...params } as TreeNodeData;
}

function dataSourceNode(key: string, dataSourceId: number): TreeNodeData {
  return makeNode({
    key,
    treeNodeType: TreeNodeType.DATA_SOURCE,
    extraParams: { dataSourceId },
  });
}

function databaseNode(key: string, databaseName: string): TreeNodeData {
  return makeNode({
    key,
    treeNodeType: TreeNodeType.DATABASE,
    extraParams: { databaseName },
  });
}

function schemaNode(key: string, schemaName: string): TreeNodeData {
  return makeNode({
    key,
    treeNodeType: TreeNodeType.SCHEMA,
    extraParams: { schemaName },
  });
}

function tablesFolder(key: string): TreeNodeData {
  return makeNode({ key, treeNodeType: TreeNodeType.TABLES });
}

function savedConsolesNode(key: string): TreeNodeData {
  return makeNode({ key, treeNodeType: TreeNodeType.SAVE_CONSOLES });
}

/**
 * A store where loads fill children from a provider, replacing the loaded node object the way the
 * real tree rebuild does, so stale references cannot carry the walk.
 */
function createLazyStore(rootNodes: TreeNodeData[], childrenProvider: (key: string) => TreeNodeData[] | undefined) {
  let treeData = rootNodes;
  const loadedKeys: string[] = [];
  const loadOptions: unknown[] = [];
  const store: PreloadTreeStore = {
    get treeData() {
      return treeData;
    },
    handleLoadData(loaded, options) {
      loadedKeys.push(String(loaded.key));
      loadOptions.push(options);
      loaded.children = childrenProvider(String(loaded.key)) ?? [];
      return { committed: true };
    },
  };
  return {
    store,
    get treeData() {
      return treeData;
    },
    get loadedKeys() {
      return loadedKeys;
    },
    get loadOptions() {
      return loadOptions;
    },
  };
}

function nodeByKey(treeData: TreeNodeData[] | null, key: string): TreeNodeData | undefined {
  for (const node of treeData || []) {
    if (node.key === key) return node;
    const nested = nodeByKey(node.children, key);
    if (nested) return nested;
  }
  return undefined;
}

async function run() {
  // Guard starts clear.
  resetDatabaseTreePreload();
  assert.equal(hasPreloadedDatabaseTables(), false);

  await testPreloadsEveryDatasourceDownToItsTables();
  await testSkipsNonTableFoldersAndAlreadyLoadedLayers();
  await testKeepsPreloadingWhenOneDatasourceFails();
  await testScheduleRunsOncePerSession();

  resetDatabaseTreePreload();
  console.log('Database tree preload tests passed');
}

async function testPreloadsEveryDatasourceDownToItsTables() {
  resetDatabaseTreePreload();
  const dsA = dataSourceNode('dataSource_1', 1);
  const dsB = dataSourceNode('dataSource_2', 2);
  const dbA = databaseNode('dataSource_1-database_a', 'a');
  const schemaB = schemaNode('dataSource_2-database_b-schema_s', 's');
  const tablesA = tablesFolder('dataSource_1-database_a-tables');
  const tablesB = tablesFolder('dataSource_2-database_b-schema_s-tables');
  const consoles = savedConsolesNode('dataSource_1-saveConsoles');
  const harness = createLazyStore([dsA, dsB], (key) => {
    if (key === dsA.key) return [dbA, consoles];
    if (key === dsB.key) return [schemaB];
    if (key === dbA.key) return [tablesA];
    if (key === schemaB.key) return [tablesB];
    if (key === tablesA.key) return [];
    if (key === tablesB.key) return [];
    return [];
  });

  await preloadAllDatabaseTables(() => harness.store, { concurrency: 1 });

  assert.equal(hasPreloadedDatabaseTables(), true);
  assert.deepEqual(
    harness.loadedKeys.sort(),
    [dsA.key, dsB.key, dbA.key, schemaB.key, tablesA.key, tablesB.key].sort(),
  );
  for (const options of harness.loadOptions) {
    assert.deepEqual(options, { closeExpandTreeNode: true, preserveInteraction: true });
  }
  // The walk refound the reloaded nodes, so the loaded database layer is the fresh object.
  const freshDatabase = nodeByKey(harness.treeData, dbA.key);
  assert.ok(freshDatabase);
  assert.ok(freshDatabase!.children!.some((child) => child.key === tablesA.key));
}

async function testSkipsNonTableFoldersAndAlreadyLoadedLayers() {
  resetDatabaseTreePreload();
  const ds = dataSourceNode('dataSource_1', 1);
  const loadedDatabase = databaseNode('dataSource_1-database_a', 'a');
  loadedDatabase.children = [];
  const harness = createLazyStore([ds], (key) => {
    if (key === ds.key) return [loadedDatabase, savedConsolesNode('dataSource_1-saveConsoles')];
    if (key === loadedDatabase.key) return [];
    return [];
  });

  await preloadAllDatabaseTables(() => harness.store);

  // The already-loaded database is left alone and the consoles folder is never touched.
  assert.deepEqual(harness.loadedKeys, [ds.key]);
}

async function testKeepsPreloadingWhenOneDatasourceFails() {
  resetDatabaseTreePreload();
  const broken = dataSourceNode('dataSource_1', 1);
  const healthy = dataSourceNode('dataSource_2', 2);
  const dbHealthy = databaseNode('dataSource_2-database_b', 'b');
  const tablesHealthy = tablesFolder('dataSource_2-database_b-tables');
  const harness = createLazyStore([broken, healthy], (key) => {
    if (key === broken.key) throw new Error('datasource unreachable');
    if (key === healthy.key) return [dbHealthy];
    if (key === dbHealthy.key) return [tablesHealthy];
    if (key === tablesHealthy.key) return [];
    return [];
  });
  // Make every load of the broken datasource throw, the way an unreachable backend does.
  const originalHandleLoadData = harness.store.handleLoadData;
  harness.store.handleLoadData = async (node, options) => {
    if (String(node.key).startsWith('dataSource_1')) {
      throw new Error('datasource unreachable');
    }
    return originalHandleLoadData(node, options);
  };

  await preloadAllDatabaseTables(() => harness.store);

  assert.deepEqual(harness.loadedKeys, [healthy.key, dbHealthy.key, tablesHealthy.key]);
}

async function testScheduleRunsOncePerSession() {
  resetDatabaseTreePreload();
  const ds = dataSourceNode('dataSource_1', 1);
  const harness = createLazyStore([ds], () => []);

  scheduleDatabaseTreePreload(() => harness.store);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(harness.loadedKeys, [ds.key]);

  scheduleDatabaseTreePreload(() => harness.store);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(harness.loadedKeys, [ds.key], 'the second schedule is a no-op');

  await preloadAllDatabaseTables(() => harness.store);
  assert.deepEqual(harness.loadedKeys, [ds.key], 'a direct preload still respects the loaded layers');
}

run();
