#!/bin/bash
# Blind fidelity judge for #6559 calibration: Gemini 3.1 Pro through agy (subscription), one call per item.
# Usage (from the repo root of a checkout of this branch, on a box with agy): bash scripts/eval/results/blind-judge-6559/run.sh
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"; W="${JOB_SCRATCH:-/tmp}/blind-judge-6559"; mkdir -p "$W/img"
node -e '
const fs=require("fs");const [here,w]=process.argv.slice(1);
const items=JSON.parse(fs.readFileSync(here+"/items.json","utf8"));const p=fs.readFileSync(here+"/judge-prompt.md","utf8");
(async()=>{const rows=[];for(const it of items){const f=w+"/img/"+it.uid+".jpg";if(!fs.existsSync(f)){const r=await fetch(it.image_url);if(!r.ok)throw new Error(it.uid+" HTTP "+r.status);fs.writeFileSync(f,Buffer.from(await r.arrayBuffer()));}
rows.push(JSON.stringify({uid:it.uid,prompt:p+"\n"+it.text+"\n\nThe page image:",image:f}));}
fs.writeFileSync(w+"/requests.jsonl",rows.join("\n")+"\n");console.log(rows.length+" requests");})();' "$HERE" "$W"
python3 scripts/eval/run-cli-arm.py --requests "$W/requests.jsonl" --out "$HERE/judge-out.jsonl" --arm blind-judge-6559 \
  --model gemini-3.1-pro-low --job blind-judge-6559 --kind judge --parallel 2 --attempts 3 --print-timeout 240
