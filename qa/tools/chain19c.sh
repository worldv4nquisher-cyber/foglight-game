#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}
runjs() { # tag script env
  for t in 1 2 3; do ./memgate.sh; env $3 timeout 1800 node $2 > logs/t19-$1-try$t.log 2>&1; echo "EXIT $?" >> logs/t19-$1-try$t.log; ./clean18.sh
    grep -q "^DONE" logs/t19-$1-try$t.log && ! grep -qiE "crash|Target closed|ECONNRESET|socket" logs/t19-$1-try$t.log && break; done; }
runjs 015a t19-015a.mjs X=1
runjs 015b t19-015b.mjs ART=1
./runc19.sh 035a 'v0.1-035 结尾演出 art=1' '' 3
./runc19.sh 035b 'v0.1-035 跳过 art=1' '' 3
./runc19.sh 035c 'v0.1-035 后备时钟 art=0' '' 3
./runc19.sh 035d 'v0.1-035 结尾曲晚到' '' 3
./runc19.sh 035e 'v0.1-035 结尾曲下载失败' '' 3
./runc19.sh 010 'v0.1-010 场景流程' '' 3
./runc19.sh 033a 'v0.1-033 配乐：主菜单' '' 3
./runc19.sh 033b 'v0.1-033 懒加载失败' '' 3
echo CHAINDONE > logs/chain19.done
