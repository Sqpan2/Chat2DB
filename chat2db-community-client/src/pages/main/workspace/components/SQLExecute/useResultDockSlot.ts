import { useEffect, useState } from 'react';
import { getWorkspaceResultDockSlotId } from '@/store/workspace/utils/resultDock';

/**
 * Resolve the workspace result dock slot owned by this tab.
 *
 * The dock renders one slot per open tab, so the element exists only after the
 * workspace layout committed. A missing slot (a split workspace, or a tab
 * without a slot) keeps the console on its inline result view.
 */
export function useResultDockSlot(
  tabId: string | number | null | undefined,
  enabled: boolean,
): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled || tabId === undefined || tabId === null) {
      setSlot(null);
      return undefined;
    }
    const resolveSlot = () => {
      setSlot(document.getElementById(getWorkspaceResultDockSlotId(tabId)));
    };
    resolveSlot();
    const animationFrame = window.requestAnimationFrame(resolveSlot);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [enabled, tabId]);

  return enabled ? slot : null;
}
