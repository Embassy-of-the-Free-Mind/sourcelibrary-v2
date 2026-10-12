#!/usr/bin/env python3
# PRIOR ART: none — score.py writes the numbers as JSON; this only renders them as the markdown tables of the #6544
# write-up, so no figure in the experiment file is copied by hand.
"""python3 report-tables.py $JOB_SCRATCH/scoreA.json $JOB_SCRATCH/scoreB.json"""
import json, sys

NAMES = {'lite': 'Flash-Lite (production)', 'f38l': '3.8 Flash low (CLI)', 'f38h': '3.8 Flash high (CLI)', 'pro': '3.1 Pro (CLI)',
         'opus': 'Opus (claude -p)', 'corr-pro': 'Pro corrects Opus draft', 'corr-opus': 'Opus corrects Pro draft', 'disagree': 'Disagreement (Pro+Opus, 3.8 high settles)'}
pc = lambda x: '—' if x is None else f'{100 * x:.1f}'
ci = lambda c: '—' if not c or c[0] is None else f'{pc(c[0])} [{pc(c[1])}, {pc(c[2])}]'


def fails(d):
    d = {k: v for k, v in d.items() if k != 'missing'}
    return ', '.join(f'{k} {v}' for k, v in sorted(d.items())) or '0'


for path in sys.argv[1:]:
    r = json.load(open(path))
    print(f"\n### {r['label']} ({r['pages']} pages)\n")
    for key, arms in r['arms'].items():
        print(f'\n**Key: {key}**\n')
        groups = sorted(next(iter(arms.values()))['by_group'])
        print('| arm | read / given | did not read (by kind) | mean page CER [95% CI by work] | failed = 1.0 | pooled CER | WER | s/page | ' + ' | '.join(groups) + ' |')
        print('|---|---|---|---|---|---|---|---|' + '---|' * len(groups))
        for a, v in arms.items():
            miss = v['did_not_read'].get('missing', 0)
            given = r['pages'] - miss
            flag = ' *partly measured*' if sum(x for k, x in v['did_not_read'].items() if k != 'missing') > 0.2 * max(1, given) or miss else ''
            print(f"| {NAMES[a]}{flag} | {v['read']} / {given} | {fails(v['did_not_read'])} | {ci(v['mcer'])} | {ci(v.get('mcer_fail1'))} | {ci(v['cer'])} | {ci(v['wer'])} | "
                  f"{'—' if v['secs_mean'] is None else round(v['secs_mean'])} | " + ' | '.join(f"{pc(v['by_group'][g]['mcer'][0])} ({v['by_group'][g]['read']})" for g in groups) + ' |')
        pp = r['pairs'][key]
        print('\nPaired mean page CER difference (points; negative = first arm better), pages both read, 95% CI by work:\n')
        print('| pair | diff [95% CI] | n |\n|---|---|---|')
        for k, v in pp.items():
            if v:
                print(f'| {k} | {v[0] * 100:+.1f} [{v[1] * 100:+.1f}, {v[2] * 100:+.1f}] | {v[3]} |')
        for a in ('corr-pro', 'corr-opus'):
            c = arms.get(a, {}).get('correction')
            if not c or not c['pages']:
                continue
            print(f"\n{NAMES[a]} — pooled CER of the draft ({c['draft_arm']}) → corrected, on {c['pages']} pages: {ci(c['accuracy']['draft'])} → {ci(c['accuracy']['corrected'])}; "
                  f"pages better {c['pages_made_better']}, worse {c['pages_made_worse']}; convention/style part (strict − folded) {pc(c['style_part']['draft'])} → {pc(c['style_part']['corrected'])}.\n")
            print('| draft noise tertile | pages | draft CER range | draft → corrected (pooled) | change [95% CI] |\n|---|---|---|---|---|')
            for t, x in c['by_tertile'].items():
                d = x['delta']
                print(f"| {t} | {x['pages']} | {x['draft_cer_range'] and ' – '.join(pc(y) for y in x['draft_cer_range'])} | {ci(x['draft'])} → {ci(x['corrected'])} | {'—' if not d else f'{d[0]*100:+.1f} [{d[1]*100:+.1f}, {d[2]*100:+.1f}]'} |")
    if r.get('disputed_share') is not None:
        print(f"\nDisputed share (Pro's characters inside a Pro/Opus disagreement span): {pc(r['disputed_share'])}% overall; "
              + ', '.join(f'{g} {pc(v)}%' for g, v in r['disputed_share_by_group'].items()) + f"; pages with no dispute: {r['pages_with_no_dispute']}.")
    for k, v in r.get('anchoring', {}).items():
        n = v.get('survived', 0) + v.get('corrected', 0) + v.get('other', 0)
        print(f"\nAnchoring {k}: {v.get('survived', 0)} of {n} planted errors survived ({pc(v['rate'])}%); by kind {v['by_kind']}.")
    print(f"\nCalls: {r['calls']}")
