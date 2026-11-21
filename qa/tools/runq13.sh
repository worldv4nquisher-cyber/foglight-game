#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
# usage: runq.sh tag "SMOKE_ONLY" [SMOKE_QUERY]
cd ${QA_DIR}/snap-03130cc/game
SMOKE_QUERY="$3" SMOKE_ONLY="$2" timeout 2400 npm run smoke > ${QA_DIR}/logs/q13-$1.log 2>&1; echo "EXIT $?" >> ${QA_DIR}/logs/q13-$1.log
