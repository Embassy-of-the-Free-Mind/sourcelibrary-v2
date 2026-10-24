# PRIOR ART: scripts/eval/results/whish147-palm-leaf-opus-2026-10-21/score_vs_gretil.py — same normalisation and
# best-window Levenshtein CER. It scores a whole read as one string against one contiguous window, which penalises any
# read of a half-leaf (each row is only the first part of a leaf line; the rest is on the other half). This adds a
# per-row score: each row is matched alone inside the leaf's located verse span, with a noise floor built the same way.
import sys, re, json, glob, os, random, unicodedata
from indic_transliteration import sanscript as s
from rapidfuzz.distance import Levenshtein
from rapidfuzz import fuzz
OUT, SK, LOC, STRIPS = sys.argv[1:5]
FIX = len(sys.argv) > 5 and sys.argv[5] == 'fix'   # 'fix' = the corrected normalisation; without it, the 2026-10-21 one
sk = json.load(open(SK))
def norm(t):
    t = unicodedata.normalize('NFC', t).lower()
    t = re.sub(r"[0-9\-'’`.\s|,;:()\[\]^*/_]|sk_\d+", '', t)
    t = re.sub(r'r([kgcjṭḍtdpbm])\1', r'r\1', t)
    t = re.sub(r'(?:ṃ|ṅ|ñ|ṇ)(?=[kgcjṭḍtdpb])', 'm', t)
    return t.replace('ṃ', 'm')
def mal2iast(txt):
    txt = re.sub(r'\[illegible\]', ' ', txt); txt = re.sub(r'<[^>]+>', ' ', txt)
    mal = ''.join(ch for ch in txt if 'ഀ' <= ch <= 'ൿ' or ch.isspace())
    if FIX:   # old Malayalam orthography: dot reph and chillu letters are r/l/n/ḷ/ṇ + virama; one e and one o sign (short in the table, long in Sanskrit)
        for a, b in (('ൎ', 'ര്'), ('ൽ', 'ല്'), ('ൻ', 'ന്'), ('ർ', 'ര്'), ('ൾ', 'ള്'), ('ൺ', 'ണ്')): mal = mal.replace(a, b)
    out = s.transliterate(mal, s.MALAYALAM, s.IAST)
    return out.replace('è', 'e').replace('ò', 'o') if FIX else out
full_ref = norm(' '.join(sk[k] for k in sorted(sk, key=int)))
def span(lf):
    t = open(f'{LOC}/{lf}.txt').read()
    a = int(re.search(r'FIRST_VISIBLE_VERSE=(\d+)', t).group(1)); b = int(re.search(r'LAST_VISIBLE_VERSE=(\d+)', t).group(1))
    return a, b, norm(' '.join(sk[str(v)] for v in range(max(1, a-1), min(72, b+1)+1) if str(v) in sk))
def best(h, ref):
    m = len(h)
    if m > len(ref): return Levenshtein.distance(h, ref)
    return min(Levenshtein.distance(h, ref[k:k+m]) for k in range(0, len(ref)-m+1))
def whole(h):   # the 2026-10-21 instrument, unchanged
    al = fuzz.partial_ratio_alignment(h, full_ref)
    return min(Levenshtein.distance(h, full_ref[i:i+len(h)]) for i in range(max(0, al.dest_start-200), min(len(full_ref), al.dest_start+200))) / len(h)
def rows_half(text):
    body = re.sub(r'<(warning|meta|scan-quality|language|script|page-type)>[\s\S]*?</\1>', ' ', text)
    return [l for l in body.split('\n') if re.search('[ഀ-ൿ]', l)]
def rows_strip(text, lf, strips):
    parts = re.split(r'^[ \t]*=====\s*PAGE\s+p\d{2}\s*=====[ \t]*$', text, flags=re.M)[1:]
    rows = {}
    for r, ptxt in zip(strips[lf], parts): rows.setdefault(r['k'], []).append(ptxt)
    return [' '.join(rows[k]) for k in sorted(rows)]
strips = json.load(open(STRIPS))
random.seed(7)
res = {}
for f in sorted(glob.glob(f'{OUT}/*-*-*.txt')):
    arm, lf = os.path.basename(f)[:-4].rsplit('-', 1)
    text = open(f).read()
    a, b, ref = span(lf)
    rows = rows_half(text) if arm.endswith('half') else rows_strip(text, lf, strips)
    segs = [norm(mal2iast(r)) for r in rows]; segs = [x for x in segs if len(x) >= 8]
    d = sum(best(x, ref) for x in segs); n = sum(len(x) for x in segs)
    # noise floor, same lengths, same span: shuffled letters of a random slice; a reversed real passage from outside the span
    fd = 0
    for x in segs:
        i = random.randrange(0, len(full_ref)-len(x)); sh = list(full_ref[i:i+len(x)]); random.shuffle(sh)
        fd += best(''.join(sh), ref)
    rd = 0
    for x in segs:
        i = random.randrange(0, len(full_ref)-len(x)); rd += best(full_ref[i:i+len(x)][::-1], ref)
    whole_h = norm(mal2iast('\n'.join(rows)))
    res[f'{arm}|{lf}'] = dict(arm=arm, leaf=lf, verses=[a, b], rows=len(segs), chars=n,
        row_cer=round(d/n, 3) if n else None, floor_shuffled=round(fd/n, 3) if n else None, floor_reversed=round(rd/n, 3) if n else None,
        whole_cer=round(whole(whole_h), 3) if len(whole_h) >= 20 else None, whole_chars=len(whole_h), _d=d, _fd=fd, _rd=rd)
json.dump(res, open(f"{OUT}/scores{'-fix' if FIX else ''}.json", 'w'), indent=1, ensure_ascii=False)
arms = sorted({v['arm'] for v in res.values()})
print('arm          leaf  rows chars  rowCER  floorSh floorRev  wholeCER')
for k, v in sorted(res.items()):
    print(f"{v['arm']:12} {v['leaf']:4} {v['rows']:4} {v['chars']:5}  {v['row_cer']}   {v['floor_shuffled']}   {v['floor_reversed']}    {v['whole_cer']}")
for arm in arms:
    vs = [v for v in res.values() if v['arm'] == arm and v['chars']]
    D = sum(v['_d'] for v in vs); N = sum(v['chars'] for v in vs)
    per = sorted(v['row_cer'] for v in vs); wh = sorted(v['whole_cer'] for v in vs if v['whole_cer'] is not None)
    print(f"POOLED {arm:12} leaves {len(vs)} chars {N} rowCER {D/N:.3f} (leaf range {per[0]}–{per[-1]}, median {per[len(per)//2]})  floor shuffled {sum(v['_fd'] for v in vs)/N:.3f} reversed {sum(v['_rd'] for v in vs)/N:.3f}  wholeCER median {wh[len(wh)//2] if wh else None} range {wh[0] if wh else ''}–{wh[-1] if wh else ''}")
