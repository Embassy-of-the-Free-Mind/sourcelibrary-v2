#!/bin/bash
# PRIOR ART: none — scripts/eval/INDEX.md has no search_concept probe; a 4-line curl wrapper for #8504.
# usage: q.sh "<query>"  -> prints top-5 similarities
body=$(jq -nc --arg q "$1" '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"search_concept",arguments:{query:$q,diversity:"off",limit:5}}}')
curl -s https://sourcelibrary.org/api/mcp -H "Authorization: Bearer $(cat /root/.sl-internal-key)" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d "$body"
