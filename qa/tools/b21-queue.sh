#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}
while ! grep -q ALLREFL logs/t21-refl-all.log 2>/dev/null; do sleep 10; done
./runt21L.sh cam-gap t21-cam.mjs
PART=A ./runt21L.sh cam-reg-A t21-camreg.mjs
PART=B ./runt21L.sh cam-reg-B t21-camreg.mjs
./runt21L.sh s3fade t21-s3fade.mjs
./runp21.sh load; ./runp21.sh memory; ./runp21.sh budget
./runc21.sh 010 'v0.1-010 场景流程' '' 2
./runc21.sh 015 'v0.1-015 S3' 'art=1' 2
./runc21.sh 033a 'v0.1-033 配乐：主菜单' '' 2
./runc21.sh 033b 'v0.1-033 懒加载失败' '' 2
./runc21.sh 035a 'v0.1-035 结尾演出 art=1' '' 2
./runc21.sh 035b '跳过 art=1' '' 2
./runc21.sh 035c '后备时钟 art=0' '' 2
./runc21.sh 035d '结尾曲晚到' '' 2
./runc21.sh 035e '结尾曲下载失败' '' 2
echo QUEUEDONE >> logs/b21-queue.log
