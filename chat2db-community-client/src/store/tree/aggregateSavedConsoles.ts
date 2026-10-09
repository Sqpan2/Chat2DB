import { TreeNodeType } from '@/constants/tree';
import type { TreeNodeData } from '@/typings';
import { createSavedConsoleTreeNodeKey } from './backgroundRefresh';

/**
 * Root-level aggregated "consoles" catalogue. It lives next to the data source nodes and lists
 * every saved console across all data sources. The per-database SAVE_CONSOLES folders keep their
 * own scope; this node is scope-free on purpose (no dataSourceId in extraParams) so the saved
 * console list API is called without a data source filter.
 */
export const AGGREGATE_SAVED_CONSOLES_KEY = 'consoles_all_chat2dbCatalogue';

export interface AggregateSavedConsolesExtraParams {
  aggregateConsoles?: boolean;
}

export function isAggregateSavedConsolesExtraParams(extraParams: unknown): boolean {
  return Boolean(
    extraParams && typeof extraParams === 'object' && (extraParams as AggregateSavedConsolesExtraParams).aggregateConsoles,
  );
}

export function buildAggregateSavedConsolesNode(originalTitle: string): TreeNodeData {
  return {
    key: AGGREGATE_SAVED_CONSOLES_KEY,
    originalTitle,
    title: null,
    treeNodeType: TreeNodeType.SAVE_CONSOLES,
    isLeaf: false,
    extraParams: {
      aggregateConsoles: true,
    } satisfies AggregateSavedConsolesExtraParams,
  };
}

interface AggregateSavedConsoleItem {
  id?: number;
  name?: string;
  ddl?: string;
  status?: unknown;
  connectable?: boolean;
  tabOpened?: unknown;
  dataSourceId?: number | null;
  dataSourceName?: string | null;
  databaseType?: string | null;
  environmentId?: number | null;
  environment?: unknown;
  identityColor?: string | null;
  watermarkEnabled?: boolean | null;
  watermarkContent?: string | null;
  databaseName?: string | null;
  schemaName?: string | null;
}

const normalizeNullable = <T,>(value: T | null | undefined, fallback: T | null = null): T | null =>
  value === null || value === undefined ? fallback : value;

/**
 * Map saved console records into leaf SAVE_CONSOLE nodes for the aggregate catalogue.
 * Each child carries its own scope (dataSourceId/databaseName/schemaName from the record) so
 * double-click opens the console bound to the right data source. Keys are suffixed with
 * `-aggregate` so they never collide with the same console listed under its database folder.
 */
export function buildAggregateSavedConsoleChildren(
  items: readonly AggregateSavedConsoleItem[] | null | undefined,
  parentExtraParams: Record<string, unknown> = {},
): TreeNodeData[] {
  return (items || []).map((item) => {
    const scope = {
      dataSourceId: normalizeNullable(item.dataSourceId) ?? undefined,
      databaseName: normalizeNullable(item.databaseName) ?? undefined,
      schemaName: normalizeNullable(item.schemaName) ?? undefined,
    };
    const key = `${createSavedConsoleTreeNodeKey({ ...scope, consoleId: item.id })}-aggregate`;
    return {
      id: item.id,
      key,
      originalTitle: item.name || '',
      title: null,
      treeNodeType: TreeNodeType.SAVE_CONSOLE,
      isLeaf: true,
      extraParams: {
        ...parentExtraParams,
        ...scope,
        dataSourceName: normalizeNullable(item.dataSourceName),
        databaseType: normalizeNullable(item.databaseType),
        environmentId: normalizeNullable(item.environmentId),
        environment: normalizeNullable(item.environment),
        identityColor: normalizeNullable(item.identityColor),
        watermarkEnabled: normalizeNullable(item.watermarkEnabled),
        watermarkContent: normalizeNullable(item.watermarkContent),
        status: item.status,
        ddl: item.ddl,
        connectable: item.connectable,
        tabOpened: item.tabOpened,
      },
    };
  });
}
