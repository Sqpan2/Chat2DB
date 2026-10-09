import type { SqlExecutionLogContext } from '@/service/sqlExecutionLog';

/**
 * The datasource a record ran against, as the console header shows it.
 *
 * @param context datasource the record ran against.
 * @param autoLocatedLabel marker of a statement that was moved to another datasource than the console's
 * own binding, empty for a statement that ran where the user pointed the console.
 */
export function formatExecutionContext(
  context: SqlExecutionLogContext,
  autoLocatedLabel?: string,
): string {
  const source = context.dataSourceName || (context.dataSourceId ? `#${context.dataSourceId}` : 'SQL');
  const target = [source, context.databaseName, context.schemaName].filter(Boolean).join(' / ');
  return context.autoLocated && autoLocatedLabel ? `${target} ${autoLocatedLabel}` : target;
}

/**
 * Identity of a header line: records sharing it are shown under one header.
 *
 * A moved statement is never folded into the run before it, however identical the datasource it landed
 * on: the marker has to stay visible on the records it belongs to.
 */
export function executionContextKey(context: SqlExecutionLogContext): string {
  return [
    context.dataSourceId,
    context.dataSourceName,
    context.databaseType,
    context.databaseName,
    context.schemaName,
    context.autoLocated ? 'auto-located' : '',
  ].join('|');
}
