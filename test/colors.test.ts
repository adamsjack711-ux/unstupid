import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { makeColors, supportsColor } from '../src/colors';

const tty = { isTTY: true } as NodeJS.WriteStream;
const pipe = { isTTY: false } as NodeJS.WriteStream;

const saved = { NO_COLOR: process.env.NO_COLOR, FORCE_COLOR: process.env.FORCE_COLOR };

function setEnv(name: 'NO_COLOR' | 'FORCE_COLOR', value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  setEnv('NO_COLOR', saved.NO_COLOR);
  setEnv('FORCE_COLOR', saved.FORCE_COLOR);
});

describe('supportsColor', () => {
  it('follows TTY detection by default', () => {
    setEnv('NO_COLOR', undefined);
    setEnv('FORCE_COLOR', undefined);
    assert.equal(supportsColor(tty), true);
    assert.equal(supportsColor(pipe), false);
  });

  it('treats override=false as an outright disable', () => {
    setEnv('NO_COLOR', undefined);
    setEnv('FORCE_COLOR', '1');
    assert.equal(supportsColor(tty, false), false);
  });

  it('treats override=true as "decide normally", not "force on"', () => {
    // commander's --no-color flag defaults to true; that must not colour a pipe.
    setEnv('NO_COLOR', undefined);
    setEnv('FORCE_COLOR', undefined);
    assert.equal(supportsColor(pipe, true), false);
    assert.equal(supportsColor(tty, true), true);
  });

  it('honours NO_COLOR', () => {
    setEnv('FORCE_COLOR', undefined);
    setEnv('NO_COLOR', '1');
    assert.equal(supportsColor(tty), false);
    setEnv('NO_COLOR', '');
    assert.equal(supportsColor(tty), true);
  });

  it('honours FORCE_COLOR', () => {
    setEnv('NO_COLOR', undefined);
    setEnv('FORCE_COLOR', '1');
    assert.equal(supportsColor(pipe), true);
    setEnv('FORCE_COLOR', '0');
    assert.equal(supportsColor(tty), false);
  });
});

describe('makeColors', () => {
  it('wraps text in ANSI codes when enabled', () => {
    const colors = makeColors(tty, true);
    setEnv('NO_COLOR', undefined);
    assert.equal(colors.enabled, true);
    assert.match(colors.red('x'), /\u001b\[31mx\u001b\[39m/);
  });

  it('is a pass-through when disabled', () => {
    const colors = makeColors(tty, false);
    assert.equal(colors.enabled, false);
    for (const style of ['bold', 'dim', 'red', 'green', 'yellow', 'cyan'] as const) {
      assert.equal(colors[style]('x'), 'x');
    }
  });
});
