#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}; Q=logs/b24-queue.log
while ! grep -q GATEDONE logs/r24-release.log; do sleep 15; done; echo "release done $(date +%T)" >> $Q
./runc24.sh m7 'v0.1-M7' '' 2; echo "m7 $(date +%T)" >> $Q
./runc24.sh 009 'v0.1-009' '' 2; echo "009 $(date +%T)" >> $Q
./runc24.sh 035 'v0.1-035' '' 2; echo "035 $(date +%T)" >> $Q
QA24_MODE=nogame ./runc24b.sh busnogame 'QA24 busread' '' 1; QA24_MODE=nan ./runc24b.sh busnan 'QA24 busread' '' 1; QA24_MODE=hang ./runc24b.sh bushang 'QA24 busread' '' 1; echo "bus $(date +%T)" >> $Q
./runt24L.sh hooks t24-hooks.mjs; DEV=1 ./runt24L.sh hooksdev t24-hooks.mjs; echo "hooks $(date +%T)" >> $Q
TMO=1200 ./runxb24.sh ff-art1 XB_BROWSER=firefox XB_QUERY=art=1; echo "ff $(date +%T)" >> $Q
TMO=600 ./runxb24.sh wk XB_BROWSER=webkit; echo "wk $(date +%T)" >> $Q
TMO=900 ./runxb24.sh wk-art1 XB_BROWSER=webkit XB_QUERY=art=1 XB_AUDIO_DECODE=reject; echo "wk-art1 $(date +%T)" >> $Q
echo QUEUEDONE >> $Q
