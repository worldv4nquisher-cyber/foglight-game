#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}; Q=logs/b27-queue.log
while ! grep -q QDONE3 $Q; do sleep 10; done
TMO=2400 ./runc27n.sh r017 'v0.1-017 交互动作 art=1' '' 2; echo "r017 $(date +%T)" >> $Q
TMO=2400 ./runc27n.sh r035 'v0.1-035 结尾曲晚到 art=1' '' 2; echo "r035 $(date +%T)" >> $Q
echo QDONE4 >> $Q
