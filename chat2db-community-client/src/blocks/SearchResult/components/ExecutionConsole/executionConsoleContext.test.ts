import assert from 'node:assert/strict';
import { executionContextKey, formatExecutionContext } from './executionConsoleContext';

const context = {
  dataSourceId: 7,
  dataSourceName: 'test-ajk-user02.db.58dns.org',
  databaseType: 'MYSQL',
  databaseName: 'db58_hbg_ccf',
};

assert.equal(
  formatExecutionContext(context),
  'test-ajk-user02.db.58dns.org / db58_hbg_ccf',
  'a statement that ran where the user pointed the console shows its target',
);
assert.equal(
  formatExecutionContext({ ...context, autoLocated: true }, '（自动定位）'),
  'test-ajk-user02.db.58dns.org / db58_hbg_ccf （自动定位）',
  'a statement moved to another datasource says so',
);
assert.equal(
  formatExecutionContext({ ...context, autoLocated: true }),
  'test-ajk-user02.db.58dns.org / db58_hbg_ccf',
  'a missing marker label leaves the target alone',
);
assert.equal(
  formatExecutionContext({ dataSourceId: 3, schemaName: 'public', autoLocated: true }, '(auto-located)'),
  '#3 / public (auto-located)',
  'a datasource with no name reports its id',
);
assert.equal(formatExecutionContext({}, '(auto-located)'), 'SQL', 'a run with nothing bound reports SQL');

assert.equal(
  executionContextKey({ ...context, autoLocated: true }),
  executionContextKey({ ...context, autoLocated: true }),
  'two records of the same moved run share one header',
);
assert.notEqual(
  executionContextKey({ ...context, autoLocated: true }),
  executionContextKey(context),
  'a moved run is never folded into the run before it, however equal the datasource',
);

console.log('Execution console context tests passed');
