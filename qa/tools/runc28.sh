#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
# batch27：$1 tag $2 SMOKE_ONLY $3 QUERY $4 tries(默认 2 = 1 次 + OOM 重试 1 次)。快照 snap-fcd796a；SMOKE_DIST 若设则复用测试构建
# 只开一个 Chrome：等没有我的 smoke / xb / qa-chrome 且可用 ≥1500 MB；崩溃看门狗 90 s。不删任何 /tmp 目录（结束统一清 qa-chrome-* / foglight-smoke-dist-*）
cd ${QA_DIR}
for t in $(seq 1 ${4:-2}); do
  for w in $(seq 1 540); do a=$(free -m | awk '/Mem:/{print $7}'); if ! pgrep -f "smoke-browser.mjs|smoke-xbrowser.mjs|check:release|user-data-dir=/tmp/qa-chrome-" >/dev/null && [ "$a" -ge 1500 ]; then break; fi; sleep 10; done
  echo "try $t $(date +%T) avail $a" >> logs/q28-$1.tries
  before=$(ls -d /tmp/smoke-chrome-* 2>/dev/null | sort)
  ( cd snap-fcd796a/game && SMOKE_ESTAB_TIMEOUT_MS=${SMOKE_ESTAB_TIMEOUT_MS:-180000} SMOKE_LOAD_TIMEOUT_MS=${SMOKE_LOAD_TIMEOUT_MS:-120000} SMOKE_QUERY="$3" SMOKE_ONLY="$2" exec setsid timeout ${TMO:-2400} npm run smoke > ${QA_DIR}/logs/q28-$1.log 2>&1 ) &
  bg=$!; nochrome=0
  while kill -0 $bg 2>/dev/null; do
    sleep 10
    mine=$(ls -d /tmp/smoke-chrome-* 2>/dev/null | sort | comm -13 <(echo "$before") - | head -1)
    if [ -n "$mine" ] && ! pgrep -f "user-data-dir=$mine" >/dev/null; then nochrome=$((nochrome+10)); else nochrome=0; fi
    if [ $nochrome -ge 90 ]; then echo "WATCHDOG: chrome gone 90s, killing" >> logs/q28-$1.log; kill -- -$bg 2>/dev/null; fi
  done
  wait $bg; echo "EXIT $? $(date +%T)" >> logs/q28-$1.log
  cp logs/q28-$1.log logs/q28-$1-try$t.log
  if grep -qE "targetCrashed|WATCHDOG" logs/q28-$1.log; then dmesg -T 2>/dev/null | grep "Killed process" | tail -2 >> logs/q28-$1.tries; continue; fi; break
done
echo GATEDONE >> logs/q28-$1.tries
