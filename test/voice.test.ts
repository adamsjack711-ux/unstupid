import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_VOICE_WORDS, buildSystemPrompt, trimVoiceSample } from '../src/claudeClient';
import { parseDiffMode } from '../src/cli';

const SAMPLE = 'Short. Punchy. No hedging, ever. That is the whole style.';

describe('trimVoiceSample', () => {
  it('leaves a short sample alone apart from whitespace', () => {
    assert.equal(trimVoiceSample('  a  b\n c '), 'a b c');
  });

  it('caps a long sample and marks the cut', () => {
    const long = 'word '.repeat(MAX_VOICE_WORDS + 200);
    const trimmed = trimVoiceSample(long);
    assert.ok(trimmed.endsWith('...'), 'expected an ellipsis on a truncated sample');
    assert.equal(trimmed.replace(/\.\.\.$/, '').trim().split(/\s+/).length, MAX_VOICE_WORDS);
  });

  it('does not mark a sample that fits', () => {
    const exact = 'word '.repeat(MAX_VOICE_WORDS).trim();
    assert.doesNotMatch(trimVoiceSample(exact), /\.\.\.$/);
  });
});

describe('buildSystemPrompt with a voice sample', () => {
  it('adds nothing when no sample is given', () => {
    const prompt = buildSystemPrompt(8, 'medium');
    assert.doesNotMatch(prompt, /voice_sample/);
    assert.doesNotMatch(prompt, /Voice: match/);
  });

  it('adds nothing for a blank or whitespace-only sample', () => {
    assert.doesNotMatch(buildSystemPrompt(8, 'medium', ''), /voice_sample/);
    assert.doesNotMatch(buildSystemPrompt(8, 'medium', '   \n  '), /voice_sample/);
  });

  it('embeds the sample in a delimited block', () => {
    const prompt = buildSystemPrompt(8, 'medium', SAMPLE);
    assert.match(prompt, /<voice_sample>/);
    assert.match(prompt, /<\/voice_sample>/);
    assert.ok(prompt.includes(SAMPLE), 'expected the sample text itself');
  });

  it('tells the model to copy the manner, not the content', () => {
    const prompt = buildSystemPrompt(8, 'medium', SAMPLE);
    assert.match(prompt, /Do not copy any of its content/);
    assert.match(prompt, /only the manner of writing/);
  });

  it('resolves the voice-versus-grade conflict explicitly', () => {
    // A terse voice naturally scores lower than a mid grade target, so the
    // prompt has to say which one wins rather than leaving it ambiguous.
    assert.match(buildSystemPrompt(12, 'medium', SAMPLE), /follow the sample/);
  });

  it('truncates an oversized sample rather than sending all of it', () => {
    const long = `${'alpha '.repeat(MAX_VOICE_WORDS + 500)}TAILWORD`;
    const prompt = buildSystemPrompt(8, 'medium', long);
    assert.doesNotMatch(prompt, /TAILWORD/, 'expected the tail to be cut');
  });

  it('keeps the rest of the prompt intact', () => {
    const prompt = buildSystemPrompt(8, 'medium', SAMPLE);
    assert.match(prompt, /Preserve every fact/);
    assert.match(prompt, /grade level of about 8/);
    assert.match(prompt, /Return only the rewritten text/);
  });
});

describe('parseDiffMode', () => {
  it('accepts the three modes, case-insensitively', () => {
    assert.equal(parseDiffMode('auto'), 'auto');
    assert.equal(parseDiffMode('Sentence'), 'sentence');
    assert.equal(parseDiffMode('WORD'), 'word');
  });

  it('rejects anything else', () => {
    assert.throws(() => parseDiffMode('inline'), /expected one of/);
    assert.throws(() => parseDiffMode(''), /expected one of/);
  });
});
