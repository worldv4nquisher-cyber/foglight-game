#!/usr/bin/env bash
# PNG → KTX2（v0.1 美术交付规范 §5.7）
# 用法：art/tools/tex-to-ktx2.sh [--hq] <输入.png>... [-o 输出目录]
#   按文件名后缀决定编码：
#     *-albedo / *-emissive / *-ui*  → sRGB，ETC1S（--hq 时 UASTC）
#     *-normal                       → 线性，UASTC（不用 --normal-mode：那会存成 RRRG 两通道，
#                                      three 的 normalMap 直接读 rgb，会把法线读坏）
#     *-orm / *-ramp / *-sdf-face / *-lightmap / 其他 → 线性，UASTC
#   全部生成 mipmap，UASTC 再加 zstd 18 超压缩。
#   优先用 KTX-Software 4.3+ 的 `ktx create`，没有就用旧的 `toktx`。
#   默认输出到 art/textures/。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../textures"
HQ=0
FILES=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --hq) HQ=1; shift ;;
    -o) OUT="$2"; shift 2 ;;
    *) FILES+=("$1"); shift ;;
  esac
done
[[ ${#FILES[@]} -gt 0 ]] || { echo "用法: $0 [--hq] a.png b.png ... [-o 目录]"; exit 1; }
mkdir -p "$OUT"
if command -v ktx >/dev/null; then TOOL=ktx; elif command -v toktx >/dev/null; then TOOL=toktx; else
  echo "缺少 KTX-Software（ktx 或 toktx），见 art/tools/README.md"; exit 1; fi

for f in "${FILES[@]}"; do
  base="$(basename "$f" .png)"; dst="$OUT/$base.ktx2"
  case "$base" in
    *-albedo|*-emissive|ui-*) kind=color ;;
    *-normal) kind=normal ;;
    *) kind=data ;;
  esac
  if [[ $TOOL == ktx ]]; then
    case $kind in
      color) if [[ $HQ == 1 ]]; then enc=(--encode uastc --uastc-quality 2 --zstd 18); else enc=(--encode basis-lz --clevel 4 --qlevel 255); fi
             ktx create --format R8G8B8A8_SRGB --assign-tf srgb --generate-mipmap "${enc[@]}" "$f" "$dst" ;;
      normal) ktx create --format R8G8B8A8_UNORM --assign-tf linear --generate-mipmap --encode uastc --uastc-quality 2 --zstd 18 "$f" "$dst" ;;
      data)   ktx create --format R8G8B8A8_UNORM --assign-tf linear --generate-mipmap --encode uastc --uastc-quality 2 --zstd 18 "$f" "$dst" ;;
    esac
  else
    case $kind in
      color) if [[ $HQ == 1 ]]; then enc=(--encode uastc --uastc_quality 2 --zcmp 18); else enc=(--encode etc1s --clevel 4 --qlevel 255); fi
             toktx --t2 --genmipmap --assign_oetf srgb "${enc[@]}" "$dst" "$f" ;;
      normal) toktx --t2 --genmipmap --assign_oetf linear --encode uastc --uastc_quality 2 --zcmp 18 "$dst" "$f" ;;
      data)   toktx --t2 --genmipmap --assign_oetf linear --encode uastc --uastc_quality 2 --zcmp 18 "$dst" "$f" ;;
    esac
  fi
  printf '%-48s %-6s %s\n' "$base.ktx2" "$kind" "$(du -h "$dst" | cut -f1)"
done
