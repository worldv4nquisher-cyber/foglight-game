#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}/snap-1d5405b/game
SMOKE_ESTAB_TIMEOUT_MS=${SMOKE_ESTAB_TIMEOUT_MS:-600000} SMOKE_LOAD_TIMEOUT_MS=${SMOKE_LOAD_TIMEOUT_MS:-600000} SMOKE_QUERY="$3" SMOKE_ONLY="$2" timeout 2400 npm run smoke > ${QA_DIR}/logs/q17-$1.log 2>&1; echo "EXIT $?" >> ${QA_DIR}/logs/q17-$1.log
${QA_DIR}/clean17.sh
