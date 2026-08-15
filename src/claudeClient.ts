/**
 * Wrapper around the Anthropic Messages API for the one call this tool makes.
 */

import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-sonnet-4-6';

/** Default output budget. Roughly 750 words. */
export const MAX_TOKENS = 1000;

/**
 * Ceiling for `--max-tokens`. The model itself goes far higher, but this client
 * is non-streaming, and the SDK refuses non-streaming requests it estimates
 * will outlive the HTTP timeout. Going past this needs a streaming rewrite.
 */
export const MAX_TOKENS_LIMIT = 16_000;
export const MIN_TOKENS = 100;

/** Rough words-per-token ratio for English prose, used to size warnings. */
export const WORDS_PER_TOKEN = 0.75;

/**
 * List price for MODEL, in US dollars per million tokens. Used only to show an
 * estimate alongside the token counts — it is a published rate that can change,
 * and it ignores any discount on your account, so treat the figure as
 * indicative rather than as billing.
 */
export const PRICE_PER_MTOK = { input: 3, output: 15 } as const;

/** Estimated US dollar cost of a request, from its token counts. */
export function estimateCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * PRICE_PER_MTOK.input +
    (outputTokens / 1_000_000) * PRICE_PER_MTOK.output
  );
}

export const API_KEY_URL = 'https://console.anthropic.com/settings/keys';

export type Strength = 'light' | 'medium' | 'heavy';

export const STRENGTHS: readonly Strength[] = ['light', 'medium', 'heavy'];

export function isStrength(value: string): value is Strength {
  return (STRENGTHS as readonly string[]).includes(value);
}

export interface HumanizeRequest {
  text: string;
  /** Target Flesch-Kincaid grade level, 3-16. */
  grade: number;
  strength: Strength;
  /** Output token budget. Defaults to MAX_TOKENS. */
  maxTokens?: number;
  /** A sample of writing whose voice the rewrite should imitate. */
  voiceSample?: string;
  /** Overrides the ANTHROPIC_API_KEY environment variable. */
  apiKey?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
}

export interface HumanizeResult {
  text: string;
  /** True when the model hit MAX_TOKENS, so the rewrite may be cut off. */
  truncated: boolean;
  inputTokens: number;
  outputTokens: number;
}

/** Thrown when no API key is available. Distinct so the CLI can exit 2. */
export class MissingApiKeyError extends Error {
  constructor() {
    super(
      'ANTHROPIC_API_KEY is not set.\n' +
        `Create a key at ${API_KEY_URL}, then export it:\n\n` +
        '  export ANTHROPIC_API_KEY=sk-ant-...\n',
    );
    this.name = 'MissingApiKeyError';
  }
}

/** Thrown for any API or network failure. The CLI exits 1 on these. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const STRENGTH_GUIDANCE: Record<Strength, string> = {
  light:
    'Light. Keep the original sentence and paragraph structure almost intact. ' +
    'Change word choice, smooth out stilted phrasing, and break up the most ' +
    'mechanical rhythms, but do not reorganise the argument or merge and split ' +
    'sentences wholesale.',
  medium:
    'Medium. Keep the order of ideas, but rework sentences freely: merge, split, ' +
    'and reorder clauses so the rhythm varies. Recast lists as prose where prose ' +
    'reads better, and rewrite any phrasing that sounds formulaic.',
  heavy:
    'Heavy. Rewrite from the ground up. Restructure paragraphs, resequence ' +
    'supporting points where a different order reads better, and change the ' +
    'shape of the piece as much as you need. The facts and conclusions must ' +
    'survive unchanged; nothing about the phrasing has to.',
};

/** Human-readable label for a target grade level, used in the system prompt. */
export function describeGrade(grade: number): string {
  if (grade <= 5) return 'upper elementary school';
  if (grade <= 8) return 'middle school';
  if (grade <= 12) return 'high school';
  if (grade <= 15) return 'undergraduate';
  return 'graduate';
}

/**
 * Longest voice sample worth sending. A few hundred words is plenty to convey a
 * voice, and the sample is pure overhead on every request.
 */
export const MAX_VOICE_WORDS = 400;

/** Trim a voice sample to MAX_VOICE_WORDS, keeping whole words. */
export function trimVoiceSample(sample: string): string {
  const words = sample.trim().split(/\s+/).filter(Boolean);
  return words.length <= MAX_VOICE_WORDS
    ? words.join(' ')
    : `${words.slice(0, MAX_VOICE_WORDS).join(' ')}...`;
}

/** Build the system prompt. Exported so it can be inspected and tested. */
export function buildSystemPrompt(
  grade: number,
  strength: Strength,
  voiceSample?: string,
): string {
  const voice = voiceSample?.trim()
    ? [
        '',
        'Voice: match the writing style of the sample below. Copy its rhythm, its ' +
          'sentence lengths, its level of formality, its vocabulary, its appetite ' +
          'for sentence fragments, and its habits of punctuation. Do not copy any ' +
          'of its content, subject matter, or specific phrases — only the manner ' +
          'of writing. If the sample and the target reading level pull in ' +
          'different directions, follow the sample; report the grade honestly ' +
          'rather than distorting the voice to hit a number.',
        '',
        '<voice_sample>',
        trimVoiceSample(voiceSample),
        '</voice_sample>',
      ]
    : [];

  return [
    'You rewrite text so that it reads as though a thoughtful person wrote it, ' +
      'not as though it was generated.',
    '',
    'How to write:',
    '- Vary sentence length and rhythm. Put a short sentence next to a long one. ' +
      'Never let every sentence settle into the same shape or length.',
    '- Cut stock AI phrasing: "delve into", "it is important to note", "in ' +
      "today's world\", \"navigate the complexities\", \"a testament to\", " +
      '"unlock the potential", "moreover/furthermore/additionally" stacked as ' +
      'paragraph openers, and closing paragraphs that restate what was just said.',
    '- Do not lean on the same transitional phrase twice. Most sentences need no ' +
      'transition word at all; let the ideas connect on their own.',
    '- Use em-dashes sparingly. At most one in the whole piece, and only where a ' +
      'comma, colon, or full stop genuinely reads worse.',
    '- Prefer flowing prose to rigid list structures. Keep a list only when the ' +
      'items are genuinely parallel and a reader would want to scan them; ' +
      'otherwise write the same content as sentences.',
    '- Let some sentences begin with "And", "But", or "So" if that is how the ' +
      'thought naturally lands. Contractions are fine.',
    '',
    'What must not change:',
    '- Preserve every fact, figure, name, date, and claim exactly as given.',
    '- Preserve the meaning, the intent, and the author\'s stance and level of ' +
      'confidence. Do not soften a firm claim or firm up a hedged one.',
    '- Add nothing that was not there. Remove nothing that was.',
    '- Keep the original language and, broadly, the original length.',
    '',
    `Reading level: target a Flesch-Kincaid grade level of about ${grade} ` +
      `(${describeGrade(grade)}). Choose vocabulary and sentence complexity to ` +
      'match. Lower grade levels want shorter sentences and everyday words; ' +
      'higher ones tolerate longer sentences, subordinate clauses, and technical ' +
      'vocabulary. Hit the level by rewriting, never by dropping content.',
    '',
    `How much to restructure: ${STRENGTH_GUIDANCE[strength]}`,
    ...voice,
    '',
    'Return only the rewritten text. No preamble, no explanation, no commentary, ' +
      'no surrounding quotes, and no markdown code fences unless the original ' +
      'text itself was fenced.',
  ].join('\n');
}

/** Rewrite `text` via the Claude API. */
export async function humanize(request: HumanizeRequest): Promise<HumanizeResult> {
  const apiKey = request.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new MissingApiKeyError();

  const client = new Anthropic({
    apiKey,
    timeout: request.timeoutMs ?? 120_000,
    maxRetries: 2,
  });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: request.maxTokens ?? MAX_TOKENS,
      system: buildSystemPrompt(request.grade, request.strength, request.voiceSample),
      messages: [{ role: 'user', content: request.text }],
    });
  } catch (error) {
    throw toApiError(error);
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  if (!text) {
    throw new ApiError(
      response.stop_reason === 'refusal'
        ? 'The model declined to rewrite this text.'
        : 'The model returned an empty response.',
    );
  }

  return {
    text,
    truncated: response.stop_reason === 'max_tokens',
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

function toApiError(error: unknown): ApiError {
  if (error instanceof Anthropic.AuthenticationError) {
    return new ApiError(
      `Authentication failed. Check that ANTHROPIC_API_KEY is valid: ${API_KEY_URL}`,
      error.status,
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ApiError('Rate limited by the Anthropic API. Try again shortly.', error.status);
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new ApiError(
      `Model "${MODEL}" is not available to this API key.`,
      error.status,
    );
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ApiError('The request to the Anthropic API timed out.');
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ApiError('Could not reach the Anthropic API. Check your network connection.');
  }
  if (error instanceof Anthropic.APIError) {
    return new ApiError(`Anthropic API error: ${error.message}`, error.status);
  }
  return new ApiError(error instanceof Error ? error.message : String(error));
}
