import assert from 'node:assert/strict';
import { TreeNodeType } from '@/constants/tree';
import { createSavedConsoleTreeNodeKey } from './backgroundRefresh';
import {
  AGGREGATE_SAVED_CONSOLES_KEY,
  buildAggregateSavedConsoleChildren,
  buildAggregateSavedConsolesNode,
  isAggregateSavedConsolesExtraParams,
} from './aggregateSavedConsoles';

function savedConsoleItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    name: '齐悟情列表环比',
    ddl: 'SELECT 1',
    status: 'RELEASE',
    connectable: true,
    dataSourceId: 7,
    dataSourceName: 'test-ajk02',
    databaseType: 'MYSQL',
    environmentId: 3,
    environment: { id: 3 },
    identityColor: null,
    watermarkEnabled: null,
    watermarkContent: null,
    databaseName: 'db58_hbg_governance',
    schemaName: null,
    ...overrides,
  };
}

function createsTheAggregateCatalogueNode() {
  const node = buildAggregateSavedConsolesNode('查询');
  assert.equal(node.key, AGGREGATE_SAVED_CONSOLES_KEY);
  assert.equal(node.treeNodeType, TreeNodeType.SAVE_CONSOLES);
  assert.equal(node.originalTitle, '查询');
  assert.equal(node.isLeaf, false);
  assert.deepEqual(node.extraParams, { aggregateConsoles: true });
  // No dataSourceId on purpose: the children request must not be filtered by data source.
  assert.equal((node.extraParams as any).dataSourceId, undefined);
}

function detectsTheAggregateCatalogueByItsExtraParams() {
  assert.equal(isAggregateSavedConsolesExtraParams({ aggregateConsoles: true }), true);
  assert.equal(isAggregateSavedConsolesExtraParams({ dataSourceId: 7 }), false);
  assert.equal(isAggregateSavedConsolesExtraParams(undefined), false);
  assert.equal(isAggregateSavedConsolesExtraParams(null), false);
}

function mapsSavedConsoleRecordsToLeafNodesWithTheirOwnScope() {
  const children = buildAggregateSavedConsoleChildren([
    savedConsoleItem(),
    savedConsoleItem({ id: 43, name: '', dataSourceId: 8, databaseName: 'db58_hbg_audit', schemaName: 'public' }),
  ]);

  assert.equal(children.length, 2);

  const [first, second] = children;
  assert.equal(first.treeNodeType, TreeNodeType.SAVE_CONSOLE);
  assert.equal(first.isLeaf, true);
  assert.equal(first.id, 42);
  assert.equal(first.originalTitle, '齐悟情列表环比');
  assert.equal(
    first.key,
    `${createSavedConsoleTreeNodeKey({
      dataSourceId: 7,
      databaseName: 'db58_hbg_governance',
      consoleId: 42,
    })}-aggregate`,
  );
  const firstParams = first.extraParams as any;
  assert.equal(firstParams.dataSourceId, 7);
  assert.equal(firstParams.databaseName, 'db58_hbg_governance');
  assert.equal(firstParams.schemaName, undefined);
  assert.equal(firstParams.dataSourceName, 'test-ajk02');
  assert.equal(firstParams.databaseType, 'MYSQL');
  assert.equal(firstParams.ddl, 'SELECT 1');
  assert.equal(firstParams.connectable, true);
  assert.equal(firstParams.aggregateConsoles, undefined);

  const secondParams = second.extraParams as any;
  assert.equal(secondParams.dataSourceId, 8);
  assert.equal(secondParams.databaseName, 'db58_hbg_audit');
  assert.equal(secondParams.schemaName, 'public');
  assert.equal(second.originalTitle, '');
}

function keepsAggregateChildKeysDistinctFromDatabaseFolderKeys() {
  const children = buildAggregateSavedConsoleChildren([savedConsoleItem()]);
  const databaseFolderKey = createSavedConsoleTreeNodeKey({
    dataSourceId: 7,
    databaseName: 'db58_hbg_governance',
    consoleId: 42,
  });
  // The same console is also listed under its database folder, so keys must never collide.
  assert.notEqual(children[0].key, databaseFolderKey);
}

function toleratesMissingRecordsAndScopes() {
  assert.deepEqual(buildAggregateSavedConsoleChildren(null), []);
  assert.deepEqual(buildAggregateSavedConsoleChildren(undefined), []);

  const [orphan] = buildAggregateSavedConsoleChildren([savedConsoleItem({ dataSourceId: null, databaseName: null })]);
  const params = orphan.extraParams as any;
  assert.equal(params.dataSourceId, undefined);
  assert.equal(params.databaseName, undefined);
  assert.ok(orphan.key.endsWith('-aggregate'));

  const [withParent] = buildAggregateSavedConsoleChildren([savedConsoleItem()], { aggregateConsoles: true });
  assert.equal((withParent.extraParams as any).aggregateConsoles, true);
}

const testCases = [
  createsTheAggregateCatalogueNode,
  detectsTheAggregateCatalogueByItsExtraParams,
  mapsSavedConsoleRecordsToLeafNodesWithTheirOwnScope,
  keepsAggregateChildKeysDistinctFromDatabaseFolderKeys,
  toleratesMissingRecordsAndScopes,
];

for (const testCase of testCases) {
  testCase();
}

console.log(`aggregateSavedConsoles: ${testCases.length} tests passed`);
