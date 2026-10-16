#!/bin/bash
# PRIOR ART: /root/engine-wave1-6011/tib/score.sh — the same kanjur_align.py call on the G4L replies.
# Tibetan (panel 6): G4L replies (between the markers) scored with kanjur_align.py exactly as engine-wave1-6011/tib/score.sh.
set -e
S=/mnt/HC_Volume_105839809/jobs/g4-hard2-6707; B=/root/engine-wave1-6011/bench/tibetan-kangyur-4523
python3 - <<PY > $S/an/tib-pages-G4L.jsonl
import json
m={p['slug']:p for p in json.load(open('$B/manifest.json'))['pages']}
rows={}
for l in open('$S/raw/G4L-tib.raw.jsonl'):
    r=json.loads(l); rows[r['uid']]=r
for u,r in rows.items():
    s=u.split('|',1)[1]
    if (r.get('text') or '').strip(): print(json.dumps({'id': m[s]['id'], 'slug': s, 'text': r['text'], 'arm': 'gemini-4-argon-low+antigravity-cli'}, ensure_ascii=False))
PY
(cd /root/tibetan-eval && /root/tibetan-ocr-app/venv/bin/python kanjur_align.py score --index etext-index-full.pkl --pages $S/an/tib-pages-G4L.jsonl --out $S/an/tib-scores-G4L.jsonl 2>> $S/an/tib-score.log)
wc -l $S/an/tib-scores-G4L.jsonl
