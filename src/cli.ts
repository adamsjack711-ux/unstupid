#!/usr/bin/env node
/**
 * humanize — rewrite AI-generated text so it reads like a person wrote it.
 *
 * Exit codes: 0 success, 1 API/network failure, 2 bad usage or missing config.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { Command, CommanderError, InvalidArgumentError } from 'commander';

import { makeColors, type Colors } from './colors';
import { unifiedDiff } from './diff';
import { analyze, describeEase, type ReadabilityScores } from './readability';
import {
  ApiError,
  MissingApiKeyError,
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
  out?: string;
  stats?: boolean;
  diff?: boolean;
  color?: boolean;
}

/** Resolve `--grade`: a preset name or an integer in [3, 16]. */
export function parseGrade(raw: string): number {
  const preset = GRADE_PRESETS[raw.toLowerCase()];
  if (preset !== undefined) return preset;

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

export function parseStrength(raw: string): Strength {
  const value = raw.toLowerCase();
  if (!isStrength(value)) {
    throw new InvalidArgumentError(`expected one of: ${STRENGTHS.join(', ')}`);
  }
  return value;
}

function buildProgram(): Command {
  return new Command()
    .name('humanize')
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
    .option('-o, --out <file>', 'write the result to a file instead of stdout')
    .option('--stats', 'print before/after readability scores to stderr')
    .option('--diff', 'print a sentence-level diff instead of the rewritten text')
    .option('--no-color', 'disable coloured output')
    .addHelpText(
      'after',
      [
        '',
        'Environment:',
        '  ANTHROPIC_API_KEY   required; get one at https://console.anthropic.com/settings/keys',
        '',
        'Examples:',
        '  humanize draft.txt',
        '  cat draft.txt | humanize --grade middle',
        '  humanize draft.txt -g 6 -s heavy -o clean.txt --stats',
        '  humanize draft.txt --diff',
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

/** Read from the file argument, or stdin when it is piped. */
async function readInput(file: string | undefined): Promise<string> {
  if (file) {
    try {
      return readFileSync(file, 'utf8');
    } catch (error) {
      const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no such file' : String(error);
      throw new UsageError(`cannot read ${file}: ${reason}`);
    }
  }

  if (process.stdin.isTTY) {
    throw new UsageError(
      'no input. Pass a file argument or pipe text on stdin:\n' +
        '  humanize draft.txt\n' +
        '  cat draft.txt | humanize',
    );
  }

  return readStdin();
}

class UsageError extends Error {}

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

  const spinner = createSpinner(`Rewriting for grade ${options.grade} (${options.strength})...`);
  spinner.start();

  let result;
  try {
    result = await humanize({
      text: input,
      grade: options.grade,
      strength: options.strength,
    });
  } finally {
    spinner.stop();
  }

  if (result.truncated) {
    process.stderr.write(
      stderrColors.yellow(
        'warning: the model hit its output limit, so the rewrite may be cut short. ' +
          'Try splitting the input into smaller pieces.\n',
      ),
    );
  }

  if (options.stats) {
    const before = analyze(input);
    const after = analyze(result.text);
    process.stderr.write(`${renderStats(before, after, options.grade, stderrColors)}\n`);
  }

  if (options.out) {
    writeFileSync(options.out, ensureTrailingNewline(result.text), 'utf8');
    process.stderr.write(stderrColors.dim(`wrote ${options.out}\n`));
  }

  if (options.diff) {
    process.stdout.write(`${unifiedDiff(input, result.text, { colors: stdoutColors })}\n`);
  } else if (!options.out) {
    process.stdout.write(ensureTrailingNewline(result.text));
  }

  return EXIT_SUCCESS;
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

/**
 * Exit quietly when the reader of a pipe goes away, so `humanize --help | head`
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
