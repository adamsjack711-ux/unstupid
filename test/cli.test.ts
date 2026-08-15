import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  GRADE_PRESETS,
  assertWritableTarget,
  parseGrade,
  parseMaxTokens,
  parseStrength,
} from '../src/cli';
import {
  buildSystemPrompt,
  isStrength,
  MAX_TOKENS,
  MAX_TOKENS_LIMIT,
  MIN_TOKENS,
  MODEL,
} from '../src/claudeClient';

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

  it('rejects numeric-looking strings that are not plain integers', () => {
    for (const value of ['+8', ' 8', '8 ', '1e1', '0x8', '٨', '-8']) {
      assert.throws(() => parseGrade(value), /expected/, `should reject ${JSON.stringify(value)}`);
    }
  });

  it('does not resolve preset names up the prototype chain', () => {
    // A plain `GRADE_PRESETS[key]` lookup returns Object.prototype members for
    // these, which used to sail through validation as a "valid" grade.
    for (const key of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      assert.throws(() => parseGrade(key), /expected/, `should reject ${key}`);
    }
  });

  it('always returns a number for accepted input', () => {
    for (const value of ['3', '16', 'elementary', 'graduate']) {
      assert.equal(typeof parseGrade(value), 'number');
    }
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

describe('assertWritableTarget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unstupid-test-'));

  it('accepts a new file in an existing directory', () => {
    assert.doesNotThrow(() => assertWritableTarget(join(dir, 'new.txt')));
  });

  it('accepts an existing writable file', () => {
    const existing = join(dir, 'existing.txt');
    writeFileSync(existing, 'x');
    assert.doesNotThrow(() => assertWritableTarget(existing));
  });

  it('rejects a path whose directory does not exist', () => {
    assert.throws(
      () => assertWritableTarget(join(dir, 'missing', 'out.txt')),
      /no such directory/,
    );
  });

  it('rejects a directory as the output path', () => {
    assert.throws(() => assertWritableTarget(dir), /is a directory/);
  });

  it('names the path the user actually typed in the error', () => {
    const target = join(dir, 'missing', 'out.txt');
    assert.throws(() => assertWritableTarget(target), new RegExp(escapeRegExp(target)));
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

describe('parseMaxTokens', () => {
  it('accepts values inside the supported range', () => {
    assert.equal(parseMaxTokens('100'), 100);
    assert.equal(parseMaxTokens('1000'), 1000);
    assert.equal(parseMaxTokens('16000'), 16000);
  });

  it('rejects values outside it', () => {
    assert.throws(() => parseMaxTokens('99'), /between 100 and 16000/);
    assert.throws(() => parseMaxTokens('16001'), /between 100 and 16000/);
    assert.throws(() => parseMaxTokens('0'), /between 100 and 16000/);
  });

  it('rejects anything that is not a plain integer', () => {
    for (const value of ['1e4', '1_000', '1000.0', '-1000', ' 1000', 'lots']) {
      assert.throws(
        () => parseMaxTokens(value),
        /expected|between/,
        `should reject ${JSON.stringify(value)}`,
      );
    }
  });

  it('defaults to the spec value and stays under the non-streaming ceiling', () => {
    assert.equal(MAX_TOKENS, 1000);
    assert.ok(MAX_TOKENS <= MAX_TOKENS_LIMIT);
    assert.ok(MIN_TOKENS < MAX_TOKENS);
  });
});
