import assert from 'node:assert/strict';
import { prepareTerminalTabLayout } from '../../../pages/main/workspace/components/WorkspaceTabs/terminalTabPlacement';
import { shouldUseWorkspaceResultDock } from './resultDock';

// The terminal dock pane is part of the stored layout even while the terminal is
// closed, so the dock must judge the layout by the panes that hold tabs.
const layoutWithClosedTerminal = prepareTerminalTabLayout(
  null,
  [{ id: 1, type: 'console', title: 'console' }] as never,
  1,
  'bottom',
);

assert.deepEqual(
  layoutWithClosedTerminal?.paneTabIds,
  { main: [1], 'terminal-panel:bottom': [] },
  'a bottom terminal dock contributes an empty pane to the layout',
);
assert.equal(
  shouldUseWorkspaceResultDock({ workspaceTabSplitLayout: layoutWithClosedTerminal }),
  true,
  'an empty terminal dock pane still uses the workspace result dock',
);

const layoutWithDockedTerminal = prepareTerminalTabLayout(
  layoutWithClosedTerminal,
  [
    { id: 1, type: 'console', title: 'console' },
    { id: 2, type: 'terminal', title: 'terminal', uniqueData: { terminalOpenPosition: 'bottom' } },
  ] as never,
  2,
  'bottom',
);

assert.equal(
  shouldUseWorkspaceResultDock({ workspaceTabSplitLayout: layoutWithDockedTerminal }),
  false,
  'an open terminal dock keeps the in-column result view',
);

console.log('workspaceResultDock terminal layout tests passed');
