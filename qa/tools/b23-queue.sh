#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}
while ! grep -q GATEDONE logs/r23-release.log 2>/dev/null; do sleep 10; done
./runt23L.sh ramp t23-ramp.mjs
./runt23L.sh bus t23-bus.mjs
./runc23.sh 015 'v0.1-015 S3' 'art=1' 2
./runc23.sh 035a 'v0.1-035 结尾演出 art=1' '' 2
./runc23.sh 035b '跳过 art=1' '' 2
./runc23.sh 035c '后备时钟 art=0' '' 2
./runc23.sh 035d '结尾曲晚到' '' 2
./runc23.sh 035e '结尾曲下载失败' '' 2
./runc23b.sh busthrow 'QA23 bus-throw' '' 1
./runc23b.sh bussilent 'QA23 bus-silent' '' 1
./runc23.sh 010 'v0.1-010 场景流程' '' 2
./runc23.sh 033a 'v0.1-033 配乐：主菜单' '' 2
./runc23.sh 033b 'v0.1-033 懒加载失败' '' 2
./runt23L.sh quick t23-quick.mjs
./runt23L.sh pen t23-pen.mjs
echo QUEUEDONE >> logs/b23-queue.log
