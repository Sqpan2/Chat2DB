import {
  memo,
  useEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
  ForwardedRef,
  useCallback,
  useRef,
  useState,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useStyles } from './style';
import CanvasTable from '@/blocks/CanvasTable';
import { ITableInstance } from '@/blocks/CanvasTable/typings';
import { IManageResultData } from '@/typings/database';
import onContextmenuCell from './event/onContextmenuCell';
import onChangeCellValue from './event/onChangeCellValue';
import onCopyData from './event/onCopyData';
import onPasteData from './event/onPasteData';
import { buildResultColumns, buildResultRecords } from './utils/dataTreating';
import useOperationRecord, { OperationRecordUtils } from './hooks/useOperationRecord';
import useFilterAndSort from './hooks/useFilterAndSort';
import useHeaderTooltip from './hooks/useHeaderTooltip';
import { ITableOperationUtils } from './typings';
import { useGlobalStore } from '@/store/global';
import ColumnVisibilityModal, { ResultColumnVisibilityOption } from './ColumnVisibilityModal';
import {
  getResultFrozenColumnCount,
  getResultColumnFields,
  getResultColumnDisplayOrder,
  getNextFrozenResultColumnFields,
  hideResultColumnFields,
  mergeResultColumnOrderFromDisplay,
  orderResultColumns,
  reconcileHiddenResultColumnFields,
  getResultFieldAtTableColumn,
} from './columnState';
import { resolveResultSelectionActiveCell, ResultSelectionCause } from './selectionState';
import {
  canFlushBatchFill,
  collectBatchFillRows,
  isPrintableEditKey,
  resolveEditableCell,
  type ResultBatchFill,
} from './utils/keyboardEdit';
import { RESULT_TABLE_CONTENT_LAYOUT_OPTIONS } from './layoutOptions';
import { resetResultTableLayout, updateResultTableRowExpansion } from './rowHeight';
import { hasActiveResultEditorChange } from '../ResultSet/resultEditActions';

interface IProps {
  className?: string;
  resultData: IManageResultData;
  // There are operational changes in the table
  onOperationChange?: (hasOperationRecord: any) => void;
  // table
  onTableOperationUtils: ITableOperationUtils;
  tableInstance: ITableInstance | null;
  setTableInstance: (tableInstance: ITableInstance) => void;
  setOrderByText?: (orderByText: string) => void;
  onFilterCountChange?: (count: number) => void;
  onActiveEditChange?: (hasChange: boolean) => void;
  onSelectionChange?: (selection: IResultSetSelection) => void;
}

export interface IResultSetSelection {
  values: unknown[];
  rowCount: number;
  cause: ResultSelectionCause;
  interactionRevision: number;
  activeCell?: {
    tableInstance: ITableInstance;
    col: number;
    row: number;
    rowId?: string | number;
    field?: string;
  };
}

export interface ResultSetTableRef {
  operationRecordUtils: OperationRecordUtils;
  tableInstance: ITableInstance | null;
  activeFilterCount: number;
  clearAllFilters: () => void;
  isFieldFrozen: (field: string | number) => boolean;
  openColumnVisibility: () => void;
  getInteractionRevision: () => number;
}

const ResultSetTable = forwardRef((props: IProps, ref: ForwardedRef<ResultSetTableRef>) => {
  const { resultData, onOperationChange, onTableOperationUtils, tableInstance, setTableInstance } = props;
  const { styles, theme } = useStyles();
  const [hiddenColumnFields, setHiddenColumnFields] = useState<Set<string>>(() => new Set());
  const [frozenColumnFields, setFrozenColumnFields] = useState<string[]>([]);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [columnVisibilityOpen, setColumnVisibilityOpen] = useState(false);
  const interactionRevisionRef = useRef(0);
  // Rows waiting to receive the value committed in the cell being edited: set when a
  // keystroke starts an edit over a multi-cell selection, consumed once it commits.
  const pendingFillRef = useRef<ResultBatchFill | null>(null);
  // Set while a fill writes its own cells, so those writes are not mistaken for the hand
  // edit that triggered them.
  const isBatchFillingRef = useRef(false);
  // Installed by the table listener effect. The keydown handler completes a fill whose
  // commit fired no change event, and only that effect knows how to write the cells.
  const runBatchFillRef = useRef<(fill: ResultBatchFill, value: unknown) => void>(() => {});
  const { customFontSize, showFieldType, showFieldComment } = useGlobalStore((state) => ({
    customFontSize: state.baseSetting.customFontSize ?? 13,
    showFieldType: state.dataTableSettings.showFieldType ?? true,
    showFieldComment: state.dataTableSettings.showFieldComment ?? true,
  }));
  const columnVisibilityOptions = useMemo<ResultColumnVisibilityOption[]>(
    () =>
      (resultData.headerList || []).slice(1).map((header, index) => ({
        field: String(index + 1),
        header,
      })),
    [resultData.headerList],
  );
  const resultColumnFields = useMemo(
    () => columnVisibilityOptions.map((column) => column.field),
    [columnVisibilityOptions],
  );

  useEffect(() => {
    setHiddenColumnFields((current) => {
      const next = reconcileHiddenResultColumnFields(resultColumnFields, current);
      return next.size === current.size && [...next].every((field) => current.has(field)) ? current : next;
    });
    setColumnOrder((current) => {
      const next = [...current.filter((field) => resultColumnFields.includes(field))];
      resultColumnFields.forEach((field) => {
        if (!next.includes(field)) {
          next.push(field);
        }
      });
      return next.length === current.length && next.every((field, index) => field === current[index])
        ? current
        : next;
    });
    setFrozenColumnFields((current) => current.filter((field) => resultColumnFields.includes(field)));
  }, [resultColumnFields]);

  // Registry data manipulation method
  const { operationRecordUtils, hasOperationRecord, reCalculateCellStyle } = useOperationRecord({
    tableInstance,
    theme,
  });

  useEffect(() => {
    if (!tableInstance || !props.onActiveEditChange) {
      return;
    }
    let frameId: number | null = null;
    const syncActiveEditState = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      frameId = requestAnimationFrame(() => {
        frameId = null;
        props.onActiveEditChange?.(hasActiveResultEditorChange(tableInstance));
      });
    };
    const eventIds = [
      tableInstance.on('click_cell', syncActiveEditState),
      tableInstance.on('dblclick_cell', syncActiveEditState),
      tableInstance.on('keydown', syncActiveEditState),
      tableInstance.on('change_cell_value', syncActiveEditState),
    ];
    const tableElement = tableInstance.getElement();
    tableElement.addEventListener('input', syncActiveEditState, true);
    tableElement.addEventListener('change', syncActiveEditState, true);
    syncActiveEditState();
    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      eventIds.forEach((eventId) => tableInstance.off(eventId));
      tableElement.removeEventListener('input', syncActiveEditState, true);
      tableElement.removeEventListener('change', syncActiveEditState, true);
    };
  }, [props.onActiveEditChange, tableInstance]);

  // Filter and sort
  const { activeFilterCount, clearAllFilters } = useFilterAndSort({
    theme,
    tableInstance,
    resultData,
    sortAfter: reCalculateCellStyle,
    filterAfter: reCalculateCellStyle,
    setOrderByText: props.setOrderByText,
  });
  const columns = useMemo(() => {
    const nextColumns = buildResultColumns({
      data: resultData,
      theme,
      visibility: { showFieldType, showFieldComment },
      hiddenFields: hiddenColumnFields,
      readOnlyFields: new Set(frozenColumnFields),
    });
    const displayOrder = getResultColumnDisplayOrder(columnOrder, frozenColumnFields);
    return orderResultColumns(nextColumns, displayOrder);
  }, [
    columnOrder,
    frozenColumnFields,
    resultData,
    theme.appearance,
    customFontSize,
    showFieldType,
    showFieldComment,
    hiddenColumnFields,
  ]);
  const records = useMemo(() => buildResultRecords(resultData), [resultData]);
  const headerTooltip = useHeaderTooltip({ tableInstance });

  useEffect(() => {
    if (!tableInstance) {
      return;
    }
    const eventId = tableInstance.on('resize_row_end', ({ row, rowHeight }) => {
      updateResultTableRowExpansion(tableInstance, row, rowHeight);
    });
    return () => tableInstance.off(eventId);
  }, [tableInstance]);

  const clearColumnSensitiveSelection = useCallback(() => {
    interactionRevisionRef.current += 1;
    tableInstance?.clearSelected();
    props.onSelectionChange?.({
      values: [],
      rowCount: 0,
      cause: 'table-selection',
      interactionRevision: interactionRevisionRef.current,
    });
  }, [props.onSelectionChange, tableInstance]);

  const handleColumnVisibilityConfirm = useCallback(
    (nextHiddenFields: Set<string>) => {
      const reconciledHiddenFields = reconcileHiddenResultColumnFields(resultColumnFields, nextHiddenFields);
      setHiddenColumnFields(reconciledHiddenFields);
      setFrozenColumnFields((current) => current.filter((field) => !reconciledHiddenFields.has(field)));
      setColumnVisibilityOpen(false);
      clearColumnSensitiveSelection();
    },
    [clearColumnSensitiveSelection, resultColumnFields],
  );

  const handleHideColumns = useCallback(
    (fields: string[]) => {
      const nextHiddenFields = hideResultColumnFields(resultColumnFields, hiddenColumnFields, fields);
      setHiddenColumnFields(nextHiddenFields);
      setFrozenColumnFields((current) => current.filter((field) => !nextHiddenFields.has(field)));
      clearColumnSensitiveSelection();
    },
    [clearColumnSensitiveSelection, hiddenColumnFields, resultColumnFields],
  );

  const handleShowAllColumns = useCallback(() => {
    setHiddenColumnFields(new Set());
    clearColumnSensitiveSelection();
  }, [clearColumnSensitiveSelection]);

  const handleFreezeColumns = useCallback(
    (fields: string[]) => {
      setFrozenColumnFields((current) =>
        getNextFrozenResultColumnFields(tableInstance?.columns || [], current, fields),
      );
      clearColumnSensitiveSelection();
    },
    [clearColumnSensitiveSelection, tableInstance],
  );

  const handleUnfreezeAllColumns = useCallback(() => {
    setFrozenColumnFields([]);
    clearColumnSensitiveSelection();
  }, [clearColumnSensitiveSelection]);

  const applyFrozenColumnCount = useCallback(() => {
    if (!tableInstance) {
      return;
    }
    tableInstance.setFrozenColCount(
      getResultFrozenColumnCount(tableInstance.columns || [], frozenColumnFields),
    );
  }, [frozenColumnFields, tableInstance]);

  useEffect(() => {
    applyFrozenColumnCount();
    reCalculateCellStyle();
  }, [applyFrozenColumnCount, columns, reCalculateCellStyle]);

  useEffect(() => {
    if (!tableInstance) {
      return;
    }
    const eventId = tableInstance.on('change_header_position', () => {
      const displayOrder = getResultColumnFields(tableInstance.columns || []);
      setColumnOrder((current) => {
        const nextOrder = mergeResultColumnOrderFromDisplay(current, displayOrder, frozenColumnFields);
        return nextOrder.length === current.length && nextOrder.every((field, index) => field === current[index])
          ? current
          : nextOrder;
      });
      applyFrozenColumnCount();
    });
    return () => tableInstance.off(eventId);
  }, [applyFrozenColumnCount, frozenColumnFields, tableInstance]);

  useEffect(() => {
    onOperationChange?.(hasOperationRecord);
  }, [hasOperationRecord]);

  useEffect(() => {
    props.onFilterCountChange?.(activeFilterCount);
  }, [activeFilterCount]);

  useEffect(() => {
    // A fill armed against the previous table must never reach a rebuilt one.
    pendingFillRef.current = null;
  }, [tableInstance]);

  useEffect(() => {
    if (!tableInstance || !operationRecordUtils) return;
    // monitors the right mouse click on a cell
    const { id: onContextmenuCellId } = onContextmenuCell({
      resultData,
      tableInstance,
      operationRecordUtils,
      onTableOperationUtils,
      frozenColumnFields,
      onHideColumns: handleHideColumns,
      onShowAllColumns: handleShowAllColumns,
      onFreezeColumns: handleFreezeColumns,
      onUnfreezeAllColumns: handleUnfreezeAllColumns,
    });
    // Fills the rest of a multi-cell selection once the edited cell commits. The writes
    // go through changeCellValue, so every filled cell is recorded exactly like a hand
    // edit and reaches the generated UPDATE statement.
    const fillPending = (fill: ResultBatchFill, value: unknown) => {
      isBatchFillingRef.current = true;
      try {
        fill.rows.forEach((row) => {
          tableInstance.changeCellValue(fill.col, row, value as string | number, true);
        });
      } finally {
        isBatchFillingRef.current = false;
      }
    };
    runBatchFillRef.current = fillPending;
    // Registered before onChangeCellValue, which rewrites a frozen or large-value cell
    // during the very same dispatch. Listening second would read that rewrite as the
    // commit and spread the cell's old value over the selection.
    const onBatchFillId = tableInstance.on('change_cell_value', (event) => {
      if (isBatchFillingRef.current) {
        return;
      }
      const pending = pendingFillRef.current;
      if (!pending) {
        return;
      }
      // The cell being edited reports first, so an event from any other cell means this
      // fill was superseded by a later edit and must not fire on top of it.
      pendingFillRef.current = null;
      if (event.col !== pending.col || event.row !== pending.row) {
        return;
      }
      fillPending(pending, event.changedValue);
    });
    // monitors cell value changes
    const onChangeCellValueId = onChangeCellValue(
      tableInstance,
      operationRecordUtils.handleCellValueChange,
      new Set(frozenColumnFields),
    );
    // Moving the selection abandons an edit that never committed. An editor that is
    // still open keeps its fill armed: committing with Tab moves the selection before
    // the editor closes, and that commit must still fill.
    const onSelectionResetId = tableInstance.on('selected_cell', () => {
      if (!isBatchFillingRef.current && !tableInstance.editorManager?.editingEditor) {
        pendingFillRef.current = null;
      }
    });
    // monitors copied data
    return () => {
      tableInstance?.off(onContextmenuCellId);
      tableInstance?.off(onChangeCellValueId);
      tableInstance?.off(onBatchFillId);
      tableInstance?.off(onSelectionResetId);
      runBatchFillRef.current = () => {};
    };
  }, [
    frozenColumnFields,
    handleHideColumns,
    handleShowAllColumns,
    handleFreezeColumns,
    handleUnfreezeAllColumns,
    onTableOperationUtils,
    operationRecordUtils,
    resultData,
    tableInstance,
  ]);

  useEffect(() => {
    if (!tableInstance || !props.onSelectionChange) {
      return;
    }

    let frameId: number | null = null;
    let latestActiveCell: { col: number; row: number } | undefined;
    let pendingCause: ResultSelectionCause = 'table-selection';
    const emitSelection = () => {
      frameId = null;
      const cells = (tableInstance.getSelectedCellInfos() || [])
        .flat()
        .filter((cell) => cell.col > 0 && !tableInstance.isHeader(cell.col, cell.row));
      const activeCell = resolveResultSelectionActiveCell(cells, latestActiveCell);
      latestActiveCell = activeCell;
      const activeRecord = activeCell ? tableInstance.getRecordByCell(activeCell.col, activeCell.row) : undefined;
      props.onSelectionChange?.({
        values: cells.map((cell) => (cell.dataValue !== undefined ? cell.dataValue : cell.value)),
        rowCount: new Set(cells.map((cell) => cell.row)).size,
        cause: pendingCause,
        interactionRevision: interactionRevisionRef.current,
        activeCell: activeCell
          ? {
              tableInstance,
              col: activeCell.col,
              row: activeCell.row,
              rowId: activeRecord?.CHAT2DB_ROW_NUMBER,
              field: getResultFieldAtTableColumn(tableInstance, activeCell.col, activeCell.row),
            }
          : undefined,
      });
    };
    const scheduleSelection = (
      cause: ResultSelectionCause,
      event?: { col?: number; row?: number },
    ) => {
      if (cause === 'table-selection' || frameId === null) {
        pendingCause = cause;
      }
      if (
        event?.col !== undefined &&
        event?.row !== undefined &&
        event.col > 0 &&
        !tableInstance.isHeader(event.col, event.row)
      ) {
        latestActiveCell = { col: event.col, row: event.row };
      }
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      frameId = requestAnimationFrame(emitSelection);
    };
    const clearSelection = () => {
      latestActiveCell = undefined;
      scheduleSelection('table-selection');
    };

    const eventIds = [
      tableInstance.on('selected_cell', (event) => scheduleSelection('table-selection', event)),
      tableInstance.on('drag_select_end', (event) => scheduleSelection('table-selection', event)),
      tableInstance.on('selected_clear', clearSelection),
      tableInstance.on('change_cell_value', (event) => scheduleSelection('value-change', event)),
    ];
    scheduleSelection('table-selection');

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      eventIds.forEach((eventId) => tableInstance.off(eventId));
    };
  }, [tableInstance, props.onSelectionChange]);

  // callback after initialization is completed
  const onInit = useCallback((_tableInstance) => {
    setTableInstance(_tableInstance);
  }, []);

  useImperativeHandle(ref, () => {
    return {
      operationRecordUtils,
      tableInstance,
      activeFilterCount,
      clearAllFilters,
      isFieldFrozen: (field) => frozenColumnFields.includes(String(field)),
      openColumnVisibility: () => setColumnVisibilityOpen(true),
      getInteractionRevision: () => interactionRevisionRef.current,
    };
  }, [operationRecordUtils, tableInstance, activeFilterCount, clearAllFilters, frozenColumnFields]);

  const onCopy = useCallback(() => {
    if (!tableInstance) return;
    onCopyData(tableInstance);
  }, [tableInstance]);

  const onPaste = useCallback(() => {
    if (!tableInstance) return;
    onPasteData(tableInstance, operationRecordUtils, new Set(frozenColumnFields));
  }, [frozenColumnFields, tableInstance, operationRecordUtils]);

  const handleTablePointerDown = useCallback(() => {
    interactionRevisionRef.current += 1;
  }, []);

  const handleTableKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      interactionRevisionRef.current += 1;
      if (event.key === 'Escape') {
        // The editor cancels without committing, so no fill may stay armed.
        pendingFillRef.current = null;
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const pending = pendingFillRef.current;
        if (pending && tableInstance) {
          // VTable commits these keys itself, but a commit whose value did not change
          // fires no change_cell_value and would leave the rest of the selection as it
          // was. Deferred so it sees the result of VTable's own handling of the key.
          setTimeout(() => {
            if (pendingFillRef.current !== pending) {
              // The commit did change the value and already filled the selection.
              return;
            }
            pendingFillRef.current = null;
            const editorManager = tableInstance.editorManager;
            if (
              !canFlushBatchFill(
                pending,
                editorManager?.editingEditor ? editorManager.editCell : undefined,
              )
            ) {
              return;
            }
            runBatchFillRef.current(pending, tableInstance.getCellOriginValue(pending.col, pending.row));
          }, 0);
        }
        return;
      }
      if (!tableInstance || !isPrintableEditKey(event.nativeEvent)) {
        return;
      }
      // VTable already owns every key while one of its editors is open.
      if (tableInstance.editorManager?.editingEditor) {
        return;
      }
      const cellPos = tableInstance.stateManager?.select?.cellPos;
      const activeCell =
        cellPos === undefined
          ? undefined
          : resolveEditableCell((col, row) => tableInstance.getEditor(col, row), cellPos.col, cellPos.row);
      if (!activeCell) {
        return;
      }
      // Read the selection before the edit starts: startEditCell selects the edited cell,
      // which collapses a multi-cell selection down to that one cell.
      const rows = collectBatchFillRows(
        tableInstance.getSelectedCellRanges(),
        activeCell.col,
        activeCell.row,
      );
      // The keystroke seeds the editor, so typing replaces the old value instead of
      // leaving the user to clear the cell first.
      event.preventDefault();
      tableInstance.startEditCell(activeCell.col, activeCell.row, event.key);
      // Armed after the edit starts: opening an editor fires selected_cell, and an armed
      // fill must survive that.
      pendingFillRef.current = rows.length ? { ...activeCell, rows } : null;
    },
    [tableInstance],
  );

  const handleBeforeRecordsChange = useCallback((table: ITableInstance) => {
    resetResultTableLayout(table);
  }, []);

  return (
    <>
      <CanvasTable
        columns={columns}
        records={records}
        onInit={onInit}
        onBeforeRecordsChange={handleBeforeRecordsChange}
        className={styles.canvasTable}
        onCopy={onCopy}
        onPaste={onPaste}
        onKeyDown={handleTableKeyDown}
        onPointerDown={handleTablePointerDown}
        customOptions={{ showFrozenColumnDivider: frozenColumnFields.length > 0 }}
        options={{
          ...RESULT_TABLE_CONTENT_LAYOUT_OPTIONS,
          // A click only selects: editing starts on double click, on Enter, or by
          // typing, which is handled in handleTableKeyDown so the keystroke can seed
          // the editor instead of VTable opening it empty.
          editCellTrigger: ['doubleclick'],
          rowSeriesNumber: {
            title: undefined,
            width: 'auto' as any,
            disableColumnResize: true,
          },
          keyboardOptions: {
            copySelected: false, // Start copying
            pasteValueToCell: false, // Turn on paste
            selectAllOnCtrlA: true, // Turn on all selections
          },
          frozenColCount: 1, // Number of frozen columns
          unfreezeAllOnExceedsMaxWidth: false,
          frozenColDragHeaderMode: 'disabled',
          defaultHeaderRowHeight: 'auto',
        }}
      />
      {headerTooltip}
      <ColumnVisibilityModal
        open={columnVisibilityOpen}
        columns={columnVisibilityOptions}
        hiddenFields={hiddenColumnFields}
        onCancel={() => setColumnVisibilityOpen(false)}
        onConfirm={handleColumnVisibilityConfirm}
      />
    </>
  );
});

export default memo(ResultSetTable);
