#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
# batch25 serial queue: wait check:release → hooks CDP → smoke group → xb firefox → xb webkit
cd ${QA_DIR}; Q=logs/b25-queue.log; echo "start $(date +%T)" >> $Q
while ! grep -q GATEDONE logs/r25-release.log 2>/dev/null; do sleep 15; done; echo "release done $(date +%T)" >> $Q
./runt25L.sh hooks t25-hooks.mjs; echo "hooks $(date +%T)" >> $Q
TMO=4200 ./runc25.sh grp 'v0.1-M7|v0.1-035|v0.1-BUG-035|v0.1-033 配乐' '' 2; echo "grp $(date +%T)" >> $Q
TMO=1500 ./runxb25.sh ff XB_BROWSER=firefox; echo "ff $(date +%T)" >> $Q
TMO=1500 ./runxb25.sh wk XB_BROWSER=webkit; echo "wk $(date +%T)" >> $Q
echo "QDONE $(date +%T)" >> $Q
