# PRIOR ART: scripts/eval/pareto-6182/build-xl-packet.py (the #6182/#6331 xl records, units and arm files this reads)
# and scripts/eval/run-cli-arm.py (the CLI runner the Gemini arms use). This file only names the paths and panels.
"""Shared paths and panel definitions for #6545 (Pro full thinking / Opus / correction arms vs 3.8 Flash CLI)."""
import json, os, random

W = os.environ.get('W6545', '/mnt/HC_Volume_105839809/jobs/pro-translate-6545/w')   # holds reference text: never commit
P6182 = '/root/pareto-6182'
C38_FILE = '/root/cli38-6182/C38-full.jsonl'
RESULTS = 'scripts/eval/results/pro-translate-6545'
STAGE1 = ['Persian', 'Sanskrit']
STAGE2 = ['Chinese', 'Greek', 'Hebrew']
GREEK_WORKS = 25

read = lambda p: [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]


def write_jsonl(p, rows):
    with open(p, 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')


def units():
    return {u['uid']: u for u in read(f'{P6182}/units.jsonl') if u['set'] == 'xl'}


def records():
    return {r['id']: r for r in read(f'{P6182}/xl/records.jsonl')}


def panel_uids(lang):
    """The #6331 xl pages of one language (one page per work); Greek subsampled to GREEK_WORKS works, seed 6545."""
    us = sorted(u for u, x in units().items() if x['lang'] == lang)
    if lang == 'Greek':
        us = sorted(random.Random(6545).sample(us, GREEK_WORKS))
    return us


def arm(name):
    """Stored arm texts by uid: C38 (#6331 CLI 3.8 Flash), FP (in use: gemini-3-flash-preview, #6182's PROD arm)."""
    p = C38_FILE if name == 'C38' else f'{P6182}/arms/{name}.jsonl'
    return {r['uid']: r['text'] for r in read(p) if (r.get('text') or '').strip()}
