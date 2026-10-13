# PRIOR ART: scripts/eval/run-cli-arm.py and claude-arm.py write the rows this reads; the #6523 rule (failed reads are
# counted, not scored) is applied here, once, for every arm.
"""Load every #6545 arm for a set of uids: {arm: {uid: text}}, plus {arm: {uid: failure}} for reads that failed."""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import W, read, arm as stored
from prompts import unwrap

NEW = ['PRO', 'C38S', 'OPUS', 'CF', 'CO']


def latest(path):
    rows = {}
    if os.path.exists(path):
        for r in read(path):
            if r.get('text') or r['uid'] not in rows: rows[r['uid']] = r
    return rows


def load(uids, names=None, extra=()):
    names = names or (['FP', 'C38'] + NEW)
    texts, fails, meta = {}, {}, {}
    for a in names:
        texts[a], fails[a], meta[a] = {}, {}, {}
        if a in ('FP', 'C38'):
            s = stored(a)
            for u in uids:
                if u in s: texts[a][u] = s[u]
                else: fails[a][u] = 'no stored text'
            continue
        rows = latest(f'{W}/arms/{a}.jsonl')
        for u in list(uids) + [x for x in extra if x.startswith(tuple(uids))]:
            r = rows.get(u)
            if not r: continue
            meta[a][u] = r
            raw = r.get('raw') if r.get('route') == 'claude-cli' else r.get('text')
            t, prob = unwrap(raw or '')
            if not (r.get('text') or '').strip(): fails[a][u] = (r.get('error') or 'empty')[:80]
            elif prob in ('empty',): fails[a][u] = 'empty'
            elif r.get('blocked'): fails[a][u] = 'safety filter'
            else: texts[a][u] = t
    # chatter guard on what is left (cliChatterReason, cli-translate.mjs's guard)
    flat = {f'{a}\t{u}': t for a in texts for u, t in texts[a].items() if a not in ('FP', 'C38')}
    reasons = json.loads(subprocess.check_output(['node', os.path.join(os.path.dirname(__file__), 'chatter.mjs')], input=json.dumps(flat).encode())) if flat else {}
    for k, why in reasons.items():
        if why:
            a, u = k.split('\t'); fails[a][u] = f'chatter: {why}'; texts[a].pop(u, None)
    return texts, fails, meta
