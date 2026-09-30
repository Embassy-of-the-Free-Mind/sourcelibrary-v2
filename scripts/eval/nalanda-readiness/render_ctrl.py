# PRIOR ART: none for Indic — scripts/eval has CJK/Latin anchor pages but no rendered-e-text control; looked in scripts/eval/lib and scripts/eval/INDEX.md.
# Positive control for the ENGINE: render GRETIL passages (IAST -> Devanagari) as clean printed pages.
import json, re, random, sys, os, html
sys.argv = ['x']
from indic_transliteration import sanscript
PT = 'gretil/skt/1_sanskr/tei/transformations/plaintext/'
picks = ['sa_nAgArjuna-mUlamadhyamakakArikA.txt', 'sa_vasubandhu-abhidharmakozabhASya.txt', 'sa_zAntideva-bodhicaryAvatAra.txt', 'sa_aSTasAhasrikA-prajJApAramitA.txt']
rng = random.Random(11)
os.makedirs('ctrl', exist_ok=True)
rows = []
for f in picks:
    p = PT + f
    if not os.path.exists(p):
        cands = [x for x in os.listdir(PT) if f.split('-')[-1][:10].lower() in x.lower()]
        print('missing', f, cands[:3]); continue
    raw = open(p, encoding='utf-8').read()
    body = raw[raw.find('# Text'):] if '# Text' in raw else raw
    lines = [l.strip() for l in body.splitlines() if l.strip() and not l.startswith('#')]
    st = rng.randrange(len(lines) // 4, len(lines) * 3 // 4)
    chunk, n = [], 0
    for l in lines[st:]:
        l = re.sub(r"\S*[\d_]\S*", "", l).replace('/', '।').replace('|', '।').strip()
        if not l: continue
        chunk.append(l); n += len(l)
        if n > 1100: break
    iast = '\n'.join(chunk)
    deva = sanscript.transliterate(iast, sanscript.IAST, sanscript.DEVANAGARI)
    name = f.replace('.txt', '')
    page = f"""<html><head><meta charset=utf-8><style>body{{width:1000px;margin:60px;font-family:'Kohinoor Devanagari','Devanagari Sangam MN',serif;font-size:26px;line-height:1.7;background:#fff;color:#111}}</style></head><body>{'<br>'.join(html.escape(x) for x in deva.splitlines())}</body></html>"""
    open(f'ctrl/{name}.html', 'w').write(page)
    rows.append({'id': f'render:{name}', 'file': p, 'iast': iast, 'deva': deva})
json.dump(rows, open('ctrl/rows.json', 'w'), ensure_ascii=False)
print(len(rows), [r['id'] for r in rows])
