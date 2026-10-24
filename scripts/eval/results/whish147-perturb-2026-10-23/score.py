"""Whish 147 perturbation / preprocessing test (#7119): score every variant, and merge reads letter by letter.

Exp 5: pooled per-row CER per variant (9 leaves, one read each) against the stability test's baseline (3 plain colour
Opus reads per leaf, control/opus-1..3). The noise threshold is a bootstrap: one of the 3 baseline reads drawn per leaf,
pooled, 10,000 times; a variant counts as better only below the 2.5th percentile of that distribution.
Exp 2: per leaf, the perturbation reads are merged akshara by akshara (star alignment on the read most like the others,
a plurality vote per position, insertions kept only when most reads have one there). The merged text keeps the centre
read's rows and is scored with the same per-row scorer; each merged akshara carries its vote count as a confidence.
Control: the same merge on the 3 stored same-crop plain colour reads.

PRIOR ART: ../whish147-stability-recall-2026-10-23/score.py (PR #7203) — norm(), mal2iast(), best() and ref_for() are
imported unchanged from its score_lib.py (copied here); that script scores and compares reads but merges none.
Usage: JOB_SCRATCH=<dir with editions/> python score.py   (writes scores.json, prints the tables)
"""
import os, re, json, random, itertools, statistics as st
from collections import Counter
from rapidfuzz.distance import Levenshtein

from score_lib import norm, mal2iast, best, ref_for, HERE

VERSE = ['4-b', '5-t', '5-b', '6-t', '6-b', '7-t', '8-t', '8-b', '9-t']
BASE = ['control/opus-1', 'control/opus-2', 'control/opus-3']
EXP5 = ['clahe', 'channel', 'sauvola', 'holes', 'rows']
PERT = ['shift+', 'shift-', 'scale85', 'scale115', 'gamma']
MIN_ROW = 8


def read_rows(stage, leaf):
    d = stage if stage.startswith('control/') else f'reads/{stage}'
    f = f'{HERE}/{d}/{leaf}.txt'
    if not os.path.exists(f): return None
    return [norm(mal2iast(m.group(1))) for m in re.finditer(r'^ROW\s+\d+\s*\|\s*(.*)$', open(f).read(), re.M)]


def score_rows(rows, leaf):
    """(edit distance, chars) over rows of >= MIN_ROW chars, each row against its best window in the leaf's span."""
    ref = ref_for(leaf); d = n = 0
    for x in rows:
        if len(x) < MIN_ROW: continue
        d += best(x, ref)[0]; n += len(x)
    return d, n


def pooled(stage_by_leaf):
    D = N = 0; per = {}
    for leaf, stage in stage_by_leaf.items():
        rows = read_rows(stage, leaf)
        if rows is None: continue
        d, n = score_rows(rows, leaf); D += d; N += n; per[leaf] = round(d / n, 3) if n else None
    return dict(cer=round(D / N, 3) if N else None, chars=N, per_leaf=per)


# ---------- aksharas ----------
VOW = ['ai', 'au', 'a', 'ā', 'i', 'ī', 'u', 'ū', 'ṛ', 'ṝ', 'ḷ', 'ḹ', 'e', 'o']
CON = ['kh', 'gh', 'ch', 'jh', 'ṭh', 'ḍh', 'th', 'dh', 'ph', 'bh', 'k', 'g', 'ṅ', 'c', 'j', 'ñ', 'ṭ', 'ḍ', 'ṇ', 't', 'd',
       'n', 'p', 'b', 'm', 'y', 'r', 'l', 'v', 'ś', 'ṣ', 's', 'h', 'ḻ', 'ḷ', 'ṟ', 'ṉ']
MARK = ['ḥ', 'ṃ', 'ṁ']


def phonemes(t):
    out, i = [], 0
    while i < len(t):
        for p in VOW + CON + MARK:
            if t.startswith(p, i):
                out.append(p); i += len(p); break
        else:
            out.append(t[i]); i += 1
    return out


def aksharas(t):
    """C* V (ḥ)?  — consonants with no vowel after them close the previous akshara (word-final / virama)."""
    out, cur = [], ''
    for p in phonemes(t):
        if p in VOW:
            out.append(cur + p); cur = ''
        elif p in MARK and out and not cur:
            out[-1] += p
        else:
            cur += p
    if cur:
        if out: out[-1] += cur
        else: out.append(cur)
    return out


def tok_cost(a, b):
    return Levenshtein.normalized_distance(a, b)


def align(A, B):
    """Needleman-Wunsch on akshara lists; substitution cost = normalised letter distance, gap 1. Returns pairs
    (i or None, j or None)."""
    n, m = len(A), len(B)
    D = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1): D[i][0] = i
    for j in range(1, m + 1): D[0][j] = j
    for i in range(1, n + 1):
        Ai = A[i - 1]; Di = D[i]; Dp = D[i - 1]
        for j in range(1, m + 1):
            Di[j] = min(Dp[j - 1] + tok_cost(Ai, B[j - 1]), Dp[j] + 1, Di[j - 1] + 1)
    i, j, path = n, m, []
    while i > 0 or j > 0:
        if i > 0 and j > 0 and abs(D[i][j] - (D[i - 1][j - 1] + tok_cost(A[i - 1], B[j - 1]))) < 1e-9:
            path.append((i - 1, j - 1)); i -= 1; j -= 1
        elif i > 0 and abs(D[i][j] - (D[i - 1][j] + 1)) < 1e-9:
            path.append((i - 1, None)); i -= 1
        else:
            path.append((None, j - 1)); j -= 1
    return path[::-1]


def leaf_tokens(rows):
    """Aksharas of a read, each tagged with its row index (rows under MIN_ROW chars dropped, as in scoring)."""
    toks, rid = [], []
    for r, x in enumerate(rows):
        if len(x) < MIN_ROW: continue
        a = aksharas(x); toks += a; rid += [r] * len(a)
    return toks, rid


def merge(reads):
    """Star alignment of k reads on the centre read (least total akshara distance to the others), plurality vote per
    centre position (a gap is a vote too), insertions between centre positions kept when more than half the reads have
    one there (the most common one). Returns merged rows (centre's row layout) and, per merged akshara, its vote count."""
    T = [leaf_tokens(r) for r in reads]
    k = len(T)
    dist = [[Levenshtein.normalized_distance(T[a][0], T[b][0]) if a != b else 0 for b in range(k)] for a in range(k)]
    c = min(range(k), key=lambda a: sum(dist[a]))
    C, crow = T[c]
    votes = [[C[i]] for i in range(len(C))]         # per centre position: each read's token (or '' for a gap)
    ins = [[] for _ in range(len(C) + 1)]            # per gap slot: each read's inserted string ('' if none)
    for o in range(k):
        if o == c: continue
        path = align(C, T[o][0])
        got = [''] * len(C); slot = [''] * (len(C) + 1); last = -1
        for i, j in path:
            if i is not None:
                got[i] = T[o][0][j] if j is not None else ''; last = i
            else:
                slot[last + 1] += T[o][0][j]
        for i in range(len(C)): votes[i].append(got[i])
        for s in range(len(C) + 1): ins[s].append(slot[s])
    for s in range(len(C) + 1): ins[s].append('')    # the centre has no insertion
    rows, conf = {}, []
    def emit(tok, n, r):
        if tok:
            rows.setdefault(r, []).append(tok); conf.append((tok, n))
    for s in range(len(C) + 1):
        if s > 0:
            i = s - 1
            tok, n = Counter(votes[i]).most_common(1)[0]
            emit(tok, n, crow[i])
        have = [x for x in ins[s] if x]
        if len(have) * 2 > k:
            tok, n = Counter(have).most_common(1)[0]
            emit(tok, n, crow[min(s, len(C) - 1)] if C else 0)
    return [''.join(rows[r]) for r in sorted(rows)], conf, c


def merged_score(rows, conf, leaf, k):
    """Score merged rows; attribute each edit to a merged akshara, so CER can be split by vote count."""
    ref = ref_for(leaf)
    # map chars of the joined rows back to akshara index
    owner = []
    for ai, (tok, n) in enumerate(conf): owner += [ai] * len(tok)
    err = [0] * len(conf); pos = 0; D = N = 0
    for x in rows:
        L = len(x)
        if L >= 1:
            d, kk = best(x, ref)
            w = ref[kk:kk + L] if L <= len(ref) else ref
            for op in Levenshtein.editops(x, w):
                hp = min(op.src_pos, L - 1)
                err[owner[pos + hp]] += 1
            D += d; N += L
        pos += L
    by = {}
    for (tok, n), e in zip(conf, err):
        b = by.setdefault(n, [0, 0]); b[0] += e; b[1] += len(tok)
    return D, N, by


def ensemble(stages_by_leaf):
    out, D, N, by = {}, 0, 0, {}
    for leaf, stages in stages_by_leaf.items():
        reads = [read_rows(s, leaf) for s in stages]
        reads = [r for r in reads if r]
        if len(reads) < 2: continue
        rows, conf, c = merge(reads)
        d, n, b = merged_score(rows, conf, leaf, len(reads))
        out[leaf] = dict(cer=round(d / n, 3) if n else None, chars=n, centre=stages[c], reads=len(reads))
        D += d; N += n
        for v, (e, m) in b.items():
            t = by.setdefault(v, [0, 0]); t[0] += e; t[1] += m
    return dict(cer=round(D / N, 3) if N else None, chars=N, per_leaf=out,
                by_votes={v: dict(chars=m, cer=round(e / m, 3) if m else None) for v, (e, m) in sorted(by.items())})


def split(by, hi):
    """CER and share of chars for merged aksharas with >= hi votes vs the rest."""
    H = [by[v] for v in by if v >= hi]; L = [by[v] for v in by if v < hi]
    def agg(xs):
        n = sum(x['chars'] for x in xs); e = sum((x['cer'] or 0) * x['chars'] for x in xs)
        return n, round(e / n, 3) if n else None
    hn, hc = agg(H); ln, lc = agg(L); tot = hn + ln
    return dict(high=dict(cer=hc, share=round(hn / tot, 3) if tot else None, chars=hn),
                rest=dict(cer=lc, share=round(ln / tot, 3) if tot else None, chars=ln))


def main():
    random.seed(7)
    res = {}
    # baseline and its noise
    base_sets = {s: pooled({l: s for l in VERSE}) for s in BASE}
    allb = {}
    for l in VERSE:
        allb[l] = []
        for s in BASE:
            r = read_rows(s, l); allb[l].append(score_rows(r, l) if r else (0, 0))
    D = sum(d for l in VERSE for d, n in allb[l]); N = sum(n for l in VERSE for d, n in allb[l])
    boot = []
    for _ in range(10000):
        d = n = 0
        for l in VERSE:
            x = random.choice(allb[l]); d += x[0]; n += x[1]
        boot.append(d / n)
    boot.sort()
    res['baseline'] = dict(pooled=round(D / N, 3), chars_per_set=round(N / 3), sets={s: v['cer'] for s, v in base_sets.items()},
                           boot_p2_5=round(boot[250], 3), boot_p50=round(boot[5000], 3), boot_p97_5=round(boot[9750], 3),
                           oracle_best_of_3=round(sum(min((d / n if n else 1) for d, n in allb[l] if n) for l in VERSE) / len(VERSE), 3))
    thr = res['baseline']['boot_p2_5']
    res['exp5'] = {}
    for v in EXP5 + PERT:
        p = pooled({l: v for l in VERSE})
        if p['cer'] is None: continue
        p['better_than_baseline'] = p['cer'] < thr
        res.setdefault('exp5' if v in EXP5 else 'perturbations_single', {})[v] = p
    # exp 2. Set A follows the brief: four perturbations of the plain colour crop plus the best exp-5 variant (best
    # channel: lowest pooled CER, though within noise). Set B: the five perturbations, no exp-5 variant.
    res['control'] = ensemble({l: BASE for l in VERSE})
    res['control']['split_3of3'] = split(res['control']['by_votes'], 3)
    sets = {'A': ['shift+', 'scale85', 'scale115', 'gamma', 'channel'], 'B': PERT}
    res['exp2'] = {}
    for name, members in sets.items():
        e = ensemble({l: members for l in VERSE}); e['members'] = members
        e['split_ge4'] = split(e['by_votes'], 4)
        res['exp2'][name] = e
    five = sets['A']
    # like for like: every 3-read subset of the perturbation reads, merged the same way as the 3-read control
    trip = []
    for combo in itertools.combinations(five, 3):
        e = ensemble({l: list(combo) for l in VERSE})
        trip.append(dict(members=combo, cer=e['cer'], chars=e['chars'], split_3of3=split(e['by_votes'], 3)))
    res['exp2_triples'] = dict(mean_cer=round(st.mean(t['cer'] for t in trip), 3), min=min(t['cer'] for t in trip),
                               max=max(t['cer'] for t in trip),
                               mean_cer_3of3=round(st.mean(t['split_3of3']['high']['cer'] for t in trip if t['split_3of3']['high']['cer'] is not None), 3),
                               mean_share_3of3=round(st.mean(t['split_3of3']['high']['share'] for t in trip), 3), all=trip)
    # oracle over the perturbation reads (best single read per leaf)
    orc = []
    for l in VERSE:
        cs = []
        for s in five:
            r = read_rows(s, l)
            if r:
                d, n = score_rows(r, l)
                if n: cs.append(d / n)
        if cs: orc.append(min(cs))
    res['exp2_oracle_best_single'] = round(st.mean(orc), 3) if orc else None
    # how often a read lands in the good mode (CER < 0.2), and best-of-3 like for like with the same-crop control
    cer = {}
    for s in BASE + EXP5 + PERT:
        for l in VERSE:
            r = read_rows(s, l); d, n = score_rows(r, l) if r else (0, 0); cer[s, l] = d / n if n else None
    good = lambda ms: sum(1 for m in ms for l in VERSE if cer[m, l] is not None and cer[m, l] < 0.2)
    best_of = lambda ms: st.mean(min([cer[m, l] for m in ms if cer[m, l] is not None] or [1.0]) for l in VERSE)
    res['good_mode'] = dict(plain=f'{good(BASE)}/{9 * len(BASE)}', perturbations=f'{good(PERT)}/{9 * len(PERT)}',
                            preprocessing=f'{good(EXP5)}/{9 * len(EXP5)}',
                            best_of_3_same_crop=round(best_of(BASE), 3),
                            best_of_3_perturbed_mean_over_triples=round(st.mean(best_of(t) for t in itertools.combinations(PERT, 3)), 3),
                            best_of_5_perturbed=round(best_of(PERT), 3),
                            per_read={f'{s}|{l}': (round(v, 3) if v is not None else None) for (s, l), v in cer.items()})
    json.dump(res, open(f'{HERE}/scores.json', 'w'), indent=1, default=list)
    b = res['baseline']
    print(f"BASELINE plain colour: pooled {b['pooled']} (sets {b['sets']}), bootstrap one-read-per-leaf p2.5/p50/p97.5 = {b['boot_p2_5']}/{b['boot_p50']}/{b['boot_p97_5']}, oracle {b['oracle_best_of_3']}")
    for k in ('exp5', 'perturbations_single'):
        for v, p in res.get(k, {}).items():
            print(f"  {v:9} pooled {p['cer']}  chars {p['chars']}  better={p['better_than_baseline']}  {p['per_leaf']}")
    for k, e in [('control', res['control'])] + [(f'exp2-{n}', e) for n, e in res['exp2'].items()]:
        print(k.upper(), 'merged CER', e['cer'], 'chars', e['chars'], {l: v['cer'] for l, v in e['per_leaf'].items()})
        print('   by votes', e['by_votes'])
        print('   split', e.get('split_ge4') or e.get('split_3of3'))
    t = res['exp2_triples']; print('PERT TRIPLES mean', t['mean_cer'], 'range', t['min'], t['max'], '3/3 cer', t['mean_cer_3of3'], 'share', t['mean_share_3of3'])
    print('PERT oracle best single', res['exp2_oracle_best_single'])


if __name__ == '__main__':
    main()
