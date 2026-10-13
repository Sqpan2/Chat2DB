import assert from 'node:assert/strict';
import {
  WORKSPACE_EXPORT_TYPE,
  buildWorkspaceExportFile,
  parseWorkspaceExportFile,
  resolveConsoleDataSourceId,
  WorkspaceImportError,
} from './workspaceTransfer';

function shouldBuildAUnifiedExportFile() {
  const exportFile = buildWorkspaceExportFile(
    [{ alias: 'test-ajk02', type: 'MYSQL', password: 'secret', id: 9 } as never],
    [
      {
        name: 'cms批量改判',
        ddl: 'SELECT 1;',
        type: 'MYSQL',
        dataSourceName: 'test-ajk02',
        databaseName: 'db58_hbg_governance',
        schemaName: 'public',
      },
    ] as never,
    '2026-10-13T00:00:00.000Z',
  );

  assert.equal(exportFile.type, WORKSPACE_EXPORT_TYPE);
  assert.equal(exportFile.version, 1);
  assert.equal(exportFile.dataSources.length, 1);
  assert.equal(exportFile.consoles.length, 1);
  // Local datasource id must not leak into the export.
  assert.equal('id' in exportFile.dataSources[0], false);
  // Password is carried in plaintext by explicit opt-in.
  assert.equal(exportFile.dataSources[0].password, 'secret');
  // Console references the datasource by name, not by local id.
  assert.equal(exportFile.consoles[0].dataSourceName, 'test-ajk02');
}

function shouldParseAFileExportedByChat2db() {
  const file = parseWorkspaceExportFile(
    JSON.stringify({
      type: WORKSPACE_EXPORT_TYPE,
      version: 1,
      exportedAt: '2026-10-13T00:00:00.000Z',
      dataSources: [{ alias: 'a', type: 'MYSQL' }],
      consoles: [{ name: 'q', ddl: 'SELECT 1' }],
    }),
  );

  assert.equal(file.dataSources.length, 1);
  assert.equal(file.consoles.length, 1);
}

function shouldRejectMalformedContent() {
  assert.throws(
    () => parseWorkspaceExportFile('not json'),
    (error) => error instanceof WorkspaceImportError && error.code === 'invalidJson',
  );
  assert.throws(
    () => parseWorkspaceExportFile(JSON.stringify({ type: 'other', dataSources: [], consoles: [] })),
    (error) => error instanceof WorkspaceImportError && error.code === 'invalidFormat',
  );
  assert.throws(
    () => parseWorkspaceExportFile(
      JSON.stringify({ type: WORKSPACE_EXPORT_TYPE, dataSources: [], consoles: [] }),
    ),
    (error) => error instanceof WorkspaceImportError && error.code === 'empty',
  );
}

function shouldResolveConsoleDataSourceIdByName() {
  const nameToId = new Map([['test-ajk02', 42]]);
  assert.equal(resolveConsoleDataSourceId('test-ajk02', nameToId), 42);
  assert.equal(resolveConsoleDataSourceId('missing', nameToId), undefined);
  assert.equal(resolveConsoleDataSourceId(undefined, nameToId), undefined);
}

async function main() {
  shouldBuildAUnifiedExportFile();
  shouldParseAFileExportedByChat2db();
  shouldRejectMalformedContent();
  shouldResolveConsoleDataSourceIdByName();

  console.log('Workspace transfer tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
