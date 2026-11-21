#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}; Q=logs/b27-queue.log; echo "start $(date +%T)" >> $Q
w(){ while ! grep -q GATEDONE $1 2>/dev/null; do sleep 10; done; }
w logs/t27-prodq.log; echo "prodq done $(date +%T)" >> $Q
./runt27L.sh b037 t27-b037.mjs; echo "b037 $(date +%T)" >> $Q
./runt27L.sh b038 t27-b038.mjs; echo "b038 $(date +%T)" >> $Q
export SMOKE_DIST=/tmp/foglight-smoke-dist-b27qa
for k in 1 2 3; do ./runc27.sh s3r$k 'v0.1-batch27-S3' '' 2; echo "s3r$k $(date +%T)" >> $Q; done
echo QDONE1 >> $Q
