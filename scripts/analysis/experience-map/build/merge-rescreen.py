#!/usr/bin/env python3
"""
Replace rows of a screen file with their re-screened versions (#6652): after the verbatim gate was made
markup-insensitive, only the rows the old gate had vetoed (non-empty `unverified`) were re-screened; this swaps
them in by page_id, keeping order, and backs up the original. PRIOR ART: none (merge-v5.mjs merges lanes, not passes).
  python3 build/merge-rescreen.py <classified.jsonl> <rescreen.jsonl>
"""
import json, sys, shutil
base, re_ = sys.argv[1:3]
R = {json.loads(l)['page_id']: l for l in open(re_) if l.strip()}
shutil.copy(base, base + '.pre-rescreen')
rows = [l for l in open(base) if l.strip()]
out = [R.get(json.loads(l)['page_id'], l) for l in rows]
open(base, 'w').writelines(x if x.endswith('\n') else x + '\n' for x in out)
print(f'{len(rows)} rows, {sum(1 for l in rows if json.loads(l)["page_id"] in R)} replaced')
