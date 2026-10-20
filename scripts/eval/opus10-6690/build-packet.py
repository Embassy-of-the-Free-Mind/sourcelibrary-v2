#!/usr/bin/env python3
# PRIOR ART: scripts/eval/pro-translate-6545/build-packet.py — the item line (build-xl-packet.py's line()), the label
# shuffle, the non-twin plants located by span (plant.mjs) and the one-item-per-agy-call request are its code; the
# rubric is its JUDGE-PROMPT-PRO.md, unchanged. What differs: two arms (O1, O10), the references are build-refs.py's,
# and every page carries its neighbours' source so a judge can see text moved across a page turn.
"""
build-packet.py — $0. Blind judge packet for #6690 under $W/judge/:
  req.jsonl   one agy request per item (rubric + the item inline)
  key.json    labels → arms, plants (no reference text; a copy without texts goes to results/)
  texts.json  the candidates by item (private: stays in $W)
Items: ARMS (each page: O1 and O10), PLANT (2 per run: O1 with ONE planted meaning error beside O10; a catch must be
located at its span), REPEAT (2 per run: an ARMS item again, labels reshuffled).
"""
import json, os, random, re, subprocess, sys
W = os.environ.get('W6690', os.path.join(os.environ.get('JOB_SCRATCH', '/tmp'), 'w'))
HERE = os.path.dirname(os.path.abspath(__file__))
P6545 = os.path.join(HERE, '..', 'pro-translate-6545')
RESULTS = os.path.join(HERE, '..', 'results', 'opus10-6690')
read = lambda p: [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]
NOTE_SLICE = ('Cut by script from the published translation around this page: it may begin and end up to about half a page '
              'before or after the page. Judge only against the part that matches the source; text outside the page is not '
              'missing from a candidate.')
NOTE_HE = ('The reference translates a different recension (Vilna 1886) whose section order differs from this 1627 print; '
           'it lists the sections this page holds, in the reference\'s order. A sentence on the page with no matching '
           'section has no reference: judge it against the source.')


def texts():
    o1 = {}
    for r in read('/mnt/HC_Volume_105839809/jobs/pro-translate-6545/w/arms/OPUS.jsonl'):   # the #6545 OPUS arm (anchors)
        if r.get('text'): o1[r['uid']] = r['text']
    for r in read(f'{W}/arms/O1.jsonl'):
        if r.get('text'): o1[r['uid']] = r['text']
    o10 = {}
    for r in read(f'{W}/arms/O10.jsonl'):
        if r.get('pages_text'): o10.update(r['pages_text'])
    return {'O1': o1, 'O10': o10}


def main():
    pages = read(f'{W}/pages.jsonl')
    recs = {r['id']: r for r in read('/root/pareto-6182/xl/records.jsonl')}
    refs = json.load(open(f'{W}/refs.json'))
    T = texts()
    meta = {}
    for p in pages:
        if p['anchor']: meta[p['run']] = recs[p['uid']]['reference_meta']
    rng = random.Random('6690')

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

    def item(p, cands):
        names = list(cands); rng.shuffle(names)
        lab = {f'T{i + 1}': n for i, n in enumerate(names)}
        return line(p, {t: cands[n] for t, n in lab.items()}), lab

    items, missing = [], []
    for p in pages:
        have = {a: T[a][p['uid']] for a in ('O1', 'O10') if p['uid'] in T[a]}
        if len(have) < 2: missing.append((p['uid'], sorted(have))); continue
        it, lab = item(p, have)
        items.append((it, {'kind': 'ARMS', 'page_id': p['uid'], 'run': p['run'], 'lang': p['lang'], 'labels': lab}))
    todo = []
    kinds = ['negation', 'number', 'name', 'clause']
    for run in ['fa', 'sa', 'zh', 'grc', 'he']:
        pu = [x[1]['page_id'] for x in items if x[1]['run'] == run]
        for i, u in enumerate(random.Random(f'plant-{run}').sample(pu, 2)):
            todo.append({'key': u, 'text': T['O1'][u], 'kinds': [kinds[(len(todo)) % 4]], 'seed': 6690 + len(todo)})
    out = json.loads(subprocess.check_output(['node', os.path.join(P6545, 'plant.mjs')], input=json.dumps(todo).encode()))
    byuid = {p['uid']: p for p in pages}
    for o in out:
        u = o['key']
        if not o['plants']: print('no plant site on', u); continue
        it, lab = item(byuid[u], {'O1_PLANT': o['text'], 'O10': T['O10'][u]})
        items.append((it, {'kind': 'PLANT', 'page_id': u, 'run': byuid[u]['run'], 'lang': byuid[u]['lang'], 'labels': lab, 'plant': o['plants'][0]}))
    for run in ['fa', 'sa', 'zh', 'grc', 'he']:
        a = [x for x in items if x[1]['kind'] == 'ARMS' and x[1]['run'] == run]
        for _, k0 in random.Random(f'rep-{run}').sample(a, 2):
            p = byuid[k0['page_id']]
            it, lab = item(p, {n: T[n][p['uid']] for n in ('O1', 'O10')})
            items.append((it, {'kind': 'REPEAT', 'page_id': p['uid'], 'run': run, 'lang': p['lang'], 'labels': lab}))
    rng.shuffle(items)
    key = {}
    for i, (it, k) in enumerate(items):
        it['id'] = f'j-{i + 1:03d}'; key[it['id']] = k
    os.makedirs(f'{W}/judge', exist_ok=True); os.makedirs(RESULTS, exist_ok=True)
    head = open(os.path.join(P6545, 'JUDGE-PROMPT-PRO.md'), encoding='utf-8').read()
    with open(f'{W}/judge/req.jsonl', 'w', encoding='utf-8') as f:
        for it, _ in items:
            f.write(json.dumps({'uid': it['id'], 'prompt': head + '\n\nITEM:\n' + json.dumps(it, ensure_ascii=False) + '\n'}, ensure_ascii=False) + '\n')
    json.dump({it['id']: it['translations'] for it, _ in items}, open(f'{W}/judge/texts.json', 'w'), ensure_ascii=False)
    k = {'items': key, 'missing': missing, 'refs_how': {u: r['how'] for u, r in refs.items()}}
    json.dump(k, open(f'{W}/judge/key.json', 'w'), ensure_ascii=False, indent=1)
    json.dump(k, open(f'{RESULTS}/key.json', 'w'), ensure_ascii=False, indent=1)
    print(len(items), 'items', {x: sum(1 for _, y in items if y['kind'] == x) for x in ('ARMS', 'PLANT', 'REPEAT')}, 'missing', missing)


if __name__ == '__main__':
    main()
