# #6903 stage 2: the Palenque held-out set, its controls, call groups and layout-only retrieval.
# Input: $MS/p/blocks.json (a dump of bookstore.maya_glyph_blocks, Stuart 2006) and $MS/set/crops/<file>.png.
# Output: $MS/set/items.json (one group = one model call, <=5 blocks of one monument, in reading order),
#         $MS/set/bare.json (the same blocks in random cross-monument groups, for the recall control),
#         $MS/set/img/<opaque>.png (crops renamed so a file name never names the monument).
# PRIOR ART: round 2's retrieval.py (Dresden, private, on l7a) picks parallels by almanac layout; Palenque has no almanacs,
# so the analogue here is the inscription's own layout: the blocks around each test block in reading order, and the
# block at the same coordinate on the two sister tablets. Never the test block's own reading.
import json, random, collections, hashlib, shutil, os
from common import MS, jl, jd, squash

SEED = 6903
N_HELDOUT = 100
EXCLUDE = {'uncertain', 'bracketed', 'range', 'partial_on_drawing', 'incomplete_entry'}
# Controls: every single block Stuart prints as "?" (8), plus the two crops he reads almost wholly from context:
# TC jamb Bp5 "9-?-?" (broken) and TC alfardas E1 "[11-WINIK-ki]" (entirely bracketed, i.e. reconstructed).
CONTROLS = ['tc-alfardas:B2', 'tc-shrine-facade:E', 'tc-main-tablet:D8', 'tc-main-tablet:D16', 'tfc-main-tablet:E4',
            'tfc-main-tablet:H9', 'ts-main-tablet:H10', 'ts-main-tablet:L1', 'tc-sanctuary-jamb:Bp5', 'tc-alfardas:E1']
MAIN = ['tc-main-tablet', 'tfc-main-tablet', 'ts-main-tablet']
NB, NSIB = 3, 1  # neighbours each side per test block; same-coordinate blocks per sister tablet

def opaque(bid): return 'q' + hashlib.sha256(('6903:' + bid).encode()).hexdigest()[:8] + '.png'

def main():
    B = [b for b in jl(MS + 'p/blocks.json')]
    for i, b in enumerate(B): b['bid'] = f"{b['monument']}:{b['coord']}"; b['order'] = i  # loaded in reading order
    by = {b['bid']: b for b in B}
    clean = [b for b in B if b.get('image') and not set(b.get('flags') or []) & EXCLUDE and b.get('transliteration')]
    # stratified by monument: proportional, at least 2 per monument
    rng = random.Random(SEED); mons = collections.defaultdict(list)
    for b in clean: mons[b['monument']].append(b)
    quota = {m: max(2, round(N_HELDOUT * len(v) / len(clean))) for m, v in mons.items()}
    while sum(quota.values()) > N_HELDOUT: quota[max(quota, key=lambda m: quota[m] / len(mons[m]))] -= 1
    held = []
    for m in sorted(mons): held += rng.sample(mons[m], quota[m])
    for b in held: b['role'] = 'heldout'
    for c in CONTROLS: by[c]['role'] = 'control'
    test = sorted(held + [by[c] for c in CONTROLS], key=lambda b: b['order'])
    tset = {b['bid'] for b in test}
    os.makedirs(MS + 'set/img', exist_ok=True)
    for b in test: shutil.copyfile(MS + 'set/crops/' + b['image']['file'], MS + 'set/img/' + opaque(b['bid']))

    def blk(b): return dict(bid=b['bid'], coord=b['coord'], role=b['role'], img=opaque(b['bid']), translit=b['transliteration'],
                            transcription=b.get('transcription') or '', translation=b.get('translation') or '', monument=b['monument'])
    seq = collections.defaultdict(list)
    for b in B: seq[b['monument']].append(b)

    def context(group):
        """Layout-only retrieval: reading-order neighbours not in the test set, then sister-tablet same coordinates."""
        out, seen = [], set()
        for b in group:
            s = seq[b['monument']]; k = s.index(b)
            before = [x for x in s[:k][::-1] if x['bid'] not in tset][:NB][::-1]
            after = [x for x in s[k + 1:] if x['bid'] not in tset][:NB]
            for x in before + after:
                if x['bid'] not in seen: seen.add(x['bid']); out.append((x, 'same inscription, near this block in reading order'))
        for b in group:
            if b['monument'] in MAIN:
                for m in MAIN:
                    x = by.get(f"{m}:{b['coord']}")
                    if m != b['monument'] and x and x['bid'] not in tset and x['bid'] not in seen and x.get('transliteration'):
                        seen.add(x['bid']); out.append((x, 'same position on a sister tablet'))
        out.sort(key=lambda t: (t[1] != 'same inscription, near this block in reading order', t[0]['order']))
        return [dict(bid=x['bid'], monument_name=x['monument_name'], coord=x['coord'], why=why, translit=x['transliteration'],
                     transcription=x.get('transcription') or '', translation=x.get('translation') or '') for x, why in out]

    items, n = [], 0
    for m in sorted({b['monument'] for b in test}, key=lambda m: min(b['order'] for b in test if b['monument'] == m)):
        tb = [b for b in test if b['monument'] == m]
        for i in range(0, len(tb), 5):
            g = tb[i:i + 5]; n += 1
            items.append(dict(id=f'P{n:02d}', monument=m, monument_name=g[0]['monument_name'], blocks=[blk(b) for b in g], retrieval=context(g)))
    for it in items:
        ctx = {squash(r['translit']) for r in it['retrieval']}
        for b in it['blocks']: b['seen'] = squash(b['translit']) in ctx
    jd(items, MS + 'set/items.json')
    sh = list(test); random.Random(SEED + 1).shuffle(sh)
    bare = [dict(id=f'R{i // 5 + 1:02d}', blocks=[blk(b) for b in sh[i:i + 5]]) for i in range(0, len(sh), 5)]
    jd(bare, MS + 'set/bare.json')
    tb = [b for it in items for b in it['blocks']]
    print(json.dumps(dict(groups=len(items), bare_groups=len(bare), heldout=sum(b['role'] == 'heldout' for b in tb),
                          controls=sum(b['role'] == 'control' for b in tb), seen=sum(b['seen'] for b in tb if b['role'] == 'heldout'),
                          quota=quota, ctx_per_group=round(sum(len(i['retrieval']) for i in items) / len(items), 1))))

if __name__ == '__main__':
    main()
