#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
# $1 tag, env passes SHOTS_*
cd ${QA_DIR}; ./memgate.sh >> logs/s20-$1.log
cd snap-f84ee88/game; SHOTS_OUT=docs/bugs/qa-v0.1-batch20/$1 SHOTS_EVAL_MS=900000 SHOTS_STEP_MS=900000 SHOTS_TOTAL_MS=3000000 timeout 3100 node --import ./scripts/register-ts-paths.mjs scripts/shots-035.mjs >> ${QA_DIR}/logs/s20-$1.log 2>&1; echo "EXIT $?" >> ${QA_DIR}/logs/s20-$1.log
