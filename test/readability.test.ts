import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  analyze,
  countSyllables,
  countTextSyllables,
  describeEase,
  splitSentences,
  splitWords,
} from '../src/readability';

describe('splitSentences', () => {
  it('returns nothing for empty or whitespace-only input', () => {
    assert.deepEqual(splitSentences(''), []);
    assert.deepEqual(splitSentences('   \n\n  '), []);
  });

  it('splits on terminal punctuation', () => {
    assert.deepEqual(splitSentences('One. Two! Three?'), ['One.', 'Two!', 'Three?']);
  });

  it('treats newlines as whitespace rather than sentence breaks', () => {
    assert.deepEqual(splitSentences('A wrapped\nsentence here.'), ['A wrapped sentence here.']);
  });

  it('counts an unterminated paragraph as one sentence', () => {
    assert.deepEqual(splitSentences('no terminator at all'), ['no terminator at all']);
  });

  it('does not split inside decimals', () => {
    assert.deepEqual(splitSentences('Pi is 3.14 exactly. Really.'), [
      'Pi is 3.14 exactly.',
      'Really.',
    ]);
  });

  it('does not split after common abbreviations', () => {
    assert.deepEqual(splitSentences('Dr. Smith arrived. He was late.'), [
      'Dr. Smith arrived.',
      'He was late.',
    ]);
    assert.equal(splitSentences('Cats, dogs, etc. are pets.').length, 1);
  });

  it('does not split after single-letter initials', () => {
    assert.deepEqual(splitSentences('J. R. R. Tolkien wrote it.'), ['J. R. R. Tolkien wrote it.']);
  });

  it('absorbs runs of terminators and trailing quotes', () => {
    assert.deepEqual(splitSentences('Wait... what?! "Yes." Fine.'), [
      'Wait...',
      'what?!',
      '"Yes."',
      'Fine.',
    ]);
  });

  it('drops fragments with no alphanumeric content', () => {
    assert.deepEqual(splitSentences('Real sentence. ... !'), ['Real sentence.']);
  });
});

describe('splitWords', () => {
  it('finds words and ignores punctuation', () => {
    assert.deepEqual(splitWords('Hello, world!'), ['Hello', 'world']);
  });

  it('keeps hyphenated and apostrophised words whole', () => {
    assert.deepEqual(splitWords("It's a well-known fact."), ["It's", 'a', 'well-known', 'fact']);
  });

  it('counts numbers as words', () => {
    assert.deepEqual(splitWords('We shipped 42 units'), ['We', 'shipped', '42', 'units']);
  });

  it('returns nothing for text with no words', () => {
    assert.deepEqual(splitWords('--- !!! ???'), []);
  });
});

describe('countSyllables', () => {
  const cases: Array<[string, number]> = [
    ['cat', 1],
    ['the', 1],
    ['a', 1],
    ['make', 1],
    ['makes', 1],
    ['walked', 1],
    ['there', 1],
    ['hello', 2],
    ['table', 2],
    ['people', 2],
    ['simple', 2],
    ['houses', 2],
    ['boxes', 2],
    ['wanted', 2],
    ['agree', 2],
    ['yellow', 2],
    ['chocolate', 3],
    ['readability', 5],
  ];

  for (const [word, expected] of cases) {
    it(`counts "${word}" as ${expected}`, () => {
      assert.equal(countSyllables(word), expected);
    });
  }

  it('never returns zero for a real word', () => {
    for (const word of ['rhythm', 'strengths', 'x']) {
      assert.ok(countSyllables(word) >= 1, `${word} should have at least one syllable`);
    }
  });

  it('estimates numeric tokens by digit count', () => {
    assert.equal(countSyllables('2024'), 4);
    assert.equal(countSyllables('7'), 1);
  });

  it('ignores case and surrounding punctuation', () => {
    assert.equal(countSyllables('HELLO'), countSyllables('hello'));
    assert.equal(countSyllables('"hello,"'), countSyllables('hello'));
  });

  it('sums across a whole string', () => {
    assert.equal(countTextSyllables('the cat sat'), 3);
  });
});

describe('analyze', () => {
  it('returns zeroes for empty input instead of dividing by zero', () => {
    const scores = analyze('');
    assert.deepEqual(scores, { grade: 0, ease: 0, sentences: 0, words: 0, syllables: 0 });
  });

  it('matches the Flesch-Kincaid formulas exactly', () => {
    // "The cat sat on the mat." -> 1 sentence, 6 words, 6 syllables.
    const scores = analyze('The cat sat on the mat.');
    assert.equal(scores.sentences, 1);
    assert.equal(scores.words, 6);
    assert.equal(scores.syllables, 6);

    const wordsPerSentence = 6;
    const syllablesPerWord = 1;
    const grade = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;
    const ease = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;

    assert.equal(scores.grade, Math.round(grade * 10) / 10);
    assert.equal(scores.ease, Math.round(ease * 10) / 10);
  });

  it('scores simple text below complex text', () => {
    const simple = analyze('The dog ran. The cat sat. Birds fly.');
    const complex = analyze(
      'The multifaceted implementation of institutional accountability mechanisms ' +
        'necessitates comprehensive interdisciplinary evaluation of organizational ' +
        'infrastructure across administrative jurisdictions.',
    );

    assert.ok(
      simple.grade < complex.grade,
      `expected ${simple.grade} < ${complex.grade}`,
    );
    assert.ok(simple.ease > complex.ease, `expected ${simple.ease} > ${complex.ease}`);
  });

  it('raises the grade level when sentences get longer', () => {
    const short = analyze('Rain fell. The road was wet. We drove slowly.');
    const long = analyze(
      'Rain fell and the road was wet, so we drove slowly, because we did not ' +
        'want to slide off the road into the ditch beside it.',
    );
    assert.ok(long.grade > short.grade, `expected ${long.grade} > ${short.grade}`);
  });

  it('is a pure function of its input', () => {
    const text = 'Some text. It has two sentences.';
    assert.deepEqual(analyze(text), analyze(text));
  });

  it('treats an unterminated paragraph as a single sentence', () => {
    const scores = analyze('four words with no terminator');
    assert.equal(scores.sentences, 1);
    assert.equal(scores.words, 5);
    assert.ok(Number.isFinite(scores.grade));
  });

  it('handles text with words but no sentence terminators without dividing by zero', () => {
    const scores = analyze('word');
    assert.ok(Number.isFinite(scores.grade));
    assert.ok(Number.isFinite(scores.ease));
  });
});

describe('describeEase', () => {
  it('labels each band', () => {
    assert.equal(describeEase(95), 'very easy');
    assert.equal(describeEase(85), 'easy');
    assert.equal(describeEase(75), 'fairly easy');
    assert.equal(describeEase(65), 'plain English');
    assert.equal(describeEase(55), 'fairly difficult');
    assert.equal(describeEase(40), 'difficult');
    assert.equal(describeEase(10), 'very difficult');
  });

  it('handles out-of-range scores', () => {
    assert.equal(describeEase(120), 'very easy');
    assert.equal(describeEase(-30), 'very difficult');
  });
});
