#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
cd ${QA_DIR}
for c in "default high" "0 high" "0.5 high" "1 high" "default ultra" "default standard"; do set -- $c
  RK=$1 RQ=$2 ./runt21.sh refl-$1-$2 t21-reflect.mjs; done
echo ALLREFL >> logs/t21-refl-all.log
