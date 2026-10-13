import i18n from '@/i18n';
import feedback from '@/utils/feedback';
import { staticMessage } from '@chat2db/ui';
import { useGlobalStore } from '@/store/global';
import {
  createWorkspaceTransferDependencies,
  runWorkspaceExport,
  runWorkspaceImport,
} from './workspaceTransferFlow';
import { WorkspaceImportError } from './workspaceTransfer';

const IMPORT_FEEDBACK_KEY = 'import-workspace';

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
    if (result.skippedConsoles > 0) {
      staticMessage.warning(
        i18n(
          'workspace.importWorkspace.partial',
          result.importedDataSources,
          result.importedConsoles,
          result.skippedConsoles,
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
