import { TreeNodeType } from '@/constants/tree';
import { WorkspaceTabType } from '@/constants/workspace';
import type { IBoundInfo, IWorkspaceTab, TreeNodeData } from '@/typings';

/**
 * Node kinds a console may be pointed at: every object a datasource holds, the databases themselves,
 * and the datasource.
 *
 * A datasource node names no database, so the console keeps the one it has and only changes
 * connection; the double-click still expands the node it always expanded.
 */
const SWITCHABLE_NODE_TYPES: ReadonlySet<TreeNodeType> = new Set([
  TreeNodeType.DATA_SOURCE,
  TreeNodeType.TABLE,
  TreeNodeType.VIEW,
  TreeNodeType.FUNCTION,
  TreeNodeType.PROCEDURE,
  TreeNodeType.TRIGGER,
  TreeNodeType.DATABASE,
]);

/**
 * The console a double-click re-points.
 *
 * The tab the user is looking at comes first. It is not always a console though: double-clicking a
 * table opens that table's data tab, which takes the focus, so the next double-click would find a data
 * tab looking back at it. The console the user last had open is the one they mean in that case.
 *
 * @param activeTab tab that was active when the double-click happened.
 * @param lastConsoleTabId console the user last had active, if any.
 * @param workspaceTabList every open tab.
 * @returns the console to re-point, or undefined when there is none.
 */
export function resolveSwitchTargetTab(
  activeTab: IWorkspaceTab | null | undefined,
  lastConsoleTabId: string | number | null,
  workspaceTabList: readonly IWorkspaceTab[] | null | undefined,
): IWorkspaceTab | undefined {
  if (activeTab?.type === WorkspaceTabType.CONSOLE) {
    return activeTab;
  }
  return (workspaceTabList || []).find(
    (tab) => tab.type === WorkspaceTabType.CONSOLE && tab.id === lastConsoleTabId,
  );
}

/**
 * The binding the console takes when the tree hands it an object.
 * <p>
 * The console follows the object the user pointed at: the datasource it lives in and the database
 * holding it, so the query they are about to write runs where the object is. Only a console owns a
 * binding it may be re-pointed at, and only an object of a datasource names one to point it at;
 * anything else leaves the active tab alone.
 *
 * @param activeTab tab the user is looking at.
 * @param node tree node the user double-clicked.
 * @returns the binding to write into that console, or null when the tab must be left alone.
 */
export function resolveConsoleDataSourceSwitch(
  activeTab: IWorkspaceTab | null | undefined,
  node: TreeNodeData | null | undefined,
): (IBoundInfo & { workspaceTabId: string | number }) | null {
  if (!activeTab || activeTab.type !== WorkspaceTabType.CONSOLE) {
    return null;
  }
  if (!node || !SWITCHABLE_NODE_TYPES.has(node.treeNodeType)) {
    return null;
  }
  const {
    dataSourceId,
    dataSourceName,
    databaseType,
    databaseName,
    schemaName,
    environmentId,
    environment,
    identityColor,
  } = node.extraParams || {};
  if (typeof dataSourceId !== 'number') {
    return null;
  }
  return {
    workspaceTabId: activeTab.id,
    dataSourceId,
    dataSourceName,
    databaseType,
    // A node that names no database leaves the console's own choice alone: a datasource switch keeps
    // whichever database it was reading.
    ...(databaseName ? { databaseName } : {}),
    ...(schemaName ? { schemaName } : {}),
    environmentId,
    environment,
    identityColor,
  };
}
