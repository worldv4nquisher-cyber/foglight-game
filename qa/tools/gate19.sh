#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
# $1 tag $2 SMOKE_ONLY $3 QUERY $4 maxtries ; waits for avail>=1500 & no other smoke-browser; retries only on renderer crash
cd ${QA_DIR}
for t in $(seq 1 ${4:-3}); do
  for w in $(seq 1 120); do a=$(free -m | awk '/Mem:/{print $7}'); if ! pgrep -f "smoke-browser.mjs" >/dev/null && [ "$a" -ge 1500 ]; then break; fi; sleep 10; done
  echo "try $t $(date +%T) avail $a" >> logs/q19-$1.tries
  ./runq19.sh $1 "$2" "$3"; cp logs/q19-$1.log logs/q19-$1-try$t.log
  grep -q "targetCrashed" logs/q19-$1.log || break
done
echo GATEDONE >> logs/q19-$1.tries
