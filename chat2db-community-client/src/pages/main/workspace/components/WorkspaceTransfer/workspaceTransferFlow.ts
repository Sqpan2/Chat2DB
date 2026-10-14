import connectionServer from '@/service/connection';
import historyServer from '@/service/history';
import { ConsoleStatus, WorkspaceTabType } from '@/constants';
import { saveFileToDesktop } from '@/utils/file';
import {
  buildWorkspaceExportFile,
  dataSourceIdentityKey,
  parseWorkspaceExportFile,
  resolveConsoleDataSourceId,
  type WorkspaceExportDataSource,
} from './workspaceTransfer';

export type WorkspaceTransferOutcome = 'saved' | 'cancelled' | 'failed';

export interface WorkspaceTransferDependencies {
  exportDataSources: (params: { datasourceIds: number[] | null; includePassword?: boolean }) => Promise<{
    message: string;
  }>;
  listDataSources: () => Promise<{ id: number; alias?: string; type?: string }[]>;
  listSavedConsoles: () => Promise<
    {
      id: number;
      name: string;
      ddl: string;
      type?: string;
      dataSourceName?: string;
      databaseName?: string;
      schemaName?: string;
    }[]
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
  deleteDataSource: (id: number) => Promise<unknown>;
  deleteConsole: (id: number) => Promise<unknown>;
  saveFile: (file: {
    fileName: string;
    fileContent: string;
    fileType: string;
  }) => Promise<{ path: string } | null | undefined>;
  readFileContent: (file: File) => Promise<string>;
}

export interface WorkspaceImportResult {
  importedDataSources: number;
  importedConsoles: number;
  skippedConsoles: number;
  skippedDataSources: number;
}

export interface WorkspaceClearResult {
  deletedDataSources: number;
  deletedConsoles: number;
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
 * newly created datasources by name. Datasources whose (alias, type) already exist and consoles
 * whose name already exists are skipped as duplicates, so re-importing the same file is a no-op.
 */
export async function runWorkspaceImport(
  file: File,
  dependencies: WorkspaceTransferDependencies,
): Promise<WorkspaceImportResult> {
  const content = await dependencies.readFileContent(file);
  const exportFile = parseWorkspaceExportFile(content);

  const nameToId = new Map<string, number>();
  const registerDataSourceName = (alias: string, id: number) => {
    nameToId.set(alias, id);
    // Register the "@"-normalized alias too, so consoles that still record the legacy
    // "@host" form (or vice versa) re-link to the datasource.
    nameToId.set(alias.startsWith('@') ? alias.slice(1) : `@${alias}`, id);
  };

  const existingDataSources = await dependencies.listDataSources().catch(() => []);
  const existingDataSourceIds = new Map<string, number>();
  for (const item of existingDataSources || []) {
    if (item?.alias) {
      existingDataSourceIds.set(dataSourceIdentityKey(item.alias, item.type), item.id);
    }
  }

  let importedDataSources = 0;
  let skippedDataSources = 0;
  for (const dataSource of exportFile.dataSources) {
    const duplicateId = existingDataSourceIds.get(dataSourceIdentityKey(dataSource.alias, dataSource.type));
    if (duplicateId != null && dataSource.alias) {
      // Already present: skip creation but keep the existing id so consoles still re-link.
      registerDataSourceName(dataSource.alias, duplicateId);
      skippedDataSources += 1;
      continue;
    }
    try {
      const created = await dependencies.createDataSource(dataSource);
      if (created?.id && dataSource.alias) {
        registerDataSourceName(dataSource.alias, created.id);
      }
      importedDataSources += 1;
    } catch {
      // Skip the failed datasource and keep importing the rest.
    }
  }

  const existingConsoles = await dependencies.listSavedConsoles().catch(() => []);
  const existingConsoleNames = new Set<string>(
    (existingConsoles || []).map((item) => (item?.name || '').trim()).filter(Boolean),
  );
  const importedConsoleNames = new Set<string>();
  let importedConsoles = 0;
  let skippedConsoles = 0;
  for (const console of exportFile.consoles) {
    const consoleName = (console?.name || '').trim();
    if (!consoleName) {
      skippedConsoles += 1;
      continue;
    }
    if (existingConsoleNames.has(consoleName) || importedConsoleNames.has(consoleName)) {
      // Duplicate: the same named saved console already exists (or was imported earlier in this
      // run), so skip instead of creating a copy.
      skippedConsoles += 1;
      continue;
    }
    importedConsoleNames.add(consoleName);
    try {
      await dependencies.createConsole({
        name: consoleName,
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

  return { importedDataSources, importedConsoles, skippedConsoles, skippedDataSources };
}

/**
 * Deletes every datasource and every saved console in the workspace. Per-item failures are
 * skipped so one broken record cannot block clearing the rest.
 */
export async function runWorkspaceClear(
  dependencies: WorkspaceTransferDependencies,
): Promise<WorkspaceClearResult> {
  let deletedDataSources = 0;
  let deletedConsoles = 0;

  const dataSources = await dependencies.listDataSources().catch(() => []);
  for (const dataSource of dataSources || []) {
    if (dataSource?.id == null) {
      continue;
    }
    try {
      await dependencies.deleteDataSource(dataSource.id);
      deletedDataSources += 1;
    } catch {
      // Keep clearing the remaining datasources.
    }
  }

  const consoles = await dependencies.listSavedConsoles().catch(() => []);
  for (const console of consoles || []) {
    if (console?.id == null) {
      continue;
    }
    try {
      await dependencies.deleteConsole(console.id);
      deletedConsoles += 1;
    } catch {
      // Keep clearing the remaining consoles.
    }
  }

  return { deletedDataSources, deletedConsoles };
}

/** Production wiring for the workspace transfer. */
export function createWorkspaceTransferDependencies(): WorkspaceTransferDependencies {
  return {
    exportDataSources: connectionServer.exportDataSource,
    listDataSources: async () => {
      const res = await connectionServer.getList({ pageNo: 1, pageSize: 10000 });
      return (res?.data || []).map((item) => ({
        id: item.id,
        alias: item.alias,
        type: item.type,
      }));
    },
    listSavedConsoles: async () => {
      const res = await historyServer.getConsoleList({
        pageNo: 1,
        pageSize: 10000,
        status: ConsoleStatus.RELEASE,
        orderByDesc: true,
      });
      return (res?.data || []).map((item) => ({
        id: item.id,
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
    deleteDataSource: (id) => connectionServer.remove({ id }),
    deleteConsole: (id) => historyServer.deleteSavedConsole({ id }),
    saveFile: ({ fileName, fileContent, fileType }) => saveFileToDesktop({ fileName, fileContent, fileType }),
    readFileContent: (file) => file.text(),
  };
}
