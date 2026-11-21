#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}
./runt20.sh pen-full t20-pen.mjs
SKIP=1 ./runt20.sh pen-skip t20-pen.mjs
SHOTS_PEN=1 ./runshots20.sh pen
for m in default off 0.25 0.5 1; do MODE=$m ./runt20.sh reflect-$m t20-reflect.mjs; done
MODE=default RQ=standard ./runt20.sh reflect-default-std t20-reflect.mjs
SEABED=0 ./runt20.sh sand0 t20-sand.mjs
SEABED=1 ./runt20.sh sand1 t20-sand.mjs
./runt20.sh rock t20-rock.mjs
echo Q20A-DONE > logs/q20a.done
