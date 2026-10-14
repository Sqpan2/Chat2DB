import connectionServer from '@/service/connection';
import historyServer from '@/service/history';
import { ConsoleStatus, WorkspaceTabType } from '@/constants';
import { saveFileToDesktop } from '@/utils/file';
import {
  buildWorkspaceExportFile,
  parseWorkspaceExportFile,
  resolveConsoleDataSourceId,
  type WorkspaceExportDataSource,
} from './workspaceTransfer';

export type WorkspaceTransferOutcome = 'saved' | 'cancelled' | 'failed';

export interface WorkspaceTransferDependencies {
  exportDataSources: (params: { datasourceIds: number[] | null; includePassword?: boolean }) => Promise<{
    message: string;
  }>;
  listSavedConsoles: () => Promise<
    { name: string; ddl: string; type?: string; dataSourceName?: string; databaseName?: string; schemaName?: string }[]
  >;
  createDataSource: (dataSource: WorkspaceExportDataSource) => Promise<{ id: number; alias: string }>;
  createConsole: (params: {
    name: string;
    ddl: string;
    type?: string;
    dataSourceId?: number;
    databaseName?: string;
    schemaName?: string;
  }) => Promise<unknown>;
  saveFile: (file: {
    fileName: string;
    fileContent: string;
    fileType: string;
  }) => Promise<{ path: string } | null | undefined>;
  readFileContent: (file: File) => Promise<string>;
  resolveImportedName: (
    baseName: string,
    existingNames: ReadonlySet<string>,
    importedNames: ReadonlySet<string>,
  ) => string;
}

export interface WorkspaceImportResult {
  importedDataSources: number;
  importedConsoles: number;
  skippedConsoles: number;
}

/** Exports every datasource (with plaintext credentials) and every saved console into one JSON file. */
export async function runWorkspaceExport(
  dependencies: WorkspaceTransferDependencies,
): Promise<WorkspaceTransferOutcome> {
  try {
    const dataSourceResponse = await dependencies.exportDataSources({
      datasourceIds: null,
      includePassword: true,
    });
    const dataSources: WorkspaceExportDataSource[] = JSON.parse(dataSourceResponse.message || '[]');
    const consoles = await dependencies.listSavedConsoles();
    const exportFile = buildWorkspaceExportFile(dataSources, consoles as never, new Date().toISOString());

    const savedFile = await dependencies.saveFile({
      fileName: 'chat2db_workspace',
      fileContent: JSON.stringify(exportFile, null, 2),
      fileType: 'json',
    });
    if (!savedFile) {
      return 'cancelled';
    }
    return 'saved';
  } catch {
    return 'failed';
  }
}

/**
 * Imports a workspace export file: recreates datasources, then recreates consoles re-linked to the
 * newly created datasources by name. Existing records are never overwritten.
 */
export async function runWorkspaceImport(
  file: File,
  dependencies: WorkspaceTransferDependencies,
): Promise<WorkspaceImportResult> {
  const content = await dependencies.readFileContent(file);
  const exportFile = parseWorkspaceExportFile(content);

  const nameToId = new Map<string, number>();
  let importedDataSources = 0;
  for (const dataSource of exportFile.dataSources) {
    try {
      const created = await dependencies.createDataSource(dataSource);
      if (created?.id && dataSource.alias) {
        nameToId.set(dataSource.alias, created.id);
        // Register the "@"-normalized alias too, so consoles that still record the legacy
        // "@host" form (or vice versa) re-link to the freshly created datasource.
        const normalizedAlias = dataSource.alias.startsWith('@')
          ? dataSource.alias.slice(1)
          : `@${dataSource.alias}`;
        nameToId.set(normalizedAlias, created.id);
      }
      importedDataSources += 1;
    } catch {
      // Skip the failed datasource and keep importing the rest.
    }
  }

  const existingConsoleNames = new Set<string>();
  const importedConsoleNames = new Set<string>();
  let importedConsoles = 0;
  let skippedConsoles = 0;
  for (const console of exportFile.consoles) {
    if (!console?.name) {
      skippedConsoles += 1;
      continue;
    }
    const name = dependencies.resolveImportedName(console.name, existingConsoleNames, importedConsoleNames);
    importedConsoleNames.add(name);
    try {
      await dependencies.createConsole({
        name,
        ddl: console.ddl || '',
        type: console.type,
        dataSourceId: resolveConsoleDataSourceId(console.dataSourceName, nameToId),
        databaseName: console.databaseName,
        schemaName: console.schemaName,
      });
      importedConsoles += 1;
    } catch {
      skippedConsoles += 1;
    }
  }

  return { importedDataSources, importedConsoles, skippedConsoles };
}

/** Production wiring for the workspace transfer. */
export function createWorkspaceTransferDependencies(): WorkspaceTransferDependencies {
  return {
    exportDataSources: connectionServer.exportDataSource,
    listSavedConsoles: async () => {
      const res = await historyServer.getConsoleList({
        pageNo: 1,
        pageSize: 10000,
        status: ConsoleStatus.RELEASE,
        orderByDesc: true,
      });
      return (res?.data || []).map((item) => ({
        name: item.name,
        ddl: item.ddl,
        type: item.type,
        dataSourceName: item.dataSourceName,
        databaseName: item.databaseName,
        schemaName: item.schemaName,
      }));
    },
    createDataSource: async (dataSource) => {
      const { id, spaceId, environmentId, environment, organizationId, storageType, ...rest } =
        dataSource as WorkspaceExportDataSource & Record<string, unknown>;
      const created = await connectionServer.save(rest as never);
      return { id: created.id, alias: created.alias };
    },
    createConsole: (params) =>
      historyServer.createConsole({
        name: params.name,
        nameCustomized: true,
        ddl: params.ddl || '',
        // Imported consoles must land as RELEASE so they show up in the saved-console tree,
        // which only lists RELEASE entries. DRAFT consoles are invisible in the UI.
        status: ConsoleStatus.RELEASE,
        operationType: WorkspaceTabType.CONSOLE,
        type: params.type,
        dataSourceId: params.dataSourceId as number,
        databaseName: params.databaseName,
        schemaName: params.schemaName,
      } as never),
    saveFile: ({ fileName, fileContent, fileType }) => saveFileToDesktop({ fileName, fileContent, fileType }),
    readFileContent: (file) => file.text(),
    resolveImportedName: (baseName, existingNames, importedNames) => {
      const fallback = (baseName || '').trim() || 'untitled';
      const taken = (name: string) => existingNames.has(name) || importedNames.has(name);
      if (!taken(fallback)) {
        return fallback;
      }
      let suffix = 2;
      while (taken(`${fallback}(${suffix})`)) {
        suffix += 1;
      }
      return `${fallback}(${suffix})`;
    },
  };
}
