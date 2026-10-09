/**
 * Scope bookkeeping for completing SQL against the datasources a console is not
 * bound to.
 *
 * The backend fans out over the scopes it is given, so this module only decides
 * *which* datasources to offer and in what order: the datasource the editor last
 * ran a statement against comes first, the remaining ones follow in tree order.
 * A datasource the editor is bound to is supplied by the caller as its own leading
 * scope and is therefore never listed here.
 */

/** Datasources a single completion fan-out reaches; mirrors the server-side cap. */
export const UNBOUND_COMPLETION_MAX_SCOPES = 12;

/** How many recently executed datasources are remembered. */
export const MAX_RECENT_EXECUTED_DATA_SOURCE_IDS = 20;

export interface UnboundCompletionScope {
  dataSourceId: number;
  /** Database to read; omitted means every database of the datasource. */
  databaseName?: string;
  /** Schema to read; omitted means every schema. */
  schemaName?: string;
}

function isUsableDataSourceId(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Moves a datasource to the front of the recency list, dropping any older entry
 * for it so an id is only ever listed once.
 */
export function recordExecutedDataSource(
  executedDataSourceIds: readonly number[] | null | undefined,
  dataSourceId: number | null | undefined,
): number[] {
  const current = executedDataSourceIds ?? [];
  if (!isUsableDataSourceId(dataSourceId)) {
    return [...current];
  }
  return [dataSourceId, ...current.filter((id) => id !== dataSourceId)].slice(
    0,
    MAX_RECENT_EXECUTED_DATA_SOURCE_IDS,
  );
}

/**
 * Orders the datasources to complete against: recently executed ones first (most
 * recent first), then everything the tree knows about, capped and deduplicated.
 *
 * @param excludedDataSourceId datasource the editor is already bound to, which the
 * caller supplies as a scope of its own and which must not be listed twice.
 */
export function buildUnboundCompletionScopes(
  executedDataSourceIds: readonly number[] | null | undefined,
  availableDataSourceIds: readonly (number | null | undefined)[] | null | undefined,
  excludedDataSourceId?: number | null,
): UnboundCompletionScope[] {
  const scopes: UnboundCompletionScope[] = [];
  const seen = new Set<number>();
  const push = (dataSourceId: number | null | undefined) => {
    if (!isUsableDataSourceId(dataSourceId) || seen.has(dataSourceId)) {
      return;
    }
    if (scopes.length >= UNBOUND_COMPLETION_MAX_SCOPES) {
      return;
    }
    seen.add(dataSourceId);
    scopes.push({ dataSourceId });
  };

  if (isUsableDataSourceId(excludedDataSourceId)) {
    seen.add(excludedDataSourceId);
  }
  (executedDataSourceIds ?? []).forEach(push);
  (availableDataSourceIds ?? []).forEach(push);
  return scopes;
}
