import { memo, useMemo } from 'react';
import { useWorkspaceStore } from '@/store/workspace';
import {
  getWorkspaceResultDockSlotId,
  isWorkspaceResultDockSlotVisible,
  WORKSPACE_RESULT_DOCK_PORTAL_ID,
} from '@/store/workspace/utils/resultDock';
import { useStyles } from './style';

/**
 * Workspace-level host for the result area.
 *
 * The result view itself keeps living inside its console (state, output tabs and
 * execution log stay untouched); each console portals its result pane into the
 * slot that matches its tab id, and only the active tab's slot is visible.
 */
const WorkspaceResultDock = memo(() => {
  const { styles } = useStyles();
  const workspaceTabList = useWorkspaceStore((state) => state.workspaceTabList);
  const activeTabId = useWorkspaceStore((state) => state.activeConsoleId);
  const tabIds = useMemo(() => (workspaceTabList || []).map((tab) => tab.id), [workspaceTabList]);

  return (
    <div className={styles.resultDock} id={WORKSPACE_RESULT_DOCK_PORTAL_ID} data-workspace-result-dock="true">
      {tabIds.map((tabId) => {
        const visible = isWorkspaceResultDockSlotVisible({ tabId, activeTabId });
        return (
          <div
            key={String(tabId)}
            id={getWorkspaceResultDockSlotId(tabId)}
            className={styles.resultDockSlot}
            data-workspace-result-dock-slot={String(tabId)}
            hidden={!visible}
            aria-hidden={!visible}
          />
        );
      })}
    </div>
  );
});

export default WorkspaceResultDock;
