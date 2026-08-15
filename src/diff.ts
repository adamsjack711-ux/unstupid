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

export interface DiffOptions {
  colors: Colors;
  /** Unchanged sentences to show around each change. Default 1. */
  context?: number;
  /** Wrap width for the rendered output. Default: terminal width, else 80. */
  width?: number;
  beforeLabel?: string;
  afterLabel?: string;
}

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

/** Render a sentence-level unified diff of two texts. */
export function unifiedDiff(before: string, after: string, options: DiffOptions): string {
  const { colors } = options;
  const context = options.context ?? 1;
  const width = Math.max(40, options.width ?? process.stdout.columns ?? 80);
  const beforeLabel = options.beforeLabel ?? 'original';
  const afterLabel = options.afterLabel ?? 'rewritten';

  const ops = diffSegments(segment(before), segment(after));
  const keep = markVisible(ops, context);

  const lines: string[] = [
    colors.bold(colors.red(`--- ${beforeLabel}`)),
    colors.bold(colors.green(`+++ ${afterLabel}`)),
  ];

  if (!ops.some((op) => op.type !== 'equal')) {
    lines.push(colors.dim('  (no changes)'));
    return lines.join('\n');
  }

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
