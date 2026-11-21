#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}
while ! grep -q QUEUEDONE logs/b21-queue.log 2>/dev/null; do sleep 15; done
./runt21L.sh cam-fine t21-camfine.mjs
echo Q2DONE >> logs/b21-queue2.log
