/**
 * Library entry point. The CLI lives in ./cli; everything it is built from is
 * re-exported here so `humanize` can also be used as a dependency.
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
  humanize,
  isStrength,
  type HumanizeRequest,
  type HumanizeResult,
  type Strength,
} from './claudeClient';

export { diffSegments, segment, unifiedDiff, type DiffOp, type DiffOptions } from './diff';
export { makeColors, supportsColor, type Colors } from './colors';
export { GRADE_PRESETS } from './cli';
