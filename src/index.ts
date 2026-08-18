/**
 * Library entry point. The CLI lives in ./cli; everything it is built from is
 * re-exported here so `unstupid` can also be used as a dependency.
 */

export {
  analyze,
  countSyllables,
  countTextSyllables,
  describeEase,
  splitSentences,
  splitWords,
  type ReadabilityScores,
} from './readability';

export {
  API_KEY_URL,
  ApiError,
  MAX_TOKENS,
  MODEL,
  MissingApiKeyError,
  STRENGTHS,
  buildSystemPrompt,
  describeGrade,
  estimateCost,
  PRICE_PER_MTOK,
  trimVoiceSample,
  MAX_VOICE_WORDS,
  humanize,
  isStrength,
  type HumanizeRequest,
  type HumanizeResult,
  type Strength,
} from './claudeClient';

export {
  chooseMode,
  diffSegments,
  paragraphs,
  segment,
  tokenizeWords,
  unifiedDiff,
  type DiffMode,
  type DiffOp,
  type DiffOptions,
} from './diff';
export {
  MIN_SENTENCES_FOR_RHYTHM,
  STOCK_PHRASES,
  TRANSITION_OPENERS,
  analyzeTells,
  countEmDashes,
  describeTells,
  findStockPhrases,
  stdev,
  type TellScores,
} from './tells';

export {
  checkFacts,
  describeFactCheck,
  extractAcronyms,
  extractFacts,
  extractNames,
  extractNumbers,
  type Fact,
  type FactCheck,
  type FactKind,
} from './facts';

export { makeColors, supportsColor, type Colors } from './colors';
export { GRADE_PRESETS } from './cli';
