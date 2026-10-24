# #6903 stage 2 deterministic scoring, round 2's rules on Palenque: exact = every legible reference sign is in the
# candidate; wrong = none is; SEEN = the block's reading is verbatim in its group's retrieved context; controls = the 10
# blocks Stuart leaves unread or reconstructs; BARE arms also report whether the model named the monument.
# Usage: python3 score.py <runName>...   (run dirs under $MS/runs/; BARE runs are recognised by their group ids R..)
# PRIOR ART: round 2's score.py + score2.py (l7a scratch); same exact/wrong/SEEN/team accounting, Palenque items.
import json, os, re, sys, math
from common import MS, jl, key_tokens, model_tokens

ITEMS = jl(MS + 'set/items.json'); BARE = jl(MS + 'set/bare.json')
CTX = {b['bid']: [{x for s in key_tokens(c['translit']) for x in s} for c in it['retrieval']] for it in ITEMS for b in it['blocks']}

def tok_seen(bid, tr):
    """Round 2's token rule: every reference token appears in ONE retrieved block (catches near-copies)."""
    kt = key_tokens(tr); return bool(kt) and any(all(a & c for a in kt) for c in CTX.get(bid, []))
MON = re.compile(r'palenque|lakam', re.I)
TABLET = {'tc': re.compile(r'\bcross\b(?!.*foliated)', re.I), 'tfc': re.compile(r'foliated', re.I), 'ts': re.compile(r'\bsun\b', re.I)}

def wilson(k, n, z=1.96):
    if n == 0: return (0, 0)
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (round(100 * (c - h)), round(100 * (c + h)))

def rows(run):
    d = MS + 'runs/' + run; out = []
    for f in sorted(os.listdir(d)):
        o = jl(d + '/' + f); gid = o['id']
        G = next(g for g in (BARE if gid.startswith('R') else ITEMS) if g['id'] == gid)
        mb = (o.get('parsed') or {}).get('blocks') or []
        for i, b in enumerate(G['blocks']):
            pos = 'X' + str(i + 1) if gid.startswith('R') else b['coord']
            m = next((x for x in mb if x.get('pos') == pos), mb[i] if i < len(mb) else {})
            unread = bool(m.get('unread')) or not (m.get('translit') or '').strip()
            seen = next((x['seen'] for g in ITEMS for x in g['blocks'] if x['bid'] == b['bid']), False) and not gid.startswith('R')
            tseen = (seen or tok_seen(b['bid'], b['translit'])) and not gid.startswith('R')
            kt = key_tokens(b['translit']); mt = model_tokens(m.get('translit', ''))
            matched = 0 if unread else sum(1 for a in kt if a & mt)
            sg = (m.get('source_guess') or '').strip()
            out.append(dict(run=run, gid=gid, bid=b['bid'], role=b['role'], seen=seen, tseen=tseen, key=b['translit'], cand=m.get('translit', ''),
                            gloss=m.get('gloss', ''), conf=float(m.get('confidence') or 0), unread=unread, verdict=m.get('verdict'),
                            n=len(kt), matched=matched, exact=(not unread) and kt and matched == len(kt), wrong=(not unread) and matched == 0,
                            src=sg, src_conf=float(m.get('source_confidence') or 0),
                            src_palenque=bool(sg) and bool(MON.search(sg)),
                            src_tablet=bool(sg) and bool(TABLET[b['bid'].split('-')[0]].search(sg)) and bool(MON.search(sg))))
    return out

def summary(run):
    R = rows(run); H = [r for r in R if r['role'] == 'heldout']; C = [r for r in R if r['role'] == 'control']
    att = [r for r in H if not r['unread']]; ex = lambda L: sum(1 for r in L if r['exact'])
    S = dict(run=run, n=len(H), attempted=len(att), exact=ex(H), exact_ci=wilson(ex(H), len(H)),
             seen=(ex([r for r in H if r['seen']]), sum(r['seen'] for r in H)), unseen=(ex([r for r in H if not r['seen']]), sum(not r['seen'] for r in H)),
             unseen_token=(ex([r for r in H if not r['tseen']]), sum(not r['tseen'] for r in H)),
             wrong=sum(r['wrong'] for r in att), wrong_conf05=sum(r['wrong'] and r['conf'] >= 0.5 for r in att),
             ctrl_read=sum(not r['unread'] for r in C), ctrl_conf05=sum(not r['unread'] and r['conf'] >= 0.5 for r in C), ctrl_n=len(C))
    if any(r['src'] for r in R):
        named = [r for r in R if r['src'] and r['src'].lower() != 'unknown']
        S.update(source_named=len(named), source_palenque=sum(r['src_palenque'] for r in R), source_right_tablet=sum(r['src_tablet'] for r in R),
                 source_examples=[(r['bid'], r['src'], r['src_conf']) for r in named][:12])
    if any(r['verdict'] for r in H):
        acc = [r for r in H if r['verdict'] == 'accept']; cor = [r for r in H if r['verdict'] == 'correct']
        S.update(accepted=(ex(acc), len(acc)), corrected=(ex(cor), len(cor)), declined=sum(r['verdict'] == 'decline' for r in H),
                 accepted_unseen=(ex([r for r in acc if not r['seen']]), sum(not r['seen'] for r in acc)),
                 ctrl_accepted=sum(r['verdict'] in ('accept', 'correct') for r in C))
    return S, R

if __name__ == '__main__':
    allr = {}
    for run in sys.argv[1:]:
        S, R = summary(run); allr[run] = R; print(json.dumps(S, ensure_ascii=False))
    json.dump(allr, open(MS + 'runs/scored_rows.json', 'w'), ensure_ascii=False, indent=1)
