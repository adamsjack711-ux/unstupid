/**
 * Flesch-Kincaid readability metrics.
 *
 * Everything here is a pure function of its input string: no I/O, no globals,
 * no dependence on process state. Syllable counting uses a vowel-group
 * heuristic, which is the standard approach for these formulas — it is an
 * approximation, not a dictionary lookup, and will miss on unusual words.
 */

export interface ReadabilityScores {
  /** Flesch-Kincaid grade level. Roughly the US school grade needed to read the text. */
  grade: number;
  /** Flesch reading ease, 0-100. Higher is easier. Can fall outside that range on extreme text. */
  ease: number;
  sentences: number;
  words: number;
  syllables: number;
}

/**
 * Words that commonly end in a period without ending a sentence. Stored
 * without the trailing period.
 */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'rev', 'hon', 'sr', 'jr', 'st',
  'vs', 'etc', 'eg', 'ie', 'al', 'cf', 'approx', 'est',
  'inc', 'ltd', 'co', 'corp', 'dept', 'univ', 'assn',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sept', 'sep', 'oct', 'nov', 'dec',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thurs', 'fri', 'sat', 'sun',
  'fig', 'figs', 'vol', 'vols', 'no', 'nos', 'pp', 'ed', 'eds', 'ch', 'sec',
]);

const TERMINATORS = '.!?';
const CLOSERS = '"\')]}”’';

/**
 * Split text into sentences.
 *
 * Handles the cases that matter for prose scoring: decimals (3.14), ellipses,
 * single-letter initials (J. R. R. Tolkien), common abbreviations, and
 * terminators followed by closing quotes or brackets. Newlines are treated as
 * whitespace, so a paragraph without terminal punctuation counts as one
 * sentence rather than one per line.
 */
export function splitSentences(text: string): string[] {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return [];

  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < flat.length; i++) {
    const ch = flat[i]!;
    if (!TERMINATORS.includes(ch)) continue;

    // Absorb a run of terminators ("?!", "...") and any closing punctuation.
    let end = i;
    while (end + 1 < flat.length && TERMINATORS.includes(flat[end + 1]!)) end++;
    while (end + 1 < flat.length && CLOSERS.includes(flat[end + 1]!)) end++;

    const next = flat[end + 1];
    // A terminator not followed by a space is inside a token: 3.14, U.S.A, a.m.
    if (next !== undefined && next !== ' ') {
      i = end;
      continue;
    }

    if (ch === '.') {
      const token = /([A-Za-z.]+)\.$/.exec(flat.slice(start, i + 1))?.[1] ?? '';
      const bare = token.replace(/\./g, '').toLowerCase();
      // "Dr." and single initials like "J." don't end sentences.
      if (ABBREVIATIONS.has(bare) || bare.length === 1) {
        i = end;
        continue;
      }
    }

    sentences.push(flat.slice(start, end + 1).trim());
    start = end + 1;
    i = end;
  }

  const tail = flat.slice(start).trim();
  if (tail) sentences.push(tail);

  // Drop fragments with no alphanumeric content (stray punctuation, bullets).
  return sentences.filter((s) => /[A-Za-z0-9]/.test(s));
}

/**
 * Split text into words. Hyphenated and apostrophised forms ("well-known",
 * "don't") count as one word, matching how the formulas are normally applied.
 */
export function splitWords(text: string): string[] {
  return text.match(/[A-Za-z0-9]+(?:[''’-][A-Za-z0-9]+)*/g) ?? [];
}

/**
 * Estimate the syllable count of a single word using a vowel-group heuristic:
 * count runs of vowels, then correct for the most common systematic error
 * (silent trailing "e").
 *
 * Purely numeric tokens are counted as one syllable per digit, which is closer
 * to how they are read aloud than treating "2024" as a single syllable.
 */
export function countSyllables(word: string): number {
  const letters = word.toLowerCase().replace(/[^a-z]/g, '');

  if (!letters) {
    const digits = word.replace(/[^0-9]/g, '');
    return Math.max(1, digits.length);
  }

  if (letters.length <= 3) return 1;

  let stem = letters
    // Silent trailing "e": "make", "chocolate". Not after "l" ("table") and
    // not after another vowel ("agree").
    .replace(/(?<=[^laeiouy])e$/, '')
    // Silent "-ed": "walked" is one syllable, but "wanted" and "needed" are two.
    .replace(/(?<=[^td])ed$/, '')
    // Silent "-es": "makes" is one syllable, but "houses" and "boxes" are two.
    .replace(/(?<=[^scgzxh])es$/, '')
    // Leading "y" is a consonant ("yellow"), not a vowel nucleus.
    .replace(/^y/, '');

  if (!stem) stem = letters;

  const groups = stem.match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 0);
}

/** Total syllables across every word in the text. */
export function countTextSyllables(text: string): number {
  return splitWords(text).reduce((total, word) => total + countSyllables(word), 0);
}

/**
 * Compute Flesch-Kincaid grade level and Flesch reading ease.
 *
 *   grade = 0.39 * (words/sentence) + 11.8 * (syllables/word) - 15.59
 *   ease  = 206.835 - 1.015 * (words/sentence) - 84.6 * (syllables/word)
 *
 * Text with no words scores zero on both rather than dividing by zero.
 */
export function analyze(text: string): ReadabilityScores {
  const sentences = splitSentences(text);
  const words = splitWords(text);
  const syllables = words.reduce((total, word) => total + countSyllables(word), 0);

  if (words.length === 0) {
    return { grade: 0, ease: 0, sentences: sentences.length, words: 0, syllables: 0 };
  }

  // A body of text with no terminal punctuation is still one sentence.
  const sentenceCount = Math.max(1, sentences.length);
  const wordsPerSentence = words.length / sentenceCount;
  const syllablesPerWord = syllables / words.length;

  return {
    grade: round(0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59),
    ease: round(206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord),
    sentences: sentences.length,
    words: words.length,
    syllables,
  };
}

/** Plain-language label for a reading ease score. */
export function describeEase(ease: number): string {
  if (ease >= 90) return 'very easy';
  if (ease >= 80) return 'easy';
  if (ease >= 70) return 'fairly easy';
  if (ease >= 60) return 'plain English';
  if (ease >= 50) return 'fairly difficult';
  if (ease >= 30) return 'difficult';
  return 'very difficult';
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
