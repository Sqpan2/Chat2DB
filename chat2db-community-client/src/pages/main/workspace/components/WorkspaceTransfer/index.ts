import i18n from '@/i18n';
import feedback from '@/utils/feedback';
import { staticMessage } from '@chat2db/ui';
import { useGlobalStore } from '@/store/global';
import {
  createWorkspaceTransferDependencies,
  runWorkspaceClear,
  runWorkspaceExport,
  runWorkspaceImport,
  type WorkspaceClearResult,
} from './workspaceTransferFlow';
import { WorkspaceImportError } from './workspaceTransfer';

const IMPORT_FEEDBACK_KEY = 'import-workspace';
const CLEAR_FEEDBACK_KEY = 'clear-workspace';

export function exportWorkspace() {
  const run = () => {
    const deps = createWorkspaceTransferDependencies();
    return runWorkspaceExport(deps)
      .then((outcome) => {
        if (outcome === 'saved') {
          staticMessage.success(i18n('workspace.exportWorkspace.success'));
        } else if (outcome === 'cancelled') {
          staticMessage.info(i18n('workspace.exportWorkspace.cancelled'));
        } else {
          staticMessage.error(i18n('workspace.exportWorkspace.failed'));
        }
      })
      .catch(() => {
        staticMessage.error(i18n('workspace.exportWorkspace.failed'));
      });
  };

  // The export carries datasource passwords in plaintext; confirm once before writing the file.
  useGlobalStore.getState().openUnifiedConfirmationModal({
    title: i18n('workspace.menu.exportWorkspace'),
    content: i18n('workspace.exportWorkspace.warning'),
    headerIconCode: 'icon-exclamation-circle',
    onOk: () => run().then(() => undefined),
  });
}

export async function importWorkspace(file: File) {
  const deps = createWorkspaceTransferDependencies();
  feedback.open({
    key: IMPORT_FEEDBACK_KEY,
    type: 'loading',
    content: i18n('workspace.importWorkspace.importing'),
    duration: 0,
  });
  try {
    const result = await runWorkspaceImport(file, deps);
    const skippedTotal = result.skippedConsoles + result.skippedDataSources;
    if (result.importedDataSources === 0 && result.importedConsoles === 0 && skippedTotal > 0) {
      staticMessage.info(i18n('workspace.importWorkspace.allDuplicate', skippedTotal));
    } else if (skippedTotal > 0) {
      staticMessage.warning(
        i18n(
          'workspace.importWorkspace.partial',
          result.importedDataSources,
          result.importedConsoles,
          skippedTotal,
        ),
      );
    } else {
      staticMessage.success(
        i18n('workspace.importWorkspace.success', result.importedDataSources, result.importedConsoles),
      );
    }
    return result;
  } catch (error) {
    if (error instanceof WorkspaceImportError) {
      staticMessage.error(i18n('workspace.importWorkspace.invalidFile'));
    } else {
      staticMessage.error(i18n('workspace.importWorkspace.failed'));
    }
    throw error;
  } finally {
    feedback.destroy(IMPORT_FEEDBACK_KEY);
  }
}

/** Clears every datasource and saved console after an explicit confirmation. */
export function clearWorkspace(): Promise<WorkspaceClearResult | undefined> {
  return new Promise((resolve) => {
    useGlobalStore.getState().openUnifiedConfirmationModal({
      title: i18n('workspace.menu.deleteWorkspace'),
      content: i18n('workspace.deleteWorkspace.warning'),
      headerIconCode: 'icon-exclamation-circle',
      onOk: async () => {
        feedback.open({
          key: CLEAR_FEEDBACK_KEY,
          type: 'loading',
          content: i18n('workspace.deleteWorkspace.clearing'),
          duration: 0,
        });
        try {
          const deps = createWorkspaceTransferDependencies();
          const result = await runWorkspaceClear(deps);
          staticMessage.success(
            i18n('workspace.deleteWorkspace.success', result.deletedDataSources, result.deletedConsoles),
          );
          resolve(result);
        } catch {
          staticMessage.error(i18n('workspace.deleteWorkspace.failed'));
          resolve(undefined);
        } finally {
          feedback.destroy(CLEAR_FEEDBACK_KEY);
        }
      },
      onCancel: () => resolve(undefined),
    });
  });
}
