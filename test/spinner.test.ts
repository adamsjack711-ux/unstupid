import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSpinner } from '../src/spinner';

const SHOW_CURSOR = '\u001b[?25h';
const HIDE_CURSOR = '\u001b[?25l';

/** A WriteStream stand-in that records everything written to it. */
function fakeStream(isTTY: boolean): NodeJS.WriteStream & { written: string } {
  const chunks: string[] = [];
  return {
    isTTY,
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    get written() {
      return chunks.join('');
    },
  } as unknown as NodeJS.WriteStream & { written: string };
}

function signalListenerCount(): number {
  return process.listenerCount('SIGINT') + process.listenerCount('SIGTERM');
}

describe('createSpinner', () => {
  it('stays silent when stdout is not a TTY', () => {
    const stream = fakeStream(true);
    const spinner = createSpinner('working', { stream, stdout: fakeStream(false) });
    assert.equal(spinner.active, false);
    spinner.start();
    spinner.stop();
    assert.equal(stream.written, '');
  });

  it('stays silent when stderr is not a TTY', () => {
    const stream = fakeStream(false);
    const spinner = createSpinner('working', { stream, stdout: fakeStream(true) });
    assert.equal(spinner.active, false);
    spinner.start();
    assert.equal(stream.written, '');
  });

  it('hides the cursor on start and restores it on stop', () => {
    const stream = fakeStream(true);
    const spinner = createSpinner('working', { stream, enabled: true });
    spinner.start();
    assert.ok(stream.written.includes(HIDE_CURSOR), 'expected the cursor to be hidden');
    spinner.stop();
    assert.ok(stream.written.endsWith(SHOW_CURSOR), 'expected the cursor to be restored');
  });

  it('leaves no residue on the line after stopping', () => {
    const stream = fakeStream(true);
    const spinner = createSpinner('working', { stream, enabled: true });
    spinner.start();
    spinner.stop();
    // The final writes must clear the line before showing the cursor again.
    assert.match(stream.written, /\r\u001b\[2K\u001b\[\?25h$/);
  });

  it('registers signal handlers while running and removes them on stop', () => {
    const before = signalListenerCount();
    const spinner = createSpinner('working', { stream: fakeStream(true), enabled: true });

    spinner.start();
    assert.ok(
      signalListenerCount() > before,
      'expected SIGINT/SIGTERM handlers while the spinner runs',
    );

    spinner.stop();
    assert.equal(signalListenerCount(), before, 'expected handlers to be removed on stop');
  });

  it('does not leak handlers across repeated start/stop cycles', () => {
    const before = signalListenerCount();
    const spinner = createSpinner('working', { stream: fakeStream(true), enabled: true });
    for (let i = 0; i < 3; i++) {
      spinner.start();
      spinner.stop();
    }
    assert.equal(signalListenerCount(), before);
  });

  it('is safe to stop without starting, and to stop twice', () => {
    const spinner = createSpinner('working', { stream: fakeStream(true), enabled: true });
    assert.doesNotThrow(() => {
      spinner.stop();
      spinner.start();
      spinner.stop();
      spinner.stop();
    });
  });
});
