import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MIN_SENTENCES_FOR_RHYTHM,
  analyzeTells,
  countEmDashes,
  describeTells,
  findStockPhrases,
  stdev,
} from '../src/tells';

/** Six sentences so the rhythm signal is in play, stuffed with tells. */
const MACHINE = [
  'In the realm of modern business, it is important to note that organizations must adapt.',
  'Moreover, the landscape of technology continues to shift in meaningful ways.',
  'Furthermore, companies should delve into the data before making any decisions.',
  'Additionally, this represents a testament to the value of careful planning.',
  'Therefore, leaders must navigate the complexities of the current environment.',
  'Ultimately, a holistic approach plays a crucial role in achieving success.',
].join(' ');

/** Six sentences of varied length, no stock phrasing, no transition openers. */
const HUMAN = [
  'The build broke on Tuesday.',
  'Nobody noticed until Thursday afternoon, when a customer wrote in to ask why their exports had been silently truncated for two days running.',
  'We rolled it back.',
  'The fix took twenty minutes once someone actually read the stack trace instead of guessing at what the error meant.',
  'Then we added a test.',
  'It would have caught this.',
].join(' ');

describe('stdev', () => {
  it('is zero for fewer than two values', () => {
    assert.equal(stdev([]), 0);
    assert.equal(stdev([5]), 0);
  });

  it('is zero for identical values', () => {
    assert.equal(stdev([7, 7, 7, 7]), 0);
  });

  it('grows with spread', () => {
    assert.ok(stdev([1, 2, 3]) < stdev([1, 10, 30]));
  });

  it('matches a known population standard deviation', () => {
    // mean 4, deviations -2,-1,0,1,2 -> variance 2
    assert.ok(Math.abs(stdev([2, 3, 4, 5, 6]) - Math.SQRT2) < 1e-9);
  });
});

describe('findStockPhrases', () => {
  it('finds nothing in clean prose', () => {
    assert.deepEqual(findStockPhrases(HUMAN), { found: [], count: 0 });
  });

  it('is case-insensitive', () => {
    assert.equal(findStockPhrases('It Is Important To Note that x.').count, 1);
  });

  it('counts repeats but lists each phrase once', () => {
    const result = findStockPhrases('delve into this. delve into that.');
    assert.deepEqual(result.found, ['delve into']);
    assert.equal(result.count, 2);
  });
});

describe('countEmDashes', () => {
  it('counts real em-dashes', () => {
    assert.equal(countEmDashes('a — b — c'), 2);
  });

  it('counts spaced double hyphens as a substitute', () => {
    assert.equal(countEmDashes('a -- b'), 1);
  });

  it('does not count hyphenated words', () => {
    assert.equal(countEmDashes('a well-known state-of-the-art thing'), 0);
  });
});

describe('analyzeTells', () => {
  it('scores machine-sounding prose well below human prose', () => {
    const machine = analyzeTells(MACHINE);
    const human = analyzeTells(HUMAN);
    assert.ok(
      machine.score < human.score - 30,
      `expected a wide gap, got machine=${machine.score} human=${human.score}`,
    );
  });

  it('flags the specific stock phrases it found', () => {
    const result = analyzeTells(MACHINE);
    assert.ok(result.stockPhrases.includes('it is important to note'));
    assert.ok(result.stockPhrases.includes('delve into'));
  });

  it('measures the transition-opener rate', () => {
    // 5 of 6 sentences open on a transition word.
    const result = analyzeTells(MACHINE);
    assert.ok(result.transitionOpenerRate > 0.7, `got ${result.transitionOpenerRate}`);
    assert.equal(analyzeTells(HUMAN).transitionOpenerRate, 0);
  });

  it('penalises em-dash overuse', () => {
    // Insert dashes *within* sentences so sentence structure — and therefore
    // the rhythm signal — is identical on both sides and only the dash count
    // differs. Replacing full stops with dashes would collapse the text to one
    // sentence and change two variables at once.
    const clean = HUMAN;
    const dashes = HUMAN.replace(/, /g, ' — ');
    assert.ok(
      analyzeTells(dashes).emDashesPer1k > analyzeTells(clean).emDashesPer1k,
      'expected a higher dash rate',
    );
    assert.equal(analyzeTells(dashes).sentences, analyzeTells(clean).sentences);
    assert.ok(
      analyzeTells(dashes).score < analyzeTells(clean).score,
      'expected the dash-heavy version to score lower',
    );
  });

  it('ignores rhythm when there are too few sentences to judge it', () => {
    const short = 'One two three four. Five six seven eight.';
    const result = analyzeTells(short);
    assert.ok(result.sentences < MIN_SENTENCES_FOR_RHYTHM);
    // Uniform lengths, but with no other tells the score should stay high
    // rather than being dragged down by an unmeasurable rhythm.
    assert.ok(result.score >= 95, `got ${result.score}`);
  });

  it('does count rhythm once there are enough sentences', () => {
    const monotone = Array.from({ length: 8 }, () => 'The value is set here.').join(' ');
    const result = analyzeTells(monotone);
    assert.ok(result.sentences >= MIN_SENTENCES_FOR_RHYTHM);
    assert.equal(result.rhythm, 0);
    assert.ok(result.score < 80, `uniform sentences should score down, got ${result.score}`);
  });

  it('returns a clean score for empty input rather than dividing by zero', () => {
    const result = analyzeTells('');
    assert.equal(result.score, 100);
    assert.equal(result.words, 0);
    assert.ok(Number.isFinite(result.rhythm));
  });

  it('always produces a score within 0-100', () => {
    for (const text of [MACHINE, HUMAN, '', 'x', 'Moreover — delve into it.']) {
      const { score } = analyzeTells(text);
      assert.ok(score >= 0 && score <= 100, `${score} out of range for ${JSON.stringify(text)}`);
    }
  });

  it('is a pure function of its input', () => {
    assert.deepEqual(analyzeTells(MACHINE), analyzeTells(MACHINE));
  });
});

describe('describeTells', () => {
  it('labels each band', () => {
    assert.equal(describeTells(95), 'reads human');
    assert.equal(describeTells(75), 'mostly clean');
    assert.equal(describeTells(60), 'some tells');
    assert.equal(describeTells(20), 'reads generated');
  });
});
