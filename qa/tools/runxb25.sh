#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
# $1 tag; rest: env assignments (XB_BROWSER=.. XB_QUERY=..). one run, one retry on crash
cd ${QA_DIR}; tag=$1; shift; L=logs/x25-$tag.log; : > $L
for t in 1 2; do
  for w in $(seq 1 120); do a=$(free -m | awk '/Mem:/{print $7}'); if ! pgrep -f "smoke-browser.mjs|smoke-xbrowser.mjs|user-data-dir=/tmp/qa-chrome-" >/dev/null && [ "$a" -ge 1500 ]; then break; fi; sleep 10; done
  echo "=== try $t $(date +%T) avail $a" >> $L
  before=$(ls -d /tmp/playwright* /tmp/m7-xb-* 2>/dev/null | sort)
  mkdir -p ${REPO_ROOT}/docs/bugs/qa-v0.1-batch25/xb/$tag
  ( cd snap-81cfd8f/game && env PW_MODULE=${PW_TOOLS}/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=${PW_BROWSERS} XB_SHOTS=${REPO_ROOT}/docs/bugs/qa-v0.1-batch25/xb/$tag XB_KEEP_SHOTS=1 "$@" setsid timeout ${TMO:-1500} npm run smoke:xb ) >> $L 2>&1; rc=$?
  echo "EXIT $rc $(date +%T)" >> $L; sleep 2; echo "foglight-dirs-after: $(ls -d /tmp/foglight-smoke-dist-* 2>/dev/null | tr "\n" " ")" >> $L
  sleep 2; for d in $(ls -d /tmp/playwright* /tmp/m7-xb-* 2>/dev/null); do echo "$before" | grep -qx "$d" && continue; pgrep -f "$d" >/dev/null || rm -rf "$d"; done
  tail -30 $L | grep -qiE "crash|Killed|EXIT 137|out of memory" || break
done; echo GATEDONE >> $L
