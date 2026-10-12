#!/usr/bin/env python3
# PRIOR ART: none — scripts/eval/pro-translate-6545/score.py (on the #6545 branch) scores the arms against each
# other; nothing scores a pinned prediction file against an experiment's result (#6557).
"""Score the pinned #6545 stage-1 predictions (v0 and v1) against the stage-1 result.

  score-6545.py --scores <#6545 r1s1/scores.json> --source-commit SHA \\
      --pin v0=predictions/6545-stage1.json --pin v1=predictions/6545-stage1-v1.json \\
      [--sens name=file ...] --out results/6545-stage1-scored.json

A cell is covered when the observed panel mean lies inside the pinned 90% interval. The pins assumed two Opus
judges per page and a round of the #6182-style panel; --sens files are the same v1 posterior under other
assumptions, computed AFTER the result was known. They explain a miss; they are not predictions.
"""
import argparse, json

ap = argparse.ArgumentParser()
ap.add_argument('--scores', required=True)
ap.add_argument('--source-commit', required=True)
ap.add_argument('--pin', action='append', required=True)
ap.add_argument('--sens', action='append', default=[])
ap.add_argument('--out', required=True)
a = ap.parse_args()

res = json.load(open(a.scores))
ARM = dict(c38='C38', pro='PRO', opus='OPUS', stored='FP', corr38='CF', corrO='CO')
NAME = dict(c38='3.8 Flash CLI (stored output)', pro='3.1 Pro CLI, default thinking', opus='Opus',
            stored='Stored production text', corr38='Stored, corrected by 3.8 Flash',
            corrO='Stored, corrected by Opus')
LANG = dict(fa='Persian', sa='Sanskrit')
load = lambda specs: {s.split('=', 1)[0]: json.load(open(s.split('=', 1)[1])) for s in specs}
pins, sens = load(a.pin), load(a.sens)
inside = lambda q, x: q[0] <= round(x, 2) <= q[2]      # the pins are stated to two decimals

obs = {l: {j: {k: res['panels'][L]['table']['by_judge'][j][A]['fidelity'] for k, A in ARM.items()}
           for j in ('opus', 'pro')} for l, L in LANG.items()}
out = dict(source='scripts/eval/results/pro-translate-6545/r1s1/scores.json', source_commit=a.source_commit,
           design_note='#6545 used ONE Opus judge and one Pro judge per page in a new blind 7-arm round; the pins '
                       'assumed two Opus judges per page and a round of the #6182-style panel.',
           pages={l: res['panels'][L]['table']['pages'] for l, L in LANG.items()}, observed=obs, cells=[],
           contrasts=[], summary={})


def tally(rows, key):
    return {n: f"{sum(r[n]['covered'] for r in rows if r['kind'] == key)}/{sum(1 for r in rows if r['kind'] == key)}"
            for n in list(pins) + list(sens)}


for l in LANG:
    for k in ARM:
        for judge, col in (('opus', 'opus_judge'), ('pro', 'pro_judge')):
            x = obs[l][judge][k]
            row = dict(kind=col, language=l, cell=k, observed=x)
            for n, p in {**pins, **sens}.items():
                q = p[l]['cells'][k][col]
                row[n] = dict(pred=q, covered=inside(q, x), error=round(x - q[1], 2))
            out['cells'].append(row)
    for k in ('pro', 'opus', 'corr38', 'corrO'):
        x = round(obs[l]['opus'][k] - obs[l]['opus']['c38'], 3)
        row = dict(kind='contrast', language=l, cell=f'{k} - c38', observed=x)
        for n, p in {**pins, **sens}.items():
            q = p[l]['cells'][k]['delta_vs_c38_opus_judge']
            row[n] = dict(pred=q, covered=inside(q, x), error=round(x - q[1], 2),
                          p_ahead=p[l]['cells'][k]['P_beats_c38_opus_judge'])
        out['contrasts'].append(row)
    x = round((obs[l]['opus']['opus'] - obs[l]['opus']['c38']) - (obs[l]['pro']['opus'] - obs[l]['pro']['c38']), 3)
    row = dict(kind='self_pref', language=l, cell='(opus - c38) Opus judge minus Pro judge', observed=x)
    for n, p in {**pins, **sens}.items():
        q = p[l]['cells']['opus']['self_pref_diff_in_diff']
        row[n] = dict(pred=q, covered=inside(q, x), error=round(x - q[1], 2))
    out['contrasts'].append(row)
rows = out['cells'] + out['contrasts']
out['summary'] = {k: tally(rows, k) for k in ('opus_judge', 'pro_judge', 'contrast', 'self_pref')}
json.dump(out, open(a.out, 'w'), indent=1)

iv = lambda q: f'{q[1]:.2f} [{q[0]:.2f}, {q[2]:.2f}]'
mark = lambda r: '' if r['covered'] else ' ✗'
cols = list(pins) + list(sens)
for kind, title in (('opus_judge', 'Opus judge, panel mean'), ('pro_judge', 'Pro judge, panel mean'),
                    ('contrast', 'Difference from 3.8 Flash CLI, Opus judge'), ('self_pref', 'Self-preference')):
    print(f'\n**{title}**\n\n| language | cell | observed | ' + ' | '.join(cols) + ' |\n|---|---|---|' + '---|' * len(cols))
    for r in rows:
        if r['kind'] == kind:
            name = NAME.get(r['cell'], r['cell'])
            print(f"| {LANG[r['language']]} | {name} | {r['observed']:.2f} | "
                  + ' | '.join(iv(r[n]['pred']) + mark(r[n]) for n in cols) + ' |')
    print('covered: ' + ', '.join(f'{n} {v}' for n, v in out['summary'][kind].items()))
