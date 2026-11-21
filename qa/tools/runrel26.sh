#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
# check:release on snapshot, outputs → batch26/perf; one retry on crash
cd ${QA_DIR}; L=logs/r26-release.log; P=${REPO_ROOT}/docs/bugs/qa-v0.1-batch26/perf
for t in 1 2; do
  ./memgate.sh >> $L; echo "=== try $t $(date +%T)" >> $L
  before=$(ls -d /tmp/smoke-chrome-* 2>/dev/null | sort)
  ( cd snap-32455f3/game && BUDGET_OUT=$P LOAD_OUT=$P MEMORY_OUT=$P exec setsid timeout 5400 npm run check:release ) >> $L 2>&1; rc=$?
  echo "EXIT $rc $(date +%T)" >> $L; echo "foglight-dirs-after: $(ls -d /tmp/foglight-smoke-dist-* 2>/dev/null | tr "\n" " ")" >> $L
  sleep 1; inuse=$(pgrep -af "user-data-dir=/tmp/" | grep -o "user-data-dir=/tmp/[^ ]*" | sed 's#user-data-dir=##' | sort -u)
  for d in $(ls -d /tmp/smoke-chrome-* 2>/dev/null); do echo "$before" | grep -qx "$d" && continue; echo "$inuse" | grep -qx "$d" || rm -rf "$d"; done
  if tail -40 $L | grep -q "targetCrashed\|看门狗\|Killed\|ECONNRESET\|Target closed\|EXIT 124\|EXIT 137"; then dmesg -T 2>/dev/null | grep "Killed process" | tail -2 >> $L; continue; fi; break
done; echo GATEDONE >> $L
