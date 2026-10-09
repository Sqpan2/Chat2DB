import {
  dataSourceFormConfigs,
  envItem,
  portItem,
  sshConfig,
  storageItem,
} from '@/components/ConnectionEdit/config/dataSource';
import { databaseMap, databaseTypeList } from '@/constants/database';
import supportedDatabaseService from '@/service/supportedDatabase';
import { useTreeStore } from '@/store/tree';
import { scheduleDatabaseTreePreload } from '@/store/tree/databaseTreePreload';
import { buildIconSprite, registerDynamicDatabases } from '@/utils/dynamicDatabaseRegistry';

const useGlobalData = () => {
  // const { getModelList } = useAIStore((state) => ({
  //   getModelList: state.getModelList,
  // }));

  const { getTreeData } = useTreeStore((state) => ({
    getTreeData: state.getTreeData,
  }));

  return () => {
    // Business metadata must not load before the host product grants workspace access.
    supportedDatabaseService
      .listSupported({})
      .then((summaries) => {
        const added = registerDynamicDatabases(
          summaries,
          { databaseMap, databaseTypeList, dataSourceFormConfigs },
          { envItem, storageItem, portItem, sshConfig },
        );
        if (!added.length) {
          return;
        }
        const sprite = buildIconSprite((summaries || []).filter((summary) => added.includes(summary.dbType)));
        if (sprite && !document.getElementById('c2d-dynamic-db-icons')) {
          const host = document.createElement('div');
          host.id = 'c2d-dynamic-db-icons';
          host.innerHTML = sprite;
          document.body.appendChild(host);
        }
      })
      .catch(() => {
        // Older backends without the endpoint keep the built-in list.
      });
    // Once the tree root lands, walk every datasource's databases and tables into the cache in the
    // background, so the tree, the search and the completion work without a first wait.
    getTreeData()
      .catch(() => undefined)
      .then(() => {
        scheduleDatabaseTreePreload(() => useTreeStore.getState());
      });
  };
};

export default useGlobalData;
