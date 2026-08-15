import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { makeColors } from '../src/colors';
import { chooseMode, paragraphs, tokenizeWords, unifiedDiff } from '../src/diff';

const plain = makeColors(process.stdout, false);

// A heavy rewrite: no sentence survives verbatim, which is what used to make
// the sentence diff print the whole text twice with nothing aligned.
const HEAVY_BEFORE = 'The cat sat on the mat. The dog ran away fast.';
const HEAVY_AFTER = 'A cat was sitting there. A dog fled quickly.';

describe('chooseMode', () => {
  it('stays on sentences when most of the original survives', () => {
    const before = 'One two. Three four. Five six. Seven eight.';
    const after = 'One two. Three four. Five six. Changed here.';
    assert.equal(chooseMode(before, after), 'sentence');
  });

  it('switches to words when nothing survives verbatim', () => {
    assert.equal(chooseMode(HEAVY_BEFORE, HEAVY_AFTER), 'word');
  });

  it('does not crash on empty input', () => {
    assert.equal(chooseMode('', ''), 'sentence');
  });
});

describe('unifiedDiff word mode', () => {
  it('is chosen automatically for a heavy rewrite', () => {
    const out = unifiedDiff(HEAVY_BEFORE, HEAVY_AFTER, { colors: plain, width: 80 });
    assert.match(out, /\[-removed-\] \{\+added\+\}/, 'expected the word-mode legend');
    assert.match(out, /^~ /m, 'expected inline word-diff lines');
  });

  it('marks removed and added runs inline, leaving shared words bare', () => {
    const out = unifiedDiff(HEAVY_BEFORE, HEAVY_AFTER, {
      colors: plain,
      mode: 'word',
      width: 200,
    });
    assert.match(out, /\[-The-\]/);
    assert.match(out, /\{\+A\+\}/);
    assert.match(out, /(?<!\[-)cat(?!-\])/, 'expected "cat" to survive unmarked');
  });

  it('can be forced back to sentence mode', () => {
    const out = unifiedDiff(HEAVY_BEFORE, HEAVY_AFTER, {
      colors: plain,
      mode: 'sentence',
      width: 80,
    });
    assert.doesNotMatch(out, /\[-/);
    assert.match(out, /^- The cat sat on the mat\.$/m);
  });

  it('wraps long changed runs instead of overflowing the line', () => {
    const longRun = `${'alpha '.repeat(60).trim()}.`;
    const out = unifiedDiff(longRun, 'Totally different text here.', {
      colors: plain,
      mode: 'word',
      width: 60,
    });
    for (const line of out.split('\n')) {
      assert.ok(line.length <= 60, `line too long (${line.length}): ${line}`);
    }
  });

  it('emits no ANSI codes when colour is disabled', () => {
    const out = unifiedDiff(HEAVY_BEFORE, HEAVY_AFTER, {
      colors: plain,
      mode: 'word',
      width: 80,
    });
    assert.doesNotMatch(out, /\u001b\[/);
  });

  it('still reports identical text as unchanged', () => {
    const out = unifiedDiff(HEAVY_BEFORE, HEAVY_BEFORE, {
      colors: plain,
      mode: 'word',
      width: 80,
    });
    assert.match(out, /no changes/);
  });

  it('pairs paragraphs when the counts match', () => {
    const out = unifiedDiff(
      'Alpha one here.\n\nBeta two here.',
      'Gamma one here.\n\nDelta two here.',
      { colors: plain, mode: 'word', width: 200 },
    );
    assert.equal(out.split('\n').filter((line) => line.startsWith('~ ')).length, 2);
  });

  it('falls back to one block when paragraph counts differ', () => {
    const out = unifiedDiff('One para here.\n\nTwo para here.', 'Single para only.', {
      colors: plain,
      mode: 'word',
      width: 200,
    });
    assert.equal(out.split('\n').filter((line) => line.startsWith('~ ')).length, 1);
  });
});

describe('paragraphs / tokenizeWords', () => {
  it('splits on blank lines and normalises whitespace', () => {
    assert.deepEqual(paragraphs('one\ntwo\n\n three  four '), ['one two', 'three four']);
  });

  it('drops empty paragraphs', () => {
    assert.deepEqual(paragraphs('\n\n  \n\nreal\n\n'), ['real']);
  });

  it('tokenizes on whitespace without producing empties', () => {
    assert.deepEqual(tokenizeWords('  a  b\nc  '), ['a', 'b', 'c']);
    assert.deepEqual(tokenizeWords('   '), []);
  });
});
