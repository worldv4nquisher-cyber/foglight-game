#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}
./r15a.sh 010 'v0.1-010' '' 'smoke 010'
./r15a.sh 013a0 'v0.1-013 S1 白盒' '' 'smoke 013 art=0'
./r15a.sh 013a1 'v0.1-013 S1 白盒' 'art=1' 'smoke 013 art=1'
./r15a.sh 014a1 'v0.1-014 S2 白盒' 'art=1' 'smoke 014 art=1'
./r15a.sh 015a1 'v0.1-015 S3 白盒' 'art=1' 'smoke 015 art=1'
./r15a.sh 017 'v0.1-017' '' 'smoke 017'
./r15a.sh 019 'v0.1-019' '' 'smoke 019 sample-317'
./r15a.sh 021 'v0.1-021/022' '' 'smoke 021/022'
echo CHAIN-DONE
