#!/usr/bin/env python3
# PRIOR ART: build-keys.py (#6544) takes two independent reads as out/pro.jsonl and out/opus.jsonl and falls back to a
# whole-page referee read when one is missing. On #7341 Gemini 3.8 Flash low was filter-cut on 16 of 26 manuscript
# pages; the fallback would make those pages' key a second Opus read (Opus graded against itself). This fills the
# Gemini slot with the Flash-Lite read (same family, API, envelope stripped) where the CLI read failed, and says so.
"""
  python3 scripts/eval/arabic-mss-gate-7341/key-reads.py   # $JOB_SCRATCH/gk/setB/{draw.json, out/pro.jsonl, out/opus.jsonl}
"""
import importlib.util, json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'replicate-6547'))
from disagree import load  # noqa: E402
spec = importlib.util.spec_from_file_location('s6544', os.path.join(HERE, '..', 'mss-thinking-6544', 'score.py'))
s6544 = importlib.util.module_from_spec(spec); spec.loader.exec_module(s6544)

src = os.path.join(os.environ['JOB_SCRATCH'], 'g', 'setB'); dst = os.path.join(os.environ['JOB_SCRATCH'], 'gk', 'setB')
os.makedirs(os.path.join(dst, 'out'), exist_ok=True)
shutil.copyfile(os.path.join(src, 'draw.json'), os.path.join(dst, 'draw.json'))
shutil.copyfile(os.path.join(src, 'out', 'opus.jsonl'), os.path.join(dst, 'out', 'opus.jsonl'))
uids = [p['uid'] for p in json.load(open(os.path.join(src, 'draw.json')))['picks']]
gem, _, _ = s6544.reads('f38l', load(os.path.join(src, 'out', 'pro.jsonl')), uids)
lite, _, _ = s6544.reads('lite', load(os.path.join(src, 'out', 'lite.jsonl')), uids)
n = {'f38l': 0, 'lite': 0, 'none': 0}
with open(os.path.join(dst, 'out', 'pro.jsonl'), 'w') as f:
    for u in uids:
        who = 'f38l' if u in gem else 'lite' if u in lite else 'none'
        n[who] += 1
        f.write(json.dumps({'uid': u, 'second_reader': who, 'text': gem.get(u) or lite.get(u) or ''}, ensure_ascii=False) + '\n')
json.dump(n, open(os.path.join(dst, 'second-reader.json'), 'w'))
print('second reader per page:', n)
