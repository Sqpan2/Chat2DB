import assert from 'node:assert/strict';
import { getSqlCompletionSuggestOptions } from './sqlCompletionSuggestOptions';

const options = getSqlCompletionSuggestOptions();

assert.equal(
  options.matchOnWordStartOnly,
  false,
  'the editor must keep a candidate whose name carries the typed text in the middle',
);
assert.equal(options.showWords, false, 'word based suggestions stay off');
assert.equal(options.snippetsPreventQuickSuggestions, false, 'a snippet may open the suggestion list');

console.log('SQL completion suggest option tests passed');
