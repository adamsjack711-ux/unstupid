# unstupid

Rewrite AI-generated text so it reads like a person wrote it — at a reading grade level you pick.

It sends your text to Claude with a system prompt that targets the usual tells (uniform sentence rhythm, stock transitional phrases, em-dash overuse, bullet lists where prose would read better) while holding every fact and claim fixed. It then scores the before and after with Flesch-Kincaid so you can see what actually changed.

```console
$ unstupid draft.txt --grade 8 --stats
```

## Install

Run it without installing:

```console
$ npx unstupid draft.txt
```

Or install it globally:

```console
$ npm install -g unstupid
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
unstupid [options] [file]
```

Text comes from the file argument, or from stdin when there's no argument:

```console
$ unstupid draft.txt
$ cat draft.txt | unstupid
$ pbpaste | unstupid --grade middle
```

### Options

| Flag | Default | What it does |
| --- | --- | --- |
| `-g, --grade <level>` | `8` | Target Flesch-Kincaid grade, `3`–`16`, or a preset name |
| `-s, --strength <level>` | `medium` | How much to restructure: `light`, `medium`, `heavy` |
| `-m, --max-tokens <n>` | `1000` | Output token budget, `100`–`16000`. Raise it for longer documents |
| `-v, --voice <file>` | — | A sample of writing whose style the rewrite should copy |
| `-o, --out <file>` | — | Write the result to a file instead of stdout |
| `--stats` | off | Print before/after readability scores to **stderr** |
| `--diff` | off | Print a diff to stdout instead of the text |
| `--no-color` | — | Disable coloured output |
| `-h, --help` | — | Show help |

Grade presets: `elementary` (4), `middle` (7), `high-school` (10), `college` (13), `graduate` (16).

`--strength` controls restructuring, not tone. `light` keeps your sentence and paragraph structure and only fixes word choice and phrasing. `medium` reworks sentences freely but keeps the order of ideas. `heavy` is free to reorganise paragraphs and resequence supporting points.

### Examples

Rewrite for a middle-school reading level and show the scores:

```console
$ unstupid draft.txt --grade middle --stats
  readability           before   after
  grade                   18.0     6.1  target 7.0, off by 0.9 (-11.9)
  reading ease            -8.0    73.8  fairly easy
  words                     44      38
  sentences                  3       3

  machine tells         before   after
  overall /100              21     100  reads human
  rhythm variance          3.8     1.2  too few sentences to score
  stock phrases              5       0
  em-dashes / 1k           0.0     0.0
  transition opens         67%      0%

  facts               4 checked, all preserved
  usage               120 in / 64 out tokens, ~$0.0013
```

See exactly what changed. `--diff` picks its granularity from how much survived — if most sentences came through intact you get a sentence diff, and if the rewrite touched nearly everything you get an inline word diff instead:

```console
$ unstupid draft.txt --diff
--- original
+++ rewritten
  [-removed-] {+added+}
~ [-No-] {+There was no+} API key [-was available-] in the build environment, so
  {+I tested+} the CLI [-was exercised end to end-] against a local mock of the
  messages [-endpoint. That confirmed on-] {+endpoint instead. The mock showed
  what actually went over+} the [-wire that it sends-] {+wire:+} the [-correct-]
  {+right+} model.
```

A sentence diff on a heavy rewrite is just the whole text printed twice, since no sentence survives to align against — hence the fallback. Force either view with `--diff-mode sentence` or `--diff-mode word` if the automatic choice is wrong for you.

### Matching your voice

Grade level controls complexity, not personality. To make the output sound like *you*, point `--voice` at something you wrote:

```console
$ unstupid draft.md --voice ~/notes/my-writing.md
```

The sample is sent as a style reference — sentence rhythm, formality, vocabulary, appetite for fragments, punctuation habits. Its *content* is explicitly off limits; only the manner of writing carries over. Samples are capped at 400 words, which is more than enough to convey a voice without inflating every request.

If your voice and the grade target disagree — a terse style naturally scores lower than its `--grade` — the voice wins and `--stats` reports the grade it actually landed on. That's deliberate: distorting someone's voice to hit a number defeats the point.

Heavy rewrite for a young audience, written to a file:

```console
$ unstupid report.md -g elementary -s heavy -o report.simple.md --stats
```

Because stats and warnings go to stderr, the tool composes cleanly in a pipeline — `--stats` never pollutes the text you're piping onward:

```console
$ unstupid draft.txt --stats | wc -w
$ find drafts -name '*.txt' -exec sh -c 'unstupid "$1" -o "${1%.txt}.clean.txt"' _ {} \;
```

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | API or network error (auth failure, rate limit, timeout, unreachable) |
| `2` | Bad usage, unreadable input, unwritable `--out`, or `ANTHROPIC_API_KEY` not set |

Anything that can be caught before the API call is caught before the API call — a bad `--grade`, an unreadable input file, an unwritable `--out` — so a mistake never costs you a request. If the write somehow fails afterwards anyway, the rewrite is printed to stdout rather than thrown away.

## Notes and limits

**Output length.** The default output budget is `max_tokens: 1000`, roughly 750 words; longer input gets truncated mid-rewrite. Raise it with `--max-tokens` up to 16000 (~12000 words):

```console
$ unstupid long-report.md --max-tokens 8000
```

The tool warns on stderr in both directions — before the call if the input won't fit the budget, and afterwards if the model actually hit the ceiling. Either warning names the flag and the current budget.

16000 is the ceiling because this client is non-streaming and the SDK refuses non-streaming requests it expects to outlive the HTTP timeout. Past that you'd need to split the document; automatic chunking is not built in.

**`--out` overwrites without asking.** Including when the target is the file you're rewriting. `unstupid draft.txt -o draft.txt` replaces `draft.txt` in place with no prompt and no backup, so keep the original in version control if you care about it.

**Reading grade is not the same thing as sounding human.** Flesch-Kincaid has exactly two inputs: sentence length and syllables per word. It cannot see stock phrasing, monotonous rhythm, em-dash overuse, or a transition word welded to the front of every paragraph — which is to say it cannot see any of the things this tool is actually for. Text can score a perfect grade 8 and still read like a chatbot wrote it.

That's why `--stats` reports a second block. The **machine tells** score measures the thing the tool is really trying to fix:

| Signal | What a bad score means |
| --- | --- |
| rhythm variance | Every sentence is the same length. Human writing varies a lot. |
| stock phrases | "delve into", "it is important to note", "a testament to", and about thirty more |
| em-dashes / 1k | Two or three per thousand words is normal. Twelve is a tell. |
| transition opens | Share of sentences starting on "Moreover", "Furthermore", "Therefore"… |

Treat the overall score as a rough signal worth investigating, not a verdict. The thresholds behind it are judgement calls picked by eye, not empirically validated, and a determined writer can score well while still being dull. Rhythm is skipped entirely on texts under five sentences, where sentence-length spread means nothing.

**Facts are checked, but only shallowly.** `--stats` extracts every number, acronym, and proper name from both versions and reports anything that vanished or appeared:

```
  facts               3 checked - MISSING 42, API; NEW 9999
  check the --diff before trusting this rewrite.
```

A dropped or altered figure, or one invented out of nothing, gets caught. What this **cannot** catch is a reversed claim, a dropped qualifier, or a confident sentence turned hedged — meaning is beyond it. A name replaced by a pronoun is reported but not treated as a failure, since that's a legitimate rewrite. For anything where accuracy matters, still read the `--diff`.

**Grade targeting is a request, not a contract.** Claude aims at the level you ask for; it doesn't compute Flesch-Kincaid while writing, and nothing retries when it misses. `--stats` shows you how far off it landed. If it consistently overshoots, ask for a grade or two lower.

**Cost is an estimate.** The figure in `--stats` uses published list prices for the model, ignores any discount on your account, and will drift when prices change. It's there for order of magnitude, not billing.

**Syllable counting is heuristic.** Flesch-Kincaid needs syllable counts, and this uses the standard vowel-group approach with corrections for silent `-e`, `-ed`, and `-es`. It's a good approximation, not a pronunciation dictionary, so unusual words will be off by one now and then. Sentence splitting handles decimals, ellipses, initials (`J. R. R. Tolkien`), and common abbreviations (`Dr.`, `etc.`).

**The spinner gets out of your way.** It draws on stderr only when both stdout and stderr are terminals and `CI` is unset, so it never appears in redirected output or logs. It hides the terminal cursor while running and restores it on exit, including on Ctrl-C — interrupting a request will not leave your terminal in a broken state.

## Library use

The package also works as a dependency:

```ts
import { analyze, humanize, unifiedDiff } from 'unstupid';

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

`npm test` is entirely offline, so the one thing it cannot tell you is whether the prompt produces good rewrites. `scripts/smoke.sh` covers that against the real API — it rewrites a fixture at grades 4, 8, and 13 and reports where each landed, so you can judge quality and grade accuracy by eye. Three API calls, and it needs `ANTHROPIC_API_KEY`:

```console
$ ./scripts/smoke.sh
$ ./scripts/smoke.sh path/to/your-own-draft.txt
```

Layout:

| Path | Purpose |
| --- | --- |
| `src/readability.ts` | Flesch-Kincaid grade and reading ease; pure functions |
| `src/claudeClient.ts` | The Anthropic API call and the system prompt |
| `src/cli.ts` | Argument parsing, I/O, exit codes — the `bin` entry point |
| `src/tells.ts` | Machine-tells scoring; pure functions |
| `src/facts.ts` | Fact-preservation check; pure functions |
| `src/diff.ts` | Sentence- and word-level LCS diff |
| `src/spinner.ts`, `src/colors.ts` | Terminal niceties, both self-disabling |
| `test/` | `node:test` suites, no test framework dependency |
| `scripts/smoke.sh` | Manual check against the real API |

### Design notes

**CommonJS, not ESM.** The compiled output is CommonJS targeting ES2022. The tradeoff: ESM is the better long-term direction and would let the CLI use top-level `await`, but CommonJS avoids the sharp edges that bite a `bin` script — no `.js` extensions required on every relative import, no `__dirname` gap, and no risk of a consumer on an older toolchain being unable to `require()` the library exports. Nothing here needs streaming ESM-only dependencies, so the cost of CommonJS is close to zero. Switching later means setting `"type": "module"`, changing `module` to `node16`, adding extensions to relative imports, and replacing the `require.main === module` guard.

**Two runtime dependencies, deliberately.** `@anthropic-ai/sdk` and `commander`, nothing else. Colour output is about twenty lines of hand-rolled ANSI in `src/colors.ts` rather than a `chalk` dependency: chalk v5 is ESM-only (so it can't be `require`d from this build) and chalk v4 pulls in a small tree of its own. For six styles behind a TTY check, in-tree was the cheaper answer. Tests use the built-in `node:test` runner, so there are no test-framework dev dependencies either.

**Streams are kept separate on purpose.** Rewritten text and diffs go to stdout; stats, warnings, and the spinner go to stderr. That's what makes `unstupid draft.txt --stats | next-tool` behave.

## License

MIT
