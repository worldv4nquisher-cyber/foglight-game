#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}
./runq12.sh 014p2 'v0.1-014 part2'
./runq12.sh a1-014p2 'v0.1-014 part2' art=1
./runq12.sh 017s2 'v0.1-017 交互动作 art=1（S2）'
./runq12.sh 017s13 'v0.1-017 交互动作 art=1（S1'
./runq12.sh a1-014 'v0.1-014 S2 白盒' art=1
