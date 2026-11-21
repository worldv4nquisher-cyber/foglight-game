#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}; Q=logs/b28b-queue.log; echo "start $(date '+%m-%d %T')" >> $Q
./runrel28b.sh; echo "release $(date '+%m-%d %T')" >> $Q
TMO=7200 ./runc28.sh full2 '' '' 2; echo "full2 $(date '+%m-%d %T')" >> $Q
./runxb28.sh ff2 XB_BROWSER=firefox XB_QUERY=art=1; echo "xb-ff2 $(date '+%m-%d %T')" >> $Q
./runxb28.sh wk2 XB_BROWSER=webkit; echo "xb-wk2 $(date '+%m-%d %T')" >> $Q
TMO=2400 ./runc28.sh r017b 'v0.1-017 交互动作 art=1' '' 2; echo "r017b $(date '+%m-%d %T')" >> $Q
TMO=2400 ./runc28.sh r035b 'v0.1-035 结尾曲晚到 art=1' '' 2; echo "r035b $(date '+%m-%d %T')" >> $Q
echo QDONE >> $Q
