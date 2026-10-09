import { TreeNodeType } from '@/constants/tree';
import type { TreeNodeData } from '@/typings';
import type { Key } from 'react';

/**
 * The object a double-clicked table name in the editor may resolve to in the left tree.
 */
export interface TableTreeLocateTarget {
  dataSourceId: number;
  databaseName?: string;
  schemaName?: string;
  tableName: string;
}

export type TableTreeLocateStatus = 'hit' | 'miss';

/**
 * The slice of the tree store the locate needs, so a test can serve a plain object.
 */
export interface TableTreeLocateStore {
  treeData: TreeNodeData[] | null;
  expandedKeys: Key[];
  searchBarValue?: string;
  handleLoadData: (
    node: TreeNodeData,
    options?: { closeExpandTreeNode?: boolean; preserveInteraction?: boolean },
  ) => Promise<{ committed?: boolean } | undefined>;
  setExpandedKeys: (keys: Key[]) => void;
  setCurrentTreeNode: (node: TreeNodeData) => void;
  setSelectedKeys: (keys: Key[]) => void;
  setScrollTargetKey: (key: Key | null) => void;
  setSearchBarValue?: (value: string) => void;
  setSearchResult?: (result: unknown) => void;
}

/** Node kinds that hold objects rather than open into them, so the walk never loads them as folders. */
const NON_FOLDER_NODE_TYPES: ReadonlySet<TreeNodeType> = new Set([
  TreeNodeType.TABLE,
  TreeNodeType.VIEW,
  TreeNodeType.FUNCTION,
  TreeNodeType.PROCEDURE,
  TreeNodeType.TRIGGER,
  TreeNodeType.COLUMN,
  TreeNodeType.KEY,
  TreeNodeType.INDEX,
  TreeNodeType.VIEWCOLUMNS,
]);

const OBJECT_NODE_TYPES: ReadonlySet<TreeNodeType> = new Set([TreeNodeType.TABLE, TreeNodeType.VIEW]);

/** Folder loads one locate may spend before it gives up. */
const MAX_FOLDER_LOADS = 8;

interface TreeEntry {
  node: TreeNodeData;
  ancestors: Key[];
}

/**
 * Brings the tree to the table a name in the editor stands for: opens the datasource, the database and
 * the folder layer that lists it, then selects the node the way a double-click on it would have.
 * <p>
 * The walk matches nodes by their extra params rather than by key templates, so every dialect's tree
 * shape - schemas, table folders, all-data shortcuts - works without knowing it.
 *
 * @param target the datasource/database/table the editor resolved the name to.
 * @param getTreeStore reads the current tree store, fresh on every step.
 * @returns whether the object's node was found and selected.
 */
export async function locateTableInDatabaseTree(
  target: TableTreeLocateTarget,
  getTreeStore: () => TableTreeLocateStore,
): Promise<TableTreeLocateStatus> {
  if (typeof target?.dataSourceId !== 'number' || !target.tableName) {
    return 'miss';
  }

  clearSearchIfActive(getTreeStore());

  const dataSourceEntry = await loadEntry(
    () => findTreeEntry(getTreeStore().treeData, (node) => isDataSourceOf(node, target.dataSourceId)),
    getTreeStore,
  );
  if (!dataSourceEntry) {
    return 'miss';
  }

  let searchRootKey = dataSourceEntry.node.key;
  if (target.databaseName) {
    const databaseEntry = await loadEntry(
      () =>
        findTreeEntry(
          getTreeStore().treeData,
          (node) =>
            node.treeNodeType !== TreeNodeType.DATA_SOURCE &&
            node.extraParams?.dataSourceId === target.dataSourceId &&
            node.extraParams?.databaseName === target.databaseName,
        ),
      getTreeStore,
    );
    if (!databaseEntry) {
      // An unknown database keeps the whole datasource searchable rather than failing the locate.
      return locateObjectUnder(dataSourceEntry.node.key, target, getTreeStore);
    }
    searchRootKey = databaseEntry.node.key;
  }
  return locateObjectUnder(searchRootKey, target, getTreeStore);
}

/**
 * Searches under one root for the object's node, opening the folders that still hide it.
 */
async function locateObjectUnder(
  rootKey: Key,
  target: TableTreeLocateTarget,
  getTreeStore: () => TableTreeLocateStore,
): Promise<TableTreeLocateStatus> {
  for (let loads = 0; loads < MAX_FOLDER_LOADS; loads += 1) {
    const root = findTreeEntry(getTreeStore().treeData, (node) => node.key === rootKey);
    if (!root) {
      return 'miss';
    }
    const objectEntry = findTreeEntry(root.node.children, (node) => isTheObject(node, target));
    if (objectEntry) {
      selectNode([...root.ancestors, root.node.key, ...objectEntry.ancestors], objectEntry.node, getTreeStore());
      return 'hit';
    }
    const folders = collectUnloadedFolders(root.node);
    if (!folders.length) {
      return 'miss';
    }
    let loaded = false;
    for (const folder of orderFoldersByTarget(folders, target)) {
      const result = await getTreeStore().handleLoadData(folder, {
        closeExpandTreeNode: true,
        preserveInteraction: true,
      });
      if (result?.committed === false) {
        return 'miss';
      }
      loaded = true;
      break;
    }
    if (!loaded) {
      return 'miss';
    }
  }
  return 'miss';
}

/**
 * Loads one entry the walk needs, refinding it after the load replaced the tree data.
 */
async function loadEntry(
  find: () => TreeEntry | undefined,
  getTreeStore: () => TableTreeLocateStore,
): Promise<TreeEntry | undefined> {
  let entry = find();
  if (!entry) {
    return undefined;
  }
  if (entry.node.children === undefined && !entry.node.isLeaf) {
    const result = await getTreeStore().handleLoadData(entry.node, {
      closeExpandTreeNode: true,
      preserveInteraction: true,
    });
    if (result?.committed === false) {
      return undefined;
    }
    entry = find();
  }
  return entry;
}

/** Drops an active search, which trims the tree and would hide the node the locate opens. */
function clearSearchIfActive(store: TableTreeLocateStore) {
  if (store.searchBarValue && store.setSearchBarValue) {
    store.setSearchBarValue('');
    store.setSearchResult?.(null);
  }
}

function selectNode(ancestors: Key[], node: TreeNodeData, store: TableTreeLocateStore) {
  store.setExpandedKeys([...(store.expandedKeys || []), ...ancestors]);
  store.setCurrentTreeNode(node);
  store.setSelectedKeys([node.key]);
  store.setScrollTargetKey(node.key);
}

/**
 * One recursive find for a node the predicate accepts, carrying the ancestors it hangs from.
 */
function findTreeEntry(
  treeData: TreeNodeData[] | null | undefined,
  predicate: (node: TreeNodeData) => boolean,
  ancestors: Key[] = [],
): TreeEntry | undefined {
  for (const node of treeData || []) {
    if (!node) {
      continue;
    }
    if (predicate(node)) {
      return { node, ancestors };
    }
    const nested = findTreeEntry(node.children, predicate, [...ancestors, node.key]);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function isDataSourceOf(node: TreeNodeData, dataSourceId: number) {
  return node.treeNodeType === TreeNodeType.DATA_SOURCE && node.extraParams?.dataSourceId === dataSourceId;
}

function isTheObject(node: TreeNodeData, target: TableTreeLocateTarget) {
  if (!OBJECT_NODE_TYPES.has(node.treeNodeType)) {
    return false;
  }
  const tableName = node.extraParams?.tableName;
  if (typeof tableName !== 'string' || tableName.toLowerCase() !== target.tableName.toLowerCase()) {
    return false;
  }
  if (target.schemaName && node.extraParams?.schemaName && node.extraParams.schemaName !== target.schemaName) {
    return false;
  }
  return true;
}

/** Folders of one loaded level that may still hide the object, deepest first within the same parent. */
function collectUnloadedFolders(root: TreeNodeData): TreeNodeData[] {
  const folders: TreeNodeData[] = [];
  const walk = (nodes: TreeNodeData[] | null | undefined) => {
    for (const node of nodes || []) {
      if (!node) {
        continue;
      }
      if (node.children === undefined && !node.isLeaf && !NON_FOLDER_NODE_TYPES.has(node.treeNodeType)) {
        folders.push(node);
      }
      walk(node.children);
    }
  };
  walk(root.children);
  return folders;
}

/** The folders that name the target's schema or database come first, so the right one loads first. */
function orderFoldersByTarget(folders: TreeNodeData[], target: TableTreeLocateTarget): TreeNodeData[] {
  const score = (node: TreeNodeData) => {
    let value = 0;
    if (target.schemaName && node.extraParams?.schemaName === target.schemaName) {
      value -= 2;
    }
    if (target.databaseName && node.extraParams?.databaseName === target.databaseName) {
      value -= 1;
    }
    return value;
  };
  return [...folders].sort((left, right) => score(left) - score(right));
}
