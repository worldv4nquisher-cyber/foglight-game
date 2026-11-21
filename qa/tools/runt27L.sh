#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
# $1 tag, $2 script; env passes; one try + one retry on crash/no-chrome
cd ${QA_DIR}; L=logs/t27-$1.log
for t in 1 2; do
  ./memgate.sh >> $L; echo "=== try $t $(date +%T)" >> $L
  setsid timeout 3600 node $2 >> $L 2>&1 & bg=$!; nc=0
  while kill -0 $bg 2>/dev/null; do sleep 10; if pgrep -f "user-data-dir=/tmp/qa-chrome-" >/dev/null; then nc=0; else nc=$((nc+10)); fi
    if [ $nc -ge 90 ]; then echo "WATCHDOG no chrome 90s" >> $L; kill -- -$bg 2>/dev/null; sleep 2; kill -9 -- -$bg 2>/dev/null; break; fi; done
  wait $bg; echo "EXIT $? $(date +%T)" >> $L
  if tail -40 $L | grep -q "WATCHDOG\|targetCrashed\|FAIL\|连接断"; then dmesg -T 2>/dev/null | grep "Killed process" | tail -2 >> $L; continue; fi; break
done; echo GATEDONE >> $L
