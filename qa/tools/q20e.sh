#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}
while [ ! -f logs/q20c.done ]; do sleep 20; done
mv logs/t20-rock.log logs/t20-rock.v1.log 2>/dev/null
./runt20.sh rock t20-rock.mjs
SEABED=1 TAG=2 NOFIX=1 START='5, 0.6, -8.62' ROUTE='[[12.5, -8.62], [13.6, -7.6], [12.5, -8.62], [5, -8.62]]' ./runt20.sh sand2 t20-sand.mjs
echo done > logs/q20e.done
