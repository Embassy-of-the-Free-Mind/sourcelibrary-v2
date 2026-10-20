# #6945 step 1: offline replay of the candidate-sign suggester. No UI, no model calls, $0.
# For every legible sign of every test block (Dresden: round 2's 70 held-out blocks; Palenque: this job's 100 held-out
# blocks), each channel ranks sign VALUES; we report recall@k (k = 1, 3, 6, 8) of the true value per channel alone and
# fused, and simulated clicks per block.
#
# Channels (all fixed before any result was seen; no weight is fitted on the test blocks):
#   picture   : set/picture.json (picture.py) — sign drawings (maya_signs: Stuart + Wayeb) fused with the nearest
#               reference block crops (Palenque non-test crops; for the codex all Palenque crops = cross-style test).
#   parallels : layout-retrieved parallels (Dresden: round 2's retrieval.json; Palenque: set/items.json `retrieval`)
#               + what follows the PREVIOUS block's reading elsewhere in the reference pool (the human has confirmed it).
#   spelling  : pool frequency prior, re-ranked by the PREVIOUS sign in the block (confirmed): synharmonic CV-CV,
#               a logogram's final consonant -> complement CV, a CV syllable -> logogram with that onset.
#   calendar  : fires only when the previous confirmed block is a day sign (-> Haab: the month coefficient is one of
#               four by the day name) or a count/period (-> a day sign: 1-13 + day names). Dresden: round 2's Venus
#               arithmetic fixes its two Haab dates (p.47 A1), and nothing else in the set is calendrical.
#   fused     : reciprocal-rank fusion (k0 = 10, equal weights) of the four; abstaining channels add nothing.
# Simulated clicks: per sign, ceil(rank / 6) page-throughs of a 6-candidate tray if rank <= 18, else 4 (open search,
# type, pick, confirm). No suggester = 4 per sign. Sign boxes are taken as given (the human corrects them; not costed).
# PRIOR ART: none for a suggester — round 2's gate0 measured only the picture channel's recall@8 (28% max) and its
# retrieval.py builds the Dresden parallels used here; `git grep -i "recall@"` in scripts/eval finds no sign suggester.
import json, re, collections, math, sys
from common import MS, R1, R2, jl, jd, norm_tok, split_tokens, key_tokens, squash

K0 = 10; KS = (1, 3, 6, 8)
DAYS = ['imix', 'ik', 'akbal', 'kan', 'chikchan', 'kimi', 'manik', 'lamat', 'muluk', 'ok', 'chuwen', 'eb', 'ben', 'ix', 'men',
        'kib', 'kaban', 'etznab', 'kawak', 'ahaw']
HAAB_COEF = {d: {str((i - 1) % 5 + j) for j in (0, 5, 10, 15)} for i, d in enumerate(DAYS)}  # Classic: Ik' days on 0/5/10/15
DAYRE = re.compile(r'\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen)\s+[“"]?(' +
                   r'imix|ik|ak.?b.?al|k.?an|chikchan|kimi|manik|lamat|muluk|ok|chuwen|eb|b.?en|ix|men|kib|kab.?an|etz.?nab|kawak|ajaw|ahaw)\b', re.I)

def rrf(lists, k0=K0, w=None):
    s = collections.defaultdict(float)
    for n, L in enumerate(lists):
        for r, v in enumerate(L or []): s[v] += (w[n] if w else 1) / (k0 + r + 1)
    return [v for v, _ in sorted(s.items(), key=lambda x: -x[1])]

def toks(tr): return [norm_tok(a) for t in split_tokens(tr) for a in t.split('/')[:1] if norm_tok(a)]

def types_of(seqs):
    """value -> 'syl' | 'logo' | 'num', from the case it is written in (logograms UPPERCASE)."""
    T = collections.Counter()
    for tr in seqs:
        for t in split_tokens(tr):
            a = t.split('/')[0]; n = norm_tok(a)
            if not n: continue
            if n.isdigit(): T[(n, 'num')] += 1
            elif re.sub(r'[^A-Za-z]', '', a).isupper() and len(re.sub(r'[^A-Za-z]', '', a)) > 1: T[(n, 'logo')] += 1
            else: T[(n, 'syl')] += 1
    out = {}
    for (n, t), c in T.most_common():
        out.setdefault(n, t)
    return out

V = set('aeiou')
def is_cv(v): return len(v) <= 3 and v[-1:] in V and all(c not in V for c in v[:-1])

def spelling(prev, prior, typ):
    if prev is None: return list(prior)
    sc = {}
    for r, v in enumerate(prior):
        s = -math.log(r + 1) * 0.5
        tp, tv = typ.get(prev), typ.get(v)
        if tp == 'syl' and tv == 'syl' and is_cv(prev) and is_cv(v) and v[-1] == prev[-1]: s += 2      # synharmony
        if tp == 'logo' and tv == 'syl' and is_cv(v) and prev[-1:] not in V and v[:-1] and prev.endswith(v[:-1]): s += 3  # complement
        if tp == 'syl' and tv == 'logo' and is_cv(prev) and v.startswith(prev): s += 1                  # prefixed complement
        if v == prev and tv == 'syl': s -= 1
        sc[v] = s
    return sorted(sc, key=lambda v: -sc[v])

def evaluate(blocks, chan, ks=KS):
    """blocks: [{key, seen, signs:[true value-set], lists:{channel: [list per sign]}}]"""
    res = {}
    for c in chan:
        hits = {k: 0 for k in ks}; n = 0; clicks = []; ranks = []
        for b in blocks:
            cb = 0
            for i, alts in enumerate(b['signs']):
                L = b['lists'][c][i] or []; n += 1
                r = next((j + 1 for j, v in enumerate(L) if v in alts), None); ranks.append(r)
                for k in ks: hits[k] += bool(r and r <= k)
                cb += math.ceil(r / 6) if r and r <= 18 else 4
            clicks.append(cb)
        res[c] = dict(n=n, **{f'r@{k}': hits[k] for k in ks}, clicks=round(sum(clicks) / max(len(clicks), 1), 2),
                      base_clicks=round(4 * n / max(len(blocks), 1), 2))
    return res

def build(corpus):
    PIC = jl(MS + 'set/picture.json')[corpus]
    if corpus == 'palenque':
        B = jl(MS + 'p/blocks.json')
        for i, b in enumerate(B): b['bid'] = f"{b['monument']}:{b['coord']}"; b['order'] = i
        items = jl(MS + 'set/items.json'); test = {b['bid'] for it in items for b in it['blocks']}
        pool = [b for b in B if b['bid'] not in test and b.get('transliteration')]
        seq = collections.defaultdict(list)
        for b in B: seq[b['monument']].append(b)
        pool_seqs = [[None if b['bid'] in test else b.get('transliteration') for b in seq[m]] for m in seq]  # gaps kept
        dayblk = lambda b: bool(DAYRE.search(b.get('translation') or ''))
        countblk = lambda b: bool(re.search(r'\bago\b|\bdays?\b|\byears?\b|k.?atun|b.?ak.?tun|winal|k.?ins?\b|score|tuns?\b', b.get('translation') or '', re.I)) and not dayblk(b)
        # pool day / haab block vocab
        day_tok, haab_tok = collections.Counter(), collections.Counter()
        for m in seq:
            s = [b for b in seq[m]]
            for j, b in enumerate(s):
                if b['bid'] in test or not b.get('transliteration'): continue
                if dayblk(b): day_tok.update(toks(b['transliteration']))
                if j and dayblk(s[j - 1]): haab_tok.update(toks(b['transliteration']))
        tests = []
        for it in items:
            ctx = it['retrieval']
            for tb in it['blocks']:
                if tb['role'] != 'heldout': continue
                b = next(x for x in B if x['bid'] == tb['bid']); s = seq[b['monument']]; k = s.index(b)
                prev = s[k - 1] if k else None
                par = []
                for r in ctx: par += [(v, 3.0 if r['why'].startswith('same position') else 1.0) for v in toks(r['translit'])]
                if prev is not None:
                    pk = squash(prev['transliteration'])
                    for ps in pool_seqs:
                        for j in range(len(ps) - 1):
                            if ps[j] and ps[j + 1] and squash(ps[j]) == pk: par += [(v, 3.0) for v in toks(ps[j + 1])]
                cal = None
                if prev is not None and dayblk(prev):
                    dn = [t for t in toks(prev['transliteration']) if t in HAAB_COEF]
                    coef = sorted(HAAB_COEF[dn[0]], key=int) if dn else []
                    cal = coef + [v for v, _ in haab_tok.most_common() if v not in coef]
                elif prev is not None and countblk(prev):
                    cal = [str(n) for n in range(1, 14)] + [v for v, _ in day_tok.most_common() if not v.isdigit()]
                tests.append(dict(key=tb['bid'], seen=tb['seen'], tr=b['transliteration'], prevsig=None, par=par, cal=cal, pic=PIC.get(tb['bid'], {})))
        seqs_for_prior = [b['transliteration'] for b in pool]
    else:
        K = jl(R1 + 'refs/key.json'); RET = jl(R2 + 'set/retrieval.json')
        HP = {6, 9, 13, 15, 21, 29, 38, 47}
        items = [i for i in jl(R1 + 'set/items_private.json') if i['role'] == 'heldout']
        pool = [r for r in K if r.get('page') is not None and r['page'] not in HP]
        # captions on unknown pages are left out of the pool, as round 2's retrieval excluded almanacs touching held-out pages
        seqs_for_prior = [t for r in pool for t in r['translit']]
        pool_seqs = [r['translit'] for r in pool]
        tests = []
        for it in items:
            R = RET.get(it['id'], []); ctxv = {squash(b['translit']) for r in R for b in r['blocks']}
            for bi, kb in enumerate(it['blocks']):
                par = []
                for ri, r in enumerate(R):
                    for j, b in enumerate(r['blocks']):
                        par += [(v, (3.0 if j == bi else 1.0) / (1 + ri / 4)) for v in toks(b['translit'])]
                if bi:
                    pk = squash(it['blocks'][bi - 1]['translit'])
                    for ps in pool_seqs:
                        for j in range(len(ps) - 1):
                            if squash(ps[j]) == pk: par += [(v, 3.0) for v in toks(ps[j + 1])]
                cal = None
                if it['dresden_page'] == 47 and kb['pos'] == 'A1':
                    cal = toks(kb['translit'])  # round 2 (#6903): fixed by the 236/90/250/8-day Venus intervals from p.46/p.48 frames
                tests.append(dict(key=f"{it['id']}:{kb['pos']}", seen=squash(kb['translit']) in ctxv, tr=kb['translit'], par=par, cal=cal, pic=PIC.get(f"{it['id']}:{kb['pos']}", {})))
    typ = types_of(seqs_for_prior)
    prior = [v for v, _ in collections.Counter(t for tr in seqs_for_prior for t in toks(tr)).most_common()]
    blocks = []
    for t in tests:
        signs = key_tokens(t['tr'])
        if not signs: continue
        truth = [sorted(a)[0] for a in signs]
        ps = collections.defaultdict(float)
        for v, w in t['par']: ps[v] += w
        parl = sorted(ps, key=lambda v: -ps[v])
        pic = rrf([t['pic'].get('signs'), t['pic'].get('crops')])
        lists = collections.defaultdict(list)
        for i in range(len(signs)):
            prev = truth[i - 1] if i else None
            sp = spelling(prev, prior, typ)
            ch = {'prior': prior, 'picture': pic, 'pic_signs': t['pic'].get('signs') or [], 'pic_signs_twkm': t['pic'].get('signs+twkm') or [],
                  'pic_crops': t['pic'].get('crops') or [], 'parallels': parl, 'spelling': sp, 'calendar': t['cal'] or []}
            ch['fused'] = rrf([pic, parl, sp, t['cal']])
            ch['fused-picture'] = rrf([parl, sp, t['cal']])
            ch['fused-parallels'] = rrf([pic, sp, t['cal']])
            ch['fused-spelling'] = rrf([pic, parl, t['cal']])
            ch['fused-calendar'] = rrf([pic, parl, sp])
            for c, L in ch.items(): lists[c].append(L)
        blocks.append(dict(key=t['key'], seen=t['seen'], signs=signs, lists=lists, cal_fired=t['cal'] is not None))
    return blocks, set(prior)

CH = ['prior', 'pic_signs', 'pic_signs_twkm', 'pic_crops', 'picture', 'parallels', 'spelling', 'calendar', 'fused',
      'fused-picture', 'fused-parallels', 'fused-spelling', 'fused-calendar']

def main():
    out = {}
    for corpus in ('dresden', 'palenque'):
        blocks, vocab = build(corpus)
        allv = [a for b in blocks for a in b['signs']]
        r = dict(blocks=len(blocks), signs=len(allv), signs_in_pool_vocab=sum(bool(a & vocab) for a in allv),
                 cal_fired_blocks=sum(b['cal_fired'] for b in blocks),
                 all=evaluate(blocks, CH),
                 seen=evaluate([b for b in blocks if b['seen']], ['fused']), unseen=evaluate([b for b in blocks if not b['seen']], ['fused']),
                 n_seen=sum(b['seen'] for b in blocks))
        # per-block: all signs of the block in the fused top-6
        r['blocks_all_signs_top6'] = sum(all(any(v in a for v in L[:6]) for a, L in zip(b['signs'], b['lists']['fused'])) for b in blocks)
        out[corpus] = r
        print(corpus, json.dumps({k: v for k, v in r.items() if k != 'all'}))
        for c in CH:
            x = r['all'][c]; n = x['n']
            print(f"  {c:16s} " + ' '.join(f"r@{k} {100 * x[f'r@{k}'] / n:5.1f}" for k in KS) + f"  clicks/block {x['clicks']} (none {x['base_clicks']})")
    jd(out, MS + 'runs/suggester.json')

if __name__ == '__main__':
    main()
