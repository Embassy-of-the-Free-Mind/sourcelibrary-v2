#!/usr/bin/env python3
# PRIOR ART: scripts/eval/opus10-6690/build-packet.py (PR #6700) — its item line, reference notes and the #6545 rubric
# are kept; it judged two arms in one order with separate repeats. This judges three arms (O1, O10, F = 3.8 Flash low)
# per page in TWO orders (B is A rotated by one, so every arm changes position), and reuses #6690's ten planted O1
# texts unchanged, now beside O10 and F. Inputs are #6690's $JOB_SCRATCH/w files (pages, refs, arms) plus arms/F.jsonl.
"""
build-packet.py — $0. Blind judge packet for the #6690 Flash round under $W/judge/:
  req.jsonl   one request per item (JUDGE-PROMPT-PRO.md + the item inline); both judges get the same requests
  key.json    item → {kind, page_id, run, order, labels → arm, plant}; a copy without texts goes to results/
  texts.json  the candidates by item (private: quotes published translations' neighbours; stays in $W)
Items: ARMS (each page × orders A and B: O1, O10, F) and PLANT (#6690's 10 planted O1 copies beside O10 and F, × A and B).
  W6690=/…/opus10-flash-6690/w python3 scripts/eval/opus10-flash-6690/build-packet.py
"""
import json, os, random, sys
W = os.environ.get('W6690', os.path.join(os.environ.get('JOB_SCRATCH', '/tmp'), 'w'))
OLD = os.environ.get('W6690_OLD', '/mnt/HC_Volume_105839809/jobs/opus10-6690/w')   # the #6690 round (PR #6700)
HERE = os.path.dirname(os.path.abspath(__file__))
P6545 = os.path.join(HERE, '..', 'pro-translate-6545')
RESULTS = os.path.join(HERE, '..', 'results', 'opus10-flash-6690')
sys.path.insert(0, P6545)
from arms import latest            # noqa: E402  (#6545: last row per uid wins)
from prompts import unwrap         # noqa: E402
read = lambda p: [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]
NOTE_SLICE = ('Cut by script from the published translation around this page: it may begin and end up to about half a page '
              'before or after the page. Judge only against the part that matches the source; text outside the page is not '
              'missing from a candidate.')
NOTE_HE = ('The reference translates a different recension (Vilna 1886) whose section order differs from this 1627 print; '
           'it lists the sections this page holds, in the reference\'s order. A sentence on the page with no matching '
           'section has no reference: judge it against the source.')
ARMS = ('O1', 'O10', 'F')


def texts():
    o1 = {}
    for r in read('/mnt/HC_Volume_105839809/jobs/pro-translate-6545/w/arms/OPUS.jsonl'):   # the #6545 OPUS arm (anchors)
        if r.get('text'): o1[r['uid']] = r['text']
    for r in read(f'{W}/arms/O1.jsonl'):
        if r.get('text'): o1[r['uid']] = r['text']
    o10 = {}
    for r in read(f'{W}/arms/O10.jsonl'):
        if r.get('pages_text'): o10.update(r['pages_text'])
    f, fails = {}, {}
    for u, r in latest(f'{W}/arms/F.jsonl').items():
        t, prob = unwrap(r.get('raw') or r.get('text') or '')
        if (r.get('text') or '').strip() and prob != 'empty' and not r.get('blocked'): f[u] = t
        else: fails[u] = (r.get('error') or prob or 'empty')[:80]
    return {'O1': o1, 'O10': o10, 'F': f}, fails


def main():
    pages = read(f'{W}/pages.jsonl')
    recs = {r['id']: r for r in read('/root/pareto-6182/xl/records.jsonl')}
    refs = json.load(open(f'{W}/refs.json'))
    T, fails = texts()
    meta = {p['run']: recs[p['uid']]['reference_meta'] for p in pages if p['anchor']}
    byuid = {p['uid']: p for p in pages}
    rng = random.Random('6690-flash')

    def line(p, labels):
        m = meta[p['run']]; r = refs[p['uid']]
        o = {'id': None, 'lang': p['lang'], 'reference_title': m.get('title'), 'reference_translator': m.get('translator'),
             'reference_year': m.get('year'), 'reference_style': m.get('style')}
        if p['anchor']:
            if m.get('located'): o['reference_located'] = m['located']
            if m.get('coverage_note'): o['reference_note'] = m['coverage_note']
        else:
            o['reference_note'] = NOTE_HE if p['run'] == 'he' else NOTE_SLICE
        if p.get('source_prev_tail'): o['source_prev_tail'] = p['source_prev_tail']
        o['source'] = p['ocr_text']
        if p.get('source_next_head'): o['source_next_head'] = p['source_next_head']
        o['reference'] = r['text']
        o['n'] = len(labels); o['translations'] = labels
        return o

    def pair(p, cands, kind, extra=None):
        """Two items for one page: order A shuffled, order B = A rotated by one (every arm moves)."""
        a = list(cands); rng.shuffle(a); b = a[1:] + a[:1]
        out = []
        for order, names in (('A', a), ('B', b)):
            lab = {f'T{i + 1}': n for i, n in enumerate(names)}
            k = {'kind': kind, 'page_id': p['uid'], 'run': p['run'], 'lang': p['lang'], 'order': order, 'labels': lab, **(extra or {})}
            out.append((line(p, {t: cands[n] for t, n in lab.items()}), k))
        return out

    items, missing = [], []
    for p in pages:
        have = {a: T[a][p['uid']] for a in ARMS if p['uid'] in T[a]}
        if len(have) < 3: missing.append((p['uid'], sorted(have))); continue
        items += pair(p, have, 'ARMS')
    # #6690's planted O1 copies, byte for byte
    ok, ot = json.load(open(f'{OLD}/judge/key.json'))['items'], json.load(open(f'{OLD}/judge/texts.json'))
    for i, k in ok.items():
        if k['kind'] != 'PLANT': continue
        u = k['page_id']; lab = next(l for l, n in k['labels'].items() if n == 'O1_PLANT')
        if u not in T['F']: missing.append((u, 'PLANT: no F')); continue
        items += pair(byuid[u], {'O1_PLANT': ot[i][lab], 'O10': T['O10'][u], 'F': T['F'][u]}, 'PLANT', {'plant': k['plant'], 'plant_6690_item': i})
    rng.shuffle(items)
    key = {}
    for n, (it, k) in enumerate(items):
        it['id'] = f'k-{n + 1:03d}'; key[it['id']] = k
    os.makedirs(f'{W}/judge', exist_ok=True); os.makedirs(RESULTS, exist_ok=True)
    head = open(os.path.join(P6545, 'JUDGE-PROMPT-PRO.md'), encoding='utf-8').read()
    with open(f'{W}/judge/req.jsonl', 'w', encoding='utf-8') as f:
        for it, _ in items:
            f.write(json.dumps({'uid': it['id'], 'prompt': head + '\n\nITEM:\n' + json.dumps(it, ensure_ascii=False) + '\n'}, ensure_ascii=False) + '\n')
    json.dump({it['id']: it['translations'] for it, _ in items}, open(f'{W}/judge/texts.json', 'w'), ensure_ascii=False)
    k = {'items': key, 'missing': missing, 'flash_failures': fails}
    json.dump(k, open(f'{W}/judge/key.json', 'w'), ensure_ascii=False, indent=1)
    json.dump(k, open(f'{RESULTS}/key.json', 'w'), ensure_ascii=False, indent=1)
    print(len(items), 'items', {x: sum(1 for _, y in items if y['kind'] == x) for x in ('ARMS', 'PLANT')}, 'missing', missing, 'flash failures', fails)


if __name__ == '__main__':
    main()
