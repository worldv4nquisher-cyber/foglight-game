#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}
while pgrep -f queue1.sh >/dev/null; do sleep 10; done
./runq.sh a1-014p2 'v0.1-014 part2' art=1
./runq.sh a1-013 'v0.1-013 S1 白盒' art=1
./runq.sh a1-015a 'v0.1-015 S3 白盒' art=1
./runq.sh a1-015b 'v0.1-015 S3 谜题 5' art=1
./runq.sh a1-017s2 'v0.1-017 交互动作 art=1（S2）' art=1
./runq.sh a1-021 'v0.1-021/022' art=1
