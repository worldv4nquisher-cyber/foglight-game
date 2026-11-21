#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}; Q=logs/b27-queue.log
while ! grep -q QDONE1 $Q; do sleep 10; done
./runt27L.sh fsdpr t27-fsdpr.mjs; echo "fsdpr $(date +%T)" >> $Q
TMO=2400 ./runc27n.sh b038 'BUG-038' '' 2; echo "b038smoke $(date +%T)" >> $Q
TMO=7200 ./runc27n.sh full '' '' 2; echo "full $(date +%T)" >> $Q
./runxb27n.sh ff XB_BROWSER=firefox XB_QUERY=art=1; echo "xb-ff $(date +%T)" >> $Q
./runxb27n.sh wk XB_BROWSER=webkit; echo "xb-wk $(date +%T)" >> $Q
./runrel27n.sh; echo "release $(date +%T)" >> $Q
echo QDONE2 >> $Q
