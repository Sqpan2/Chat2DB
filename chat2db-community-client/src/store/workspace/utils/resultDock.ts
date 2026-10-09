export const WORKSPACE_RESULT_DOCK_PORTAL_ID = 'workspace-result-dock';

export const WORKSPACE_RESULT_DOCK_SLOT_ID_PREFIX = 'workspace-result-dock-slot-';

/** Height of the dock pane: pixels once dragged, a percentage for the first result. */
export type WorkspaceResultDockSize = number | string;

/** The dock never hides more than this share of the workspace. */
export const RESULT_DOCK_MAX_HEIGHT_RATIO = 0.8;

/** The editor band above the dock always keeps this much room. */
export const RESULT_DOCK_MIN_TOP_BAND_HEIGHT = 120;

export function getWorkspaceResultDockSlotId(tabId: string | number) {
  return `${WORKSPACE_RESULT_DOCK_SLOT_ID_PREFIX}${tabId}`;
}

/**
 * The dock lifts the result area out of the console column, which only matches
 * the workspace while it shows a single tab pane.
 *
 * The stored layout is not a reliable signal on its own: the terminal dock pane
 * exists in the layout even when the terminal is closed, and the renderer hides
 * it in that state. Count the panes that actually hold tabs, exactly like the
 * renderer does.
 */
export function shouldUseWorkspaceResultDock(
  state: { workspaceTabSplitLayout?: { paneTabIds?: Record<string, unknown[]> } | null } | null | undefined,
): boolean {
  const paneTabIds = state?.workspaceTabSplitLayout?.paneTabIds;
  if (!paneTabIds) {
    return true;
  }
  const occupiedPaneCount = Object.values(paneTabIds).filter((tabIds) => (tabIds || []).length > 0).length;
  return occupiedPaneCount <= 1;
}

/**
 * Every open tab owns a dock slot so a console can keep rendering its result
 * while hidden; only the active tab's slot is visible.
 */
export function isWorkspaceResultDockSlotVisible(params: {
  tabId: string | number;
  activeTabId?: string | number | null;
}): boolean {
  if (params.activeTabId === undefined || params.activeTabId === null) {
    return false;
  }
  return String(params.tabId) === String(params.activeTabId);
}

/**
 * The dock remembers one height per tab, so the pane follows the active tab and
 * collapses to zero while that tab has no result yet.
 */
export function resolveWorkspaceResultDockSize(params: {
  enabled: boolean;
  height?: WorkspaceResultDockSize | null;
  containerHeight?: number;
}): WorkspaceResultDockSize {
  if (!params.enabled) {
    return 0;
  }
  const { height, containerHeight } = params;
  if (typeof height === 'string') {
    return height;
  }
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
    return 0;
  }
  const maxSize = getWorkspaceResultDockMaxSize(containerHeight);
  return maxSize === undefined ? height : Math.min(height, maxSize);
}

export function getWorkspaceResultDockMaxSize(containerHeight?: number): number | undefined {
  if (typeof containerHeight !== 'number' || !Number.isFinite(containerHeight) || containerHeight <= 0) {
    return undefined;
  }
  return Math.max(
    0,
    Math.min(containerHeight * RESULT_DOCK_MAX_HEIGHT_RATIO, containerHeight - RESULT_DOCK_MIN_TOP_BAND_HEIGHT),
  );
}

export function isWorkspaceResultDockCollapsed(size: WorkspaceResultDockSize): boolean {
  if (typeof size === 'number') {
    return !Number.isFinite(size) || size <= 0;
  }
  return size.trim() === '' || size === '0' || size === '0px';
}
