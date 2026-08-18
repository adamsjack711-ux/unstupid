#!/usr/bin/env bash
#
# Smoke test against the real Claude API.
#
# Everything in `npm test` runs offline, which means the one thing it cannot
# check is whether the prompt actually produces good rewrites that land near the
# requested grade level. This script does that: it rewrites a fixture at three
# grade levels and reports where each one landed.
#
# Costs three API calls. Requires ANTHROPIC_API_KEY.
#
#   ./scripts/smoke.sh
#   ./scripts/smoke.sh path/to/your-own-draft.txt

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "ANTHROPIC_API_KEY is not set." >&2
  echo "Get a key at https://console.anthropic.com/settings/keys, then:" >&2
  echo "  export ANTHROPIC_API_KEY=sk-ant-..." >&2
  exit 2
fi

if [[ ! -f dist/cli.js ]]; then
  echo "==> building"
  npm run build >/dev/null
fi

INPUT="${1:-}"
CLEANUP=""
if [[ -z "$INPUT" ]]; then
  INPUT="$(mktemp)"
  CLEANUP="$INPUT"
  cat > "$INPUT" <<'FIXTURE'
In today's rapidly evolving digital landscape, it is important to note that
organizations must navigate the complexities of data governance frameworks.
Moreover, the implementation of comprehensive compliance mechanisms is a
testament to institutional commitment. Furthermore, stakeholders should delve
into the multifaceted considerations that underpin these strategic initiatives.
It is worth noting that the ramifications of inadequate governance extend
across numerous operational domains, thereby necessitating a holistic approach.
FIXTURE
fi
trap '[[ -n "$CLEANUP" ]] && rm -f "$CLEANUP"' EXIT

echo "==> input: $INPUT"
echo
node -e '
const {analyze} = require("./dist/readability");
const s = analyze(require("fs").readFileSync(process.argv[1], "utf8"));
console.log(`    baseline: grade ${s.grade}, ease ${s.ease}, ${s.words} words`);
' "$INPUT"

status=0
for grade in 4 8 13; do
  echo
  echo "======================================================================"
  echo "==> --grade $grade"
  echo "======================================================================"
  if out=$(node dist/cli.js "$INPUT" --grade "$grade" --stats 2>&1 >/dev/null); then
    echo "$out"
  else
    echo "FAILED (exit $?)" >&2
    echo "$out" >&2
    status=1
    continue
  fi
  echo
  echo "--- rewrite ---"
  node dist/cli.js "$INPUT" --grade "$grade" 2>/dev/null
done

echo
echo "======================================================================"
echo "==> --diff at grade 8"
echo "======================================================================"
node dist/cli.js "$INPUT" --grade 8 --diff 2>/dev/null || status=1

echo
if [[ $status -eq 0 ]]; then
  echo "Smoke test finished. Check by eye:"
  echo "  * does each 'after' grade land near its target?"
  echo "  * do the rewrites read like a person wrote them?"
  echo "  * are all the facts from the original still present?"
else
  echo "Smoke test hit at least one failure — see above." >&2
fi
exit $status
