#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}
while [ ! -f logs/q20a.done ]; do sleep 20; done
./runt20.sh boost t20-boost.mjs
./runc20.sh 015 'v0.1-015 S3' 'art=1' 2
./runc20.sh 035a 'v0.1-035 结尾演出 art=1' '' 2
./runc20.sh 035b 'v0.1-035 跳过 art=1' '' 2
./runc20.sh 035c 'v0.1-035 后备时钟 art=0' '' 2
./runc20.sh 035d 'v0.1-035 结尾曲晚到' '' 2
./runc20.sh 035e 'v0.1-035 结尾曲下载失败' '' 2
./runc20.sh 010 'v0.1-010 场景流程' '' 2
./runc20.sh 033a 'v0.1-033 配乐：主菜单' '' 2
./runc20.sh 033b 'v0.1-033 懒加载失败' '' 2
echo Q20B-DONE > logs/q20b.done
