#!/usr/bin/env node
/**
 * unstupid — rewrite AI-generated text so it reads like a person wrote it.
 *
 * Exit codes: 0 success, 1 API/network failure, 2 bad usage or missing config.
 */

import { accessSync, constants, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Command, CommanderError, InvalidArgumentError } from 'commander';

import { makeColors, type Colors } from './colors';
import { unifiedDiff, type DiffMode } from './diff';
import { analyze, describeEase, splitWords, type ReadabilityScores } from './readability';
import {
  ApiError,
  MAX_TOKENS,
  MAX_TOKENS_LIMIT,
  MIN_TOKENS,
  MissingApiKeyError,
  WORDS_PER_TOKEN,
  humanize,
  isStrength,
  STRENGTHS,
  type Strength,
} from './claudeClient';
import { createSpinner } from './spinner';

const EXIT_SUCCESS = 0;
const EXIT_API_ERROR = 1;
const EXIT_USAGE = 2;

const MIN_GRADE = 3;
const MAX_GRADE = 16;
const DEFAULT_GRADE = 8;

/**
 * Warn once the input gets this close to filling the output budget, leaving a
 * little room for a rewrite that runs slightly longer than the original.
 */
const LONG_INPUT_RATIO = 0.93;

/** Named shorthands for common target grade levels. */
export const GRADE_PRESETS: Record<string, number> = {
  elementary: 4,
  middle: 7,
  'high-school': 10,
  college: 13,
  graduate: 16,
};

interface CliOptions {
  grade: number;
  strength: Strength;
  maxTokens: number;
  voice?: string;
  out?: string;
  stats?: boolean;
  diff?: boolean;
  diffMode: DiffMode;
  color?: boolean;
}

/** Resolve `--grade`: a preset name or an integer in [3, 16]. */
export function parseGrade(raw: string): number {
  // Object.hasOwn, not a plain lookup: `GRADE_PRESETS['constructor']` would
  // otherwise resolve up the prototype chain and hand back a function.
  const key = raw.toLowerCase();
  if (Object.hasOwn(GRADE_PRESETS, key)) return GRADE_PRESETS[key]!;

  if (!/^\d+$/.test(raw)) {
    throw new InvalidArgumentError(
      `expected ${MIN_GRADE}-${MAX_GRADE} or one of: ${Object.keys(GRADE_PRESETS).join(', ')}`,
    );
  }
  const value = Number(raw);
  if (value < MIN_GRADE || value > MAX_GRADE) {
    throw new InvalidArgumentError(`must be between ${MIN_GRADE} and ${MAX_GRADE}`);
  }
  return value;
}

/** Resolve `--max-tokens`: an integer in [MIN_TOKENS, MAX_TOKENS_LIMIT]. */
export function parseMaxTokens(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new InvalidArgumentError(`expected a whole number of tokens`);
  }
  const value = Number(raw);
  if (value < MIN_TOKENS || value > MAX_TOKENS_LIMIT) {
    throw new InvalidArgumentError(`must be between ${MIN_TOKENS} and ${MAX_TOKENS_LIMIT}`);
  }
  return value;
}

const DIFF_MODES: readonly DiffMode[] = ['auto', 'sentence', 'word'];

/** Resolve `--diff-mode`. */
export function parseDiffMode(raw: string): DiffMode {
  const value = raw.toLowerCase();
  if (!(DIFF_MODES as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`expected one of: ${DIFF_MODES.join(', ')}`);
  }
  return value as DiffMode;
}

export function parseStrength(raw: string): Strength {
  const value = raw.toLowerCase();
  if (!isStrength(value)) {
    throw new InvalidArgumentError(`expected one of: ${STRENGTHS.join(', ')}`);
  }
  return value;
}

function buildProgram(): Command {
  return new Command()
    .name('unstupid')
    .description(
      'Rewrite AI-generated text so it reads like a person wrote it, at a reading grade level you pick.\n' +
        'Reads from a file argument or from stdin.',
    )
    .argument('[file]', 'file to rewrite; omit to read from stdin')
    .option(
      '-g, --grade <level>',
      `target Flesch-Kincaid grade (${MIN_GRADE}-${MAX_GRADE}), or one of: ${Object.keys(GRADE_PRESETS).join(', ')}`,
      parseGrade,
      DEFAULT_GRADE,
    )
    .option(
      '-s, --strength <level>',
      `how much to restructure (${STRENGTHS.join(', ')})`,
      parseStrength,
      'medium' as Strength,
    )
    .option(
      '-m, --max-tokens <n>',
      `output token budget (${MIN_TOKENS}-${MAX_TOKENS_LIMIT}); raise it for longer documents`,
      parseMaxTokens,
      MAX_TOKENS,
    )
    .option(
      '-v, --voice <file>',
      'a sample of writing whose style the rewrite should imitate',
    )
    .option('-o, --out <file>', 'write the result to a file instead of stdout')
    .option('--stats', 'print before/after readability scores to stderr')
    .option('--diff', 'print a diff instead of the rewritten text')
    .option(
      '--diff-mode <mode>',
      `diff granularity (${DIFF_MODES.join(', ')}); auto picks by how much survived`,
      parseDiffMode,
      'auto' as DiffMode,
    )
    .option('--no-color', 'disable coloured output')
    .addHelpText(
      'after',
      [
        '',
        'Environment:',
        '  ANTHROPIC_API_KEY   required; get one at https://console.anthropic.com/settings/keys',
        '',
        'Examples:',
        '  unstupid draft.txt',
        '  cat draft.txt | unstupid --grade middle',
        '  unstupid draft.txt -g 6 -s heavy -o clean.txt --stats',
        '  unstupid draft.txt --diff',
        '  unstupid draft.txt --voice my-old-posts.md',
        '',
        'Exit codes:',
        '  0  success',
        '  1  API or network error',
        '  2  bad usage, or ANTHROPIC_API_KEY not set',
      ].join('\n'),
    );
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Read a UTF-8 file, reporting failures as usage errors. */
function readTextFile(file: string, what: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    throw new UsageError(`cannot read ${what} ${file}: ${describeFsError(error)}`);
  }
}

/** Read from the file argument, or stdin when it is piped. */
async function readInput(file: string | undefined): Promise<string> {
  if (file) {
    return readTextFile(file, 'input');
  }

  if (process.stdin.isTTY) {
    throw new UsageError(
      'no input. Pass a file argument or pipe text on stdin:\n' +
        '  unstupid draft.txt\n' +
        '  cat draft.txt | unstupid',
    );
  }

  return readStdin();
}

class UsageError extends Error {}

function describeFsError(error: unknown): string {
  switch ((error as NodeJS.ErrnoException).code) {
    case 'ENOENT':
      return 'no such file or directory';
    case 'EACCES':
    case 'EPERM':
      return 'permission denied';
    case 'EISDIR':
      return 'path is a directory';
    case 'ENOSPC':
      return 'no space left on device';
    default:
      return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Check that `--out` is writable *before* spending an API call on a rewrite we
 * would then have nowhere to put. Checking up front cannot be airtight — the
 * filesystem can change underneath us — so the write itself is still guarded.
 */
export function assertWritableTarget(target: string): void {
  const full = resolve(target);
  try {
    if (existsSync(full)) {
      if (statSync(full).isDirectory()) {
        throw new UsageError(`cannot write to ${target}: path is a directory`);
      }
      accessSync(full, constants.W_OK);
      return;
    }
    accessSync(dirname(full), constants.W_OK);
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(`cannot write to ${target}: ${describeFsError(error)}`);
  }
}

function renderStats(
  before: ReadabilityScores,
  after: ReadabilityScores,
  targetGrade: number,
  colors: Colors,
): string {
  const row = (label: string, grade: string, ease: string, note: string): string =>
    `  ${label.padEnd(8)}${grade.padStart(7)}${ease.padStart(8)}  ${colors.dim(note)}`;

  const delta = Math.round((after.grade - before.grade) * 10) / 10;
  const arrow = delta === 0 ? '' : delta < 0 ? `${delta}` : `+${delta}`;

  return [
    colors.bold('  readability     grade    ease'),
    row('before', before.grade.toFixed(1), before.ease.toFixed(1), describeEase(before.ease)),
    row('after', after.grade.toFixed(1), after.ease.toFixed(1), describeEase(after.ease)),
    row('target', targetGrade.toFixed(1), '', arrow ? `grade ${arrow}` : 'grade unchanged'),
    colors.dim(
      `  ${before.words} words / ${before.sentences} sentences  ->  ` +
        `${after.words} words / ${after.sentences} sentences`,
    ),
  ].join('\n');
}

async function run(argv: string[]): Promise<number> {
  const program = buildProgram().exitOverride();

  let file: string | undefined;
  let options: CliOptions;
  try {
    program.parse(argv);
    file = program.args[0];
    options = program.opts<CliOptions>();
  } catch (error) {
    if (error instanceof CommanderError) {
      // --help and --version are successful exits; everything else is misuse.
      const ok = error.code === 'commander.helpDisplayed' || error.code === 'commander.version';
      return ok ? EXIT_SUCCESS : EXIT_USAGE;
    }
    throw error;
  }

  const stderrColors = makeColors(process.stderr, options.color);
  const stdoutColors = makeColors(process.stdout, options.color);

  const input = await readInput(file);
  if (!input.trim()) {
    throw new UsageError('input is empty; nothing to rewrite.');
  }

  // Fail before the API call, not after it, so a bad path costs nothing.
  if (options.out) assertWritableTarget(options.out);

  let voiceSample: string | undefined;
  if (options.voice) {
    voiceSample = readTextFile(options.voice, '--voice sample');
    if (!voiceSample.trim()) {
      throw new UsageError(`--voice file ${options.voice} is empty`);
    }
  }

  const inputWords = splitWords(input).length;
  const outputWordBudget = Math.round(options.maxTokens * WORDS_PER_TOKEN);
  if (inputWords > outputWordBudget * LONG_INPUT_RATIO) {
    const remedy =
      options.maxTokens < MAX_TOKENS_LIMIT
        ? `Raise --max-tokens (up to ${MAX_TOKENS_LIMIT}) or split the input and run it in pieces.`
        : 'Split the input and run it in pieces.';
    process.stderr.write(
      stderrColors.yellow(
        `warning: input is ${inputWords} words, but --max-tokens ${options.maxTokens} ` +
          `allows only about ${outputWordBudget}. The rewrite will likely be cut short. ` +
          `${remedy}\n`,
      ),
    );
  }

  const spinner = createSpinner(`Rewriting for grade ${options.grade} (${options.strength})...`);
  spinner.start();

  let result;
  try {
    result = await humanize({
      text: input,
      grade: options.grade,
      strength: options.strength,
      maxTokens: options.maxTokens,
      voiceSample,
    });
  } finally {
    spinner.stop();
  }

  if (result.truncated) {
    process.stderr.write(
      stderrColors.yellow(
        `warning: the model hit its ${options.maxTokens}-token output limit, so the ` +
          'rewrite is probably cut short. ' +
          (options.maxTokens < MAX_TOKENS_LIMIT
            ? `Retry with a higher --max-tokens (up to ${MAX_TOKENS_LIMIT}).\n`
            : 'Split the input into smaller pieces.\n'),
      ),
    );
  }

  if (options.stats) {
    const before = analyze(input);
    const after = analyze(result.text);
    process.stderr.write(`${renderStats(before, after, options.grade, stderrColors)}\n`);
  }

  if (options.out) {
    try {
      writeFileSync(options.out, ensureTrailingNewline(result.text), 'utf8');
    } catch (error) {
      // The rewrite exists but has nowhere to go. Print it so the API call the
      // user just paid for is not lost, then report the failure.
      process.stdout.write(ensureTrailingNewline(result.text));
      throw new UsageError(
        `cannot write to ${options.out}: ${describeFsError(error)} ` +
          '(the rewrite was printed to stdout instead)',
      );
    }
    process.stderr.write(stderrColors.dim(`wrote ${options.out}\n`));
  }

  if (options.diff) {
    process.stdout.write(`${unifiedDiff(input, result.text, { colors: stdoutColors, mode: options.diffMode })}\n`);
  } else if (!options.out) {
    process.stdout.write(ensureTrailingNewline(result.text));
  }

  return EXIT_SUCCESS;
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

/**
 * Exit quietly when the reader of a pipe goes away, so `unstupid --help | head`
 * behaves like every other Unix tool instead of dumping a stack trace.
 */
function exitQuietlyOnBrokenPipe(stream: NodeJS.WriteStream): void {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(EXIT_SUCCESS);
    throw error;
  });
}

async function main(): Promise<void> {
  exitQuietlyOnBrokenPipe(process.stdout);
  exitQuietlyOnBrokenPipe(process.stderr);

  const colors = makeColors(process.stderr);
  try {
    process.exitCode = await run(process.argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${colors.red('error:')} ${error.message}\n`);
      process.exitCode = EXIT_USAGE;
    } else if (error instanceof MissingApiKeyError) {
      process.stderr.write(`${colors.red('error:')} ${error.message}`);
      process.exitCode = EXIT_USAGE;
    } else if (error instanceof ApiError) {
      process.stderr.write(`${colors.red('error:')} ${error.message}\n`);
      process.exitCode = EXIT_API_ERROR;
    } else {
      process.stderr.write(
        `${colors.red('error:')} ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = EXIT_API_ERROR;
    }
  }
}

// Only self-execute when run as a program, so the module stays importable.
if (require.main === module) {
  void main();
}
