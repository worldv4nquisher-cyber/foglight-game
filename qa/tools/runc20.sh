#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
# $1 tag $2 SMOKE_ONLY $3 QUERY $4 tries — one case per run; watchdog: kill if smoke-browser has no chrome child for 90 s (renderer/browser died)
cd ${QA_DIR}
for t in $(seq 1 ${4:-3}); do
  for w in $(seq 1 120); do a=$(free -m | awk '/Mem:/{print $7}'); if ! pgrep -f "smoke-browser.mjs" >/dev/null && [ "$a" -ge 1500 ]; then break; fi; sleep 10; done
  echo "try $t $(date +%T) avail $a" >> logs/q20-$1.tries
  before=$(ls -d /tmp/smoke-chrome-* 2>/dev/null | sort)
  ( cd snap-f84ee88/game && SMOKE_ESTAB_TIMEOUT_MS=${SMOKE_ESTAB_TIMEOUT_MS:-180000} SMOKE_LOAD_TIMEOUT_MS=${SMOKE_LOAD_TIMEOUT_MS:-120000} SMOKE_QUERY="$3" SMOKE_ONLY="$2" exec setsid timeout 2400 npm run smoke > ${QA_DIR}/logs/q20-$1.log 2>&1 ) &
  bg=$!; nochrome=0
  while kill -0 $bg 2>/dev/null; do
    sleep 10
    mine=$(ls -d /tmp/smoke-chrome-* 2>/dev/null | sort | comm -13 <(echo "$before") - | head -1)
    if [ -n "$mine" ] && ! pgrep -f "user-data-dir=$mine" >/dev/null; then nochrome=$((nochrome+10)); else nochrome=0; fi
    if [ $nochrome -ge 90 ]; then echo "WATCHDOG: chrome gone 90s, killing" >> logs/q20-$1.log; kill -- -$bg 2>/dev/null; fi
  done
  wait $bg; echo "EXIT $?" >> logs/q20-$1.log
  sleep 1; inuse=$(pgrep -af "user-data-dir=/tmp/" | grep -o "user-data-dir=/tmp/[^ ]*" | sed 's#user-data-dir=##' | sort -u)
  for d in $(ls -d /tmp/smoke-chrome-* 2>/dev/null); do echo "$before" | grep -qx "$d" && continue; echo "$inuse" | grep -qx "$d" || rm -rf "$d"; done
  cp logs/q20-$1.log logs/q20-$1-try$t.log
  grep -qE "targetCrashed|WATCHDOG" logs/q20-$1.log || break
done
echo GATEDONE >> logs/q20-$1.tries
