export interface ResultEditCellAddress {
  col: number;
  row: number;
}

export interface ResultEditCellRange {
  start: ResultEditCellAddress;
  end: ResultEditCellAddress;
}

/**
 * Whether a keydown should start editing the active cell.
 *
 * VTable owns the modifier combinations and the non-printable keys for its own
 * shortcuts, so only plain character keys are taken over here. Composition input
 * is left alone so IME candidates are never swallowed, and space stays with the
 * grid's own scrolling behaviour.
 */
export function isPrintableEditKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  if (event.isComposing || event.key === 'Process' || event.key === ' ') {
    return false;
  }
  return event.key.length === 1;
}

/**
 * The rows that should receive the same value as the cell being edited.
 *
 * Only the active cell's own column is collected: the feature exists to edit one
 * field across many rows, and filling across columns would push a single value
 * into editors of unrelated types (a date picker beside a free-text input).
 */
export function collectBatchFillRows(
  ranges: readonly ResultEditCellRange[],
  activeCol: number,
  activeRow: number,
): number[] {
  const rows = new Set<number>();
  ranges.forEach((range) => {
    if (activeCol < range.start.col || activeCol > range.end.col) {
      return;
    }
    for (let row = range.start.row; row <= range.end.row; row += 1) {
      if (row !== activeRow) {
        rows.add(row);
      }
    }
  });
  return [...rows].sort((left, right) => left - right);
}

/**
 * A cell is only editable when VTable resolved an editor for it, which the result
 * table leaves unset for read-only result sets and for frozen or hidden fields.
 */
export function resolveEditableCell(
  getEditor: (col: number, row: number) => unknown,
  col: number,
  row: number,
): ResultEditCellAddress | undefined {
  if (col < 0 || row < 0 || !getEditor(col, row)) {
    return undefined;
  }
  return { col, row };
}

export interface ResultBatchFill extends ResultEditCellAddress {
  /** The other rows of the active column that receive the committed value. */
  rows: number[];
}

/**
 * Whether an armed fill may still be completed, given where the grid is editing.
 *
 * A commit whose value did not change fires no `change_cell_value`, so Enter and Tab
 * complete that fill themselves. That is only safe once the active cell has stopped
 * being edited: while its own editor is still open nothing has been committed, and the
 * cell's previous value would be written over the selected rows.
 */
export function canFlushBatchFill(
  fill: ResultEditCellAddress,
  editingCell: ResultEditCellAddress | undefined,
): boolean {
  if (!editingCell) {
    return true;
  }
  return editingCell.col !== fill.col || editingCell.row !== fill.row;
}
