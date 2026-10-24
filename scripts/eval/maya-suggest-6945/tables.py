# #6903 stage 2 result table: deterministic score + both blind judges per run, Team precision, recall control.
# Usage: python3 tables.py <run>...  (after score.py inputs exist and judge_{opus,gemini}_*.json are in $MS/runs/)
# PRIOR ART: round 2's table2.py (l7a scratch); same columns, Palenque runs.
import json, sys, glob
from common import MS, jl
import score, judge_packet as jp

def main(runs):
    K = {(x['run'], x['bid']): x['jid'] for f in glob.glob(MS + 'runs/judge_key_*.json') for x in jl(f)}
    O, G = jp.verdicts('opus'), jp.verdicts('gemini')
    def jv(V, run, bid, f='translit'): return (V.get(K.get((run, bid)), {}) or {}).get(f)
    out = {}
    for run in runs:
        S, R = score.summary(run); H = [r for r in R if r['role'] == 'heldout']; att = [r for r in H if not r['unread']]
        row = dict(S)
        for w, V in (('O', O), ('G', G)):
            m = [r for r in att if jv(V, run, r['bid']) == 'match']
            row[f'match_{w}'] = len(m); row[f'gloss_{w}'] = sum(jv(V, run, r['bid'], 'gloss') == 'match' for r in att)
            row[f'wrong_{w}'] = sum(jv(V, run, r['bid']) == 'wrong' for r in att)
            row[f'wrong_conf05_{w}'] = sum(jv(V, run, r['bid']) == 'wrong' and r['conf'] >= 0.5 for r in att)
            row[f'match_unseen_{w}'] = sum(not r['seen'] for r in m); row[f'match_unseen_tok_{w}'] = sum(not r['tseen'] for r in m)
            if S.get('accepted'):
                acc = [r for r in att if r['verdict'] == 'accept']; st = [r for r in att if r['verdict'] in ('accept', 'correct')]
                row[f'acc_prec_{w}'] = (sum(jv(V, run, r['bid']) == 'match' for r in acc), len(acc))
                row[f'acc_unseen_prec_{w}'] = (sum(jv(V, run, r['bid']) == 'match' for r in acc if not r['seen']), sum(not r['seen'] for r in acc))
                row[f'stood_prec_{w}'] = (sum(jv(V, run, r['bid']) == 'match' for r in st), len(st))
            hi = [r for r in att if r['conf'] >= 0.9]
            row[f'conf09_{w}'] = (sum(jv(V, run, r['bid']) == 'match' for r in hi), len(hi))
        row.pop('source_examples', None)
        out[run] = row; print(json.dumps(row, ensure_ascii=False))
    json.dump(out, open(MS + 'runs/table.json', 'w'), indent=1)

if __name__ == '__main__':
    main(sys.argv[1:])
