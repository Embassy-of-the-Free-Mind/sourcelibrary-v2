"""Fresh read vs the stored edition-anchored text, per anchored leaf, against that leaf's edition excerpt (#7119).
PRIOR ART: score-fresh.py (the 9-leaf gate; same norm, mal2iast and per-row best-window CER), extended to every
edition-anchored leaf with the excerpt its collation used (reads/collate/<leaf>.excerpt.json). Writes
fresh-vs-anchored.json {leaf: {fresh_cer, anchored_cer, fresh_chars}}.
Usage: python score-all.py   (needs $JOB_SCRATCH/anchored-all.json from apply-fresh.mjs --dump)"""
import json, os, re, glob
from score_fresh_lib import norm, mal2iast, best
HERE = os.path.dirname(os.path.abspath(__file__)); S = os.environ['JOB_SCRATCH']
anch = json.load(open(f'{S}/anchored-all.json'))
corpus = json.load(open(f'{S}/corpus.json'))
out = {}
for lf, iast in anch.items():
    ex = json.load(open(f'{HERE}/reads/collate/{lf}.excerpt.json'))
    ref = norm(corpus[ex['corpus_start']:ex['corpus_end']])
    arows = [norm(re.sub(r'\[[^\]]*\]', ' ', l.split('. ', 1)[1])) for l in iast.split('\n') if re.match(r'^\d+\. ', l)]
    f = f'{HERE}/reads/fresh/{lf}.txt'
    frows = [norm(mal2iast(m.group(1))) for m in re.finditer(r'^ROW\s+\d+\s*\|\s*(.*)$', open(f).read(), re.M)] if os.path.exists(f) else []
    def cer(rows):
        rows = [x for x in rows if len(x) >= 8]; n = sum(map(len, rows))
        return (round(sum(best(x, ref) for x in rows) / n, 3), n) if n else (None, 0)
    fc, fn = cer(frows); ac, an = cer(arows)
    out[lf] = dict(fresh_cer=fc, fresh_chars=fn, anchored_cer=ac, anchored_chars=an)
json.dump(out, open(f'{HERE}/fresh-vs-anchored.json', 'w'), indent=0)
v = [x for x in out.values() if x['fresh_cer'] is not None]
print(len(out), 'anchored leaves;', len(v), 'with a fresh read;', sum(1 for x in v if x['fresh_cer'] < x['anchored_cer']), 'where the fresh read scores better')
