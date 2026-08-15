# humanize

Rewrite AI-generated text so it reads like a person wrote it — at a reading grade level you pick.

It sends your text to Claude with a system prompt that targets the usual tells (uniform sentence rhythm, stock transitional phrases, em-dash overuse, bullet lists where prose would read better) while holding every fact and claim fixed. It then scores the before and after with Flesch-Kincaid so you can see what actually changed.

```console
$ humanize draft.txt --grade 8 --stats
```

## Install

Run it without installing:

```console
$ npx humanize draft.txt
```

Or install it globally:

```console
$ npm install -g humanize
```

Requires Node 18 or newer.

## Setup

You need an Anthropic API key. Create one at <https://console.anthropic.com/settings/keys>, then:

```console
$ export ANTHROPIC_API_KEY=sk-ant-...
```

Without it the tool exits immediately with a message pointing at that page — it never prompts.

## Usage

```
humanize [options] [file]
```

Text comes from the file argument, or from stdin when there's no argument:

```console
$ humanize draft.txt
$ cat draft.txt | humanize
$ pbpaste | humanize --grade middle
```

### Options

| Flag | Default | What it does |
| --- | --- | --- |
| `-g, --grade <level>` | `8` | Target Flesch-Kincaid grade, `3`–`16`, or a preset name |
| `-s, --strength <level>` | `medium` | How much to restructure: `light`, `medium`, `heavy` |
| `-o, --out <file>` | — | Write the result to a file instead of stdout |
| `--stats` | off | Print before/after readability scores to **stderr** |
| `--diff` | off | Print a sentence-level diff to stdout instead of the text |
| `--no-color` | — | Disable coloured output |
| `-h, --help` | — | Show help |

Grade presets: `elementary` (4), `middle` (7), `high-school` (10), `college` (13), `graduate` (16).

`--strength` controls restructuring, not tone. `light` keeps your sentence and paragraph structure and only fixes word choice and phrasing. `medium` reworks sentences freely but keeps the order of ideas. `heavy` is free to reorganise paragraphs and resequence supporting points.

### Examples

Rewrite for a middle-school reading level and show the scores:

```console
$ humanize draft.txt --grade middle --stats
  readability     grade    ease
  before     18.0    -8.0  very difficult
  after       6.1    73.8  fairly easy
  target      7.0          grade -11.9
  44 words / 3 sentences  ->  38 words / 3 sentences
```

See exactly which sentences changed:

```console
$ humanize draft.txt --diff
--- original
+++ humanized
- In today's rapidly evolving digital landscape, it is important to note that
  organizations must navigate the complexities of data governance.
+ Data governance is a mess right now, and companies have to deal with it.
```

Heavy rewrite for a young audience, written to a file:

```console
$ humanize report.md -g elementary -s heavy -o report.simple.md --stats
```

Because stats and warnings go to stderr, the tool composes cleanly in a pipeline — `--stats` never pollutes the text you're piping onward:

```console
$ humanize draft.txt --stats | wc -w
$ find drafts -name '*.txt' -exec sh -c 'humanize "$1" -o "${1%.txt}.clean.txt"' _ {} \;
```

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | API or network error (auth failure, rate limit, timeout, unreachable) |
| `2` | Bad usage, unreadable input, unwritable `--out`, or `ANTHROPIC_API_KEY` not set |

Anything that can be caught before the API call is caught before the API call — a bad `--grade`, an unreadable input file, an unwritable `--out` — so a mistake never costs you a request. If the write somehow fails afterwards anyway, the rewrite is printed to stdout rather than thrown away.

## Notes and limits

**Output length.** The API call uses `max_tokens: 1000`, roughly 750 words. Longer input gets truncated mid-rewrite. The tool warns on stderr twice about this — once before the call if the input is over ~700 words, and again afterwards if the model actually hit the ceiling. Split long documents and run them in pieces; chunking is not built in.

**`--out` overwrites without asking.** Including when the target is the file you're rewriting. `humanize draft.txt -o draft.txt` replaces `draft.txt` in place with no prompt and no backup, so keep the original in version control if you care about it.

**The model can still be wrong.** The prompt tells Claude to preserve every fact, figure, and claim, and in practice it does — but this is a language model, not a diffing tool with guarantees. For anything where accuracy matters, read `--diff` before you ship the result.

**Grade targeting is approximate.** Claude aims at the grade level you ask for; it doesn't compute Flesch-Kincaid while writing. `--stats` tells you where it actually landed. If you're consistently overshooting, ask for a grade or two lower.

**Syllable counting is heuristic.** Flesch-Kincaid needs syllable counts, and this uses the standard vowel-group approach with corrections for silent `-e`, `-ed`, and `-es`. It's a good approximation, not a pronunciation dictionary, so unusual words will be off by one now and then. Sentence splitting handles decimals, ellipses, initials (`J. R. R. Tolkien`), and common abbreviations (`Dr.`, `etc.`).

**The spinner gets out of your way.** It draws on stderr only when both stdout and stderr are terminals and `CI` is unset, so it never appears in redirected output or logs. It hides the terminal cursor while running and restores it on exit, including on Ctrl-C — interrupting a request will not leave your terminal in a broken state.

## Library use

The package also works as a dependency:

```ts
import { analyze, humanize, unifiedDiff } from 'humanize';

const before = analyze(draft);              // { grade, ease, sentences, words, syllables }
const { text } = await humanize({ text: draft, grade: 8, strength: 'medium' });
const after = analyze(text);
```

`analyze`, `splitSentences`, `splitWords`, and `countSyllables` are pure functions with no I/O and no dependency on process state.

## Development

```console
$ npm install
$ npm run build      # tsc -> dist/
$ npm test           # type-checks src + test, then runs node:test
```

Layout:

| Path | Purpose |
| --- | --- |
| `src/readability.ts` | Flesch-Kincaid grade and reading ease; pure functions |
| `src/claudeClient.ts` | The Anthropic API call and the system prompt |
| `src/cli.ts` | Argument parsing, I/O, exit codes — the `bin` entry point |
| `src/diff.ts` | Sentence-level LCS diff |
| `src/spinner.ts`, `src/colors.ts` | Terminal niceties, both self-disabling |
| `test/` | `node:test` suites, no test framework dependency |

### Design notes

**CommonJS, not ESM.** The compiled output is CommonJS targeting ES2022. The tradeoff: ESM is the better long-term direction and would let the CLI use top-level `await`, but CommonJS avoids the sharp edges that bite a `bin` script — no `.js` extensions required on every relative import, no `__dirname` gap, and no risk of a consumer on an older toolchain being unable to `require()` the library exports. Nothing here needs streaming ESM-only dependencies, so the cost of CommonJS is close to zero. Switching later means setting `"type": "module"`, changing `module` to `node16`, adding extensions to relative imports, and replacing the `require.main === module` guard.

**Two runtime dependencies, deliberately.** `@anthropic-ai/sdk` and `commander`, nothing else. Colour output is about twenty lines of hand-rolled ANSI in `src/colors.ts` rather than a `chalk` dependency: chalk v5 is ESM-only (so it can't be `require`d from this build) and chalk v4 pulls in a small tree of its own. For six styles behind a TTY check, in-tree was the cheaper answer. Tests use the built-in `node:test` runner, so there are no test-framework dev dependencies either.

**Streams are kept separate on purpose.** Rewritten text and diffs go to stdout; stats, warnings, and the spinner go to stderr. That's what makes `humanize draft.txt --stats | next-tool` behave.

## License

MIT
