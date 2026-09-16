import assert from 'node:assert/strict';
import {
  SAVED_CONSOLE_EXPORT_TYPE,
  buildSavedConsoleExportFile,
  parseSavedConsoleExportFile,
  resolveImportedConsoleName,
  SavedConsoleImportError,
} from './savedConsoleTransfer';

const buildConsole = (overrides = {}) =>
  ({
    id: 1,
    name: 'cms批量改判',
    ddl: 'SELECT 1;',
    dataSourceId: 8,
    dataSourceName: 'test-ajk02',
    databaseName: 'db58_hbg_governance',
    schemaName: 'public',
    type: 'MYSQL',
    status: 'DRAFT',
    connectable: true,
    operationType: 'CONSOLE',
    ...overrides,
  }) as any;

function shouldExportEveryConsoleWithoutLocalIds() {
  const exportFile = buildSavedConsoleExportFile(
    [buildConsole(), buildConsole({ id: 2, name: '房态测试' })],
    '2026-09-16T00:00:00.000Z',
  );

  assert.equal(exportFile.type, SAVED_CONSOLE_EXPORT_TYPE);
  assert.equal(exportFile.version, 1);
  assert.equal(exportFile.exportedAt, '2026-09-16T00:00:00.000Z');
  assert.equal(exportFile.consoles.length, 2);
  assert.deepEqual(exportFile.consoles[0], {
    name: 'cms批量改判',
    ddl: 'SELECT 1;',
    type: 'MYSQL',
    dataSourceId: 8,
    dataSourceName: 'test-ajk02',
    databaseName: 'db58_hbg_governance',
    schemaName: 'public',
  });
  // Local console ids must not leak into the export.
  assert.equal('id' in exportFile.consoles[0], false);
}

function shouldExportEmptyListForMissingConsoleList() {
  const exportFile = buildSavedConsoleExportFile(null, '2026-09-16T00:00:00.000Z');

  assert.deepEqual(exportFile.consoles, []);
}

function shouldParseAFileExportedByChat2db() {
  const consoles = parseSavedConsoleExportFile(
    JSON.stringify({
      type: SAVED_CONSOLE_EXPORT_TYPE,
      version: 1,
      exportedAt: '2026-09-16T00:00:00.000Z',
      consoles: [{ name: 'cms批量改判', ddl: 'SELECT 1;' }],
    }),
  );

  assert.deepEqual(consoles, [{ name: 'cms批量改判', ddl: 'SELECT 1;' }]);
}

function shouldRejectMalformedContent() {
  assert.throws(
    () => parseSavedConsoleExportFile('not json'),
    (error) => error instanceof SavedConsoleImportError && error.code === 'invalidJson',
  );
  assert.throws(
    () => parseSavedConsoleExportFile(JSON.stringify({ type: 'something-else', consoles: [] })),
    (error) => error instanceof SavedConsoleImportError && error.code === 'invalidFormat',
  );
  assert.throws(
    () => parseSavedConsoleExportFile(JSON.stringify({ type: SAVED_CONSOLE_EXPORT_TYPE, consoles: [] })),
    (error) => error instanceof SavedConsoleImportError && error.code === 'empty',
  );
}

function shouldDropRecordsWithoutAName() {
  const consoles = parseSavedConsoleExportFile(
    JSON.stringify({
      type: SAVED_CONSOLE_EXPORT_TYPE,
      consoles: [{ name: 'keep', ddl: '' }, { ddl: 'SELECT 1;' }, null],
    }),
  );

  assert.deepEqual(consoles, [{ name: 'keep', ddl: '' }]);
}

function shouldSuffixDuplicatedNames() {
  const existingNames = new Set(['cms批量改判']);
  const importedNames = new Set<string>();

  const first = resolveImportedConsoleName('cms批量改判', existingNames, importedNames);
  importedNames.add(first);
  const second = resolveImportedConsoleName('cms批量改判', existingNames, importedNames);
  importedNames.add(second);
  const third = resolveImportedConsoleName('cms批量改判', existingNames, importedNames);
  importedNames.add(third);
  const unique = resolveImportedConsoleName('房态测试', existingNames, importedNames);

  assert.equal(first, 'cms批量改判(2)');
  assert.equal(second, 'cms批量改判(3)');
  assert.equal(third, 'cms批量改判(4)');
  assert.equal(unique, '房态测试');
}

function shouldFallBackForBlankNames() {
  assert.equal(resolveImportedConsoleName('   ', new Set(), new Set()), 'untitled');
  assert.equal(resolveImportedConsoleName('', new Set(['untitled']), new Set()), 'untitled(2)');
}

async function main() {
  shouldExportEveryConsoleWithoutLocalIds();
  shouldExportEmptyListForMissingConsoleList();
  shouldParseAFileExportedByChat2db();
  shouldRejectMalformedContent();
  shouldDropRecordsWithoutAName();
  shouldSuffixDuplicatedNames();
  shouldFallBackForBlankNames();

  console.log('Saved console transfer tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
