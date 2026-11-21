#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}
while ! grep -q QUEUEDONE logs/b22-queue.log 2>/dev/null; do sleep 10; done
TAG=-b ./runt22L.sh mem-b t22-mem.mjs
TAG=-std START=standard SC=s1,s3 SEQ=ultra,high,standard NOSHOT=1 ./runt22L.sh mip-std t22-mip.mjs
./runc22x.sh 015x 'v0.1-015 S3 谜题 5' 'art=1' 1
./runc22x.sh 035ax 'v0.1-035 结尾演出 art=1' '' 1
./runc22x.sh 035bx '跳过 art=1' '' 1
./runc22x.sh 035cx '后备时钟 art=0' '' 1
./runc22x.sh 035dx '结尾曲晚到' '' 1
./runc22x.sh 035ex '结尾曲下载失败' '' 1
echo QUEUE2DONE >> logs/b22-queue2.log
