#!/bin/bash
QA_DIR="${QA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"; REPO_ROOT="${REPO_ROOT:-$(cd "$QA_DIR/../.." && pwd)}"; PW_TOOLS="${PW_TOOLS:-$REPO_ROOT/../pw-tools}"; PW_BROWSERS="${PW_BROWSERS:-$REPO_ROOT/../pw-browsers}"; export QA_DIR REPO_ROOT PW_TOOLS PW_BROWSERS  # 路径见 qa/README.md
# run one smoke, append result line to md
tag=$1; name=$2; q=$3; label=$4
./runq14.sh "$tag" "$name" "$q"
L=logs/q14-$tag.log
ex=$(grep -o "EXIT [0-9]*" $L | tail -1)
nok=$(grep -c "^  ✓" $L); nbad=$(grep -c "✗" $L)
res=PASS; [ "$ex" != "EXIT 0" ] && res=FAIL
echo "- $label（q14-$tag.log）：$ex，**$res**（✓ 行 $nok，✗ 行 $nbad）" >> ${REPO_ROOT}/docs/bugs/qa-v0.1-batch14.md
echo "$label $ex ok=$nok bad=$nbad"; grep "✗" $L | cut -c1-300 | head -5
