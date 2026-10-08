import { memo, useCallback, useLayoutEffect, useRef, useState, type ComponentType, type PropsWithChildren } from 'react';
import SplitPane, { type SplitPaneProps } from 'react-split-pane';
import { useWorkspaceStore } from '@/store/workspace';
import {
  getWorkspaceResultDockMaxSize,
  isWorkspaceResultDockCollapsed,
  resolveWorkspaceResultDockSize,
  shouldUseWorkspaceResultDock,
  type WorkspaceResultDockSize,
} from '@/store/workspace/utils/resultDock';
import WorkspaceLeft from './components/WorkspaceLeft';
import WorkspaceResultDock from './components/WorkspaceResultDock';
import WorkspaceRight from './components/WorkspaceRight';

import { useStyles } from './style';

/** Dragging the dock below this height packs it away, as the console pane does. */
const RESULT_DOCK_PACK_THRESHOLD = 50;

// react-split-pane types its own children out of `SplitPaneProps`.
const SplitPaneWithChildren = SplitPane as unknown as ComponentType<PropsWithChildren<SplitPaneProps>>;

const workspacePage = memo(() => {
  const { cx, styles } = useStyles();
  const workspaceRootRef = useRef<HTMLDivElement>(null);
  const [workspaceHeight, setWorkspaceHeight] = useState(0);
  const [draggingDockSize, setDraggingDockSize] = useState<WorkspaceResultDockSize | null>(null);
  const {
    panelLeftWidth,
    setPanelLeftWidth,
    resultDockEnabled,
    activeTabId,
    resultDockHeight,
    setResultDockHeight,
  } = useWorkspaceStore((state) => {
    return {
      panelLeftWidth: state.layout.panelLeftWidth,
      setPanelLeftWidth: state.setPanelLeftWidth,
      resultDockEnabled: shouldUseWorkspaceResultDock(state),
      activeTabId: state.activeConsoleId,
      resultDockHeight: state.resultDockHeights[String(state.activeConsoleId ?? '')],
      setResultDockHeight: state.setResultDockHeight,
    };
  });

  useLayoutEffect(() => {
    if (!workspaceRootRef.current) {
      return;
    }
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWorkspaceHeight(entry.contentRect.height);
      }
    });
    resizeObserver.observe(workspaceRootRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const resultDockSize = resolveWorkspaceResultDockSize({
    enabled: resultDockEnabled,
    height: resultDockHeight,
    containerHeight: workspaceHeight,
  });
  const dockSize = draggingDockSize ?? resultDockSize;
  const dockCollapsed = isWorkspaceResultDockCollapsed(dockSize);
  const resultDockMaxSize = getWorkspaceResultDockMaxSize(workspaceHeight);

  const handleResultDockChange = useCallback((size: WorkspaceResultDockSize) => {
    setDraggingDockSize(size);
  }, []);

  const handleResultDockDragFinished = useCallback(
    (size: WorkspaceResultDockSize) => {
      setDraggingDockSize(null);
      const packed = typeof size === 'number' && size < RESULT_DOCK_PACK_THRESHOLD;
      setResultDockHeight(activeTabId, packed ? 0 : size);
    },
    [activeTabId, setResultDockHeight],
  );

  return (
    <div className={styles.workspaceRoot} ref={workspaceRootRef} data-workspace-shortcut-surface="true">
      <SplitPaneWithChildren
        split="horizontal"
        // The dock paints above the band so its pane unfold handle, which sits
        // above the pane edge, stays clickable while the dock is packed.
        className={cx({
          ResizerSizeIsZeroTop: dockCollapsed,
          ResizerHidden: !resultDockEnabled || dockCollapsed,
        })}
        pane1Style={{ zIndex: 1 }}
        pane2Style={{ zIndex: 2 }}
        size={dockSize}
        minSize={0}
        {...(resultDockMaxSize === undefined ? {} : { maxSize: resultDockMaxSize })}
        primary="second"
        allowResize={resultDockEnabled && !dockCollapsed}
        onChange={handleResultDockChange}
        onDragFinished={handleResultDockDragFinished}
      >
        <div className={styles.workspaceTopBand}>
          <SplitPaneWithChildren
            split="vertical"
            className={cx({ ['ResizerSizeIsZeroRight']: panelLeftWidth === 0 })}
            pane1Style={{ zIndex: 2 }}
            pane2Style={{ zIndex: 1 }}
            onDragFinished={(newSize) => {
              const nextWidth = newSize < 100 ? 0 : newSize;
              if (Number.isFinite(nextWidth) && nextWidth !== panelLeftWidth) {
                setPanelLeftWidth(nextWidth);
              }
            }}
            size={panelLeftWidth}
            minSize={0}
            primary="first"
          >
            <WorkspaceLeft />
            <WorkspaceRight />
          </SplitPaneWithChildren>
        </div>
        <WorkspaceResultDock />
      </SplitPaneWithChildren>
    </div>
  );
});

export default workspacePage;
