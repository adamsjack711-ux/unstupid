import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { makeColors } from '../src/colors';
import { diffSegments, segment, unifiedDiff } from '../src/diff';

const plain = makeColors(process.stdout, false);

describe('segment', () => {
  it('splits text into sentences across paragraphs', () => {
    assert.deepEqual(segment('One. Two.\n\nThree.'), ['One.', 'Two.', 'Three.']);
  });

  it('returns nothing for empty text', () => {
    assert.deepEqual(segment('   '), []);
  });
});

describe('diffSegments', () => {
  it('reports every segment as equal for identical input', () => {
    const ops = diffSegments(['a', 'b'], ['a', 'b']);
    assert.deepEqual(
      ops.map((op) => op.type),
      ['equal', 'equal'],
    );
  });

  it('detects a replaced middle segment', () => {
    const ops = diffSegments(['a', 'b', 'c'], ['a', 'x', 'c']);
    const changed = ops.filter((op) => op.type !== 'equal');
    assert.deepEqual(changed, [
      { type: 'remove', value: 'b' },
      { type: 'add', value: 'x' },
    ]);
  });

  it('handles an empty side', () => {
    assert.deepEqual(
      diffSegments([], ['a']).map((op) => op.type),
      ['add'],
    );
    assert.deepEqual(
      diffSegments(['a'], []).map((op) => op.type),
      ['remove'],
    );
  });

  it('preserves every original segment across removes and equals', () => {
    const before = ['a', 'b', 'c', 'd'];
    const ops = diffSegments(before, ['a', 'x', 'd']);
    const recovered = ops
      .filter((op) => op.type !== 'add')
      .map((op) => op.value);
    assert.deepEqual(recovered, before);
  });
});

describe('unifiedDiff', () => {
  it('says so when nothing changed', () => {
    const out = unifiedDiff('Same text.', 'Same text.', { colors: plain, width: 80 });
    assert.match(out, /no changes/);
  });

  it('marks removals and additions', () => {
    const out = unifiedDiff('The old sentence.', 'The new sentence.', {
      colors: plain,
      width: 80,
    });
    assert.match(out, /^- The old sentence\.$/m);
    assert.match(out, /^\+ The new sentence\.$/m);
  });

  it('elides unchanged runs beyond the context window', () => {
    const shared = 'One two. Three four. Five six. Seven eight. Nine ten.';
    const out = unifiedDiff(`${shared} Old tail.`, `${shared} New tail.`, {
      colors: plain,
      context: 1,
      width: 80,
    });
    assert.match(out, /\.\.\./);
    // The first sentence is outside the context window, so it is elided.
    assert.doesNotMatch(out, /^ {2}One two\.$/m);
    // The sentence immediately before the change is inside it.
    assert.match(out, /^ {2}Nine ten\.$/m);
  });

  it('wraps long sentences with a hanging indent', () => {
    const long = `${'word '.repeat(40).trim()}.`;
    const out = unifiedDiff(long, 'Short.', { colors: plain, width: 60 });
    for (const line of out.split('\n')) {
      assert.ok(line.length <= 60, `line too long: ${line}`);
    }
    assert.match(out, /^ {2}word/m);
  });

  it('emits no ANSI codes when colour is disabled', () => {
    const out = unifiedDiff('One.', 'Two.', { colors: plain, width: 80 });
    assert.doesNotMatch(out, /\u001b\[/);
  });
});
