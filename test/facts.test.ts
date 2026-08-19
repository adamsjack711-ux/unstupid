import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkFacts,
  describeFactCheck,
  extractAcronyms,
  extractFacts,
  extractNames,
  extractNumbers,
} from '../src/facts';

describe('extractNumbers', () => {
  it('finds plain integers and decimals', () => {
    assert.deepEqual(extractNumbers('We shipped 42 units at 3.5 each'), ['42', '3.5']);
  });

  it('normalises thousands separators so 1,000 equals 1000', () => {
    assert.deepEqual(extractNumbers('1,000 and 1000'), ['1000', '1000']);
  });

  it('keeps percentages and currency attached', () => {
    assert.deepEqual(extractNumbers('up 12% to $1,500'), ['12%', '$1500']);
  });

  it('finds nothing in text without numbers', () => {
    assert.deepEqual(extractNumbers('no digits here at all'), []);
  });

  it('keeps the magnitude word, so billions do not compare equal to millions', () => {
    assert.deepEqual(extractNumbers('NASA allocated $4.2 billion'), ['$4.2 billion']);
    assert.deepEqual(extractNumbers('NASA allocated $4.2 million'), ['$4.2 million']);
    assert.notDeepEqual(
      extractNumbers('$4.2 billion'),
      extractNumbers('$4.2 million'),
    );
  });

  it('reads every magnitude word', () => {
    assert.deepEqual(
      extractNumbers('3 hundred, 3 thousand, 3 million, 3 billion, 3 trillion'),
      ['3 hundred', '3 thousand', '3 million', '3 billion', '3 trillion'],
    );
  });

  it('folds an abbreviation onto its full word, since expanding one is not a change', () => {
    assert.deepEqual(extractNumbers('$5M'), extractNumbers('$5 million'));
    assert.deepEqual(extractNumbers('3k'), extractNumbers('3 thousand'));
    assert.deepEqual(extractNumbers('£5bn'), extractNumbers('£5 billion'));
    assert.deepEqual(extractNumbers('7 tn'), extractNumbers('7 trillion'));
  });

  it('is case-insensitive about the magnitude', () => {
    assert.deepEqual(extractNumbers('$4.2 Billion'), ['$4.2 billion']);
    assert.deepEqual(extractNumbers('$4.2 BILLION'), ['$4.2 billion']);
  });

  it('reads a hyphenated magnitude', () => {
    assert.deepEqual(extractNumbers('a 4.2-billion dollar program'), ['4.2 billion']);
  });

  it('does not read a spaced single letter as a magnitude', () => {
    // "5 m" is far more likely to be five metres, and treating it as five
    // million would make two different figures compare equal.
    assert.deepEqual(extractNumbers('a 5 m cable'), ['5']);
    assert.notDeepEqual(extractNumbers('a 5 m cable'), extractNumbers('5 million'));
  });

  it('does not treat an ordinary following word as a magnitude', () => {
    assert.deepEqual(extractNumbers('a 47-page report'), ['47']);
    assert.deepEqual(extractNumbers('12 units shipped'), ['12']);
  });

  it('keeps percentages working alongside magnitudes', () => {
    assert.deepEqual(extractNumbers('up 12% on $4.2 billion'), ['12%', '$4.2 billion']);
  });
});

describe('extractAcronyms', () => {
  it('finds initialisms', () => {
    assert.deepEqual(extractAcronyms('the API and the CLI'), ['API', 'CLI']);
  });

  it('folds plurals onto the singular', () => {
    assert.deepEqual(extractAcronyms('two APIs'), ['API']);
  });

  it('ignores ordinary capitalised words', () => {
    assert.deepEqual(extractAcronyms('The Cat Sat'), []);
  });
});

describe('extractNames', () => {
  it('finds names that appear mid-sentence', () => {
    assert.ok(extractNames('We met Alice yesterday.').includes('Alice'));
  });

  it('ignores the capitalised first word of a sentence', () => {
    assert.ok(!extractNames('Alice met us yesterday.').includes('Alice'));
  });

  it('ignores capitalised grammar words mid-sentence', () => {
    const names = extractNames('It broke. However the fix worked. Therefore we shipped.');
    assert.ok(!names.includes('However'));
    assert.ok(!names.includes('Therefore'));
  });
});

describe('checkFacts and magnitude', () => {
  it('catches a thousandfold change to a figure', () => {
    const check = checkFacts('NASA allocated $4.2 billion.', 'NASA allocated $4.2 million.');
    assert.equal(check.ok, false);
    assert.deepEqual(
      check.missing.map((f) => f.value),
      ['$4.2 billion'],
    );
    assert.deepEqual(
      check.added.map((f) => f.value),
      ['$4.2 million'],
    );
  });

  it('does not flag an abbreviation that was merely expanded', () => {
    const check = checkFacts('It cost $5M.', 'It cost $5 million.');
    assert.equal(check.ok, true);
  });
});

describe('checkFacts', () => {
  it('passes when everything survives', () => {
    const before = 'We shipped 42 units through the API in March.';
    const after = 'The API carried 42 units that March.';
    const check = checkFacts(before, after);
    assert.equal(check.ok, true);
    assert.deepEqual(check.missing, []);
  });

  it('catches a dropped number', () => {
    const check = checkFacts('Revenue rose 12% last year.', 'Revenue rose last year.');
    assert.equal(check.ok, false);
    assert.ok(check.missing.some((f) => f.kind === 'number' && f.value === '12%'));
  });

  it('catches a changed number', () => {
    const check = checkFacts('We saw 1,000 users.', 'We saw 10,000 users.');
    assert.equal(check.ok, false);
    assert.ok(check.missing.some((f) => f.value === '1000'));
    assert.ok(check.added.some((f) => f.value === '10000'));
  });

  it('catches an invented number', () => {
    const check = checkFacts('Usage grew a lot.', 'Usage grew 40%.');
    assert.equal(check.ok, false);
    assert.ok(check.added.some((f) => f.kind === 'number' && f.value === '40%'));
  });

  it('catches a dropped acronym', () => {
    const check = checkFacts('It runs over the TTY.', 'It runs over the terminal.');
    assert.equal(check.ok, false);
    assert.ok(check.missing.some((f) => f.kind === 'acronym' && f.value === 'TTY'));
  });

  it('reports a dropped name without failing the check', () => {
    // Replacing a name with a pronoun is a legitimate rewrite, so it is
    // surfaced but does not make the check fail.
    const check = checkFacts('We told Alice about it.', 'We told her about it.');
    assert.ok(check.missing.some((f) => f.kind === 'name' && f.value === 'Alice'));
    assert.equal(check.ok, true);
  });

  it('counts how many facts it checked', () => {
    assert.equal(checkFacts('42 and 7 via API', '').checked, 3);
  });

  it('treats text with no facts as passing', () => {
    const check = checkFacts('some words here', 'other words there');
    assert.equal(check.checked, 0);
    assert.equal(check.ok, true);
  });

  it('is order-insensitive', () => {
    const check = checkFacts('We saw 1 then 2.', 'We saw 2 then 1.');
    assert.equal(check.ok, true);
  });
});

describe('extractFacts', () => {
  it('de-duplicates repeated facts', () => {
    const facts = extractFacts('42 and 42 and 42');
    assert.equal(facts.filter((f) => f.value === '42').length, 1);
  });
});

describe('describeFactCheck', () => {
  it('says so when nothing is checkable', () => {
    assert.match(describeFactCheck(checkFacts('words', 'words')), /nothing checkable/);
  });

  it('reports a clean pass with a count', () => {
    assert.match(describeFactCheck(checkFacts('42 units', '42 units')), /all preserved/);
  });

  it('names the missing values', () => {
    const text = describeFactCheck(checkFacts('we had 42 units', 'we had units'));
    assert.match(text, /MISSING/);
    assert.match(text, /42/);
  });

  it('flags invented numbers separately', () => {
    const text = describeFactCheck(checkFacts('it grew', 'it grew 40%'));
    assert.match(text, /NEW/);
    assert.match(text, /40%/);
  });
});

describe('describeFactCheck regression', () => {
  it('does not hide an invented number when the original had no facts', () => {
    // The worst case: text with nothing checkable in it, and the rewrite
    // fabricates a figure. An early "nothing checkable found" used to swallow it.
    const text = describeFactCheck(checkFacts('sales went up', 'sales went up 40%'));
    assert.doesNotMatch(text, /nothing checkable/);
    assert.match(text, /40%/);
  });

  it('still reports nothing checkable when nothing was invented either', () => {
    assert.match(describeFactCheck(checkFacts('words', 'other words')), /nothing checkable/);
  });
});
