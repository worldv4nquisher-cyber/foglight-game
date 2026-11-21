#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}; Q=logs/b35-queue.log
while ! grep -q GATEDONE logs/q24-rerun-v0.1-021.tries 2>/dev/null; do sleep 15; done; echo "rerun 021 done $(date +%T)" >> $Q
TMO=3000 ./runc24.sh full-tail 'v0.1-035|v0.1-M7' '' 1; echo "full-tail $(date +%T)" >> $Q
./runc24.sh rerun2-v0.1-011 'v0.1-011' '' 1; echo "rerun2 011 $(date +%T)" >> $Q
echo "reruns done $(date +%T)" >> $Q
export PW_MODULE=${PW_TOOLS}/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=${PW_BROWSERS}
SMOKE_DEV=1 TMO=900 ./runc35.sh smoke-dev 'BUG-035' '' 1; echo "smoke-dev $(date +%T)" >> $Q
TMO=900 ./runc35.sh smoke-dist 'BUG-035' '' 1; echo "smoke-dist $(date +%T)" >> $Q
TMO=900 ./runxb35.sh px7-dev XB_DEV=1 XB_BROWSER=chromium XB_DEVICE='Pixel 7' XB_CHROMIUM_PATH=/opt/google/chrome/chrome; echo "px7-dev $(date +%T)" >> $Q
TMO=900 ./runxb35.sh ip15-dev XB_DEV=1 XB_BROWSER=webkit XB_DEVICE='iPhone 15'; echo "ip15-dev $(date +%T)" >> $Q
TMO=600 ./runxb35.sh wk-dev XB_DEV=1 XB_BROWSER=webkit; echo "wk-dev $(date +%T)" >> $Q
TMO=900 ./runxb35.sh px7-dist XB_BROWSER=chromium XB_DEVICE='Pixel 7' XB_CHROMIUM_PATH=/opt/google/chrome/chrome; echo "px7-dist $(date +%T)" >> $Q
TMO=900 ./runxb35.sh ip15-dist XB_BROWSER=webkit XB_DEVICE='iPhone 15'; echo "ip15-dist $(date +%T)" >> $Q
TMO=600 ./runxb35.sh wk-dist XB_BROWSER=webkit; echo "wk-dist $(date +%T)" >> $Q
TMO=900 ./runxb35.sh ipad-wk-dist XB_BROWSER=webkit XB_DEVICE='iPad Pro 11'; echo "ipad-wk $(date +%T)" >> $Q
TMO=900 ./runxb35.sh ipad-cr-dist XB_BROWSER=chromium XB_DEVICE='iPad Pro 11' XB_CHROMIUM_PATH=/opt/google/chrome/chrome; echo "ipad-cr $(date +%T)" >> $Q
echo QUEUEDONE >> $Q
