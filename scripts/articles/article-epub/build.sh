#!/usr/bin/env bash
# Usage: bash scripts/articles/article-epub/build.sh <article-slug>   (see README.md)
set -euo pipefail
SLUG="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
ENV="${ENV_FILE:-/root/sourcelibrary/.env.production.local}"
WORK="${KEEP_WORK:-$(mktemp -d)}"; mkdir -p "$WORK"; [ -n "${KEEP_WORK:-}" ] || trap 'rm -rf "$WORK"' EXIT
OUT="${OUT:-$WORK/$SLUG.epub}"
ESB="$ROOT/node_modules/.bin/esbuild"
alias_args=(--alias:next/link="$HERE/mocks/Link.jsx" --alias:@/components/layout/ContentPageLayout="$HERE/mocks/Layout.jsx"
  --alias:@/components/articles/SourceQuote="$HERE/mocks/SourceQuote.jsx" --alias:@/components/articles/PageFigure="$HERE/mocks/PageFigure.jsx"
  --alias:@/lib/article-metadata="$HERE/mocks/Empty.jsx")
banner="import{createRequire}from'module';const require=createRequire('$ROOT/package.json');globalThis.__repoRequire=require;"

sed "s#__PAGE__#$ROOT/src/app/articles/$SLUG/page.tsx#" "$HERE/render.jsx" > "$WORK/render.jsx"
NODE_PATH="$ROOT/node_modules" "$ESB" "$WORK/render.jsx" --bundle --platform=node --jsx=automatic --tsconfig="$ROOT/tsconfig.json" \
  "${alias_args[@]}" --outfile="$WORK/render.cjs" --log-level=error
(cd "$WORK" && PUBLIC_DIR="$ROOT/public" node render.cjs)

grep -o -E 'sourcelibrary.org/book/[a-z0-9-]+\?page=[0-9]+' "$WORK/article.html" | sed 's#sourcelibrary.org/book/##' | awk '!s[$0]++' > "$WORK/refs.txt"
mkdir -p "$WORK/pages"
(cd "$WORK" && node --env-file="$ENV" "$HERE/fetch-pages.mjs" "$ROOT")

NODE_PATH="$ROOT/node_modules" "$ESB" "$HERE/build.ts" --bundle --platform=node --format=esm --tsconfig="$ROOT/tsconfig.json" \
  --alias:sharp="$HERE/mocks/sharp.mjs" --alias:archiver="$HERE/mocks/archiver.mjs" --outfile="$WORK/build.mjs" --log-level=error --banner:js="$banner"
(cd "$WORK" && PUBLIC_DIR="$ROOT/public" node --no-deprecation build.mjs "$SLUG" "$OUT")
[ "${UPLOAD:-1}" = 0 ] && { echo "not uploaded (UPLOAD=0)"; exit 0; }
NODE_PATH="$ROOT/node_modules" "$ESB" "$HERE/upload.ts" --bundle --platform=node --format=esm --tsconfig="$ROOT/tsconfig.json" \
  --outfile="$WORK/upload.mjs" --log-level=error --banner:js="$banner"
node --no-deprecation --env-file="$ENV" "$WORK/upload.mjs" "$SLUG${STYLE:+-$STYLE}${NAME_SUFFIX:-}" "$OUT"
