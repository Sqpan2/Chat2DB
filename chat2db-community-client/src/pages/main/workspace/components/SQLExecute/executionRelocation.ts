import type { IBoundInfo, TreeNodeData } from '@/typings';
import type { IExecutionDatasource } from '@/typings/sqlParser';
import { shouldFanOutSqlCompletion } from '@/components/SQLEditor/core/sqlCompletionScopes';

/**
 * Words a read-only statement can start with. Only a query is moved between datasources: every other
 * statement - including anything this check does not recognise - keeps the console's binding, because
 * an unrecognised statement may well be a write.
 */
const QUERY_STARTERS = ['select', 'with'];

/**
 * Whether the statement looks like a query.
 *
 * A cheap pre-filter in front of the backend, which classifies the statement for real before moving it.
 * Anything it cannot see through - an unparsable statement, a comment without an end - keeps the
 * console's binding rather than risking a write on another datasource.
 */
export function isReadOnlyQuery(sql: string | null | undefined): boolean {
  const statement = stripLeadingNoise(sql);
  const firstWord = /^[A-Za-z_]+/.exec(statement);
  return firstWord !== null && QUERY_STARTERS.includes(firstWord[0].toLowerCase());
}

/**
 * Whether a statement of this editor may be moved to another datasource: a console tab that can reach
 * several datasources, bound to one of them, running a query.
 */
export function shouldResolveExecutionDatasource(
  dbInfo: IBoundInfo | null | undefined,
  sql: string | null | undefined,
): boolean {
  return typeof dbInfo?.dataSourceId === 'number' && isReadOnlyQuery(sql) && shouldFanOutSqlCompletion(dbInfo);
}

/**
 * The console's binding, moved to the datasource that holds the statement's tables.
 *
 * The environment and the dialect follow the datasource the statement moves to, so the console reports
 * the datasource it really ran against. The schema of the old binding is dropped: it belonged to a
 * database the statement no longer reads.
 */
export function relocateBoundInfo(
  dbInfo: IBoundInfo,
  target: IExecutionDatasource,
  dataSourceNode?: TreeNodeData,
): IBoundInfo {
  return {
    ...dbInfo,
    dataSourceId: target.dataSourceId ?? dbInfo.dataSourceId,
    dataSourceName:
      target.dataSourceName ?? dataSourceNode?.extraParams?.dataSourceName ?? dbInfo.dataSourceName,
    environmentId: dataSourceNode ? dataSourceNode.extraParams?.environmentId : dbInfo.environmentId,
    environment: dataSourceNode ? dataSourceNode.extraParams?.environment : dbInfo.environment,
    identityColor: dataSourceNode ? dataSourceNode.extraParams?.identityColor : dbInfo.identityColor,
    databaseType: dataSourceNode?.extraParams?.databaseType ?? dbInfo.databaseType,
    databaseName: target.databaseName ?? undefined,
    schemaName: undefined,
  };
}

/**
 * The tree node of a datasource, which carries the name, dialect and environment a statement moved to
 * it has to run under.
 */
export function findDataSourceNode(
  dataSourceNodes: readonly TreeNodeData[] | null | undefined,
  dataSourceId: number | null | undefined,
): TreeNodeData | undefined {
  if (typeof dataSourceId !== 'number') {
    return undefined;
  }
  return (dataSourceNodes || []).find((node) => node.extraParams?.dataSourceId === dataSourceId);
}

/**
 * What the desktop bridge needs to stop a pending request: it calls the "signal" it was given with the
 * pending request's id and reject, and the caller cancels through them.
 */
export interface RequestStopParams {
  id: string;
  reject: (reason?: any) => void;
}

/**
 * A way to give up on one request: the value the request's second parameter carries, plus the call that
 * stops it. The web takes a DOM AbortSignal; the desktop bridge only understands its own callback.
 */
export interface RequestStopSignal {
  signal: AbortSignal | ((params: RequestStopParams) => void) | null;
  cancel: () => void;
}

/**
 * The stop signal for one request, built for the runtime it runs in.
 *
 * On the web an AbortController does both jobs. On the desktop the bridge calls the "signal" with the
 * pending request's id and reject; cancelling removes the pending request and rejects it, the same way
 * useAbortRequest does. Passing a DOM AbortSignal there crashes the request with "E.call is not a
 * function", which silently turned every datasource lookup into a fallback to the console's binding.
 *
 * @param isDesktopRuntime whether the request runs inside the desktop app.
 * @param cancelPendingRequest drops a pending desktop request, given the id and reject the bridge passed.
 */
export function createRequestStopSignal(
  isDesktopRuntime: boolean,
  cancelPendingRequest?: (params: RequestStopParams) => void,
): RequestStopSignal {
  if (isDesktopRuntime) {
    let pending: RequestStopParams | null = null;
    return {
      signal: (params: RequestStopParams) => {
        pending = params;
      },
      cancel: () => {
        if (!pending) {
          return;
        }
        const current = pending;
        pending = null;
        cancelPendingRequest?.(current);
      },
    };
  }
  const controller = new AbortController();
  return { signal: controller.signal, cancel: () => controller.abort() };
}

/**
 * The statement without the comments and the blank space in front of it, so the first word is the word
 * that decides whether it is a query.
 */
function stripLeadingNoise(sql: string | null | undefined): string {
  if (!sql) {
    return '';
  }
  let remaining = sql;
  for (;;) {
    const trimmed = remaining.replace(/^[\s;]+/, '');
    if (trimmed.startsWith('--')) {
      const lineEnd = trimmed.indexOf('\n');
      if (lineEnd === -1) {
        return '';
      }
      remaining = trimmed.slice(lineEnd + 1);
      continue;
    }
    if (trimmed.startsWith('/*')) {
      const commentEnd = trimmed.indexOf('*/');
      if (commentEnd === -1) {
        return '';
      }
      remaining = trimmed.slice(commentEnd + 2);
      continue;
    }
    return trimmed;
  }
}
