import assert from 'node:assert/strict';
import {
  canFlushBatchFill,
  collectBatchFillRows,
  isPrintableEditKey,
  resolveEditableCell,
  type ResultEditCellRange,
} from './keyboardEdit';

const key = (overrides: Partial<Parameters<typeof isPrintableEditKey>[0]>) => ({
  key: 'a',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...overrides,
});

assert.equal(isPrintableEditKey(key({ key: 'a' })), true, 'a letter should start an edit');
assert.equal(isPrintableEditKey(key({ key: '7' })), true, 'a digit should start an edit');
assert.equal(isPrintableEditKey(key({ key: "'" })), true, 'a quote should start an edit');
assert.equal(isPrintableEditKey(key({ key: '%' })), true, 'a symbol should start an edit');
assert.equal(isPrintableEditKey(key({ key: '中' })), true, 'a composed character should start an edit');

assert.equal(isPrintableEditKey(key({ key: 'c', metaKey: true })), false, 'copy must stay with the app');
assert.equal(isPrintableEditKey(key({ key: 'v', ctrlKey: true })), false, 'paste must stay with the app');
assert.equal(isPrintableEditKey(key({ key: 'a', ctrlKey: true })), false, 'select-all must stay with the grid');
assert.equal(isPrintableEditKey(key({ key: 'x', altKey: true })), false, 'alt combinations are not plain text');
assert.equal(isPrintableEditKey(key({ key: ' ' })), false, 'space stays with the grid scrolling');
assert.equal(isPrintableEditKey(key({ key: 'Enter' })), false, 'named keys are not text input');
assert.equal(isPrintableEditKey(key({ key: 'Escape' })), false, 'named keys are not text input');
assert.equal(isPrintableEditKey(key({ key: 'ArrowDown' })), false, 'named keys are not text input');
assert.equal(
  isPrintableEditKey(key({ key: 'Process', isComposing: true })),
  false,
  'an IME candidate must not be swallowed',
);
assert.equal(
  isPrintableEditKey(key({ key: 'a', isComposing: true })),
  false,
  'a keystroke inside an IME composition must not be swallowed',
);

const range = (startCol: number, startRow: number, endCol: number, endRow: number): ResultEditCellRange => ({
  start: { col: startCol, row: startRow },
  end: { col: endCol, row: endRow },
});

assert.deepEqual(
  collectBatchFillRows([range(2, 1, 2, 1)], 2, 1),
  [],
  'editing a lone cell fills nothing',
);
assert.deepEqual(
  collectBatchFillRows([range(2, 1, 2, 4)], 2, 1),
  [2, 3, 4],
  'the rows below the active cell in its own column are filled',
);
assert.deepEqual(
  collectBatchFillRows([range(2, 1, 2, 4)], 2, 3),
  [1, 2, 4],
  'the active cell is excluded wherever it sits in the range',
);
assert.deepEqual(
  collectBatchFillRows([range(1, 1, 3, 3)], 2, 2),
  [1, 3],
  'a block fills only the active column, never the neighbouring ones',
);
assert.deepEqual(
  collectBatchFillRows([range(1, 1, 3, 3)], 4, 2),
  [],
  'a range that misses the active column fills nothing',
);
assert.deepEqual(
  collectBatchFillRows([range(2, 5, 2, 6), range(2, 1, 2, 3)], 2, 5),
  [1, 2, 3, 6],
  'separate ranges are merged and ordered by row',
);
assert.deepEqual(
  collectBatchFillRows([range(2, 1, 2, 4), range(2, 2, 2, 3)], 2, 1),
  [2, 3, 4],
  'overlapping ranges fill each row once',
);

const editorAt = (col: number, row: number) => (candidateCol: number, candidateRow: number) =>
  candidateCol === col && candidateRow === row ? { name: 'custom-input-editor' } : undefined;

assert.deepEqual(
  resolveEditableCell(editorAt(2, 3), 2, 3),
  { col: 2, row: 3 },
  'a cell with an editor can be edited',
);
assert.equal(
  resolveEditableCell(editorAt(2, 3), 2, 4),
  undefined,
  'a cell without an editor must not start an edit',
);
assert.equal(
  resolveEditableCell(() => ({ name: 'custom-input-editor' }), -1, 3),
  undefined,
  'a header or missing column must not start an edit',
);
assert.equal(
  resolveEditableCell(() => ({ name: 'custom-input-editor' }), 2, -1),
  undefined,
  'a missing row must not start an edit',
);

assert.equal(canFlushBatchFill({ col: 2, row: 1 }, undefined), true, 'a closed editor leaves nothing uncommitted');
assert.equal(
  canFlushBatchFill({ col: 2, row: 1 }, { col: 3, row: 1 }),
  true,
  'Tab opening an editor further along the row still has a commit to finish',
);
assert.equal(
  canFlushBatchFill({ col: 2, row: 1 }, { col: 2, row: 1 }),
  false,
  'the edited cell being open again means the key committed nothing',
);
assert.equal(
  canFlushBatchFill({ col: 2, row: 1 }, { col: 2, row: 2 }),
  true,
  'an editor open on another row does not block the fill',
);

console.log('keyboardEdit tests passed');
