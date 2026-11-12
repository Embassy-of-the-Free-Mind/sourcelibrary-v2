#!/usr/bin/env bash
# Renders a plate (SVG or HTML) to PNG with headless Chromium, EB Garamond loaded from ../fonts.
# Usage: bash plates/render.sh <in.svg> <out.png> <width> <height>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CHROME="${CHROME:-$(ls -d /root/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell | tail -1)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cat > "$T/p.html" <<HTML
<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:"EB Garamond";font-style:normal;src:url(file://$HERE/../fonts/EBGaramond-Regular.ttf)}
@font-face{font-family:"EB Garamond";font-style:italic;src:url(file://$HERE/../fonts/EBGaramond-Italic.ttf)}
html,body{margin:0;background:transparent}svg{display:block}</style>
$(cat "$1")
HTML
"$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars --default-background-color=00000000 --window-size="$3,$4" --screenshot="$2" "file://$T/p.html" >/dev/null 2>&1
echo "$2"
