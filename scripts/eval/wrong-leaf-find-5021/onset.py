#!/usr/bin/env python3
# PRIOR ART: scripts/audit/leaf-shift-risk-5021.mjs fit (odds ratios over the same labels, but per PAGE, with the
# number features; it has no "what is on the page where the slide starts" and no source rule count).
"""
onset.py LABELS.jsonl OUT.json — on the Opus-labelled books (labels.mjs), rebuild write groups (2 s rule) and ask:
 where in its group does a slide begin, and what is on the ONSET page (the last own page before the first next-page,
 i.e. the page whose section stopped short / whose text the slide starts from)? Compared with every other page of the
 same groups (within-group control, so book, lane, model and date are held fixed).
"""
import sys, json, math, collections
rows = [json.loads(l) for l in open(sys.argv[1])]
def wilson(k, n, z=1.96):
    if not n: return None
    p = k / n; d = 1 + z*z/n; c = p + z*z/(2*n); h = z*math.sqrt(p*(1-p)/n + z*z/(4*n*n))
    return [round(k/n, 3), round((c-h)/d, 3), round((c+h)/d, 3)]
out = {}
onset = []; ctrl = []; pos_first = collections.Counter(); gsizes = collections.Counter(); lab_by = collections.defaultdict(lambda: [0, 0])
end_drop = collections.Counter()
for b in rows:
    ps = [p for p in b['pages'] if p.get('t') is not None]
    ps.sort(key=lambda p: p['n'])
    groups, cur = [], []
    for p in ps:
        if cur and p['n'] == cur[-1]['n'] + 1 and abs(p['t'] - cur[-1]['t']) <= 2000: cur.append(p)
        else:
            if cur: groups.append(cur)
            cur = [p]
    if cur: groups.append(cur)
    for g in groups:
        ys = [p.get('y') for p in g]
        for i, p in enumerate(g):
            if p.get('y') in ('next', 'own', 'prev'):
                k = (len(g) if len(g) <= 8 else '9+', i if i < 8 else '8+')
                lab_by[('pos', i if i < 8 else 8)][0 if p['y'] == 'own' else 1] += 1
        firsts = [i for i, y in enumerate(ys) if y == 'next']
        if not firsts: continue
        f = firsts[0]
        if f > 0 and ys[f-1] == 'next': continue
        gsizes[len(g)] += 1; pos_first[f] += 1
        if f == 0: continue  # the slide started in an earlier call (or at the call's first page): no onset in this group
        o = g[f-1]
        onset.append(o)
        ctrl += [p for j, p in enumerate(g) if j != f-1 and p.get('y') is None]
        # does the slide run to the group's end?
        end_drop['runs to end' if all(y in ('next', 'mixed', None) for y in ys[f:]) and ys[-1] in ('next', None) else 'stops inside'] += 1
def share(xs, fn): k = sum(1 for x in xs if fn(x)); return wilson(k, len(xs)) + [k, len(xs)]
K = lambda p: math.log(max(1, p['en']) / max(1, p['src']))
feats = {
  'source has an in-page rule (---)': lambda p: p['hr'] > 0,
  'source < 600 chars': lambda p: p['src'] < 600,
  'odd page type (not text)': lambda p: (p.get('ty') or 'text') != 'text',
  'English ends with ... or …': lambda p: p['tl'].rstrip().endswith(('...', '…')),
  'English starts with ... or …': lambda p: p['h'].lstrip().startswith(('...', '…')),
}
out['onset_vs_same_groups'] = {k: {'onset': share(onset, f), 'other_unlabelled_pages_same_groups': share(ctrl, f)} for k, f in feats.items()}
out['first_next_position_in_group'] = dict(sorted(pos_first.items()))
out['group_size_of_slides'] = dict(sorted(gsizes.items()))
out['slide_runs_to_group_end'] = dict(end_drop)
out['labelled_pos'] = {str(k[1]): {'own': v[0], 'shift': v[1]} for k, v in sorted(lab_by.items())}
json.dump(out, open(sys.argv[2], 'w'), indent=1)
print(json.dumps(out, indent=1))

# Part 2: the shape. The onset page's English length against the book's median ratio k (absorption: it holds two leaves),
# and what Opus said about the LAST page of a group whose slide runs to the end (it has no n+1 to carry).
import statistics
shape = {'onset_resid': [], 'ctrl_resid': [], 'last_verdict': collections.Counter(), 'onset_verdict': collections.Counter()}
for b in rows:
    ps = sorted([p for p in b['pages'] if p.get('t') is not None], key=lambda p: p['n'])
    rr = [K(p) for p in ps if p['src'] >= 300 and (p.get('ty') or 'text') == 'text']
    if len(rr) < 5: continue
    k = statistics.median(rr)
    groups, cur = [], []
    for p in ps:
        if cur and p['n'] == cur[-1]['n'] + 1 and abs(p['t'] - cur[-1]['t']) <= 2000: cur.append(p)
        else:
            if cur: groups.append(cur)
            cur = [p]
    if cur: groups.append(cur)
    for g in groups:
        ys = [p.get('y') for p in g]
        if 'next' not in ys: continue
        f = ys.index('next')
        if f > 0:
            shape['onset_resid'].append(K(g[f-1]) - k); shape['onset_verdict'][ys[f-1]] += 1
            shape['ctrl_resid'] += [K(p) - k for j, p in enumerate(g) if j < f-1]
        if f < len(g) - 1: shape['last_verdict'][ys[-1]] += 1
q = lambda xs: [round(statistics.quantiles(xs, n=4)[i], 2) for i in range(3)] if len(xs) > 4 else None
res = {'onset_log_len_resid_quartiles': q(shape['onset_resid']), 'n_onset': len(shape['onset_resid']), 'earlier_pages_resid_quartiles': q(shape['ctrl_resid']), 'n_earlier': len(shape['ctrl_resid']),
       'onset_share_resid_gt_0.4': round(sum(x > 0.4 for x in shape['onset_resid']) / max(1, len(shape['onset_resid'])), 3), 'earlier_share_resid_gt_0.4': round(sum(x > 0.4 for x in shape['ctrl_resid']) / max(1, len(shape['ctrl_resid'])), 3),
       'opus_on_onset_page': dict(shape['onset_verdict']), 'opus_on_last_page_of_slid_group': dict(shape['last_verdict'])}
out['shape'] = res
json.dump(out, open(sys.argv[2], 'w'), indent=1)
print(json.dumps(res, indent=1))

# Part 3: the page right after a slid group. If the call's last tag came back empty or short (nothing left to carry),
# the parser skipped it and the worker read it again alone: written seconds after the group, in a group of its own.
after = collections.Counter(); gaps = []
base_after = collections.Counter()
for b in rows:
    ps = sorted([p for p in b['pages'] if p.get('t') is not None], key=lambda p: p['n'])
    by = {p['n']: p for p in ps}
    groups, cur = [], []
    for p in ps:
        if cur and p['n'] == cur[-1]['n'] + 1 and abs(p['t'] - cur[-1]['t']) <= 2000: cur.append(p)
        else:
            if cur: groups.append(cur)
            cur = [p]
    if cur: groups.append(cur)
    gid = {p['n']: gi for gi, g in enumerate(groups) for p in g}
    for gi, g in enumerate(groups):
        if len(g) < 2: continue
        ys = [p.get('y') for p in g]
        slid = ys[-1] == 'next'
        nx = by.get(g[-1]['n'] + 1)
        if not nx: continue
        alone = len(groups[gid[nx['n']]]) == 1
        dt = (nx['t'] - g[-1]['t']) / 1000
        tag = 'slid' if slid else ('clean' if all(y in (None, 'own') for y in ys) else 'other')
        (after if tag == 'slid' else base_after)[(tag, 'next page written alone' if alone else 'next page in a group', '0-60 s later' if 0 < dt <= 60 else 'other time')] += 1
out['after_group'] = {' | '.join(k): v for k, v in sorted((after + base_after).items())}
json.dump(out, open(sys.argv[2], 'w'), indent=1)
print(json.dumps(out['after_group'], indent=1))
