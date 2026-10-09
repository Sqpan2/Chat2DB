import type { IBoundInfo } from '@/typings';

export type DataSourceRuntimeAvailability = 'available' | 'unavailable';

export type DataSourceRuntimeAvailabilityById = Record<number, DataSourceRuntimeAvailability | undefined>;

export type DataSourceRuntimeAvailabilityGenerationById = Record<number, number | undefined>;

interface DataSourceRuntimeAvailabilityState {
  runtimeAvailabilityByDataSourceId: DataSourceRuntimeAvailabilityById;
  runtimeAvailabilityGenerationByDataSourceId: DataSourceRuntimeAvailabilityGenerationById;
}

export function getDataSourceRuntimeAvailabilityGeneration(
  generationByDataSourceId: DataSourceRuntimeAvailabilityGenerationById,
  dataSourceId: number,
) {
  return generationByDataSourceId[dataSourceId] ?? 0;
}

export function transitionDataSourceRuntimeAvailability(
  state: DataSourceRuntimeAvailabilityState,
  dataSourceId: number,
  availability?: DataSourceRuntimeAvailability,
  expectedGeneration?: number,
): DataSourceRuntimeAvailabilityState | undefined {
  const currentGeneration = getDataSourceRuntimeAvailabilityGeneration(
    state.runtimeAvailabilityGenerationByDataSourceId,
    dataSourceId,
  );
  if (expectedGeneration !== undefined && currentGeneration !== expectedGeneration) {
    return undefined;
  }

  const runtimeAvailabilityByDataSourceId = { ...state.runtimeAvailabilityByDataSourceId };
  if (availability) {
    runtimeAvailabilityByDataSourceId[dataSourceId] = availability;
  } else {
    delete runtimeAvailabilityByDataSourceId[dataSourceId];
  }
  return {
    runtimeAvailabilityByDataSourceId,
    runtimeAvailabilityGenerationByDataSourceId: {
      ...state.runtimeAvailabilityGenerationByDataSourceId,
      [dataSourceId]: currentGeneration + 1,
    },
  };
}

export type EditorDataSourceState = 'unbound' | 'loading' | 'available' | 'unavailable' | 'deleted';

interface DataSourceListItem {
  extraParams: {
    dataSourceId?: number;
  };
}

export function resolveEditorDataSourceState(
  dataSourceId: number | undefined,
  dataSourceList: readonly DataSourceListItem[] | null | undefined,
  runtimeAvailabilityByDataSourceId: DataSourceRuntimeAvailabilityById,
): EditorDataSourceState {
  if (dataSourceId === undefined) {
    return 'unbound';
  }
  if (dataSourceList == null) {
    return 'loading';
  }
  if (!dataSourceList.some((item) => item.extraParams.dataSourceId === dataSourceId)) {
    return 'deleted';
  }
  return runtimeAvailabilityByDataSourceId[dataSourceId] === 'unavailable' ? 'unavailable' : 'available';
}

export function resolveEditorDataSourceConnectable(
  state: EditorDataSourceState,
  fallbackConnectable?: boolean,
): boolean | undefined {
  if (state === 'loading') {
    return fallbackConnectable;
  }
  return state === 'available';
}

export type SqlExecutionBlockReason = 'missingDataSource' | 'deletedDataSource';

export function getSqlExecutionBlockReason(
  dataSourceId: number | undefined,
  state: EditorDataSourceState,
): SqlExecutionBlockReason | undefined {
  if (dataSourceId === undefined) {
    return 'missingDataSource';
  }
  return state === 'deleted' ? 'deletedDataSource' : undefined;
}

type LiveDataSourceContext = Pick<
  IBoundInfo,
  | 'dataSourceId'
  | 'dataSourceName'
  | 'environmentId'
  | 'environment'
  | 'identityColor'
  | 'watermarkEnabled'
  | 'watermarkContent'
  | 'connectable'
>;

export function mergeLiveDataSourceContext(current: IBoundInfo, live: LiveDataSourceContext): IBoundInfo {
  if (
    current.dataSourceId === live.dataSourceId &&
    current.dataSourceName === live.dataSourceName &&
    current.environmentId === live.environmentId &&
    current.environment === live.environment &&
    current.identityColor === live.identityColor &&
    current.watermarkEnabled === live.watermarkEnabled &&
    current.watermarkContent === live.watermarkContent &&
    current.connectable === live.connectable
  ) {
    return current;
  }
  return {
    ...current,
    dataSourceId: live.dataSourceId,
    dataSourceName: live.dataSourceName,
    environmentId: live.environmentId,
    environment: live.environment,
    identityColor: live.identityColor,
    watermarkEnabled: live.watermarkEnabled,
    watermarkContent: live.watermarkContent,
    connectable: live.connectable,
  };
}

/**
 * Takes the binding of a datasource the console was pointed at from outside itself - the tree handing
 * it a table, say.
 *
 * The identity of the datasource record is merged as it always is, so a rename or a colour change still
 * reaches the console. The binding itself is only taken over when it really changed, because another
 * datasource means another dialect: a console that was re-pointed has to carry the database and the
 * dialect of the datasource it now reads, while an unrelated write to the store must not drag a console
 * that already matches it.
 *
 * @param current binding the console is holding.
 * @param live binding the store holds for it.
 * @returns the binding the console should hold.
 */
export function adoptBoundDataSourceContext(current: IBoundInfo, live: IBoundInfo): IBoundInfo {
  const identity = mergeLiveDataSourceContext(current, live);
  if (live.dataSourceId === current.dataSourceId && live.databaseName === current.databaseName) {
    return identity;
  }
  return {
    ...identity,
    databaseType: live.databaseType ?? identity.databaseType,
    databaseName: live.databaseName,
    schemaName: live.schemaName,
    supportDatabase: live.supportDatabase ?? identity.supportDatabase,
    supportSchema: live.supportSchema ?? identity.supportSchema,
  };
}
