/**
 * Detecting machine-sounding prose.
 *
 * Flesch-Kincaid only sees sentence length and syllable count, so it cannot
 * see any of the things that actually make text read as generated: uniform
 * rhythm, stock phrasing, em-dash overuse, every paragraph opening on a
 * transition word. This module measures those directly.
 *
 * The thresholds below are judgement calls, chosen by eye from what typical
 * human prose looks like. They are not empirically validated, and the score is
 * a rough signal rather than a verdict — treat a low score as "worth a look",
 * not as proof. Every function here is pure.
 */

import { splitSentences, splitWords } from './readability';

/**
 * Multi-word phrases that show up far more often in generated prose than in
 * writing people do themselves. Kept to phrases rather than single words:
 * "leverage" and "foster" have honest uses, "delve into the complexities"
 * rather less so.
 */
export const STOCK_PHRASES: readonly string[] = [
  'delve into',
  'it is important to note',
  "it's important to note",
  'it is worth noting',
  "it's worth noting",
  'in today’s world',
  "in today's world",
  'in the world of',
  'in the realm of',
  'navigate the complexities',
  'navigating the complexities',
  'a testament to',
  'unlock the potential',
  'unlock the power',
  'plays a crucial role',
  'plays a vital role',
  'plays a key role',
  'at the end of the day',
  'when it comes to',
  'the landscape of',
  'ever-evolving',
  'rapidly evolving',
  'holistic approach',
  'paradigm shift',
  'game-changer',
  'game changer',
  'deep dive',
  'a myriad of',
  'a plethora of',
  'rich tapestry',
  'seamless integration',
  'robust and scalable',
  'cutting-edge',
  'state-of-the-art',
  'first and foremost',
  'needless to say',
  'this comprehensive guide',
  'in conclusion',
  'in summary',
];

/** Words that, used to open a sentence, signal mechanical connective tissue. */
export const TRANSITION_OPENERS: readonly string[] = [
  'however',
  'moreover',
  'furthermore',
  'additionally',
  'therefore',
  'thus',
  'consequently',
  'nevertheless',
  'nonetheless',
  'accordingly',
  'similarly',
  'likewise',
  'notably',
  'importantly',
  'indeed',
  'overall',
  'ultimately',
  'subsequently',
  'conversely',
];

/**
 * Thresholds. Each metric is converted to a 0-1 penalty: 0 once the text looks
 * unremarkable, 1 once it is as bad as the metric meaningfully gets.
 */
const RHYTHM_FLOOR_WORDS = 4.5; // sentence-length stdev at or above this reads varied
/**
 * Sentence-length spread means nothing on a handful of sentences — three
 * happen to be similar lengths quite often in perfectly human writing. Below
 * this count the rhythm signal is dropped rather than guessed at.
 */
export const MIN_SENTENCES_FOR_RHYTHM = 5;
const STOCK_PHRASES_PER_1K_MAX = 8;
const EM_DASH_PER_1K_FREE = 2; // a couple per thousand words is normal
const EM_DASH_PER_1K_MAX = 12;
const TRANSITION_RATE_FREE = 0.1; // one opener in ten sentences is unremarkable
const TRANSITION_RATE_MAX = 0.35;

/** How much each signal contributes to the overall score. Sums to 1. */
const WEIGHTS = {
  rhythm: 0.3,
  stockPhrases: 0.3,
  transitions: 0.25,
  emDashes: 0.15,
} as const;

export interface TellScores {
  /** 0-100. Higher means fewer machine tells. */
  score: number;
  /** Standard deviation of sentence length, in words. Low means monotonous. */
  rhythm: number;
  /** Stock phrases found, in the order they appear in STOCK_PHRASES. */
  stockPhrases: string[];
  stockPhrasesPer1k: number;
  emDashesPer1k: number;
  /** Share of sentences opening on a transition word, 0-1. */
  transitionOpenerRate: number;
  sentences: number;
  words: number;
}

/** Population standard deviation. Returns 0 for fewer than two values. */
export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Which stock phrases appear in the text, and how many times in total. */
export function findStockPhrases(text: string): { found: string[]; count: number } {
  const haystack = text.toLowerCase();
  const found: string[] = [];
  let count = 0;
  for (const phrase of STOCK_PHRASES) {
    const hits = countOccurrences(haystack, phrase.toLowerCase());
    if (hits > 0) {
      found.push(phrase);
      count += hits;
    }
  }
  return { found, count };
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + needle.length;
  }
}

/** Count em-dashes, including the double-hyphen people type when they lack one. */
export function countEmDashes(text: string): number {
  return (text.match(/—|\s--\s/g) ?? []).length;
}

/** Analyse a text for machine tells. */
export function analyzeTells(text: string): TellScores {
  const sentences = splitSentences(text);
  const words = splitWords(text);
  const wordCount = words.length;

  if (wordCount === 0) {
    return {
      score: 100,
      rhythm: 0,
      stockPhrases: [],
      stockPhrasesPer1k: 0,
      emDashesPer1k: 0,
      transitionOpenerRate: 0,
      sentences: 0,
      words: 0,
    };
  }

  const per1k = (n: number): number => (n / wordCount) * 1000;

  const lengths = sentences.map((s) => splitWords(s).length);
  const rhythm = stdev(lengths);

  const stock = findStockPhrases(text);
  const stockPer1k = per1k(stock.count);
  const emDashPer1k = per1k(countEmDashes(text));

  const openers = sentences.filter((sentence) => {
    const first = splitWords(sentence)[0]?.toLowerCase();
    return first !== undefined && TRANSITION_OPENERS.includes(first);
  }).length;
  const transitionOpenerRate = sentences.length > 0 ? openers / sentences.length : 0;

  // Too few sentences to read anything into their spread. Redistribute the
  // weight across the remaining signals rather than scoring a guess.
  const rhythmCounts = sentences.length >= MIN_SENTENCES_FOR_RHYTHM;
  const rhythmPenalty = rhythmCounts
    ? clamp01((RHYTHM_FLOOR_WORDS - rhythm) / RHYTHM_FLOOR_WORDS)
    : 0;
  const stockPenalty = clamp01(stockPer1k / STOCK_PHRASES_PER_1K_MAX);
  const emDashPenalty = clamp01(
    (emDashPer1k - EM_DASH_PER_1K_FREE) / (EM_DASH_PER_1K_MAX - EM_DASH_PER_1K_FREE),
  );
  const transitionPenalty = clamp01(
    (transitionOpenerRate - TRANSITION_RATE_FREE) / (TRANSITION_RATE_MAX - TRANSITION_RATE_FREE),
  );

  const weighted =
    (rhythmCounts ? WEIGHTS.rhythm * rhythmPenalty : 0) +
    WEIGHTS.stockPhrases * stockPenalty +
    WEIGHTS.emDashes * emDashPenalty +
    WEIGHTS.transitions * transitionPenalty;
  // Renormalise so dropping the rhythm signal does not silently inflate scores.
  const totalWeight = rhythmCounts
    ? 1
    : WEIGHTS.stockPhrases + WEIGHTS.emDashes + WEIGHTS.transitions;
  const penalty = weighted / totalWeight;

  return {
    score: Math.round(100 * (1 - penalty)),
    rhythm: round1(rhythm),
    stockPhrases: stock.found,
    stockPhrasesPer1k: round1(stockPer1k),
    emDashesPer1k: round1(emDashPer1k),
    transitionOpenerRate: Math.round(transitionOpenerRate * 100) / 100,
    sentences: sentences.length,
    words: wordCount,
  };
}

/** Plain-language reading of an overall tells score. */
export function describeTells(score: number): string {
  if (score >= 85) return 'reads human';
  if (score >= 70) return 'mostly clean';
  if (score >= 50) return 'some tells';
  return 'reads generated';
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
