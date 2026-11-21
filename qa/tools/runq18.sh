#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
# $1 tag  $2 SMOKE_ONLY  $3 SMOKE_QUERY
cd ${QA_DIR}/snap-fe19ab7/game
before=$(ls -d /tmp/smoke-chrome-* 2>/dev/null | sort)
SMOKE_ESTAB_TIMEOUT_MS=${SMOKE_ESTAB_TIMEOUT_MS:-600000} SMOKE_LOAD_TIMEOUT_MS=${SMOKE_LOAD_TIMEOUT_MS:-600000} SMOKE_QUERY="$3" SMOKE_ONLY="$2" timeout 2400 npm run smoke > ${QA_DIR}/logs/q18-$1.log 2>&1; echo "EXIT $?" >> ${QA_DIR}/logs/q18-$1.log
sleep 1
inuse=$(pgrep -af "user-data-dir=/tmp/" | grep -o "user-data-dir=/tmp/[^ ]*" | sed 's#user-data-dir=##' | sort -u)
for d in $(ls -d /tmp/smoke-chrome-* 2>/dev/null); do echo "$before" | grep -qx "$d" && continue; echo "$inuse" | grep -qx "$d" || rm -rf "$d"; done
${QA_DIR}/clean18.sh
