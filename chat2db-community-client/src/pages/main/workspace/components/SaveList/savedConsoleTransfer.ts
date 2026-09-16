import type { IConsole } from '@/typings';

/**
 * File marker written into every export so an unrelated JSON file is rejected on import.
 */
export const SAVED_CONSOLE_EXPORT_TYPE = 'chat2db-saved-console';
export const SAVED_CONSOLE_EXPORT_VERSION = 1;

export interface SavedConsoleExportItem {
  name: string;
  ddl: string;
  type?: IConsole['type'];
  dataSourceId?: number;
  dataSourceName?: string;
  databaseName?: string;
  schemaName?: string;
}

export interface SavedConsoleExportFile {
  type: string;
  version: number;
  exportedAt: string;
  consoles: SavedConsoleExportItem[];
}

export type SavedConsoleImportErrorCode = 'invalidJson' | 'invalidFormat' | 'empty';

export class SavedConsoleImportError extends Error {
  code: SavedConsoleImportErrorCode;

  constructor(code: SavedConsoleImportErrorCode) {
    super(code);
    this.name = 'SavedConsoleImportError';
    this.code = code;
  }
}

/**
 * Console ids are local to one installation, so they are intentionally left out of the export.
 */
export function buildSavedConsoleExportFile(
  consoles: IConsole[] | null | undefined,
  exportedAt: string,
): SavedConsoleExportFile {
  return {
    type: SAVED_CONSOLE_EXPORT_TYPE,
    version: SAVED_CONSOLE_EXPORT_VERSION,
    exportedAt,
    consoles: (consoles || []).map((item) => ({
      name: item.name,
      ddl: item.ddl,
      type: item.type,
      dataSourceId: item.dataSourceId,
      dataSourceName: item.dataSourceName,
      databaseName: item.databaseName,
      schemaName: item.schemaName,
    })),
  };
}

export function parseSavedConsoleExportFile(fileContent: string): SavedConsoleExportItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch {
    throw new SavedConsoleImportError('invalidJson');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new SavedConsoleImportError('invalidFormat');
  }

  const exportFile = parsed as Partial<SavedConsoleExportFile>;
  if (exportFile.type !== SAVED_CONSOLE_EXPORT_TYPE || !Array.isArray(exportFile.consoles)) {
    throw new SavedConsoleImportError('invalidFormat');
  }

  const consoles = exportFile.consoles.filter(
    (item): item is SavedConsoleExportItem =>
      !!item && typeof item === 'object' && typeof (item as SavedConsoleExportItem).name === 'string',
  );

  if (!consoles.length) {
    throw new SavedConsoleImportError('empty');
  }

  return consoles;
}

/**
 * Imported consoles are always created as new records: a name already in use gets a numeric suffix.
 */
export function resolveImportedConsoleName(
  baseName: string,
  existingNames: ReadonlySet<string>,
  importedNames: ReadonlySet<string>,
): string {
  const fallbackName = (baseName || '').trim() || 'untitled';
  const isNameTaken = (name: string) => existingNames.has(name) || importedNames.has(name);

  if (!isNameTaken(fallbackName)) {
    return fallbackName;
  }

  let suffix = 2;
  while (isNameTaken(`${fallbackName}(${suffix})`)) {
    suffix += 1;
  }

  return `${fallbackName}(${suffix})`;
}
