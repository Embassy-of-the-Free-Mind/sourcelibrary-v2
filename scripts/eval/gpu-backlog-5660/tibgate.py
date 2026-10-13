#!/usr/bin/env python3
"""Tibetan gate for job gpu-backlog-5660 (#5660), per shard, BEFORE the shard is applied.
usage: tibgate.py <shard k> <tag>   (shard reads already pulled to bo/run-s<k>/ and judged by judge.py with YIG_D=bo)
accuracy: one random SERVED page per Kangyur-titled book in the shard, kanjur_align.py vs the Derge Kangyur e-text (+shuffle floor)
fabrication screen: served pages whose RAW read has Devanagari / Latin / CJK lines (the judge strips them; they are counted)
by eye: 10 other books, one random served page each -> gates/<tag>/eye/{stem}.jpg + .txt (stripped text = what would be written)
"""
import json, os, re, sys, random, statistics, subprocess, collections
B = '/root/gpu-backlog-5660/bo'; k, tag = sys.argv[1], sys.argv[2]
G = f'{B}/gates/{tag}'; os.makedirs(f'{G}/eye', exist_ok=True)
todo = {json.loads(l)['stem']: json.loads(l) for l in open(f'{B}/todo-all.jsonl')}
shard_books = {json.loads(l)['book'] for l in open(f'{B}/shard-{k}.jsonl')}
gate = {json.loads(l)['id']: json.loads(l) for l in open(f'{B}/gate.jsonl')}
dec = [json.loads(l) for l in open(f'{B}/decisions.jsonl')]
dec = [d for d in dec if d['book'] in shard_books]
cls = collections.Counter(f"{d['class']}:{d['reason']}" for d in dec)
served = [d for d in dec if d['class'] == 'serve']
by_book = collections.defaultdict(list)
for d in served: by_book[d['book']].append(d)
rng = random.Random(f'5660-{tag}')
KANG = re.compile(r'Kanjur|Kangyur|བཀའ་འགྱུར|bka. .gyur', re.I)
kb = sorted(b for b in by_book if KANG.search(gate[b]['title'] or ''))
pick = [rng.choice(sorted(by_book[b], key=lambda d: d['stem'])) for b in kb]
with open(f'{G}/acc-in.jsonl', 'w') as f:
    for d in pick:
        f.write(json.dumps({'id': d['stem'], 'page': d['page'], 'text': open(f"{B}/stripped/{d['stem']}.txt", encoding='utf-8').read(), 'arm': 'yigdzin'}, ensure_ascii=False) + '\n')
for shuf in (False, True):
    subprocess.run(['python3', '/root/tibetan-eval/kanjur_align.py', 'score', '--index', '/root/tibetan-eval/etext-index-full.pkl', '--pages', f'{G}/acc-in.jsonl', '--out', f"{G}/acc{'-shuffle' if shuf else ''}.jsonl"] + (['--control-shuffle'] if shuf else []), check=True, cwd='/root/tibetan-eval', capture_output=True)
acc = [json.loads(l) for l in open(f'{G}/acc.jsonl')]; fl = [json.loads(l)['identity'] for l in open(f'{G}/acc-shuffle.jsonl')]
ids = [a['identity'] for a in acc]
# fabrication screen over every served page of the shard: non-Tibetan script in the RAW leaf read
DEV = re.compile(r'[ऀ-ॿ]'); LAT = re.compile(r'[A-Za-z]{3,}'); CJK = re.compile(r'[㐀-鿿]')
fab = collections.Counter(); fab_list = []
for d in served:
    raw = open(f"{B}/leafdir/{d['stem']}.txt", encoding='utf-8', errors='replace').read()
    hit = [n for n, rx in (('devanagari', DEV), ('latin', LAT), ('cjk', CJK)) if rx.search(raw)]
    for h in hit: fab[h] += 1
    if hit: fab_list.append({'stem': d['stem'], 'scripts': hit, 'stripped_lines': d.get('stripped')})
json.dump(fab_list, open(f'{G}/foreign-script-pages.json', 'w'), indent=1)
# by eye: 10 non-Kangyur books first (the accuracy books are covered by the reference), one served page each
others = sorted(set(by_book) - set(kb)); rng.shuffle(others); pool = others + kb
eye = []
for b in pool[:10]:
    d = rng.choice(sorted(by_book[b], key=lambda d: d['stem'])); t = todo[d['stem']]
    subprocess.run(['curl', '-s', '-m', '60', '-o', f"{G}/eye/{d['stem']}.jpg", t['url']])
    open(f"{G}/eye/{d['stem']}.txt", 'w', encoding='utf-8').write(open(f"{B}/stripped/{d['stem']}.txt", encoding='utf-8').read())
    g = gate[b]; eye.append({'stem': d['stem'], 'book': b, 'page': d['page'], 'title': g['title'], 'class': 'manuscript' if g['provider'] == 'bl' or g['bc'] == 'handwritten' else 'woodblock', 'link': f"https://sourcelibrary.org/book/{b}?page={d['page']}"})
json.dump(eye, open(f'{G}/eye/list.json', 'w'), ensure_ascii=False, indent=1)
q = statistics.quantiles(ids, n=4) if len(ids) >= 4 else [None, None, None]
summ = {'issue': 5660, 'lane': 'bo', 'tag': tag, 'shard': k, 'pages_judged': len(dec), 'served': len(served), 'classes': dict(cls.most_common()),
        'accuracy': {'measure': 'accuracy', 'ref': 'Derge Kangyur e-text (kanjur_align NW syllable identity)', 'n_books': len(ids), 'median_identity': round(statistics.median(ids), 4) if ids else None,
                     'iqr': [round(q[0], 4), round(q[2], 4)] if ids and len(ids) >= 4 else None, 'ge_0_9': sum(x >= 0.9 for x in ids), 'shuffle_floor_median': round(statistics.median(fl), 4) if fl else None,
                     'earlier': '0.947 manuscripts (#4523, 100 books), 0.955 woodblock canary (#5660, 30 books)'},
        'foreign_script_raw': dict(fab), 'eye_packet': len(eye)}
json.dump(summ, open(f'{G}/summary.json', 'w'), indent=1); print(json.dumps(summ, indent=1))
