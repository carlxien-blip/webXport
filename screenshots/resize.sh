#!/usr/bin/env bash
# 把任意尺寸图片缩放 + 白底填充成 Chrome Web Store 要求的 1280×800 PNG
#
# 用法：
#   ./screenshots/resize.sh <input.png/jpg> [output.png]
#
# 行为：
#   1. 等比缩放，保证图片完全装进 1280×800（不裁切）
#   2. 不放大，原图小于目标尺寸就保持原尺寸
#   3. 缺的部分用白色 (#FFFFFF) 补齐
#   4. 输出永远是 PNG（Chrome 偏好 PNG）

set -euo pipefail

INPUT="${1:-}"
if [ -z "$INPUT" ] || [ ! -f "$INPUT" ]; then
  echo "Usage: $0 <input> [output]"
  exit 1
fi

OUTPUT="${2:-${INPUT%.*}-1280x800.png}"
PAD_COLOR="${PAD_COLOR:-FFFFFF}"

w=$(sips -g pixelWidth "$INPUT" 2>/dev/null | tail -1 | awk '{print $2}')
h=$(sips -g pixelHeight "$INPUT" 2>/dev/null | tail -1 | awk '{print $2}')

# 等比缩放 scale = min(1280/w, 800/h)，× 1000 保精度
sw=$((1280000 / w))
sh=$((800000 / h))
s=$([ $sw -lt $sh ] && echo $sw || echo $sh)
[ $s -gt 1000 ] && s=1000  # 不放大

nw=$((w * s / 1000))
nh=$((h * s / 1000))

TMP=$(mktemp -t webxport-resize-XXXXXX.png)
sips --resampleHeightWidth "$nh" "$nw" "$INPUT" --out "$TMP" > /dev/null
sips -p 800 1280 --padColor "$PAD_COLOR" "$TMP" --out "$OUTPUT" > /dev/null
rm -f "$TMP"

# 校验输出
ow=$(sips -g pixelWidth "$OUTPUT" 2>/dev/null | tail -1 | awk '{print $2}')
oh=$(sips -g pixelHeight "$OUTPUT" 2>/dev/null | tail -1 | awk '{print $2}')
echo "✓ ${OUTPUT} (${ow}×${oh})"
