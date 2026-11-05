#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tibetan-correct-6560/prep.py (Derge windows through kanjur_align.py window_syllables and a
# pickled e-text index that lived on Hetzner /root/tibetan-eval/, plant()) and alignpairs.py (the ported NW). Neither
# can place a NEW folio in Derge: prep.py reads the vol/imgnum a 2026-09-30 scoring run left in the manifest, and the
# index pickle is not on this box. This rebuilds the window straight from the public OpenPecha P000001 checkout
# (base/vNNN.txt + layers/vNNN/Pagination.yml), places a folio by syllable 5-gram votes, and reuses prep.py's plant()
# and alignpairs' NW unchanged.
"""Derge for the router tests' Tibetan cell (#6740, route-judge tib-kangyur).

  python3 tib-derge.py check  --p1 DIR                       reproduce the #6560 derge-windows.json.gz syllables
  python3 tib-derge.py locate --p1 DIR IN.jsonl OUT.jsonl    {key, text} -> {key, vol, imgnum, votes, identity}
  python3 tib-derge.py score  --p1 DIR IN.jsonl OUT.json     {key, route, vol, imgnum, text} -> {pages: {key: {route: {identity}}}}
  python3 tib-derge.py plants --p1 DIR IN.jsonl OUT.json     {key, vol, imgnum, served_text} -> plants.json (prep.py's shape)

--p1 is a checkout of https://github.com/OpenPecha-Data/P000001 (sparse: P000001.opf/base, layers/*/Pagination.yml).
identity = NW syllable matches against the window (vol, imgnum +- 2) / syllables of the read, as kanjur_align.py.
"""
import gzip, json, os, random, re, sys, types
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '../../..'))
sys.path.insert(0, os.path.join(REPO, 'scripts/eval/tibetan-correct-6560'))
import alignpairs  # noqa: E402
from alignpairs import syllables  # noqa: E402
# prep.py's plant() imports kanjur_align.syllables; alignpairs.syllables is that tokeniser (alignpairs header).
sys.modules.setdefault('kanjur_align', types.SimpleNamespace(syllables=syllables))
import prep  # noqa: E402

TIB = re.compile('[ༀ-࿿]')
G = 5


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def pagination(p1, vol):
    """[(imgnum, start, end)] from layers/<vol>/Pagination.yml (a flat YAML; parsed by line, no PyYAML here)."""
    out, cur = [], {}
    for line in open(os.path.join(p1, 'P000001.opf/layers', vol, 'Pagination.yml'), encoding='utf-8'):
        s = line.strip()
        if s.startswith('imgnum:'):
            cur = {'imgnum': int(s.split(':', 1)[1])}
        elif s.startswith('start:'):
            cur['start'] = int(s.split(':', 1)[1])
        elif s.startswith('end:'):
            cur['end'] = int(s.split(':', 1)[1]); out.append((cur['imgnum'], cur['start'], cur['end']))
    return out


_vols = {}
def volume(p1, vol):
    if vol not in _vols:
        base = open(os.path.join(p1, 'P000001.opf/base', vol + '.txt'), encoding='utf-8').read()
        _vols[vol] = (base, pagination(p1, vol))
    return _vols[vol]


def window(p1, vol, imgnum, w=2):
    base, pg = volume(p1, vol)
    imgnum = int(imgnum)
    return [s for im, a, b in sorted(pg) if imgnum - w <= im <= imgnum + w for s in syllables(base[a:b + 1])]


def manuscript_syllables(text):
    """The read's syllables, markup lines dropped (score.py manuscript_text)."""
    keep = [l for l in text.split('\n') if l.strip() and TIB.search(l) and not re.fullmatch(r'<[\w-]+[^>]*/>', l.strip())
            and not re.fullmatch(r'<([\w-]+)[^>]*>.*</\1>', l.strip())]
    return syllables('\n'.join(keep))


def identity(read, win):
    return round(alignpairs.matches(read, win) / len(read), 4) if read else None


def vols(p1):
    return sorted(f[:-4] for f in os.listdir(os.path.join(p1, 'P000001.opf/base')) if f.endswith('.txt'))


def check(p1):
    W = json.load(gzip.open(os.path.join(REPO, 'scripts/eval/results/tibetan-correct-6560/derge-windows.json.gz'), 'rt', encoding='utf-8'))['windows']
    same = 0
    for k, v in W.items():
        mine = window(p1, v['derge_vol'], v['derge_imgnum'])
        ok = mine == v['syllables']
        same += ok
        if not ok:
            print(k, v['derge_vol'], v['derge_imgnum'], len(mine), len(v['syllables']), file=sys.stderr)
    print(f'windows reproduced {same}/{len(W)}')


def locate(p1, rows):
    """Vote each read's 5-grams against every Derge page; the page with the most votes is the folio's imgnum."""
    want = defaultdict(set)
    reads = {}
    for r in rows:
        s = manuscript_syllables(r['text']); reads[r['key']] = s
        for i in range(len(s) - G + 1):
            want[tuple(s[i:i + G])].add(r['key'])
    votes = defaultdict(Counter)
    for vol in vols(p1):
        base, pg = volume(p1, vol)
        for im, a, b in pg:
            s = syllables(base[a:b + 1])
            seen = set()
            for i in range(len(s) - G + 1):
                g = tuple(s[i:i + G])
                if g in want and g not in seen:
                    seen.add(g)
                    for k in want[g]:
                        votes[k][(vol, im)] += 1
        _vols.pop(vol, None)
    out = []
    for r in rows:
        k = r['key']
        if not votes[k]:
            out.append({'key': k, 'vol': None, 'imgnum': None, 'votes': 0, 'identity': None}); continue
        # a frame can hold two leaves: the window is centred on the best page, as kanjur_align's (vol, imgnum)
        # (the Kangyur repeats itself: of the three pages with most votes, the one whose window the read matches best)
        top = votes[k].most_common(3)
        (ident, (vol, im), n) = max((identity(reads[k], window(p1, v, i)), (v, i), c) for (v, i), c in top)
        out.append({'key': k, 'vol': vol, 'imgnum': im, 'votes': n, 'grams': max(0, len(reads[k]) - G + 1), 'identity': ident,
                    'top3': [f'{v}:{i}:{c}' for (v, i), c in top]})
        print(k, vol, im, n, ident, file=sys.stderr)
    return out


def main():
    cmd, p1 = sys.argv[1], arg('--p1')
    pos = [a for a in sys.argv[2:] if not a.startswith('--') and a != p1]
    if cmd == 'check':
        return check(p1)
    rows = [json.loads(l) for l in open(pos[0], encoding='utf-8') if l.strip()]
    if cmd == 'locate':
        with open(pos[1], 'w', encoding='utf-8') as f:
            for r in locate(p1, rows):
                f.write(json.dumps(r, ensure_ascii=False) + '\n')
    elif cmd == 'score':
        pages = defaultdict(dict)
        for r in rows:
            pages[r['key']][r['route']] = {'identity': identity(manuscript_syllables(r['text']), window(p1, r['vol'], r['imgnum'])) if r.get('vol') else None}
        json.dump({'source': 'OpenPecha P000001 (Esukhia Derge Kangyur e-text), Pagination layer, window imgnum +- 2', 'pages': pages}, open(pos[1], 'w'), ensure_ascii=False)
    elif cmd == 'plants':
        # prep.py's rule: 3 plants per folio in syllables the draft has RIGHT against Derge; judge.mjs uses one of them.
        rng = random.Random(int(arg('--seed', '6740')))
        plants = {}
        for r in rows:
            txt, pl = prep.plant({'id': r['key'], 'served_text': r['served_text']}, window(p1, r['vol'], r['imgnum']), rng)
            plants[r['key']] = {'plants': pl}
        json.dump({'seed': int(arg('--seed', '6740')), 'rule': 'prep.py plant(): 3 per folio, in syllables the draft has right against Derge', 'anchor_ids': sorted(plants), 'plants': plants},
                  open(pos[1], 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
