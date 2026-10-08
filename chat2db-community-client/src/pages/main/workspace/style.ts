import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ css }) => {
  return {
    workspaceRoot: css`
      width: 100%;
      height: 100%;
    `,
    workspaceTopBand: css`
      height: 100%;
      width: 100%;
      overflow: hidden;
    `,
    leftContainer: css`
      display: relative;
      height: 100%;
    `,
  };
});
