/**
 * Checking that a rewrite kept the facts.
 *
 * The system prompt tells the model to preserve every figure and name, and in
 * practice it does — but "in practice it does" is not a guarantee, and a
 * silently altered number is the worst thing this tool could do to you. So
 * verify rather than trust.
 *
 * The check is deliberately narrow. It looks at the things that are both
 * high-stakes and cheap to extract without a parser: numbers, acronyms, and
 * capitalised names. It cannot understand meaning, so it will never catch a
 * reversed claim or a dropped qualifier — read the diff for those. What it does
 * catch is a figure that changed or vanished.
 *
 * Every function here is pure.
 */

export type FactKind = 'number' | 'acronym' | 'name';

export interface Fact {
  kind: FactKind;
  /** The comparison key — normalised. */
  value: string;
}

export interface FactCheck {
  /** Present in the original, absent from the rewrite. */
  missing: Fact[];
  /** Present in the rewrite but not the original — a possible invention. */
  added: Fact[];
  /** How many distinct facts were found in the original. */
  checked: number;
  ok: boolean;
}

/**
 * Words that are capitalised for grammar rather than because they name
 * something, and so must not be treated as names.
 */
const SENTENCE_OPENERS = new Set([
  'The', 'A', 'An', 'This', 'That', 'These', 'Those', 'It', 'They', 'We', 'I',
  'You', 'He', 'She', 'There', 'Here', 'If', 'When', 'While', 'Then', 'But',
  'And', 'So', 'For', 'To', 'In', 'On', 'At', 'By', 'With', 'From', 'As',
  'Every', 'Each', 'All', 'Some', 'Most', 'No', 'Not', 'Now', 'Its', 'Their',
  'Our', 'His', 'Her', 'Because', 'After', 'Before', 'Once', 'Only', 'Both',
  'Either', 'Neither', 'What', 'Which', 'Who', 'Where', 'Why', 'How', 'Do',
  'Does', 'Did', 'Is', 'Are', 'Was', 'Were', 'Be', 'Been', 'Can', 'Could',
  'Should', 'Would', 'Will', 'May', 'Might', 'Must', 'Have', 'Has', 'Had',
  'Let', 'Make', 'Use', 'Using', 'Given', 'Since', 'Though', 'Although',
  'However', 'Moreover', 'Furthermore', 'Additionally', 'Therefore', 'Thus',
]);

/**
 * Numbers, with formatting normalised so that "1,000" and "1000" compare equal
 * and a trailing percent or leading currency symbol is kept as part of the fact.
 */
export function extractNumbers(text: string): string[] {
  const matches = text.match(/[$£€]?\d[\d,]*(?:\.\d+)?%?/g) ?? [];
  return matches.map((raw) => raw.replace(/,/g, ''));
}

/** Initialisms: API, TTY, CLI, MIT, and their plurals. */
export function extractAcronyms(text: string): string[] {
  return (text.match(/\b[A-Z]{2,6}s?\b/g) ?? []).map((a) => a.replace(/s$/, ''));
}

/**
 * Capitalised words that are not sentence-grammar artefacts. Only words that
 * appear mid-sentence count, since a word at the start of a sentence is
 * capitalised regardless of whether it names anything.
 */
export function extractNames(text: string): string[] {
  const names: string[] = [];
  // Split on sentence terminators so we can ignore each sentence's first word.
  for (const sentence of text.split(/[.!?]+\s+/)) {
    const words = sentence.trim().split(/\s+/);
    words.slice(1).forEach((word) => {
      const clean = word.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
      if (clean.length < 2) return;
      if (!/^[A-Z][a-z]+$/.test(clean)) return; // skips ALLCAPS and lowercase
      if (SENTENCE_OPENERS.has(clean)) return;
      names.push(clean);
    });
  }
  return names;
}

/** All checkable facts in a text, de-duplicated. */
export function extractFacts(text: string): Fact[] {
  const seen = new Set<string>();
  const facts: Fact[] = [];
  const add = (kind: FactKind, value: string): void => {
    const key = `${kind}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    facts.push({ kind, value });
  };

  extractNumbers(text).forEach((value) => add('number', value));
  extractAcronyms(text).forEach((value) => add('acronym', value));
  extractNames(text).forEach((value) => add('name', value));
  return facts;
}

/**
 * Compare the facts in a rewrite against the original.
 *
 * A name that legitimately became a pronoun will show up as missing; that is a
 * false positive by design, on the principle that a noisy warning beats a
 * silent change to a figure.
 */
export function checkFacts(before: string, after: string): FactCheck {
  const beforeFacts = extractFacts(before);
  const afterFacts = extractFacts(after);

  const afterKeys = new Set(afterFacts.map((f) => `${f.kind}:${f.value}`));
  const beforeKeys = new Set(beforeFacts.map((f) => `${f.kind}:${f.value}`));

  const missing = beforeFacts.filter((f) => !afterKeys.has(`${f.kind}:${f.value}`));
  const added = afterFacts.filter((f) => !beforeKeys.has(`${f.kind}:${f.value}`));

  return {
    missing,
    added,
    checked: beforeFacts.length,
    // Only numbers and acronyms are treated as hard failures. A changed name is
    // reported but does not fail the check, because rephrasing legitimately
    // replaces names with pronouns.
    ok: !missing.some((f) => f.kind !== 'name') && !added.some((f) => f.kind === 'number'),
  };
}

/** One-line summary of a fact check, for the stats block. */
export function describeFactCheck(check: FactCheck): string {
  const parts: string[] = [];
  const hard = check.missing.filter((f) => f.kind !== 'name');
  const names = check.missing.filter((f) => f.kind === 'name');
  const inventedNumbers = check.added.filter((f) => f.kind === 'number');

  // An original with nothing checkable in it can still have had a figure
  // invented into the rewrite, which is the worst case of all — so report the
  // "nothing to check" result only when there is genuinely nothing to say.
  if (check.checked === 0 && inventedNumbers.length === 0) {
    return 'nothing checkable found';
  }

  if (hard.length > 0) parts.push(`MISSING ${hard.map((f) => f.value).join(', ')}`);
  if (inventedNumbers.length > 0) {
    parts.push(`NEW ${inventedNumbers.map((f) => f.value).join(', ')}`);
  }
  if (names.length > 0) parts.push(`${names.length} name(s) dropped`);

  if (parts.length === 0) return `${check.checked} checked, all preserved`;
  return `${check.checked} checked - ${parts.join('; ')}`;
}
