import { DatabaseCapability } from '@/constants/databaseCapabilities';
import type { IBoundInfo, TreeNodeData } from '@/typings';
import { isDatabaseCapabilitySupported } from '@/utils/databaseJudgments';
import {
  UNBOUND_COMPLETION_MAX_SCOPES,
  buildUnboundCompletionScopes,
  type UnboundCompletionScope,
} from '@/store/workspace/utils/unboundCompletion';

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
 * editor's own binding cannot reach every table the user may want to name.
 *
 * A console always fans out once it is bound to a datasource of a dialect that has
 * backend completion: its own request only ever reads the datasource it is bound to,
 * and the user expects to complete the tables of the other datasources too.
 *
 * A console with nothing bound fans out whatever its dialect, since it has no
 * metadata of its own to read and previously offered no completion at all.
 *
 * A local `.sql` file or a terminal keeps its current behaviour: it has no console to
 * bind, and its dialect may not have backend completion to fan out with.
 */
export function shouldFanOutSqlCompletion(dbInfo: IBoundInfo | null | undefined): boolean {
  if (!isConsoleContext(dbInfo)) {
    return false;
  }
  const { dataSourceId, databaseType } = dbInfo || {};
  if (!dataSourceId) {
    return true;
  }
  return isDatabaseCapabilitySupported(databaseType, DatabaseCapability.BACKEND_COMPLETION);
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
 * The datasources to complete against, in priority order: the datasource the editor
 * is bound to leads - narrowed to its chosen database when it has one, so the tables
 * the user is working with still rank first - and every other datasource of the tree
 * follows, most recently executed first.
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
  const { dataSourceId, databaseName, schemaName } = dbInfo || {};
  if (!dataSourceId) {
    return buildUnboundCompletionScopes(sources.executedDataSourceIds, availableDataSourceIds(sources));
  }
  const boundScope = boundScopeOf(dataSourceId, databaseName, schemaName);
  const others = buildUnboundCompletionScopes(
    sources.executedDataSourceIds,
    availableDataSourceIds(sources),
    dataSourceId,
  );
  return [boundScope, ...others].slice(0, UNBOUND_COMPLETION_MAX_SCOPES);
}

/**
 * The leading scope: the datasource the console is bound to, narrowed to the database
 * and schema the user picked when they picked one. Without a database the backend
 * covers every database of the datasource.
 */
function boundScopeOf(
  dataSourceId: number,
  databaseName?: string,
  schemaName?: string,
): UnboundCompletionScope {
  return {
    dataSourceId,
    ...(databaseName ? { databaseName } : {}),
    ...(schemaName ? { schemaName } : {}),
  };
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
