import assert from 'node:assert/strict';
import {
  getWorkspaceResultDockMaxSize,
  getWorkspaceResultDockSlotId,
  isWorkspaceResultDockCollapsed,
  isWorkspaceResultDockSlotVisible,
  resolveWorkspaceResultDockSize,
  shouldUseWorkspaceResultDock,
  WORKSPACE_RESULT_DOCK_PORTAL_ID,
  WORKSPACE_RESULT_DOCK_SLOT_ID_PREFIX,
} from './resultDock';

assert.equal(WORKSPACE_RESULT_DOCK_PORTAL_ID, 'workspace-result-dock');
assert.equal(
  getWorkspaceResultDockSlotId(42),
  `${WORKSPACE_RESULT_DOCK_SLOT_ID_PREFIX}42`,
  'each tab gets its own dock slot id',
);
assert.equal(getWorkspaceResultDockSlotId('local-1'), `${WORKSPACE_RESULT_DOCK_SLOT_ID_PREFIX}local-1`);

assert.equal(
  shouldUseWorkspaceResultDock({ workspaceTabSplitLayout: null }),
  true,
  'a single tab pane uses the workspace result dock',
);
assert.equal(
  shouldUseWorkspaceResultDock({ workspaceTabSplitLayout: undefined }),
  true,
  'an unset split layout uses the workspace result dock',
);
assert.equal(shouldUseWorkspaceResultDock(null), true, 'a missing state falls back to the dock');
assert.equal(
  shouldUseWorkspaceResultDock({ workspaceTabSplitLayout: { paneTabIds: { main: [1, 2] } } as never }),
  true,
  'a stored layout whose single pane holds the tabs still uses the dock',
);
assert.equal(
  shouldUseWorkspaceResultDock({
    workspaceTabSplitLayout: {
      paneTabIds: { main: [1, 2], 'terminal-panel:bottom': [] },
    } as never,
  }),
  true,
  'an empty terminal dock pane does not count as a split',
);
assert.equal(
  shouldUseWorkspaceResultDock({
    workspaceTabSplitLayout: { paneTabIds: { main: [1], 'terminal-panel:bottom': [9] } } as never,
  }),
  false,
  'a terminal dock pane holding tabs counts as a split',
);
assert.equal(
  shouldUseWorkspaceResultDock({
    workspaceTabSplitLayout: { paneTabIds: { main: [1, 2], split: [3] } } as never,
  }),
  false,
  'two panes holding tabs keep the in-column result view',
);

assert.equal(
  isWorkspaceResultDockSlotVisible({ tabId: 7, activeTabId: 7 }),
  true,
  'the active tab slot is visible',
);
assert.equal(
  isWorkspaceResultDockSlotVisible({ tabId: '7', activeTabId: 7 }),
  true,
  'slot visibility compares ids across number and string tabs',
);
assert.equal(
  isWorkspaceResultDockSlotVisible({ tabId: 7, activeTabId: 8 }),
  false,
  'an inactive tab keeps a hidden slot',
);
assert.equal(
  isWorkspaceResultDockSlotVisible({ tabId: 7, activeTabId: null }),
  false,
  'no active tab leaves every slot hidden',
);

assert.equal(
  resolveWorkspaceResultDockSize({ enabled: true, height: 320 }),
  320,
  'the dock follows the remembered pixel height',
);
assert.equal(
  resolveWorkspaceResultDockSize({ enabled: true, height: '50%' }),
  '50%',
  'the first execution keeps its percentage height',
);
assert.equal(
  resolveWorkspaceResultDockSize({ enabled: true, height: 0 }),
  0,
  'a console without a result keeps the dock collapsed',
);
assert.equal(resolveWorkspaceResultDockSize({ enabled: true }), 0, 'an unknown height collapses the dock');
assert.equal(
  resolveWorkspaceResultDockSize({ enabled: true, height: Number.NaN }),
  0,
  'a non-finite height collapses the dock',
);
assert.equal(
  resolveWorkspaceResultDockSize({ enabled: false, height: 320 }),
  0,
  'a split workspace never opens the dock',
);
assert.equal(
  resolveWorkspaceResultDockSize({ enabled: true, height: 900, containerHeight: 1000 }),
  800,
  'a remembered height is capped so the editor band stays visible',
);
assert.equal(
  resolveWorkspaceResultDockSize({ enabled: true, height: 900, containerHeight: 300 }),
  180,
  'a short workspace keeps room for the editor band',
);
assert.equal(
  resolveWorkspaceResultDockSize({ enabled: true, height: 400, containerHeight: 1000 }),
  400,
  'a height inside the cap is kept as it is',
);
assert.equal(
  resolveWorkspaceResultDockSize({ enabled: true, height: '50%', containerHeight: 100 }),
  '50%',
  'a percentage height is left to the split pane',
);
assert.equal(
  resolveWorkspaceResultDockSize({ enabled: true, height: 900 }),
  900,
  'an unmeasured workspace cannot clamp the height',
);
assert.equal(getWorkspaceResultDockMaxSize(1000), 800);
assert.equal(getWorkspaceResultDockMaxSize(200), 80);
assert.equal(getWorkspaceResultDockMaxSize(100), 0, 'a workspace shorter than the editor band collapses the dock');
assert.equal(getWorkspaceResultDockMaxSize(undefined), undefined);

assert.equal(isWorkspaceResultDockCollapsed(0), true);
assert.equal(isWorkspaceResultDockCollapsed('0px'), true);
assert.equal(isWorkspaceResultDockCollapsed(320), false);
assert.equal(isWorkspaceResultDockCollapsed('50%'), false);

console.log('workspaceResultDock tests passed');
