import { TreeNodeType } from '@/constants/tree';
import { WorkspaceTabType } from '@/constants/workspace';
import type { IBoundInfo, IWorkspaceTab, TreeNodeData } from '@/typings';

/**
 * The binding the console takes when the tree hands it a table.
 * <p>
 * The console follows the object the user pointed at: the datasource the table lives in and the
 * database holding it, so the query they are about to write runs where the table is. Only a console
 * owns a binding it may be re-pointed at, and only a table names a datasource and database to point
 * it at; anything else leaves the active tab alone.
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
  if (!node || node.treeNodeType !== TreeNodeType.TABLE) {
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
    databaseName,
    schemaName,
    environmentId,
    environment,
    identityColor,
  };
}
