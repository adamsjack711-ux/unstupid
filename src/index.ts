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
export { makeColors, supportsColor, type Colors } from './colors';
export { GRADE_PRESETS } from './cli';
