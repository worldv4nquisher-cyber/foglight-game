#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}; Q=logs/b28b-queue.log
until grep -q QDONE $Q; do sleep 20; done
TMO=2400 ./runc28.sh r013b 'v0.1-013 S1 白盒' '' 2; echo "r013b $(date '+%m-%d %T')" >> $Q
TMO=2400 ./runc28.sh r021b 'v0.1-021/022' '' 2; echo "r021b $(date '+%m-%d %T')" >> $Q
TMO=2400 ./runc28.sh r035e 'v0.1-035 结尾演出 art=1' '' 2; echo "r035e $(date '+%m-%d %T')" >> $Q
echo QDONE3 >> $Q
