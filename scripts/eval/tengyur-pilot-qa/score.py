#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tibetan-mt-ab/score.mjs — decodes a ranked multi-candidate packet
# (controls first, then per-engine scores). This packet has one English per item and three
# control kinds (NEG / PLANT / DUP), and Part B's 84000 packet is two pages with a planted and
# a duplicate candidate; the decoding differs enough that a separate 100-line scorer is clearer.
"""
Score Parts B, C and D of the Tengyur pilot QA (#5497). Controls are read FIRST; the headline
numbers are printed only if the controls pass.

  python3 score.py <work-dir> <keys-dir> <out.json>
"""
import json, statistics, sys
from collections import Counter

work, keys, out = sys.argv[1:4]
J = lambda p: json.load(open(p, encoding='utf8'))
L = lambda p: [json.loads(l) for l in open(p, encoding='utf8') if l.strip()]

# ── Part C ────────────────────────────────────────────────────────────────────────────────
key = J(f'{keys}/c-key.json')
plants = J(f'{keys}/plants.json')
v = {'A': {}, 'B': {}}
for j in 'AB':
    for h in '12':
        for r in L(f'{work}/c/out/{j}{h}.jsonl'):
            v[j][r['id']] = r
assert all(len(v[j]) == len(key) for j in 'AB'), {j: len(v[j]) for j in 'AB'}
num = lambda f: f if isinstance(f, (int, float)) else None
real_of = {}
for cid, k in key.items():
    if k['kind'] == 'REAL':
        real_of[(k['vol'], k['page'])] = cid

controls = {'NEG': [], 'PLANT': [], 'DUP': []}
for cid, k in key.items():
    if k['kind'] == 'NEG':
        for j in 'AB':
            controls['NEG'].append({'judge': j, 'vol': k['vol'], 'fidelity': v[j][cid]['fidelity'], 'pass': num(v[j][cid]['fidelity']) is not None and v[j][cid]['fidelity'] <= 2})
    elif k['kind'] == 'PLANT':
        orig = real_of[(k['vol'], k['page'])]
        for j in 'AB':
            p, o = v[j][cid], v[j][orig]
            caught = p['inversion'] or any(i['type'] == 'added_fact' for i in p['inventions'])
            # Did the judge point at the planted sentence (not some other slip)? A distinctive word of it.
            mark = {'113': 'town', '33': 'ultimate', '96': 'same entity', '174': 'capable', '157': 'Vulture'}[str(k['vol'])]
            quoted = mark.lower() in json.dumps(p['inversion_quotes'] + p['inventions'] + [p['reason']], ensure_ascii=False).lower()
            controls['PLANT'].append({'judge': j, 'vol': k['vol'], 'type': k['plant']['type'], 'caught_flag': caught, 'plant_quoted': quoted,
                                      'fid_plant': p['fidelity'], 'fid_orig': o['fidelity'], 'pass': caught})
    elif k['kind'] == 'DUP':
        orig = real_of[(k['vol'], k['page'])]
        for j in 'AB':
            a, b = v[j][cid], v[j][orig]
            controls['DUP'].append({'judge': j, 'vol': k['vol'], 'fid_dup': a['fidelity'], 'fid_orig': b['fidelity'],
                                    'same_fid': a['fidelity'] == b['fidelity'], 'same_inversion': a['inversion'] == b['inversion'], 'same_omission': a['omission'] == b['omission']})

real = [cid for cid, k in key.items() if k['kind'] == 'REAL']
def fid_stats(ids, j):
    f = [v[j][c]['fidelity'] for c in ids]
    n = [x for x in f if num(x) is not None]
    return {'n': len(f), 'cant_tell': len(f) - len(n), 'median': statistics.median(n) if n else None,
            'share_ge4': round(sum(1 for x in n if x >= 4) / len(n), 3) if n else None,
            'dist': dict(sorted(Counter(map(str, f)).items()))}
per_judge = {j: fid_stats(real, j) for j in 'AB'}
# mean of the two judges per page (cant_tell → the other judge's number)
pair = []
for c in real:
    a, b = num(v['A'][c]['fidelity']), num(v['B'][c]['fidelity'])
    pair.append((a, b))
both = [(a, b) for a, b in pair if a is not None and b is not None]
agree = {'exact': sum(a == b for a, b in both), 'within1': sum(abs(a - b) <= 1 for a, b in both), 'n': len(both),
         'omission_agree': sum(v['A'][c]['omission'] == v['B'][c]['omission'] for c in real),
         'inversion_agree': sum(v['A'][c]['inversion'] == v['B'][c]['inversion'] for c in real)}
combined = [((a if a is not None else b) + (b if b is not None else a)) / 2 for a, b in pair if a is not None or b is not None]
by_vol = {}
for vol in sorted({key[c]['vol'] for c in real}):
    ids = [c for c in real if key[c]['vol'] == vol]
    cf = [((num(v['A'][c]['fidelity']) or num(v['B'][c]['fidelity'])) + (num(v['B'][c]['fidelity']) or num(v['A'][c]['fidelity']))) / 2 for c in ids]
    by_vol[vol] = {'n': len(ids), 'median_mean_fid': statistics.median(cf), 'share_ge4': round(sum(x >= 4 for x in cf) / len(cf), 3),
                   'omission_either': sum(v['A'][c]['omission'] or v['B'][c]['omission'] for c in ids),
                   'inversion_either': sum(v['A'][c]['inversion'] or v['B'][c]['inversion'] for c in ids),
                   'inversion_both': sum(v['A'][c]['inversion'] and v['B'][c]['inversion'] for c in ids)}
inv_types = {j: Counter(i['type'] for c in real for i in v[j][c]['inventions']) for j in 'AB'}
pages_with_inv_type = {j: {t: sum(any(i['type'] == t for i in v[j][c]['inventions']) for c in real) for t in ('boundary', 'unreadable_fill', 'added_fact', 'gloss')} for j in 'AB'}
markup = {j: Counter(v[j][c].get('markup') for c in real) for j in 'AB'}
inversions = []
for c in real:
    for j in 'AB':
        for q in v[j][c].get('inversion_quotes') or []:
            inversions.append({'cid': c, 'judge': j, 'vol': key[c]['vol'], 'page': key[c]['page'], 'folio': key[c]['folio'],
                               'url': f"https://sourcelibrary.org/book/{key[c]['book_id']}?page={key[c]['page']}", **q,
                               'other_judge_flagged': v['B' if j == 'A' else 'A'][c]['inversion']})
omissions = []
for c in real:
    for j in 'AB':
        for o in v[j][c].get('omissions') or []:
            omissions.append({'cid': c, 'judge': j, 'vol': key[c]['vol'], 'page': key[c]['page'], 'omission': o})
low = sorted(({'cid': c, 'vol': key[c]['vol'], 'page': key[c]['page'], 'folio': key[c]['folio'], 'url': f"https://sourcelibrary.org/book/{key[c]['book_id']}?page={key[c]['page']}",
               'A': v['A'][c]['fidelity'], 'B': v['B'][c]['fidelity'], 'reasonA': v['A'][c]['reason'], 'reasonB': v['B'][c]['reason']} for c in real),
             key=lambda r: (num(r['A']) or 3) + (num(r['B']) or 3))[:8]
C = {'controls': {'NEG_pass': f"{sum(x['pass'] for x in controls['NEG'])}/{len(controls['NEG'])}",
                  'PLANT_pass': f"{sum(x['pass'] for x in controls['PLANT'])}/{len(controls['PLANT'])}",
                  'DUP_same_fidelity': f"{sum(x['same_fid'] for x in controls['DUP'])}/{len(controls['DUP'])}",
                  'DUP_same_inversion': f"{sum(x['same_inversion'] for x in controls['DUP'])}/{len(controls['DUP'])}",
                  'DUP_same_omission': f"{sum(x['same_omission'] for x in controls['DUP'])}/{len(controls['DUP'])}",
                  'detail': controls},
     'real_pages': len(real), 'per_judge': per_judge, 'agreement': agree,
     'combined': {'median': statistics.median(combined), 'share_ge4': round(sum(x >= 4 for x in combined) / len(combined), 3), 'n': len(combined)},
     'by_volume': by_vol,
     'omission_pages': {j: sum(v[j][c]['omission'] for c in real) for j in 'AB'},
     'omission_either': sum(v['A'][c]['omission'] or v['B'][c]['omission'] for c in real),
     'inversion_pages': {j: sum(v[j][c]['inversion'] for c in real) for j in 'AB'},
     'inversion_either': sum(v['A'][c]['inversion'] or v['B'][c]['inversion'] for c in real),
     'inversion_both': sum(v['A'][c]['inversion'] and v['B'][c]['inversion'] for c in real),
     'invention_mentions': inv_types, 'pages_with_invention_type': pages_with_inv_type, 'markup': markup,
     'inversions': inversions, 'omissions': omissions, 'lowest_pages': low}

# ── Part B ────────────────────────────────────────────────────────────────────────────────
bkey = J(f'{keys}/b-key.json')
B = {'pages': []}
for jf in ('judge1', 'judge2'):
    for r in L(f'{work}/b/out/{jf}.jsonl'):
        lab = bkey[r['id']]['labels']
        kinds = {lab[t]: s for t, s in r['scores'].items()}
        rank_kind = [[lab[t] for t in grp] for grp in r['ranking']]
        B['pages'].append({'judge': jf, 'page': bkey[r['id']]['page'], 'real': kinds['real'], 'plant': kinds['plant'], 'dup': kinds['dup'],
                           'ranking': rank_kind, 'plant_caught': kinds['plant'].get('inversion') or (num(kinds['plant']['fidelity']) or 9) < (num(kinds['real']['fidelity']) or 0),
                           'dup_tied_with_real': any('real' in g and 'dup' in g for g in rank_kind), 'reason': r.get('reason'), 'inversion_quotes': r.get('inversion_quotes')})

# ── Part D ────────────────────────────────────────────────────────────────────────────────
seeds = J(f'{keys}/d-seed-key.json')
rows = []
for b in (1, 2):
    rows += J(f'{work}/d/out/out-B{b}.json')
seed_rows = [r for r in rows if r['cid'] in seeds]
note_rows = [r for r in rows if r['cid'] not in seeds]
rank = {'wrong': 0, 'partly-wrong': 1, 'unverifiable': 2, 'correct': 3, 'no-claim': 4}
worst = {}
for r in note_rows:
    if r['cid'] not in worst or rank[r['verdict']] < rank[worst[r['cid']]]:
        worst[r['cid']] = r['verdict']
D = {'seeds': {cid: {'truth': seeds[cid]['truth'], 'verdicts': [r['verdict'] for r in seed_rows if r['cid'] == cid]} for cid in seeds},
     'seeds_caught': f"{sum(any(r['verdict'] in ('wrong', 'partly-wrong') for r in seed_rows if r['cid'] == cid) for cid in seeds)}/{len(seeds)}",
     'notes': len(worst), 'claims': len(note_rows),
     'by_note_worst': dict(Counter(worst.values())), 'by_claim': dict(Counter(r['verdict'] for r in note_rows)),
     'missing_url': sum(1 for r in note_rows if r['verdict'] in ('correct', 'wrong', 'partly-wrong') and not r.get('source_url')),
     'wrong_rows': [r for r in note_rows if r['verdict'] in ('wrong', 'partly-wrong')]}

res = {'C': C, 'B': B, 'D': D}
json.dump(res, open(out, 'w'), ensure_ascii=False, indent=1)
print(json.dumps({'C_controls': {k: v_ for k, v_ in C['controls'].items() if k != 'detail'}, 'C_per_judge': per_judge, 'C_agreement': agree, 'C_combined': C['combined'],
                  'C_by_volume': by_vol, 'C_omission': C['omission_pages'], 'C_inversion': C['inversion_pages'], 'C_inversion_both': C['inversion_both'],
                  'C_inv_pages': pages_with_inv_type, 'C_markup': {j: dict(m) for j, m in markup.items()},
                  'B': [{k: p[k] for k in ('judge', 'page', 'ranking', 'plant_caught', 'dup_tied_with_real')} | {'fid_real': p['real']['fidelity'], 'fid_plant': p['plant']['fidelity'], 'fid_dup': p['dup']['fidelity']} for p in B['pages']],
                  'D': {k: D[k] for k in ('seeds_caught', 'notes', 'claims', 'by_note_worst', 'by_claim', 'missing_url')}}, ensure_ascii=False, indent=1))
