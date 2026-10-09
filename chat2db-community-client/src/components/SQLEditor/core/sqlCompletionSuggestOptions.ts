import type * as monaco from 'monaco-editor';

/**
 * Suggest options the SQL completion needs.
 *
 * `matchOnWordStartOnly` is off because a table or column name is often remembered from its middle:
 * the editor would otherwise drop every candidate whose name does not begin with the typed text,
 * however widely the datasource itself matched. Names that do begin with it still rank first, since
 * the editor orders the survivors by match quality.
 */
export const getSqlCompletionSuggestOptions = (): monaco.editor.ISuggestOptions => ({
  showWords: false,
  snippetsPreventQuickSuggestions: false,
  matchOnWordStartOnly: false,
});
