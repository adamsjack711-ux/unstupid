/**
 * A progress indicator that writes to stderr and disables itself whenever it
 * would corrupt output — when stdout is a pipe or file, when stderr is not a
 * terminal, or when a CI environment variable is set.
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_MS = 80;

export interface Spinner {
  /** True when the spinner will actually draw. */
  readonly active: boolean;
  start(): void;
  /** Erase the spinner. Safe to call when not started, and idempotent. */
  stop(): void;
}

export interface SpinnerOptions {
  /** Force the spinner on or off, bypassing TTY detection. */
  enabled?: boolean;
  stream?: NodeJS.WriteStream;
  stdout?: NodeJS.WriteStream;
}

export function createSpinner(label: string, options: SpinnerOptions = {}): Spinner {
  const stream = options.stream ?? process.stderr;
  const stdout = options.stdout ?? process.stdout;

  const enabled =
    options.enabled ??
    // Drawing only makes sense when the user is watching a terminal, and the
    // spec calls for suppressing it as soon as stdout is redirected.
    (Boolean(stream.isTTY) && Boolean(stdout.isTTY) && !process.env.CI);

  let timer: NodeJS.Timeout | undefined;
  let frame = 0;
  let drawn = false;

  const render = (): void => {
    stream.write(`\r\u001b[2K${FRAMES[frame % FRAMES.length]} ${label}`);
    frame++;
    drawn = true;
  };

  return {
    active: enabled,

    start(): void {
      if (!enabled || timer) return;
      stream.write('\u001b[?25l'); // hide cursor
      render();
      timer = setInterval(render, FRAME_MS);
      // Never hold the event loop open on the spinner's account.
      timer.unref?.();
    },

    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      if (!enabled) return;
      if (drawn) {
        stream.write('\r\u001b[2K');
        drawn = false;
      }
      stream.write('\u001b[?25h'); // show cursor
    },
  };
}
