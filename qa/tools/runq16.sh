#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}/snap-8ccd2b0/game
QA_EXPLORE_MS=${QA_EXPLORE_MS:-60000} SMOKE_QUERY="$3" SMOKE_ONLY="$2" timeout 2400 npm run smoke > ${QA_DIR}/logs/q16-$1.log 2>&1; echo "EXIT $?" >> ${QA_DIR}/logs/q16-$1.log
${QA_DIR}/clean16.sh
