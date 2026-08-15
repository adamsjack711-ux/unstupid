/**
 * Minimal ANSI colouring.
 *
 * This is deliberately hand-rolled instead of pulling in chalk: the entire
 * surface used here is six styles, and keeping it in-tree holds the runtime
 * dependency list at exactly the two packages the CLI genuinely needs.
 */

export interface Colors {
  enabled: boolean;
  bold(text: string): string;
  dim(text: string): string;
  red(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  cyan(text: string): string;
}

/**
 * Decide whether to emit ANSI codes for a stream.
 *
 * `override` is an opt-out only: `false` disables colour outright, while `true`
 * and `undefined` both mean "decide normally". That matters because commander's
 * `--no-color` flag defaults to `true` when the user says nothing, so treating
 * `true` as "force on" would colour redirected output.
 *
 * Otherwise: NO_COLOR (any non-empty value) disables, FORCE_COLOR (anything but
 * "0") enables, and the fallback is whether the stream is a TTY.
 */
export function supportsColor(stream: NodeJS.WriteStream, override?: boolean): boolean {
  if (override === false) return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  if (process.env.FORCE_COLOR !== undefined) return process.env.FORCE_COLOR !== '0';
  return Boolean(stream.isTTY);
}

export function makeColors(stream: NodeJS.WriteStream, override?: boolean): Colors {
  const enabled = supportsColor(stream, override);
  const wrap =
    (open: string, close: string) =>
    (text: string): string =>
      enabled ? `\u001b[${open}m${text}\u001b[${close}m` : text;

  return {
    enabled,
    bold: wrap('1', '22'),
    dim: wrap('2', '22'),
    red: wrap('31', '39'),
    green: wrap('32', '39'),
    yellow: wrap('33', '39'),
    cyan: wrap('36', '39'),
  };
}
