import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ css, token }) => {
  return {
    resultDock: css`
      position: relative;
      height: 100%;
      width: 100%;
      background-color: ${token.colorBgBase};
    `,
    resultDockSlot: css`
      height: 100%;
      width: 100%;
      &[hidden] {
        display: none;
      }
    `,
  };
});
