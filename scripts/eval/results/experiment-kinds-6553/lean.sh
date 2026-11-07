#!/bin/bash
# usage: lean.sh promptfile outfile ; prompt on stdin file
claude -p --model sonnet --strict-mcp-config --setting-sources local --disable-slash-commands --no-session-persistence --tools "" --output-format json --system-prompt "You are a careful research librarian classifying internal experiment write-ups. Answer exactly in the requested format." < "$1" > "$2"
