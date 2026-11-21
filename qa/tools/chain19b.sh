#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}
./gate19.sh 015 'v0.1-015' 'art=1' 4
./gate19.sh 035 'v0.1-035' '' 3
./gate19.sh 010 'v0.1-010 场景流程' '' 3
./gate19.sh 033 'v0.1-033' '' 3
echo CHAINDONE > logs/chain19.done
