/**
 * Sentence-level unified diff.
 *
 * Line-level diffing is close to useless for prose, where a "line" is usually a
 * whole paragraph and any rewrite replaces it wholesale. Diffing on sentences
 * instead shows which sentences actually survived.
 */

import type { Colors } from './colors';
import { splitSentences } from './readability';

export type DiffOpType = 'equal' | 'remove' | 'add';

export interface DiffOp {
  type: DiffOpType;
  value: string;
}

/**
 * `sentence` lists whole sentences as added or removed. `word` marks changes
 * inline within the surrounding text. `auto` picks between them — see
 * chooseMode.
 */
export type DiffMode = 'auto' | 'sentence' | 'word';

export interface DiffOptions {
  colors: Colors;
  /** Unchanged sentences to show around each change. Default 1. */
  context?: number;
  /** Wrap width for the rendered output. Default: terminal width, else 80. */
  width?: number;
  /** Default 'auto'. */
  mode?: DiffMode;
  beforeLabel?: string;
  afterLabel?: string;
}

/**
 * Below this share of original sentences surviving verbatim, a sentence diff
 * degenerates into "everything removed, everything added" — two copies of the
 * text with no alignment to read. Word mode is the useful view there.
 */
const SENTENCE_ALIGNMENT_FLOOR = 0.25;

/**
 * Word diffing is quadratic in the length of the paragraph pair. Paragraphs are
 * normally a few hundred words, so this cap only trips on pathological input —
 * where we fall back to listing the pair wholesale rather than allocating a
 * table with tens of millions of cells.
 */
const MAX_WORD_DIFF = 4000;

/**
 * Segment text into diffable units: sentences, but never merging across blank
 * lines so paragraph boundaries stay visible.
 */
export function segment(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .flatMap((paragraph) => splitSentences(paragraph))
    .filter((s) => s.length > 0);
}

/**
 * Longest-common-subsequence diff over segments. Inputs here are bounded by the
 * model's 1000-token output, so the quadratic DP table is a few thousand cells
 * at worst.
 */
export function diffSegments(before: string[], after: string[]): DiffOp[] {
  const n = before.length;
  const m = after.length;

  // lcs[i][j] = length of the longest common subsequence of before[i..] and after[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j]! =
        before[i] === after[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ type: 'equal', value: before[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ type: 'remove', value: before[i]! });
      i++;
    } else {
      ops.push({ type: 'add', value: after[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'remove', value: before[i++]! });
  while (j < m) ops.push({ type: 'add', value: after[j++]! });

  return ops;
}

/** Split into paragraphs, dropping blank ones. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/** Split a paragraph into words for word-level diffing. */
export function tokenizeWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

/**
 * Pick a diff mode. A heavy rewrite changes every sentence, so the sentence
 * diff finds nothing in common and prints the whole text twice; word mode shows
 * what actually moved.
 */
export function chooseMode(before: string, after: string): Exclude<DiffMode, 'auto'> {
  const originals = segment(before);
  if (originals.length === 0) return 'sentence';

  const ops = diffSegments(originals, segment(after));
  const survived = ops.filter((op) => op.type === 'equal').length;
  return survived / originals.length < SENTENCE_ALIGNMENT_FLOOR ? 'word' : 'sentence';
}

/**
 * Pair up paragraphs for word diffing. Rewrites normally keep the paragraph
 * count, so index pairing is right and cheap; when the counts differ we give up
 * on structure and diff the texts as single blocks.
 */
function pairParagraphs(before: string, after: string): Array<[string, string]> {
  const b = paragraphs(before);
  const a = paragraphs(after);
  if (b.length === a.length && b.length > 0) {
    return b.map((text, i) => [text, a[i]!] as [string, string]);
  }
  return [[b.join(' '), a.join(' ')]];
}

/** Render one paragraph pair as inline text with change markers. */
function renderWordDiff(before: string, after: string, colors: Colors, width: number): string {
  const b = tokenizeWords(before);
  const a = tokenizeWords(after);

  if (b.length > MAX_WORD_DIFF || a.length > MAX_WORD_DIFF) {
    return [
      colors.red(wrap(before, '- ', width)),
      colors.green(wrap(after, '+ ', width)),
    ].join('\n');
  }

  // Group consecutive ops of the same type so a rewritten phrase reads as one
  // marked run rather than a stutter of per-word markers, but keep the run's
  // words as separate tokens so a long run can still wrap.
  const tokens: WordToken[] = [];
  const ops = diffSegments(b, a);
  let index = 0;
  while (index < ops.length) {
    const type = ops[index]!.type;
    const run: string[] = [];
    while (index < ops.length && ops[index]!.type === type) {
      run.push(ops[index]!.value);
      index++;
    }
    const open = type === 'remove' ? '[-' : type === 'add' ? '{+' : '';
    const close = type === 'remove' ? '-]' : type === 'add' ? '+}' : '';
    run.forEach((word, i) => {
      tokens.push({
        type,
        text: (i === 0 ? open : '') + word + (i === run.length - 1 ? close : ''),
      });
    });
  }

  return wrapTokens(tokens, '~ ', width, colors);
}

/** Render a unified diff of two texts, at sentence or word granularity. */
export function unifiedDiff(before: string, after: string, options: DiffOptions): string {
  const { colors } = options;
  const context = options.context ?? 1;
  const width = Math.max(40, options.width ?? process.stdout.columns ?? 80);
  const beforeLabel = options.beforeLabel ?? 'original';
  const afterLabel = options.afterLabel ?? 'rewritten';
  const requested = options.mode ?? 'auto';

  const ops = diffSegments(segment(before), segment(after));

  const lines: string[] = [
    colors.bold(colors.red(`--- ${beforeLabel}`)),
    colors.bold(colors.green(`+++ ${afterLabel}`)),
  ];

  if (!ops.some((op) => op.type !== 'equal')) {
    lines.push(colors.dim('  (no changes)'));
    return lines.join('\n');
  }

  const mode = requested === 'auto' ? chooseMode(before, after) : requested;
  if (mode === 'word') {
    lines.push(colors.dim(`  [-removed-] {+added+}`));
    for (const [b, a] of pairParagraphs(before, after)) {
      lines.push(renderWordDiff(b, a, colors, width));
    }
    return lines.join('\n');
  }

  const keep = markVisible(ops, context);
  let skipping = false;
  for (let index = 0; index < ops.length; index++) {
    const op = ops[index]!;
    if (!keep[index]) {
      skipping = true;
      continue;
    }
    if (skipping) {
      lines.push(colors.dim('  ...'));
      skipping = false;
    }
    switch (op.type) {
      case 'remove':
        lines.push(colors.red(wrap(op.value, '- ', width)));
        break;
      case 'add':
        lines.push(colors.green(wrap(op.value, '+ ', width)));
        break;
      case 'equal':
        lines.push(colors.dim(wrap(op.value, '  ', width)));
        break;
    }
  }

  return lines.join('\n');
}

/** Flag which ops to print: every change, plus `context` equals around each. */
function markVisible(ops: DiffOp[], context: number): boolean[] {
  const keep = new Array<boolean>(ops.length).fill(false);
  for (let i = 0; i < ops.length; i++) {
    if (ops[i]!.type === 'equal') continue;
    const from = Math.max(0, i - context);
    const to = Math.min(ops.length - 1, i + context);
    for (let j = from; j <= to; j++) keep[j] = true;
  }
  return keep;
}

interface WordToken {
  type: DiffOpType;
  text: string;
}

/**
 * Wrap word tokens to `width`, colouring each word as it is emitted.
 *
 * Colour is applied per token rather than per run so that measuring stays on
 * plain text, and so a long run of changed words wraps like any other prose
 * instead of overflowing the line as one indivisible piece.
 */
function wrapTokens(tokens: WordToken[], prefix: string, width: number, colors: Colors): string {
  const indent = ' '.repeat(prefix.length);
  const limit = Math.max(20, width - prefix.length);
  const paint = (token: WordToken): string =>
    token.type === 'remove'
      ? colors.red(token.text)
      : token.type === 'add'
        ? colors.green(token.text)
        : colors.dim(token.text);

  const lines: string[] = [];
  let current: string[] = [];
  let length = 0;

  for (const token of tokens) {
    const next = length === 0 ? token.text.length : length + 1 + token.text.length;
    if (current.length > 0 && next > limit) {
      lines.push(current.join(' '));
      current = [paint(token)];
      length = token.text.length;
    } else {
      current.push(paint(token));
      length = next;
    }
  }
  if (current.length > 0) lines.push(current.join(' '));
  if (lines.length === 0) return prefix.trimEnd();

  return lines.map((line, i) => (i === 0 ? prefix : indent) + line).join('\n');
}


/** Word-wrap `text` to `width`, prefixing the first line and indenting the rest. */
function wrap(text: string, prefix: string, width: number): string {
  const indent = ' '.repeat(prefix.length);
  const limit = Math.max(20, width - prefix.length);
  const lines: string[] = [];
  let current = '';

  for (const word of text.split(/\s+/)) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= limit) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length === 0) return prefix.trimEnd();

  return lines.map((line, i) => (i === 0 ? prefix : indent) + line).join('\n');
}
