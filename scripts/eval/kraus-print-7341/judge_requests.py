#!/usr/bin/env python3
# PRIOR ART: scripts/eval/arabic-mss-gate-7341/judge.py — the two-family usability judge, its prompt, plant3() and its
# score step, all imported unchanged. Its `requests` draws the 6 planted controls from six MANUSCRIPT books, so on a
# one-book print set it plants nothing; this draws them from six Kraus pages instead (donor clause from another page).
"""
Judge requests for the Kraus 25-page print test (#7341): every read of every arm, plus 6 planted copies (3 Opus,
3 Gemini, six different pages), written where judge.py's `score` step reads them.

  python3 scripts/eval/kraus-print-7341/judge_requests.py      # then run the two judges, then judge.py score
"""
import importlib.util, json, os, random

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('gj', os.path.join(HERE, '..', 'arabic-mss-gate-7341', 'judge.py'))
gj = importlib.util.module_from_spec(spec); spec.loader.exec_module(gj)

root = os.path.join(os.environ['JOB_SCRATCH'], 'g')
S = os.path.join(root, 'setB')
picks = json.load(open(os.path.join(S, 'draw.json')))['picks']
uids = [p['uid'] for p in picks]; img = {p['uid']: p['image'] for p in picks}
R = gj.arm_reads(S, uids)
rng = random.Random(7341)
items = [{'iid': f'{arm}|{u}', 'uid': u, 'arm': arm, 'text': R[arm][u]} for u in uids for arm in gj.ARMS if u in R[arm]]
order = uids[:]; rng.shuffle(order)
plants, n = {}, 0
for u in order:
    if n == 6:
        break
    arm = 'opus' if n % 2 == 0 else 'f38l'
    if u not in R[arm]:
        continue
    donor_u = rng.choice([x for x in R['opus'] if x != u])
    t, pl = gj.plant3(R[arm][u], R['opus'][donor_u], rng)
    if not t:
        continue
    iid = f'plant-{arm}|{u}'
    items.append({'iid': iid, 'uid': u, 'arm': f'plant-{arm}', 'text': t, 'donor': donor_u})
    plants[iid] = pl; n += 1
rng.shuffle(items)
os.makedirs(gj.J(root), exist_ok=True)
json.dump(items, open(gj.J(root, 'items.json'), 'w'), ensure_ascii=False, indent=1)
json.dump(plants, open(gj.J(root, 'plants.json'), 'w'), ensure_ascii=False, indent=1)
for fam in ('claude', 'gemini'):
    with open(gj.J(root, f'req-{fam}.jsonl'), 'w') as f:
        for it in items:
            f.write(json.dumps({'uid': it['iid'], 'image': img[it['uid']], 'prompt': gj.PROMPT.format(text=it['text'])}, ensure_ascii=False) + '\n')
print(len(items), 'items;', len(plants), 'planted copies; failed reads graded FAILED without a call:',
      sum(1 for u in uids for a in gj.ARMS if u not in R[a]))
