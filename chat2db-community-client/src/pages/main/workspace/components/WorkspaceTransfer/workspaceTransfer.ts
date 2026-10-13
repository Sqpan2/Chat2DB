import type { IConsole } from '@/typings';

/**
 * Unified workspace migration: one file carries every datasource and every saved console so a
 * single export/import round-trips the whole left-hand workspace across machines.
 *
 * Credentials are carried in plaintext by explicit user opt-in (the export UI warns about it), so
 * the file must be treated as a secret.
 */

export const WORKSPACE_EXPORT_TYPE = 'chat2db-workspace-export';
export const WORKSPACE_EXPORT_VERSION = 1;

/** A datasource as exported by `POST /api/connection/datasource/export`. */
export interface WorkspaceExportDataSource {
  alias?: string;
  url?: string;
  user?: string;
  password?: string | null;
  authenticationType?: string;
  type?: string;
  envType?: string;
  host?: string;
  port?: string;
  ssh?: unknown;
  ssl?: unknown;
  sid?: string;
  driver?: string;
  jdbc?: string;
  extendInfo?: unknown;
  driverConfig?: unknown;
  identityColor?: string | null;
  watermarkEnabled?: boolean | null;
  watermarkContent?: string | null;
  kind?: string;
  serviceName?: string;
  serviceType?: string;
  supportDatabase?: boolean;
  supportSchema?: boolean;
  email?: string;
  keyfile?: string;
  project?: string;
  storageType?: string;
  [key: string]: unknown;
}

export interface WorkspaceExportConsole {
  name: string;
  ddl: string;
  type?: IConsole['type'];
  dataSourceName?: string;
  databaseName?: string;
  schemaName?: string;
}

export interface WorkspaceExportFile {
  type: string;
  version: number;
  exportedAt: string;
  dataSources: WorkspaceExportDataSource[];
  consoles: WorkspaceExportConsole[];
}

export type WorkspaceImportErrorCode = 'invalidJson' | 'invalidFormat' | 'empty';

export class WorkspaceImportError extends Error {
  code: WorkspaceImportErrorCode;

  constructor(code: WorkspaceImportErrorCode) {
    super(code);
    this.name = 'WorkspaceImportError';
    this.code = code;
  }
}

/**
 * Datasource ids are local to one installation, so consoles reference the datasource by its stable
 * name (`dataSourceName`) instead. The import side resolves that name back to the freshly created
 * datasource id on the target machine.
 */
export function buildWorkspaceExportFile(
  dataSources: WorkspaceExportDataSource[],
  consoles: IConsole[] | null | undefined,
  exportedAt: string,
): WorkspaceExportFile {
  return {
    type: WORKSPACE_EXPORT_TYPE,
    version: WORKSPACE_EXPORT_VERSION,
    exportedAt,
    dataSources: (dataSources || []).map(({ id: _id, ...item }) => ({ ...item })),
    consoles: (consoles || []).map((item) => ({
      name: item.name,
      ddl: item.ddl,
      type: item.type,
      dataSourceName: item.dataSourceName,
      databaseName: item.databaseName,
      schemaName: item.schemaName,
    })),
  };
}

export function parseWorkspaceExportFile(fileContent: string): WorkspaceExportFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch {
    throw new WorkspaceImportError('invalidJson');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new WorkspaceImportError('invalidFormat');
  }

  const exportFile = parsed as Partial<WorkspaceExportFile>;
  if (
    exportFile.type !== WORKSPACE_EXPORT_TYPE ||
    !Array.isArray(exportFile.dataSources) ||
    !Array.isArray(exportFile.consoles)
  ) {
    throw new WorkspaceImportError('invalidFormat');
  }

  if (!exportFile.dataSources.length && !exportFile.consoles.length) {
    throw new WorkspaceImportError('empty');
  }

  return exportFile as WorkspaceExportFile;
}

/**
 * Resolves a target datasource id for an imported console by matching the exported datasource name.
 * Returns undefined when no matching datasource was imported (the console keeps "未指定数据源").
 */
export function resolveConsoleDataSourceId(
  dataSourceName: string | undefined,
  nameToId: ReadonlyMap<string, number>,
): number | undefined {
  if (!dataSourceName) {
    return undefined;
  }
  return nameToId.get(dataSourceName);
}
