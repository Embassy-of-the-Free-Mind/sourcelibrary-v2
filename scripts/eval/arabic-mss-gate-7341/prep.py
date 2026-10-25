#!/usr/bin/env python3
# PRIOR ART: scripts/eval/mss-thinking-6544/build-requests.py (the one diplomatic READ prompt every non-production
# reader gets, imported) and build-keys.py (the referee keys, run unchanged on the layout this writes). Those build
# two sets with correction and resolver arms; #7341 needs only single reads of 30 drawn pages, a print variant of the
# prompt for Kraus 1935, and its scratch laid out as build-keys.py expects (<root>/setB/draw.json, out/{pro,opus}.jsonl).
"""
Request files for the Arabic manuscript OCR gate (#7341). Data lives under $JOB_SCRATCH/g, never in the repo.

  python3 scripts/eval/arabic-mss-gate-7341/prep.py   # g/setB/draw.json + g/setB/req/read.jsonl, read-claude.jsonl

The Gemini CLI read is filed as `pro.jsonl` and Opus as `opus.jsonl`, the two names build-keys.py reads; the "pro"
slot holds Gemini 3.8 Flash low here (Pro needs AGY_ALLOW_HEAVY, which this gate may not set).
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'mss-thinking-6544'))
sys.path.insert(0, os.path.join(HERE, '..', 'replicate-6547'))
from prep import SENT  # noqa: E402
import importlib.util  # noqa: E402
spec = importlib.util.spec_from_file_location('br', os.path.join(HERE, '..', 'mss-thinking-6544', 'build-requests.py'))
br = importlib.util.module_from_spec(spec); spec.loader.exec_module(br)

READ_MS = br.READ
# Kraus 1935 is a printed edition with footnotes and an apparatus: the same prompt with "printed" for "handwritten".
READ_PRINT = READ_MS.replace('all the handwritten text on this manuscript page', 'all the text on this printed page, '
                             'footnotes included,')

root = os.path.join(os.environ['JOB_SCRATCH'], 'g', 'setB')
draw = json.load(open(os.path.join(os.environ['JOB_SCRATCH'], 'draw.json')))
os.makedirs(os.path.join(root, 'req'), exist_ok=True); os.makedirs(os.path.join(root, 'out'), exist_ok=True)
picks = [{'uid': p['uid'], 'image': p['image'], 'book_id': p['book_id'], 'page': p['page'], 'cell': p['cell'], 'leaf': p['leaf']} for p in draw['pages']]
json.dump({'seed': draw['seed'], 'picks': picks}, open(os.path.join(root, 'draw.json'), 'w'), indent=1)
P = lambda p: READ_PRINT if p['cell'] == 'ar-print' else READ_MS  # noqa: E731
with open(os.path.join(root, 'req', 'read.jsonl'), 'w') as f:  # Gemini: run-cli-arm.py appends the sentinel
    f.writelines(json.dumps({'uid': p['uid'], 'image': p['image'], 'prompt': P(p)}, ensure_ascii=False) + '\n' for p in picks)
with open(os.path.join(root, 'req', 'read-claude.jsonl'), 'w') as f:
    f.writelines(json.dumps({'uid': p['uid'], 'image': p['image'], 'prompt': f'{P(p)}\n\n{SENT}'}, ensure_ascii=False) + '\n' for p in picks)
print(len(picks), 'pages:', sum(p['cell'] == 'ar-ms' for p in picks), 'ms,', sum(p['cell'] == 'ar-print' for p in picks), 'print')
