#!/usr/bin/env python3
# PRIOR ART: none — looked in scripts/batch/cli-ocr-lane.mjs (its ledger records outcomes, not page types) and
# scripts/audit/ (no detector of re-reads typed blank).
"""Step 1 of the #8632 blank-write measurement: written re-reads (reread-ledger.jsonl, outcome written) whose kept
read says <page-type>blank. Disk only, no database. Writes /root/jobs/repair-8632/blank-written.json."""
import json, os, re, sys
root = '/root/jobs/cli-ocr-reread'
out = []
n = 0
for l in open(f'{root}/reread-ledger.jsonl'):
    if '"outcome":"written"' not in l: continue
    r = json.loads(l); n += 1
    f = f"{root}/{r['at'][:10]}/{r['book_id']}/{r['page_id']}.txt"
    try: t = open(f, encoding='utf-8', errors='replace').read()
    except OSError: continue
    if re.search(r'<page-type>\s*blank', t, re.I):
        body = re.sub(r'<[^>]+>[^<]*</[^>]+>', '', t).strip()
        out.append({'page_id': r['page_id'], 'book_id': r['book_id'], 'at': r['at'], 'run': r.get('run'), 'body_chars': len(body)})
json.dump(out, open('/root/jobs/repair-8632/blank-written.json', 'w'))
print(f'{n} written re-reads; {len(out)} typed blank')
