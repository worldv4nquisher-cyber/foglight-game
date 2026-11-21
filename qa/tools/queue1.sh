#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}
./runq.sh 010 'v0.1-010 场景流程'
./runq.sh 005 'v0.1-005 字幕'
./runq.sh 007 'v0.1-007 三级提示'
./runq.sh 011 'v0.1-011 潮汐'
./runq.sh 012 'v0.1-012 光路'
./runq.sh 013 'v0.1-013 S1 白盒'
./runq.sh 014 'v0.1-014 S2 白盒'
./runq.sh 017s2 'v0.1-017 交互动作 art=1（S2）'
./runq.sh 017s13 'v0.1-017 交互动作 art=1（S1'
./runq.sh 015a 'v0.1-015 S3 白盒'
./runq.sh 015b 'v0.1-015 S3 谜题 5'
./runq.sh 021 'v0.1-021/022'
