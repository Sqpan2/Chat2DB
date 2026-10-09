import { DatabaseCapability } from '@/constants/databaseCapabilities';
import type { IBoundInfo, TreeNodeData } from '@/typings';
import { getDatabaseSupport, isDatabaseCapabilitySupported } from '@/utils/databaseJudgments';
import { buildUnboundCompletionScopes, type UnboundCompletionScope } from '@/store/workspace/utils/unboundCompletion';

/**
 * Datasources a completion request may be fanned out to, plus the recency list
 * that decides their order.
 */
export interface SqlCompletionScopeSources {
  /** Datasources this session already ran SQL against, most recent first. */
  executedDataSourceIds: readonly number[];
  /** Every datasource the tree knows about, in tree order. */
  dataSourceNodes: readonly TreeNodeData[];
}

/**
 * Whether completion has to be fanned out over several datasources, because the
 * editor's own binding cannot produce candidates on its own.
 *
 * Two cases qualify, both inside a console tab (a local `.sql` file or a terminal
 * keeps its current behaviour, since it has no console to bind):
 *
 * - nothing is bound at all, so every datasource is a candidate;
 * - a datasource is bound but no database is chosen, and the datasource owns
 *   databases - the bound request would read the metadata of no database and
 *   silently return nothing.
 */
export function shouldFanOutSqlCompletion(dbInfo: IBoundInfo | null | undefined): boolean {
  if (!isConsoleContext(dbInfo)) {
    return false;
  }
  const { dataSourceId, databaseName, databaseType } = dbInfo || {};
  if (!dataSourceId) {
    return true;
  }
  return (
    isDatabaseCapabilitySupported(databaseType, DatabaseCapability.BACKEND_COMPLETION) &&
    getDatabaseSupport(databaseType).supportDatabase &&
    !databaseName
  );
}

/**
 * Whether the editor is a console tab. Only a console carries a backend console
 * id: a local `.sql` file is identified by its workspace tab, which may also be a
 * number, so the console id is the reliable distinction.
 */
function isConsoleContext(dbInfo: IBoundInfo | null | undefined): boolean {
  return typeof dbInfo?.consoleId === 'number' && Number.isFinite(dbInfo.consoleId);
}

/**
 * The datasources to complete against, in priority order.
 *
 * With nothing bound the recently executed datasources lead and every other
 * datasource of the tree follows. With a datasource bound but no database, only
 * that datasource is used - the server expands it to all of its databases.
 *
 * @returns the scopes to send, or an empty array when the editor must keep using
 * the bound completion request.
 */
export function resolveSqlCompletionScopes(
  dbInfo: IBoundInfo | null | undefined,
  sources: SqlCompletionScopeSources,
): UnboundCompletionScope[] {
  if (!shouldFanOutSqlCompletion(dbInfo)) {
    return [];
  }
  const { dataSourceId } = dbInfo || {};
  if (dataSourceId) {
    return [{ dataSourceId }];
  }
  return buildUnboundCompletionScopes(sources.executedDataSourceIds, availableDataSourceIds(sources));
}

/**
 * Ids of the datasources the tree may complete against, skipping the ones the
 * user cannot read and the nodes that carry no id.
 */
function availableDataSourceIds(sources: SqlCompletionScopeSources): number[] {
  return sources.dataSourceNodes
    .filter((node) => node.extraParams?.hasPermission !== false)
    .map((node) => node.extraParams?.dataSourceId)
    .filter((dataSourceId): dataSourceId is number => typeof dataSourceId === 'number');
}
