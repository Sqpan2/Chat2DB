import type { ISqlCompletionCandidate } from '@/typings/sqlParser';

const SNIPPET_TYPE = 'SNIPPET';
const LINE_BREAK = /\r?\n/;

/**
 * SQL templates are authored as readable multi-line SQL. Completion inserts a
 * statement into the console instead of beautifying it, so the editor receives
 * the template on a single line: a multi-line block pushes the rest of the
 * statement down and reports parser errors while the placeholders are empty.
 */
export function toSingleLineSqlTemplate(template: string): string {
  return template
    .split(LINE_BREAK)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ');
}

/**
 * A backend snippet marks itself either through its candidate type or through
 * the insert type that selects Monaco snippet insertion.
 */
export function isSnippetCompletion(
  candidate: { type?: string; insertType?: string } | null | undefined,
): boolean {
  return candidate?.type === SNIPPET_TYPE || candidate?.insertType === SNIPPET_TYPE;
}

/**
 * Backend snippet templates feed several completion paths (backend suggestions,
 * legacy tips, cached tips), so they are flattened once where the response
 * enters the editor.
 */
export function normalizeSnippetCandidates(
  candidates: ISqlCompletionCandidate[],
): ISqlCompletionCandidate[] {
  return candidates.map((candidate) => {
    if (!candidate?.insertText || !isSnippetCompletion(candidate)) {
      return candidate;
    }
    return {
      ...candidate,
      insertText: toSingleLineSqlTemplate(candidate.insertText),
    };
  });
}
