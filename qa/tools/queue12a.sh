#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}
./runq12.sh 019 'v0.1-019'
./runq12.sh 010 'v0.1-010 场景流程'
./runq12.sh 013 'v0.1-013 S1 白盒'
./runq12.sh 014 'v0.1-014 S2 白盒'
./runq12.sh 015a 'v0.1-015 S3 白盒'
./runq12.sh 015b 'v0.1-015 S3 谜题 5'
./runq12.sh 021 'v0.1-021/022'
