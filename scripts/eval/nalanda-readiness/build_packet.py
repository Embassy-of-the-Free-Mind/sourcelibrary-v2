# PRIOR ART: scripts/eval/tibetan-mt-ab/build-judge-packet.mjs (same blinding + positive/same-arm controls, Tibetan vs 84000); this is the Sanskrit variant with public-domain references.
# Blinded packet for the Sanskrit fidelity judge. T-labels shuffled per page (seed recorded).
# Controls: POSITIVE = the published reference itself offered as a candidate (must score 4–5; only on
# brahmasutra/yogasutra pages, where the reference covers the whole page); NEGATIVE = the served English of
# a DIFFERENT page of the same book (must score 1–2 with invention). Keys go to key.json, never to judges.
import json, glob, random, os
rng = random.Random(20260930)
pages = {os.path.basename(p)[:-5]: json.load(open(p)) for p in sorted(glob.glob('pages/*.json'))}
rows, key = [], {}
located = {}
for pid in pages:
    rf = f'refs/{pid}.ref.txt'
    if not os.path.exists(rf): continue
    txt = open(rf).read()
    if txt.startswith('NOT LOCATED'): continue
    first, _, body = txt.partition('\n'); located[pid] = (first, body.strip())
pos_ids = [p for p in located if p.startswith(('brahmasutra', 'yogasutra'))][:2]
neg_ids = [p for p in located if p.startswith('manu')][:1] + [p for p in located if p.startswith('yogasutra')][1:2]
for pid, (note, ref) in located.items():
    cands = {'served': pages[pid]['english']}
    if pid in pos_ids: cands['ctrl_reference'] = ref
    if pid in neg_ids:
        other = [q for q in pages if q.startswith(pid.split('_')[0]) and q != pid][0]
        cands['ctrl_wrong_page'] = pages[other]['english']
    arms = list(cands); rng.shuffle(arms)
    labels = {f'T{i+1}': a for i, a in enumerate(arms)}
    key[pid] = labels
    rows.append({'id': pid, 'work': pages[pid]['work'], 'reference_note': note, 'source': pages[pid]['source'],
                 'reference': ref, 'translations': {l: cands[a] for l, a in labels.items()}})
with open('packet.jsonl', 'w') as f:
    for r in rows: f.write(json.dumps(r, ensure_ascii=False) + '\n')
json.dump({'seed': 20260930, 'labels': key, 'positive_control': pos_ids, 'negative_control': neg_ids}, open('key.json', 'w'), indent=1)
print(len(rows), 'pages', 'pos', pos_ids, 'neg', neg_ids)
