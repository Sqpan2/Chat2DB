import { TreeNodeType } from '@/constants/tree';
import type { TreeNodeData } from '@/typings';
import type { Key } from 'react';

/**
 * The tree layers preloading walks: datasources, their databases and schemas, and the folder that
 * lists each database's tables. Anything else - accounts, saved consoles, views - is left lazy.
 */
const PRELOAD_NODE_TYPES: ReadonlySet<TreeNodeType> = new Set([
  TreeNodeType.DATABASE,
  TreeNodeType.SCHEMA,
  TreeNodeType.TABLES,
]);

/** How many datasources preload walks at once, so one slow backend cannot stall the others. */
const DEFAULT_CONCURRENCY = 3;

export interface PreloadTreeStore {
  treeData: TreeNodeData[] | null;
  handleLoadData: (
    node: TreeNodeData,
    options?: { closeExpandTreeNode?: boolean; preserveInteraction?: boolean },
  ) => Promise<{ committed?: boolean } | undefined>;
}

let preloaded = false;

/** Whether this session already ran the preload. */
export function hasPreloadedDatabaseTables() {
  return preloaded;
}

/** Clears the once-per-session guard, so tests and re-logins can run the preload again. */
export function resetDatabaseTreePreload() {
  preloaded = false;
}

/**
 * Loads every datasource's databases and their table lists into the tree cache in the background, so
 * opening the app leaves the tree, the search and the completion working without a first-click wait.
 * <p>
 * The walk never expands or selects anything: loads run with the quiet options the tree locate uses.
 * One unreachable datasource is skipped rather than ending the preload.
 *
 * @param getTreeStore reads the current tree store, fresh on every step.
 * @param options concurrency of datasource walks, 3 by default.
 */
export async function preloadAllDatabaseTables(
  getTreeStore: () => PreloadTreeStore,
  options?: { concurrency?: number },
): Promise<void> {
  preloaded = true;
  const concurrency = Math.max(1, options?.concurrency ?? DEFAULT_CONCURRENCY);
  const dataSourceKeys = collectDataSourceKeys(getTreeStore().treeData);
  if (!dataSourceKeys.length) {
    return;
  }

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, dataSourceKeys.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= dataSourceKeys.length) {
        return;
      }
      await preloadDatasource(dataSourceKeys[index], getTreeStore).catch(() => {
        // An unreachable datasource keeps the preload running for the others.
      });
    }
  });
  await Promise.all(workers);
}

/** Kicks the preload off once per session; every later call is a no-op. */
export function scheduleDatabaseTreePreload(getTreeStore: () => PreloadTreeStore): void {
  if (preloaded) {
    return;
  }
  void preloadAllDatabaseTables(getTreeStore).catch(() => {
    // The tree stays lazy whatever the preload hit.
  });
}

/**
 * Loads one datasource, its databases and each database's table folder, refinding every node by key
 * between steps: a load replaces the tree's node objects.
 */
async function preloadDatasource(dataSourceKey: Key, getTreeStore: () => PreloadTreeStore): Promise<void> {
  const loadByKey = async (key: Key): Promise<TreeNodeData | undefined> => {
    const node = findNodeByKey(getTreeStore().treeData, key);
    if (!node) {
      return undefined;
    }
    await loadNode(node, getTreeStore);
    return findNodeByKey(getTreeStore().treeData, key);
  };

  const dataSource = await loadByKey(dataSourceKey);
  if (!dataSource) {
    return;
  }
  for (const databaseNode of listPreloadChildren(dataSource)) {
    const database = await loadByKey(databaseNode.key);
    if (!database) {
      continue;
    }
    for (const folderNode of listPreloadChildren(database)) {
      await loadByKey(folderNode.key);
    }
  }
}

function collectDataSourceKeys(treeData: TreeNodeData[] | null | undefined): Key[] {
  const found: Key[] = [];
  const walk = (nodes: TreeNodeData[] | null | undefined) => {
    for (const node of nodes || []) {
      if (!node) {
        continue;
      }
      if (node.treeNodeType === TreeNodeType.DATA_SOURCE) {
        found.push(node.key);
      }
      walk(node.children);
    }
  };
  walk(treeData);
  return found;
}

/** The loaded children the preload descends into, only the layers it understands. */
function listPreloadChildren(node: TreeNodeData): TreeNodeData[] {
  return (node.children || []).filter(
    (child) => child && PRELOAD_NODE_TYPES.has(child.treeNodeType) && child.children === undefined && !child.isLeaf,
  );
}

function findNodeByKey(treeData: TreeNodeData[] | null | undefined, key: Key): TreeNodeData | undefined {
  for (const node of treeData || []) {
    if (!node) {
      continue;
    }
    if (node.key === key) {
      return node;
    }
    const nested = findNodeByKey(node.children, key);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

async function loadNode(node: TreeNodeData, getTreeStore: () => PreloadTreeStore): Promise<void> {
  if (node.children !== undefined || node.isLeaf) {
    return;
  }
  await getTreeStore().handleLoadData(node, {
    closeExpandTreeNode: true,
    preserveInteraction: true,
  });
}
