import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GRADE_PRESETS, parseGrade, parseStrength } from '../src/cli';
import { buildSystemPrompt, isStrength, MAX_TOKENS, MODEL } from '../src/claudeClient';

describe('parseGrade', () => {
  it('accepts numeric grades in range', () => {
    assert.equal(parseGrade('3'), 3);
    assert.equal(parseGrade('8'), 8);
    assert.equal(parseGrade('16'), 16);
  });

  it('accepts named presets, case-insensitively', () => {
    assert.equal(parseGrade('elementary'), GRADE_PRESETS.elementary);
    assert.equal(parseGrade('High-School'), GRADE_PRESETS['high-school']);
    assert.equal(parseGrade('graduate'), GRADE_PRESETS.graduate);
  });

  it('rejects out-of-range grades', () => {
    assert.throws(() => parseGrade('2'), /between 3 and 16/);
    assert.throws(() => parseGrade('17'), /between 3 and 16/);
  });

  it('rejects nonsense', () => {
    assert.throws(() => parseGrade('eight'), /expected/);
    assert.throws(() => parseGrade('8.5'), /expected/);
    assert.throws(() => parseGrade(''), /expected/);
  });
});

describe('parseStrength', () => {
  it('accepts the three levels, case-insensitively', () => {
    assert.equal(parseStrength('light'), 'light');
    assert.equal(parseStrength('MEDIUM'), 'medium');
    assert.equal(parseStrength('heavy'), 'heavy');
  });

  it('rejects anything else', () => {
    assert.throws(() => parseStrength('extreme'), /expected one of/);
  });
});

describe('isStrength', () => {
  it('narrows only the valid values', () => {
    assert.ok(isStrength('light'));
    assert.ok(!isStrength('Light'));
    assert.ok(!isStrength('gentle'));
  });
});

describe('request configuration', () => {
  it('pins the model and token budget the spec requires', () => {
    assert.equal(MODEL, 'claude-sonnet-4-6');
    assert.equal(MAX_TOKENS, 1000);
  });
});

describe('buildSystemPrompt', () => {
  it('names the requested grade level', () => {
    assert.match(buildSystemPrompt(6, 'medium'), /grade level of about 6/);
    assert.match(buildSystemPrompt(14, 'medium'), /grade level of about 14/);
  });

  it('varies the restructuring guidance by strength', () => {
    const light = buildSystemPrompt(8, 'light');
    const heavy = buildSystemPrompt(8, 'heavy');
    assert.notEqual(light, heavy);
    assert.match(light, /Light\./);
    assert.match(heavy, /Heavy\./);
  });

  it('covers the required instructions', () => {
    const prompt = buildSystemPrompt(8, 'medium');
    assert.match(prompt, /Vary sentence length and rhythm/);
    assert.match(prompt, /em-dashes sparingly/);
    assert.match(prompt, /Preserve every fact/);
    assert.match(prompt, /Return only the rewritten text/);
  });
});
