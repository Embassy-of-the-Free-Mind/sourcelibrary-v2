#!/usr/bin/env python3
# PRIOR ART: scripts/eval/replicate-6547/score-bentham.py (failed-read rule, oracle disagreement analysis, anchoring
# verdicts — imported, not copied) and textmetrics.py (Levenshtein, normalisations, bootstrap). Those score one
# English set against one reference; #6544 scores four scripts against expert references (Set A) and against two
# rotated model keys (Set B), resamples by WORK, and splits correction gains by draft noise and by error kind.
"""
  python3 score.py --set setA [--json out.json]     # against the expert page references
  python3 score.py --set setB [--json out.json]     # against KEY-O and KEY-G (keys/key-o.json, keys/key-g.json)

Measures (failed reads are COUNTED, never scored: #6523):
  CER    letters only, case folded, diacritics / abbreviation marks / MUFI folded to base letters (`fold`): reading
         accuracy without the reference's diplomatic conventions (CREMMA keeps 14.6% abbreviation marks).
  WER    the same fold, on words.
  strict CER (humphries_strict): every character, case and punctuation; `strict − CER` is the convention / style part.
Intervals: 95%, pooled ratio resampled by work (Set A: the source manuscript; Set B: the book).
"""
import argparse, collections, json, os, re, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'replicate-6547'))
from textmetrics import unwrap, failed_kind, lev, ratio_ci, humphries_strict, plant_verdict, plant_ambiguous  # noqa: E402
from disagree import load, disagreement_spans, toks  # noqa: E402

# Two CREMMA images are two-page spreads whose reference transcribes one page (by-eye read, 2026-10-12): every arm is
# charged for the other page, or for picking the wrong one. Excluded from scoring for every arm.
EXCLUDE_A = {'cremma-medii-aevi|H318/13v', 'cremma-medii-aevi|H318/10r'}
ARMS = ['lite', 'f38l', 'f38h', 'pro', 'opus', 'corr-pro', 'corr-opus', 'disagree']
DRAFT_OF = {'corr-pro': 'opus', 'corr-opus': 'pro'}
FOLD = {'ſ': 's', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'ꝑ': 'p', 'ꝓ': 'p', 'ꝕ': 'p', 'ꝗ': 'q', 'ꝙ': 'q', 'ꝯ': 'c', 'ꝰ': 'us',
        'ꝫ': 'et', 'ꝭ': 'is', 'ꝝ': 'r', 'ꝛ': 'r', 'ꝩ': 'v', 'ꝟ': 'v', 'ꝁ': 'k', 'ꝉ': 'l', 'ꞇ': 't', 'đ': 'd', 'ħ': 'h', 'ł': 'l',
        'ı': 'i', 'ȷ': 'j', 'ꝥ': 'th', 'þ': 'th', 'ð': 'd', 'ø': 'o'}
# Production's OCR envelope: metadata blocks are dropped, page-text blocks (header, margin, folio, catchword, insert,
# footnote, page-num, sig) are kept as text — the references transcribe them. (block-drift.mjs sourceProse drops both.)
CUT = re.compile(r"\bI(?: am|'m)? (?:cannot|can't|unable to|not able to) (?:provide|transcribe|reproduce|output|give)|This request was blocked by Gemini's filters", re.I)
META = 'meta|vocab|language|lang|page-type|scan-quality|script|columns|image-desc|detected-images|warning|note'


def clean_lite(t):
    t = re.sub(rf'<({META})\b[^>]*>[\s\S]*?</\1>', ' ', t or '', flags=re.I)
    t = re.sub(r'<\/?[a-zA-Z][^>]*>', ' ', t)
    return re.sub(r'->|<-', ' ', t).strip()


def fold(t):
    t = unicodedata.normalize('NFKC', t or '').lower()
    t = ''.join(FOLD.get(c, c) for c in t)
    t = ''.join(c for c in unicodedata.normalize('NFKD', t) if not unicodedata.combining(c))
    t = re.sub(r'<[^>]{0,40}>', ' ', t).replace('ـ', '')  # Bentham <gap/>; Arabic tatweel
    t = re.sub(r'(\w)-\s*\n\s*', r'\1', t)
    return re.sub(r'\s+', ' ', re.sub(r'[\W\d_]+', ' ', t)).strip()


def counts(h, r):
    fh, fr = fold(h), fold(r)
    ch, cr = fh.replace(' ', ''), fr.replace(' ', '')
    sh, sr = humphries_strict(h), humphries_strict(r)
    return {'cd': lev(ch, cr), 'cl': len(cr), 'wd': lev(fh.split(), fr.split()), 'wl': len(fr.split()), 'sd': lev(sh, sr), 'sl': len(sr)}


def text_of(arm, row):
    t = unwrap(row['text'])[0]
    return clean_lite(row['text']) if arm == 'lite' else t


def reads(arm, rows, uids):
    texts, fails, secs = {}, collections.Counter(), []
    for u in uids:
        r = rows.get(u)
        k = failed_kind(r) if r else 'missing'
        if r and arm == 'lite' and r.get('text') and not clean_lite(r['text']).strip():
            k = 'empty'
        if r and r.get('secs'):
            secs.append(r['secs'])
        nb = lambda x: len(re.findall(r'<<<\s*BEGIN\s*>>>', x or ''))
        if not k and (nb(r.get('raw')) >= 2 or (r.get('raw') and nb(r.get('text'))) or (not r.get('raw') and nb(r.get('text')) >= 2)):
            k = 'restarted'  # a second <<<BEGIN>>> inside the markers: the page written again after a restart
        if not k and r.get('text', '').strip().startswith('An error occurred'):
            k = 'cli_error'  # agy's own error string returned as the reply
        if not k and len(text_of(arm, r).strip()) < 30 and len(r.get('raw') or '') > 200:
            k = 'chatter'  # reasoning leaked; the marker extractor kept a stray word ('and') between quoted markers
        if not k and CUT.search(text_of(arm, r)):
            k = 'filter_cut'  # a read the copy filter cut mid-page, then an apology or summary (#6523: counted, not scored)
        if k:
            fails[k] += 1
        else:
            texts[u] = text_of(arm, r)
    return texts, dict(fails), secs


def agg(per, work, units=('cd', 'cl')):
    by = collections.defaultdict(lambda: [0, 0])
    for u, c in per.items():
        by[work[u]][0] += c[units[0]]; by[work[u]][1] += c[units[1]]
    return ratio_ci([tuple(v) for v in by.values()], B=4000)


def mean_ci(per, work, B=4000):
    """Mean page CER (each page capped at 1.0, as #6388), 95% interval resampled by work."""
    import random
    by = collections.defaultdict(list)
    for u, c in per.items():
        by[work[u]].append(min(1.0, c['cd'] / max(1, c['cl'])))
    W = list(by.values())
    if not W:
        return None, None, None
    f = lambda s: sum(sum(x) for x in s) / sum(len(x) for x in s)
    rng = random.Random(6544); bs = sorted(f([W[rng.randrange(len(W))] for _ in W]) for _ in range(B))
    return f(W), bs[int(0.025 * B)], bs[int(0.975 * B) - 1]


def paired_mean(a, b, work, B=4000):
    """Mean page CER(a) − mean page CER(b) (pages capped at 1.0) on pages both read, resampled by work."""
    import random
    by = collections.defaultdict(list)
    for u in a:
        if u in b:
            by[work[u]].append(min(1.0, a[u]['cd'] / max(1, a[u]['cl'])) - min(1.0, b[u]['cd'] / max(1, b[u]['cl'])))
    W = list(by.values())
    if not W:
        return None
    f = lambda s: sum(sum(x) for x in s) / sum(len(x) for x in s)
    rng = random.Random(6544); bs = sorted(f([W[rng.randrange(len(W))] for _ in W]) for _ in range(B))
    return f(W), bs[int(0.025 * B)], bs[int(0.975 * B) - 1], sum(len(x) for x in W)


PAIRS = [('pro', 'lite'), ('f38h', 'lite'), ('f38l', 'lite'), ('opus', 'lite'), ('f38h', 'f38l'), ('pro', 'f38h'), ('opus', 'pro'),
         ('corr-opus', 'pro'), ('corr-opus', 'opus'), ('corr-pro', 'opus'), ('corr-pro', 'pro'), ('disagree', 'pro'), ('disagree', 'opus')]


def paired(a, b, work):
    """CER(a) − CER(b) on pages both read, resampled by work: (point, lo, hi)."""
    import random
    common = [u for u in a if u in b]
    by = collections.defaultdict(lambda: [0, 0, 0])
    for u in common:
        w = by[work[u]]; w[0] += a[u]['cd']; w[1] += b[u]['cd']; w[2] += a[u]['cl']
    W = list(by.values())
    if not W:
        return None
    f = lambda s: (sum(x[0] for x in s) - sum(x[1] for x in s)) / max(1, sum(x[2] for x in s))
    rng = random.Random(6544); bs = sorted(f([W[rng.randrange(len(W))] for _ in W]) for _ in range(4000))
    return f(W), bs[100], bs[3899], len(common)


def score_set(root, s, refs, work, group, uids, label):
    out = os.path.join(root, s, 'out')
    rows = {a: load(os.path.join(out, f'{a}.jsonl')) for a in ARMS if a != 'disagree'}
    T, F, S = {}, {}, {}
    for a in rows:
        T[a], F[a], S[a] = reads(a, rows[a], uids)
    # disagreement arm: Pro primary + Opus; pages with no disputed span keep Pro's text; resolver failure = failed read
    res = load(os.path.join(out, 'resolve.jsonl'))
    T['disagree'], F['disagree'], S['disagree'] = {}, collections.Counter(), []
    disputed = {}
    for u in uids:
        if u not in T.get('pro', {}) or u not in T.get('opus', {}):
            F['disagree']['primary_or_second_unread'] += 1; continue
        P = toks(T['pro'][u]); sp = disagreement_spans(T['pro'][u], [T['opus'][u]])
        disputed[u] = (sum(len(P[k].strip()) for s0, e in sp for k in range(s0, e)), sum(len(x.strip()) for x in P))
        if not sp:
            T['disagree'][u] = T['pro'][u]; continue
        rt, rf, _ = reads('resolve', {u: res[u]} if u in res else {}, [u])  # same failed-read rules as every arm
        k = next(iter(rf), None)
        if k:
            F['disagree'][k] += 1
        else:
            T['disagree'][u] = unwrap(res[u]['text'])[0]; S['disagree'].append(res[u].get('secs') or 0)
    F['disagree'] = dict(F['disagree'])
    MISS = {a: {u for u in uids if u not in rows[a]} for a in rows}  # not yet run (quota): neither read nor failed
    MISS['disagree'] = {u for u in uids if u in MISS.get('pro', ()) or u in MISS.get('opus', ()) or (u not in T['disagree'] and u not in res and disputed.get(u, (0,))[0])}
    rep = {'label': label, 'pages': len(uids), 'arms': {}, 'disputed_share': None}
    for keyname, ref in refs.items():
        C = {a: {u: counts(t, ref[u]) for u, t in T[a].items() if u in ref} for a in T}
        R = rep['arms'].setdefault(keyname, {})
        for a in ARMS:
            if a not in C:
                continue
            n_unread = sum(F[a].values())
            row = {'read': len(C[a]), 'did_not_read': F[a], 'partly_measured': n_unread > 0.2 * len(uids),
                   'mcer': mean_ci(C[a], work),
                   # sensitivity: every page the arm was given, a failed read scored 1.0 (not the #6523 rule; shown beside it)
                   'mcer_fail1': mean_ci({**{u: {'cd': 1, 'cl': 1} for u in uids if u in ref and u not in C[a] and u not in MISS.get(a, ())}, **C[a]}, work) if a != 'disagree' or C[a] else None, 'cer': agg(C[a], work), 'wer': agg(C[a], work, ('wd', 'wl')), 'strict': agg(C[a], work, ('sd', 'sl')),
                   'secs_mean': (sum(S[a]) / len(S[a])) if S[a] else None,
                   'vs_lite': paired(C[a], C['lite'], work) if a != 'lite' and 'lite' in C else None,
                   'by_group': {}}
            for g in sorted(set(group.values())):
                sub = {u: c for u, c in C[a].items() if group[u] == g}
                unread = sum(1 for u in uids if group[u] == g and u not in T[a])
                row['by_group'][g] = {'read': len(sub), 'unread': unread, 'mcer': mean_ci(sub, work), 'cer': agg(sub, work), 'wer': agg(sub, work, ('wd', 'wl'))}
            row['worst'] = sorted(((c['cd'] / max(1, c['cl']), u) for u, c in C[a].items()), reverse=True)[:10]
            R[a] = row
        rep.setdefault('pairs', {})[keyname] = {f'{x}-{y}': paired_mean(C[x], C[y], work) for x, y in PAIRS if x in C and y in C}
        # correction: by draft noise tertile; accuracy (folded letters) vs convention/style (strict − folded)
        for a, d in DRAFT_OF.items():
            if a not in C or d not in C:
                continue
            common = sorted((u for u in C[a] if u in C[d]), key=lambda u: C[d][u]['cd'] / max(1, C[d][u]['cl']))
            k = len(common)
            terc = {'clean': common[:k // 3], 'middle': common[k // 3: 2 * k // 3], 'noisy': common[2 * k // 3:]}
            out_t = {}
            for name, us in terc.items():
                dsub = {u: C[d][u] for u in us}; csub = {u: C[a][u] for u in us}
                out_t[name] = {'pages': len(us), 'draft_cer_range': [round(C[d][us[0]]['cd'] / max(1, C[d][us[0]]['cl']), 4), round(C[d][us[-1]]['cd'] / max(1, C[d][us[-1]]['cl']), 4)] if us else None,
                               'draft': agg(dsub, work), 'corrected': agg(csub, work), 'delta': paired(csub, dsub, work)}
            dall = {u: C[d][u] for u in common}; call = {u: C[a][u] for u in common}
            sty = lambda D: sum(max(0, c['sd'] - c['cd']) for c in D.values()) / max(1, sum(c['sl'] for c in D.values()))
            R[a]['correction'] = {'draft_arm': d, 'pages': k, 'accuracy': {'draft': agg(dall, work), 'corrected': agg(call, work), 'delta': paired(call, dall, work)},
                                  'style_part': {'draft': sty(dall), 'corrected': sty(call)},
                                  'pages_made_worse': sum(1 for u in common if C[a][u]['cd'] > C[d][u]['cd']),
                                  'pages_made_better': sum(1 for u in common if C[a][u]['cd'] < C[d][u]['cd']), 'by_tertile': out_t}
    if disputed:
        rep['disputed_share'] = sum(x for x, _ in disputed.values()) / max(1, sum(y for _, y in disputed.values()))
        rep['disputed_share_by_group'] = {g: sum(disputed[u][0] for u in disputed if group[u] == g) / max(1, sum(disputed[u][1] for u in disputed if group[u] == g)) for g in sorted(set(group.values()))}
        rep['pages_with_no_dispute'] = sum(1 for x, _ in disputed.values() if x == 0)
    # call accounting
    rep['calls'] = {a: sum(int(r.get('attempts') or 1) for r in rows[a].values() if r.get('route') != 'stored') for a in rows}
    rep['calls']['resolve'] = sum(int(r.get('attempts') or 1) for r in res.values())
    rep['no_view_reads'] = {a: sum(1 for r in rows[a].values() if 'gate_calls' in r and not any(str(g).startswith('view_file') for g in (r.get('gate_calls') or []))) for a in rows}
    return rep, T


def anchoring(root, refs):
    p = os.path.join(root, 'setA', 'plants.json')
    if not os.path.exists(p):
        return {}
    plants = json.load(open(p))['plants']
    rep = {}
    for corr in ('pro', 'opus'):
        rows = load(os.path.join(root, 'setA', 'out', f'corr-{corr}-anchor.jsonl'))
        v = collections.Counter(); detail = []; unread = 0
        for u, e in plants.items():
            r = rows.get(u)
            if not r or failed_kind(r):
                unread += 1; continue
            t = unwrap(r['text'])[0]
            for x in e[corr]:
                if x['kind'] != 'dropped_line' and x.get('planted') == x.get('orig'):
                    vv = 'invalid_plant'  # the planter changed nothing (its word core missed an apostrophe or a mark)
                elif x['kind'] == 'dropped_line':
                    vv = dropped_verdict(t, x)
                else:
                    vv = 'ambiguous' if plant_ambiguous(x, refs[u]) else plant_verdict(t, x)
                v[vv] += 1; detail.append({'uid': u, 'kind': x['kind'], 'orig': x['orig'], 'planted': x.get('planted'), 'verdict': vv})
        n = v['survived'] + v['corrected'] + v['other']
        by_kind = {}
        for d in detail:
            bk = by_kind.setdefault(d['kind'], collections.Counter()); bk[d['verdict']] += 1
        rep[f'corr-{corr}'] = {**v, 'unread_pages': unread, 'rate': v['survived'] / n if n else None, 'by_kind': {k: dict(c) for k, c in by_kind.items()}, 'detail': detail}
    return rep


def dropped_verdict(out, plant):
    """Did the corrector put back the dropped line? 'survived' = still missing (its words not found in order)."""
    words = [fold(w) for w in plant['orig'].split() if fold(w)]
    o = fold(out).split()
    if not words:
        return 'site_not_found'
    k = len(words)
    # restored = >= 60% of the line's words inside one window of k + 3 output words (punctuation, a split or a merged
    # neighbour line must not hide a restoration)
    def hit(win):
        c = collections.Counter(win); n = 0
        for w in words:
            if c[w] > 0:
                c[w] -= 1; n += 1
        return n
    best = max((hit(o[i:i + k + 3]) for i in range(max(1, len(o) - k + 1))), default=0)
    return 'corrected' if best >= max(1, round(0.6 * k)) else 'survived'


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--root', default=os.environ.get('JOB_SCRATCH')); ap.add_argument('--set', required=True)
    ap.add_argument('--json'); ap.add_argument('--uids')
    a = ap.parse_args()
    if a.set == 'setA':
        P = [json.loads(l) for l in open(os.path.join(a.root, 'setA', 'pages.jsonl'), encoding='utf-8') if l.strip()]
        refs = {'reference': {r['uid']: r['gt'] for r in P}}
        work = {r['uid']: r['dataset'] + '/' + r['work'] for r in P}; group = {r['uid']: r['dataset'] for r in P}
        uids = [r['uid'] for r in P if r['uid'] not in EXCLUDE_A]
    else:
        P = json.load(open(os.path.join(a.root, 'setB', 'draw.json')))['picks']
        kd = os.path.join(a.root, 'setB', 'keys')
        refs = {k: json.load(open(os.path.join(kd, f'{k}.json'))) for k in ('key-o', 'key-g', 'key-f') if os.path.exists(os.path.join(kd, f'{k}.json'))}
        work = {r['uid']: r['book_id'] for r in P}; group = {r['uid']: r['stratum'] for r in P}
        uids = [r['uid'] for r in P]
    if a.uids:
        keep = set(json.load(open(a.uids))); uids = [u for u in uids if u in keep]
    rep, _ = score_set(a.root, a.set, refs, work, group, uids, a.set)
    if a.set == 'setA':
        rep['anchoring'] = anchoring(a.root, refs['reference'])
    pc = lambda x: '—' if x is None else f'{100 * x:.2f}'
    ci = lambda c: f'{pc(c[0])} [{pc(c[1])}, {pc(c[2])}]' if c and c[0] is not None else '—'
    print(f"{a.set}: {rep['pages']} pages; disputed share {pc(rep['disputed_share'])}%")
    for key, R in rep['arms'].items():
        print(f'== key: {key}')
        for arm, v in R.items():
            vl = v['vs_lite']
            print(f"{arm:10s} read {v['read']:3d} fail {v['did_not_read']} mCER {ci(v['mcer'])} (fail=1: {ci(v['mcer_fail1'])}) CER {ci(v['cer'])} WER {ci(v['wer'])} strict {ci(v['strict'])} "
                  f"secs {v['secs_mean'] and round(v['secs_mean'])} vs-lite {vl and ci(vl[:3])}{' PARTLY MEASURED' if v['partly_measured'] else ''}")
            print('            ' + '  '.join(f"{g}: {ci(x['mcer'])} ({x['read']}/{x['read'] + x['unread']})" for g, x in v['by_group'].items()))
            if 'correction' in v:
                c = v['correction']
                print(f"            correction of {c['draft_arm']}: {ci(c['accuracy']['draft'])} -> {ci(c['accuracy']['corrected'])} delta {c['accuracy']['delta'] and ci(c['accuracy']['delta'][:3])}; "
                      f"style part {pc(c['style_part']['draft'])} -> {pc(c['style_part']['corrected'])}; better {c['pages_made_better']} worse {c['pages_made_worse']}")
                for tn, t in c['by_tertile'].items():
                    print(f"              {tn:7s} draft {ci(t['draft'])} -> {ci(t['corrected'])} delta {t['delta'] and ci(t['delta'][:3])}")
    for key, pp in rep.get('pairs', {}).items():
        print(f'== paired mean page CER difference, key {key} (negative = first arm better)')
        print('   ' + '  '.join(f"{k}: {ci(v[:3])} n={v[3]}" for k, v in pp.items() if v))
    for k, v in rep.get('anchoring', {}).items():
        print(f"ANCHOR {k}: {dict((x, y) for x, y in v.items() if x not in ('detail', 'by_kind'))} by kind {v['by_kind']}")
    print('calls', rep['calls'], 'no-view reads', rep['no_view_reads'])
    if a.json:
        json.dump(rep, open(a.json, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
