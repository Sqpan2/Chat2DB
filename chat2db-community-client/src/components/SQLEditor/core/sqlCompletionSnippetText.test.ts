import assert from 'node:assert/strict';
import {
  isSnippetCompletion,
  normalizeSnippetCandidates,
  toSingleLineSqlTemplate,
} from './sqlCompletionSnippetText';

assert.equal(
  toSingleLineSqlTemplate(`SELECT
    *
FROM
    $1;`),
  'SELECT * FROM $1;',
  'a backend select template loses its line breaks and indentation',
);

assert.equal(
  toSingleLineSqlTemplate(`UPDATE $1
SET
    $2
WHERE
    $3;`),
  'UPDATE $1 SET $2 WHERE $3;',
  'every template clause stays on the inserted line',
);

assert.equal(
  toSingleLineSqlTemplate('SELECT \n\t${2:*} \nFROM \n\t${1:};\n'),
  'SELECT ${2:*} FROM ${1:};',
  'a local snippet template keeps its tabstops on one line',
);

assert.equal(
  toSingleLineSqlTemplate('DROP TABLE $1;'),
  'DROP TABLE $1;',
  'an already single-line template is unchanged',
);

assert.equal(
  toSingleLineSqlTemplate('  USE $1;  '),
  'USE $1;',
  'surrounding whitespace is trimmed',
);

assert.equal(
  toSingleLineSqlTemplate('SHOW TABLES;\n\n'),
  'SHOW TABLES;',
  'blank lines do not leave trailing separators',
);

assert.equal(toSingleLineSqlTemplate(''), '', 'an empty template stays empty');

assert.equal(isSnippetCompletion({ type: 'SNIPPET' }), true, 'candidate type marks a snippet');
assert.equal(isSnippetCompletion({ insertType: 'SNIPPET' }), true, 'insert type marks a snippet');
assert.equal(
  isSnippetCompletion({ type: 'COLUMN', insertType: 'PLAIN_TEXT' }),
  false,
  'a plain candidate is not a snippet',
);
assert.equal(isSnippetCompletion(null), false, 'a missing candidate is not a snippet');

const columnCandidate = { type: 'COLUMN', insertText: 'id' };
const snippetCandidate = {
  type: 'SNIPPET',
  insertType: 'SNIPPET',
  label: 'select from',
  insertText: `SELECT
    *
FROM
    $1;`,
};
const labelOnlySnippet = { type: 'SNIPPET', label: 'select from' };

const normalized = normalizeSnippetCandidates([columnCandidate, snippetCandidate, labelOnlySnippet]);

assert.equal(normalized[0], columnCandidate, 'a plain candidate is passed through untouched');
assert.equal(
  normalized[1].insertText,
  'SELECT * FROM $1;',
  'a snippet candidate insert text becomes a single line',
);
assert.equal(normalized[1].label, 'select from', 'snippet labels keep the template name');
assert.equal(normalized[1].insertType, 'SNIPPET', 'normalized snippets still insert as snippets');
assert.notEqual(normalized[1], snippetCandidate, 'normalizing a snippet returns a copy of the candidate');
assert.equal(
  normalized[2].insertText,
  undefined,
  'a snippet candidate without insert text is left for the label fallback',
);

assert.equal(snippetCandidate.insertText.includes('\n'), true, 'the source candidate keeps its template layout');

console.log('sqlCompletionSnippetText tests passed');
