export interface ConfigState {
  layout: {
    panelLeft: boolean;
    panelLeftWidth: number;
    panelRight: boolean;
    panelRightWidth: number;
  };
  /**
   * Result dock height per workspace tab. Kept outside `layout` on purpose: the
   * persisted layout must keep its current shape.
   */
  resultDockHeights: Record<string, number | string>;
}

export const initConfigState: ConfigState = {
  layout: {
    panelLeft: true,
    panelRight: true,
    panelLeftWidth: 260,
    panelRightWidth: 300,
  },
  resultDockHeights: {},
};
