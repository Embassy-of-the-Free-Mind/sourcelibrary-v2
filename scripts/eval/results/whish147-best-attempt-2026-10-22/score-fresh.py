"""Gate for the fresh Opus read (#7119): per-row CER against GRETIL, the corrected instrument of #7148.
PRIOR ART: ../whish147-line-strips-2026-10-22/score-lines.py — its norm(), mal2iast(fix) and best-window per-row CER
are copied unchanged; the verse span comes from this run's locate (locate-A.json: the leaf's offsets in editions/sk.txt,
±200 characters), since the fresh read covers the whole leaf, not its left half.
Usage: python score-fresh.py <stage> [<stage> ...]   (anchored text scored as arm 'anchored')
"""
import sys, re, json, os, random, unicodedata
from indic_transliteration import sanscript as s
from rapidfuzz.distance import Levenshtein
HERE = os.path.dirname(os.path.abspath(__file__)); S = os.environ['JOB_SCRATCH']
LEAVES = ['4-b', '5-t', '5-b', '6-t', '6-b', '7-t', '8-t', '8-b', '9-t']
SK = open(f'{S}/editions/sk.txt').read()
LOC = json.load(open(f'{HERE}/locate-A.json'))
def norm(t):
    t = unicodedata.normalize('NFC', t).lower()
    t = re.sub(r"[0-9\-'’`.\s|,;:()\[\]^*/_]|sk_\d+", '', t)
    t = re.sub(r'r([kgcjṭḍtdpbm])\1', r'r\1', t)
    t = re.sub(r'(?:ṃ|ṅ|ñ|ṇ)(?=[kgcjṭḍtdpb])', 'm', t)
    return t.replace('ṃ', 'm')
def mal2iast(txt):
    txt = re.sub(r'\[[^\]]*\]', ' ', txt); txt = re.sub(r'<[^>]+>', ' ', txt)
    mal = ''.join(ch for ch in txt if 'ഀ' <= ch <= 'ൿ' or ch.isspace())
    for a, b in (('ൎ', 'ര്'), ('ൽ', 'ല്'), ('ൻ', 'ന്'), ('ർ', 'ര്'), ('ൾ', 'ള്'), ('ൺ', 'ണ്')): mal = mal.replace(a, b)
    return s.transliterate(mal, s.MALAYALAM, s.IAST).replace('è', 'e').replace('ò', 'o')
def best(h, ref):
    m = len(h)
    if m > len(ref): return Levenshtein.distance(h, ref)
    return min(Levenshtein.distance(h, ref[k:k + m]) for k in range(0, len(ref) - m + 1))
full = norm(SK)
random.seed(7)
anch = json.load(open(f'{S}/anchored-verse.json'))
res = {}
for arm in sys.argv[1:] + ['anchored']:
    for lf in LEAVES:
        if arm == 'anchored':
            rows = [re.sub(r'\[[^\]]*\]', ' ', l.split('. ', 1)[1]) for l in anch.get(lf, '').split('\n') if re.match(r'^\d+\. ', l)]
            segs = [norm(r) for r in rows]
        else:
            f = f'{HERE}/reads/{arm}/{lf}.txt'
            if not os.path.exists(f): continue
            rows = [m.group(1) for m in re.finditer(r'^ROW\s+\d+\s*\|\s*(.*)$', open(f).read(), re.M)]
            segs = [norm(mal2iast(r)) for r in rows]
        segs = [x for x in segs if len(x) >= 8]
        l = LOC[lf]; a, b = max(0, l['start'] - 200), min(len(SK), l['end'] + 200)
        ref = norm(SK[a:b])
        d = sum(best(x, ref) for x in segs); n = sum(len(x) for x in segs)
        fd = 0
        for x in segs:
            i = random.randrange(0, len(full) - len(x)); sh = list(full[i:i + len(x)]); random.shuffle(sh); fd += best(''.join(sh), ref)
        res[f'{arm}|{lf}'] = dict(arm=arm, leaf=lf, rows=len(segs), chars=n, cer=round(d / n, 3) if n else None, floor=round(fd / n, 3) if n else None, _d=d, _fd=fd)
for arm in sys.argv[1:] + ['anchored']:
    vs = [v for v in res.values() if v['arm'] == arm and v['chars']]
    if not vs: continue
    D = sum(v['_d'] for v in vs); N = sum(v['chars'] for v in vs); F = sum(v['_fd'] for v in vs)
    print(f"{arm:10} leaves {len(vs)} chars {N} pooled CER {D/N:.3f} floor {F/N:.3f}  by leaf: " + ' '.join(f"{v['leaf']}={v['cer']}" for v in vs))
json.dump(res, open(f'{HERE}/fresh-gate-scores.json', 'w'), indent=1)
