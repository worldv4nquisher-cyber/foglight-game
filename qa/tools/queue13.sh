#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}
./runq13.sh 019 'v0.1-019'
./runq13.sh 010 'v0.1-010 场景流程'
./runq13.sh 013 'v0.1-013 S1 白盒'
./runq13.sh 014a0 'v0.1-014 S2 白盒'
./runq13.sh 014a1 'v0.1-014 S2 白盒' art=1
./runq13.sh 014p2 'v0.1-014 part2'
./runq13.sh 015a 'v0.1-015 S3 白盒'
./runq13.sh 015b 'v0.1-015 S3 谜题 5'
./runq13.sh 017s2 'v0.1-017 交互动作 art=1（S2）'
./runq13.sh 017s13 'v0.1-017 交互动作 art=1（S1'
./runq13.sh 021 'v0.1-021/022'
