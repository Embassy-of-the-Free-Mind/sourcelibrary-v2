#!/bin/sh
# Search one book (#7598). Called by run-batch.sh from inside the batch directory.
# Skips a book whose JSON already holds a verdict that is not a usage-limit message.
id=$1
[ -s "$id.json" ] && grep -q verdict "$id.json" && ! grep -q "hit your" "$id.json" && exit 0
# A clean env: subscription only, never the API. run-batch.sh is launched with .env.production.local
# loaded (its post-run ingest needs MONGODB_URI); that file's ANTHROPIC_API_KEY outranks the claude.ai
# login. /usr/bin/env, not env: uv puts an `env` script in ~/.local/bin that shadows it and runs nothing.
/usr/bin/env -i HOME="$HOME" PATH="$PATH" USER="$USER" LANG="${LANG:-en_US.UTF-8}" CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}" claude -p "$(cat "$id.prompt")" --model sonnet --strict-mcp-config --setting-sources local \
  --disable-slash-commands --no-session-persistence --tools WebSearch WebFetch Bash \
  --allowedTools "WebSearch" "WebFetch" "Bash(curl:*)" \
  --system-prompt "You are a careful bibliographic researcher. Use the tools to search and verify, then answer exactly in the requested JSON." \
  --output-format json > "$id.json" 2> "$id.err"
echo "$(date -u +%H:%M:%S) $id $?" >> progress.log
