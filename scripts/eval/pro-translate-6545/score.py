#!/usr/bin/env python3
# PRIOR ART: scripts/eval/pareto-6182/score-xl.py — `norm` (fidelity, reversal, omission, invention, span) is imported
# from it unchanged and its by-book bootstrap is the same draw (one page per book here, so pages = works); #6545 adds a
# second and third judge, so the agreement measures (Krippendorff's ordinal alpha, WMT-style pairwise ranking accuracy,
# error-span F1, self-preference) and the correction-arm risk measures are new.
"""
score.py ROUND — $0. Scores one #6545 judging round. Reads $W/judge/<ROUND>/{key.json, texts.json, opus/out-*.jsonl,
pro/out.jsonl, fable/out-*.jsonl}, the arm rows in $W/arms/ and $W/plants-corr.json. Writes
scripts/eval/results/pro-translate-6545/<ROUND>/scores.json (numbers, no reference text) and prints a summary.
"""
import difflib, importlib.util, json, math, os, random, re, statistics, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import W, read, RESULTS, arm as stored
from prompts import unwrap

spec = importlib.util.spec_from_file_location('scorexl', os.path.join(os.path.dirname(__file__), '..', 'pareto-6182', 'score-xl.py'))
sx = importlib.util.module_from_spec(spec); spec.loader.exec_module(sx)

ROUND = sys.argv[1]
J = f'{W}/judge/{ROUND}'
KEY = json.load(open(f'{J}/key.json'))
TEXTS = json.load(open(f'{J}/texts.json'))
ITEMS = KEY['items']
GEMINI = {'FP', 'C38', 'C38S', 'PRO', 'CF', 'DF', 'C38_PLANT'}
CLAUDE = {'OPUS', 'CO', 'DO'}
B = 2000


# ---------- load judges ----------
def parse_obj(raw):
    t, _ = unwrap(raw)
    m = re.search(r'\{[\s\S]*\}', t)
    if not m: return None
    try:
        return json.loads(m.group(0))
    except ValueError:
        return None


def load_judges():
    out = {'opus': {}, 'pro': {}, 'fable': {}}
    for j in ('opus', 'fable'):
        d = f'{J}/{j}'
        for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            if f.startswith('out-'):
                for l in open(f'{d}/{f}', encoding='utf-8'):
                    if l.strip():
                        try:
                            o = json.loads(l); out[j][o['id']] = o
                        except (ValueError, KeyError):
                            pass
    p = f'{J}/pro/out.jsonl'
    if os.path.exists(p):
        for r in read(p):
            o = parse_obj(r.get('text') or '')
            if o and r['uid'] in ITEMS: out['pro'][r['uid']] = o
    return out


def decode(o, labels):
    tier = {}
    for t, grp in enumerate(o.get('ranking') or []):
        for l in (grp if isinstance(grp, list) else [grp]):
            tier[l] = t
    res = {}
    for l, s in (o.get('scores') or {}).items():
        if l not in labels or not isinstance(s, dict): continue
        try:
            n = sx.norm(s, tier.get(l))
        except Exception:
            continue
        if n['fid'] is not None:
            try: n['fid'] = float(n['fid'])
            except (TypeError, ValueError): n['fid'] = None
        n['spans'] = [x for x in (s.get('spans') or []) if isinstance(x, dict) and x.get('quote')]
        n['inv'] = [x for x in (s.get('invention') or []) if isinstance(x, dict)]
        n['revq'] = (s.get('reversal') or {}).get('candidate') if isinstance(s.get('reversal'), dict) else None
        n['defq'] = [x.get('detail', '') for x in (s.get('defects') or []) if isinstance(x, dict)]
        n['label'] = l
        res[labels[l]] = n
    return res


RAW = load_judges()
DEC = {j: {i: decode(o, ITEMS[i]['labels']) for i, o in RAW[j].items() if i in ITEMS} for j in RAW}
JUDGES = [j for j in ('opus', 'pro', 'fable') if DEC[j]]


# ---------- helpers ----------
def mean(x): return sum(x) / len(x) if x else None


def boot(pages, stat, seed=6545):
    """Bootstrap by page (one page per work here, so by work): 2,000 draws, 2.5/97.5 percentiles."""
    if len(pages) < 2: return None
    rng = random.Random(seed); vals = []
    for _ in range(B):
        d = [pages[rng.randrange(len(pages))] for _ in pages]
        v = stat(d)
        if v is not None: vals.append(v)
    vals.sort()
    return [round(vals[int(0.025 * len(vals))], 3), round(vals[int(0.975 * len(vals)) - 1], 3)] if vals else None


def arms_items(lang=None, kind='ARMS'):
    return [i for i, k in ITEMS.items() if k['kind'] == kind and (lang is None or k['lang'] == lang)]


def fid(j, i, a):
    d = DEC[j].get(i, {}).get(a)
    return d['fid'] if d and d['fid'] is not None else None


norm_ws = lambda s: re.sub(r'\s+', ' ', s).strip().lower()


def locate(quote, text):
    """(start, end) of a judge's quote in the candidate, or None. Exact after whitespace/case folding, else its first 5 words."""
    t = norm_ws(text); q = norm_ws(quote).strip('"\'“”‘’.…')
    if not q: return None
    k = t.find(q)
    if k < 0:
        w = q.split(' ')
        for n in (6, 4, 3):
            if len(w) >= n:
                k = t.find(' '.join(w[:n]))
                if k >= 0: break
    if k < 0: return None
    return (k, k + len(q))


def spans_of(j, i, a, types=('accuracy',)):
    d = DEC[j].get(i, {}).get(a)
    if not d: return []
    text = TEXTS[i][d['label']]
    out = []
    for s in d['spans']:
        if types and s.get('type') not in types: continue
        loc = locate(s['quote'], text)
        if loc: out.append(loc)
    return out


# ---------- Krippendorff's alpha, ordinal, 1–5 ----------
def kalpha(pairs):
    """pairs: list of (a, b) values from two coders on the same unit (no missing)."""
    vals = [1, 2, 3, 4, 5]
    pairs = [(round(a), round(b)) for a, b in pairs if a is not None and b is not None]
    if len(pairs) < 5: return None
    o = {(c, k): 0.0 for c in vals for k in vals}
    for a, b in pairs:
        o[(a, b)] += 1; o[(b, a)] += 1
    n_c = {c: sum(o[(c, k)] for k in vals) for c in vals}
    n = sum(n_c.values())

    def d2(c, k):
        if c == k: return 0.0
        lo, hi = min(c, k), max(c, k)
        return (sum(n_c[g] for g in range(lo, hi + 1)) - (n_c[lo] + n_c[hi]) / 2) ** 2
    Do = sum(o[(c, k)] * d2(c, k) for c in vals for k in vals) / n
    De = sum(n_c[c] * n_c[k] * d2(c, k) for c in vals for k in vals) / (n * (n - 1))
    return None if De == 0 else 1 - Do / De


def alpha_with_ci(units):
    """units: list of (page_id, a, b). Bootstrap resamples pages."""
    by = {}
    for p, a, b in units: by.setdefault(p, []).append((a, b))
    pages = list(by)
    pt = kalpha([x for p in pages for x in by[p]])
    ci = boot(pages, lambda d: kalpha([x for p in d for x in by[p]]))
    return {'alpha': None if pt is None else round(pt, 3), 'ci_by_work': ci, 'units': len(units), 'works': len(pages)}


# ---------- per-panel arm table ----------
def panel_table(lang, arms):
    items = arms_items(lang)
    page = {i: ITEMS[i]['page_id'] for i in items}
    out = {'pages': len(items), 'by_judge': {}}
    for j in JUDGES:
        tab = {}
        for a in arms:
            rows = [i for i in items if fid(j, i, a) is not None]
            if not rows: continue
            f = lambda d: mean([fid(j, i, a) for i in d])
            revs = [DEC[j][i][a]['rev'] for i in rows]
            tab[a] = {'n': len(rows), 'fidelity': round(f(rows), 3), 'ci_by_work': boot(rows, f), 'reversals_per_100': round(100 * mean(revs), 1),
                      'omission_pct': round(100 * mean([DEC[j][i][a]['om'] for i in rows]), 1),
                      'acc_spans_per_page': round(mean([len([s for s in DEC[j][i][a]['spans'] if s.get('type') == 'accuracy']) for i in rows]), 2),
                      'style_spans_per_page': round(mean([len([s for s in DEC[j][i][a]['spans'] if s.get('type') == 'style']) for i in rows]), 2)}
        out['by_judge'][j] = tab
    # either-judge reversal pages (Opus or Pro)
    out['reversal_pages_either'] = {a: sum(1 for i in items if any(DEC[j].get(i, {}).get(a, {}).get('rev') for j in ('opus', 'pro'))) for a in arms}
    return out


def paired(lang, x, y, judge):
    items = [i for i in arms_items(lang) if fid(judge, i, x) is not None and fid(judge, i, y) is not None]
    if not items: return None
    d = lambda s: mean([fid(judge, i, x) - fid(judge, i, y) for i in s])
    w = sum(1 for i in items if fid(judge, i, x) > fid(judge, i, y)); l = sum(1 for i in items if fid(judge, i, x) < fid(judge, i, y))
    return {'n': len(items), 'mean': round(d(items), 3), 'ci_by_work': boot(items, d), 'wins': w, 'losses': l, 'ties': len(items) - w - l}


def headline_judge(x, y):
    """Family rule: a pair with a Claude-made arm is headlined by the Pro judge; Gemini-only pairs by the Opus judge."""
    return 'pro' if (x in CLAUDE or y in CLAUDE) else 'opus'


# ---------- judge controls (planted errors) ----------
def plant_catches():
    res = {}
    for j in JUDGES:
        rows = []
        for i, k in ITEMS.items():
            if k['kind'] != 'PLANT' or i not in DEC[j]: continue
            d = DEC[j][i].get('C38_PLANT')
            if not d: continue
            text = TEXTS[i][d['label']]
            pl = k['plant']
            pos = norm_ws(text).find(norm_ws(pl['new'])[:60])
            region = (pos, pos + len(norm_ws(pl['new']))) if pos >= 0 else None
            quotes = [s['quote'] for s in d['spans']] + ([d['revq']] if d['revq'] else [])
            located = False
            if region:
                for q in quotes:
                    loc = locate(q, text)
                    if loc and loc[0] < region[1] + 20 and loc[1] > region[0] - 20: located = True
            # count-based: lower than the same page's C38 in the ARMS item, same judge
            arms_i = next((a for a, kk in ITEMS.items() if kk['kind'] == 'ARMS' and kk['page_id'] == k['page_id']), None)
            ref = fid(j, arms_i, 'C38') if arms_i else None
            lower = d['fid'] is not None and ref is not None and d['fid'] < ref
            rows.append({'item': i, 'lang': k['lang'], 'kind': pl['kind'], 'how': pl['how'], 'located': located, 'lower_than_C38': lower, 'fid': d['fid'], 'C38_fid': ref})
        res[j] = {'n': len(rows), 'located': sum(r['located'] for r in rows), 'lower': sum(r['lower_than_C38'] for r in rows),
                  'located_by_kind': {kd: [sum(r['located'] for r in rows if r['kind'] == kd), sum(1 for r in rows if r['kind'] == kd)] for kd in sorted({r['kind'] for r in rows})},
                  'rows': rows}
    return res


# ---------- agreement ----------
def agreement(ja, jb, item_filter=None, arms=None):
    units = []
    for i, k in ITEMS.items():
        if k['kind'] != 'ARMS' or (item_filter and not item_filter(i)): continue
        for a in k['labels'].values():
            if arms and a not in arms: continue
            fa, fb = fid(ja, i, a), fid(jb, i, a)
            if fa is not None and fb is not None: units.append((k['page_id'], fa, fb))
    return alpha_with_ci(units)


def retest(j):
    units = []
    for i, k in ITEMS.items():
        if k['kind'] != 'REPEAT': continue
        a_i = next((x for x, kk in ITEMS.items() if kk['kind'] == 'ARMS' and kk['page_id'] == k['page_id']), None)
        for a in k['labels'].values():
            f1, f2 = fid(j, a_i, a), fid(j, i, a)
            if f1 is not None and f2 is not None: units.append((k['page_id'], f1, f2))
    return alpha_with_ci(units)


def rank_agreement(ja, jb, langs, arms, item_filter=None):
    agree = total = 0; rows = []
    for L in langs:
        items = [i for i in arms_items(L) if not item_filter or item_filter(i)]
        for x_i, x in enumerate(arms):
            for y in arms[x_i + 1:]:
                sg = []
                for j in (ja, jb):
                    c = [i for i in items if all(fid(jj, i, a) is not None for jj in (ja, jb) for a in (x, y))]
                    if len(c) < 3: sg = None; break
                    m = mean([fid(j, i, x) - fid(j, i, y) for i in c])
                    sg.append((m > 0) - (m < 0))
                if not sg: continue
                total += 1; agree += sg[0] == sg[1]
                rows.append({'lang': L, 'pair': f'{x}-{y}', ja: sg[0], jb: sg[1]})
    return {'pairs': total, 'agree': agree, 'share': round(agree / total, 3) if total else None, 'rows': rows}


def span_f1(ja, jb, item_filter=None):
    ma = na = mb = nb = 0
    for i, k in ITEMS.items():
        if k['kind'] != 'ARMS' or (item_filter and not item_filter(i)): continue
        for a in k['labels'].values():
            if a not in DEC[ja].get(i, {}) or a not in DEC[jb].get(i, {}): continue
            A, Bs = spans_of(ja, i, a), spans_of(jb, i, a)
            ov = lambda s, T: any(s[0] < t[1] and s[1] > t[0] for t in T)
            ma += sum(ov(s, Bs) for s in A); na += len(A); mb += sum(ov(s, A) for s in Bs); nb += len(Bs)
    P = ma / na if na else None; R = mb / nb if nb else None
    return {'spans_a': na, 'spans_b': nb, 'precision_a_in_b': None if P is None else round(P, 3), 'recall': None if R is None else round(R, 3),
            'f1': round(2 * P * R / (P + R), 3) if P and R else None}


def self_preference(item_filter=None):
    """(Pro judge − Opus judge) on Gemini-made arms minus the same on Claude-made arms, per page; bootstrap by page."""
    per = {}
    for i, k in ITEMS.items():
        if k['kind'] != 'ARMS' or (item_filter and not item_filter(i)): continue
        g = [fid('pro', i, a) - fid('opus', i, a) for a in k['labels'].values() if a in GEMINI and fid('pro', i, a) is not None and fid('opus', i, a) is not None]
        c = [fid('pro', i, a) - fid('opus', i, a) for a in k['labels'].values() if a in CLAUDE and fid('pro', i, a) is not None and fid('opus', i, a) is not None]
        if g and c: per[i] = (mean(g), mean(c))
    ii = list(per)
    if not ii: return None
    st = lambda d: mean([per[i][0] - per[i][1] for i in d])
    return {'pages': len(ii), 'gap_gemini_arms': round(mean([per[i][0] for i in ii]), 3), 'gap_claude_arms': round(mean([per[i][1] for i in ii]), 3),
            'did': round(st(ii), 3), 'ci_by_work': boot(ii, st)}


# ---------- correction-arm risk measures ----------
def edit_share(a, b):
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    same = sum(bl.size for bl in sm.get_matching_blocks())
    return 1 - same / max(len(a), 1), sm


def pct(xs, q):
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(q * len(xs)))], 3) if xs else None


def correction_measures(langs, corr_arms):
    from arms import load
    uids = sorted({k['page_id'] for k in ITEMS.values() if k['kind'] == 'ARMS'})
    texts, _, _ = load(uids, ['FP'] + [a for a in corr_arms if a in ('CF', 'CO')])
    out = {}
    plants = json.load(open(f'{W}/plants-corr.json')) if os.path.exists(f'{W}/plants-corr.json') else {}
    fp = stored('FP')
    for a in corr_arms:
        o = {}
        arm_text = lambda i, a=a: TEXTS[i][next(l for l, x in ITEMS[i]['labels'].items() if x == a)]
        ai = [i for i in arms_items() if a in ITEMS[i]['labels'].values() and 'FP' in ITEMS[i]['labels'].values() and ITEMS[i]['lang'] in langs]
        # edit size
        shares = {}
        for i in ai:
            s, _ = edit_share(fp[ITEMS[i]['page_id']], arm_text(i)); shares[i] = s
        o['edit_share'] = {'n': len(shares), 'median': pct(list(shares.values()), 0.5), 'p90': pct(list(shares.values()), 0.9),
                           'unchanged': sum(1 for v in shares.values() if v == 0)}
        # targeted vs polish: share of FP characters the corrector changed that lie inside an accuracy span either judge flagged on FP
        inside = total = 0
        for i in ai:
            draft = fp[ITEMS[i]['page_id']]; _, sm = edit_share(draft, arm_text(i))
            flagged = []
            fl = next(l for l, x in ITEMS[i]['labels'].items() if x == 'FP')
            for j in ('opus', 'pro'):
                d = DEC[j].get(i, {}).get('FP')
                if not d: continue
                for s in d['spans']:
                    if s.get('type') != 'accuracy': continue
                    k0 = draft.lower().find(norm_ws(s['quote'])[:40].lower())
                    if k0 >= 0: flagged.append((k0 - 15, k0 + len(s['quote']) + 15))
            for tag, i1, i2, j1, j2 in sm.get_opcodes():
                if tag == 'equal': continue
                rng_ = range(i1, max(i2, i1 + 1))
                total += len(rng_); inside += sum(1 for c in rng_ if any(f0 <= c < f1 for f0, f1 in flagged))
        o['changed_chars_inside_flagged_spans'] = {'share': round(inside / total, 3) if total else None, 'changed_chars': total}
        # by judge: Δ accuracy spans and Δ style spans vs FP; invented edits; errors the edit introduced
        o['by_judge'] = {}
        for j in JUDGES:
            rows = [i for i in ai if a in DEC[j].get(i, {}) and 'FP' in DEC[j].get(i, {})]
            if not rows: continue
            cnt = lambda i, x, t: len([s for s in DEC[j][i][x]['spans'] if s.get('type') == t])
            inv_new = 0; intro = 0
            for i in rows:
                # only quotes found in the corrected text and NOT found in the draft: text the edit put there
                draft, mine = fp[ITEMS[i]['page_id']], arm_text(i)
                new_q = lambda q: q and locate(q, mine) is not None and locate(q, draft) is None
                inv_new += sum(1 for v in DEC[j][i][a]['inv'] if v.get('kind') in ('added_fact', 'unreadable_fill') and new_q(v.get('quote')))
                intro += sum(1 for s in DEC[j][i][a]['spans'] if s.get('type') == 'accuracy' and new_q(s['quote']))
            o['by_judge'][j] = {'n': len(rows), 'd_accuracy_spans_per_page': round(mean([cnt(i, a, 'accuracy') - cnt(i, 'FP', 'accuracy') for i in rows]), 2),
                                'd_style_spans_per_page': round(mean([cnt(i, a, 'style') - cnt(i, 'FP', 'style') for i in rows]), 2),
                                'invented_edits_per_100': round(100 * inv_new / len(rows), 1), 'introduced_accuracy_spans_per_100': round(100 * intro / len(rows), 1)}
        # over-correction: pages where both Opus and Pro gave FP >= 4.5
        clean = [i for i in ai if all((fid(j, i, 'FP') or 0) >= 4.5 for j in ('opus', 'pro'))]
        oc = {'clean_pages': len(clean)}
        for j in ('opus', 'pro'):
            dd = [fid(j, i, a) - fid(j, i, 'FP') for i in clean if fid(j, i, a) is not None]
            oc[j] = {'lower': sum(1 for x in dd if x < 0), 'n': len(dd), 'mean_drop_when_lower': round(mean([x for x in dd if x < 0]), 2) if any(x < 0 for x in dd) else 0}
        relaxed = [i for i in ai if all((fid(j, i, 'FP') or 0) >= 4 for j in ('opus', 'pro'))]
        oc['relaxed_both_judges_ge_4'] = {'pages': len(relaxed)}
        for j in ('opus', 'pro'):
            dd = [fid(j, i, a) - fid(j, i, 'FP') for i in relaxed if fid(j, i, a) is not None]
            oc['relaxed_both_judges_ge_4'][j] = {'lower': sum(1 for x in dd if x < 0), 'higher': sum(1 for x in dd if x > 0), 'n': len(dd), 'mean_change': round(mean(dd), 2) if dd else None}
        o['over_correction'] = oc
        # gain by draft noise tertile (FP's mean fidelity over Opus and Pro)
        sc = [(i, mean([fid(j, i, 'FP') for j in ('opus', 'pro') if fid(j, i, 'FP') is not None])) for i in ai]
        sc = [x for x in sc if x[1] is not None]; sc.sort(key=lambda x: x[1])
        terc = {}
        for t, name in enumerate(('noisiest third', 'middle third', 'cleanest third')):
            part = sc[t * len(sc) // 3:(t + 1) * len(sc) // 3]
            terc[name] = {'pages': len(part), 'fp_mean': round(mean([x[1] for x in part]), 2) if part else None}
            for j in ('opus', 'pro'):
                dd = [fid(j, i, a) - fid(j, i, 'FP') for i, _ in part if fid(j, i, a) is not None and fid(j, i, 'FP') is not None]
                terc[name][f'gain_{j}'] = round(mean(dd), 2) if dd else None
        o['gain_by_draft_noise'] = terc
        # planted errors in the draft (CF-PL / CO-PL): fixed, left (anchored) or rewritten
        pl_rows = []
        prow = {}
        if os.path.exists(f'{W}/arms/{a}-PL.jsonl'):
            for r in read(f'{W}/arms/{a}-PL.jsonl'):
                if r.get('text') or r['uid'] not in prow: prow[r['uid']] = r
        for uid, r in prow.items():
            u = uid.split('#')[0]
            if u not in plants or ITEMS and plants[u]['lang'] not in langs: continue
            raw = r.get('raw') if r.get('route') == 'claude-cli' else r.get('text')
            t, prob = unwrap(raw or '')
            if not t: pl_rows.append({'uid': u, 'failed': True}); continue
            T = norm_ws(t)
            for p in plants[u]['plants']:
                new, old = norm_ws(p['new']), norm_ws(p['old'])
                m_sw = re.match(r'swap (.+) ↔ (.+)', p['how'])
                if m_sw and f'{m_sw.group(2)} and {m_sw.group(1)}'.lower() in new:
                    pl_rows.append({'uid': u, 'kind': p['kind'], 'how': p['how'], 'status': 'excluded: order of a coordinated pair is not a meaning error'}); continue
                if new in T and new != old: st = 'left'
                elif old in T: st = 'fixed'
                else:
                    # the sentence was rewritten: is the planted token gone from the closest sentence?
                    sents = re.split(r'(?<=[.!?;:])\s+|\n+', t)
                    best = max(sents, key=lambda s: difflib.SequenceMatcher(None, norm_ws(s), new).ratio()) if sents else ''
                    tok = p['how'].split('→')[-1].strip().lower() if '→' in p['how'] else None
                    if p['kind'] == 'negation' and tok:
                        st = 'left (rewritten)' if (tok in norm_ws(best)) else 'fixed (rewritten)'
                    elif tok and p['kind'] in ('number', 'name'):
                        st = 'left (rewritten)' if tok.split(' ')[-1] in norm_ws(best) else 'fixed (rewritten)'
                    elif p['kind'] == 'clause' and p.get('dropped'):
                        cw = [w for w in re.findall(r'[a-zāīūṛṣṇśḥṃ]{4,}', norm_ws(p['dropped']))]
                        hit = sum(1 for w in cw if w in T)
                        st = 'fixed (rewritten)' if cw and hit / len(cw) >= 0.5 else 'left (rewritten)'
                    else:
                        st = 'rewritten'
                pl_rows.append({'uid': u, 'kind': p['kind'], 'how': p['how'], 'status': st})
            # edit size outside the plants: share of the rest changed
        n_pl = [x for x in pl_rows if not x.get('failed') and not x['status'].startswith('excluded')]
        o['planted'] = {'plants': len(n_pl), 'fixed': sum(1 for x in n_pl if x['status'].startswith('fixed')), 'left': sum(1 for x in n_pl if x['status'].startswith('left')),
                        'unclear': sum(1 for x in n_pl if x['status'] == 'rewritten'), 'failed_reads': sum(1 for x in pl_rows if x.get('failed')), 'rows': pl_rows}
        out[a] = o
    return out


def run_meta(arms):
    """seconds and calls per page from the arm rows (stage pages only)."""
    from arms import latest
    uids = {k['page_id'] for k in ITEMS.values() if k['kind'] == 'ARMS'}
    m = {}
    for a in arms:
        if a == 'FP': continue
        rows = [r for u, r in (latest(f'{W}/arms/{a}.jsonl').items() if a != 'C38' else {r['uid']: r for r in read('/root/cli38-6182/C38-full.jsonl')}.items()) if u in uids]
        if not rows: continue
        secs = [r.get('secs') for r in rows if r.get('secs') is not None]
        calls = [(r.get('attempts') or 1) for r in rows]
        m[a] = {'pages': len(rows), 'secs_per_page_median': round(statistics.median(secs), 1) if secs else None, 'secs_per_page_mean': round(mean(secs), 1) if secs else None,
                'calls_per_page': round(mean(calls), 2), 'nudged': sum(1 for r in rows if r.get('nudged'))}
    return m


def main():
    langs = KEY['langs']; arms = KEY['arms']
    S = {'round': ROUND, 'langs': langs, 'arms': arms, 'judged_items': {j: len(DEC[j]) for j in JUDGES}, 'items': {k: sum(1 for x in ITEMS.values() if x['kind'] == k) for k in ('ARMS', 'PLANT', 'REPEAT')},
         'failed_reads': {a: len(v) for a, v in KEY['failed_reads'].items()}, 'failed_reads_detail': KEY['failed_reads']}
    S['panels'] = {}
    for L in langs + ['pooled']:
        LL = None if L == 'pooled' else L
        tab = panel_table(LL, arms) if LL else None
        pairs = {}
        cmp = [('PRO', 'C38'), ('PRO', 'C38S'), ('C38S', 'C38'), ('OPUS', 'C38'), ('OPUS', 'PRO'), ('PRO', 'FP'), ('C38', 'FP'), ('OPUS', 'FP'),
               ('OPUS', 'C38S'), ('CF', 'FP'), ('CO', 'FP'), ('CO', 'C38S'), ('C38S2', 'C38S'), ('OPUS', 'C38S2'), ('DO', 'OPUS'), ('DO', 'C38S'), ('DF', 'C38S'), ('CF', 'C38'), ('CO', 'C38'), ('CO', 'OPUS'), ('DF', 'FP'), ('DO', 'FP'), ('DF', 'C38'), ('DO', 'C38'), ('DO', 'CO'), ('DF', 'CF')]
        for x, y in cmp:
            if x not in arms or y not in arms: continue
            pairs[f'{x}-{y}'] = {'headline_judge': headline_judge(x, y), **{j: paired(LL, x, y, j) for j in JUDGES}}
            ps = [pairs[f'{x}-{y}'][j] for j in ('opus', 'pro') if pairs[f'{x}-{y}'].get(j)]
            sg = {(p['mean'] > 0) - (p['mean'] < 0) for p in ps}
            pairs[f'{x}-{y}']['judges_agree_on_sign'] = len(ps) == 2 and len(sg) == 1
        S['panels'][L] = {'table': tab, 'pairs': pairs}
        if LL is None:
            S['panels'][L]['table'] = panel_table(None, arms)
    S['plant_controls'] = plant_catches()
    S['agreement'] = {}
    for ja, jb in (('opus', 'pro'), ('opus', 'fable'), ('pro', 'fable')):
        if ja not in JUDGES or jb not in JUDGES: continue
        S['agreement'][f'{ja}-{jb}'] = {L: agreement(ja, jb, (lambda i, L=L: ITEMS[i]['lang'] == L) if L != 'pooled' else None) for L in langs + ['pooled']}
        S['agreement'][f'{ja}-{jb}']['span_f1'] = span_f1(ja, jb)
        S['agreement'][f'{ja}-{jb}']['ranking'] = rank_agreement(ja, jb, langs, [a for a in arms])
    S['retest'] = {j: retest(j) for j in JUDGES}
    if 'pro' in JUDGES and 'opus' in JUDGES:
        S['self_preference'] = {L: self_preference((lambda i, L=L: ITEMS[i]['lang'] == L) if L != 'pooled' else None) for L in langs + ['pooled']}
    corr = [a for a in arms if a in ('CF', 'CO', 'DF', 'DO')]
    if corr: S['correction'] = correction_measures(langs, corr)
    S['run'] = run_meta(arms)
    # Fable subset: Opus outlier cases (Fable and Pro agree, Opus differs by >= 2) and by >= 1
    if 'fable' in JUDGES:
        out1 = []; n = 0
        for i in KEY.get('fable_items', []):
            if ITEMS[i]['kind'] != 'ARMS': continue
            for a in ITEMS[i]['labels'].values():
                f, p, o = fid('fable', i, a), fid('pro', i, a), fid('opus', i, a)
                if None in (f, p, o): continue
                n += 1
                if f == p and abs(o - f) >= 1: out1.append({'item': i, 'arm': a, 'lang': ITEMS[i]['lang'], 'opus': o, 'fable': f, 'pro': p})
        S['opus_outlier'] = {'units': n, 'opus_off_by_1plus': len(out1), 'opus_off_by_2plus': sum(1 for x in out1 if abs(x['opus'] - x['fable']) >= 2),
                             'opus_higher': sum(1 for x in out1 if x['opus'] > x['fable']), 'rows': out1}
        # the same for Pro and Fable as the outlier, for scale
        for who, (x1, x2) in (('pro', ('opus', 'fable')), ('fable', ('opus', 'pro'))):
            c = 0
            for i in KEY.get('fable_items', []):
                if ITEMS[i]['kind'] != 'ARMS': continue
                for a in ITEMS[i]['labels'].values():
                    v = [fid(j, i, a) for j in (who, x1, x2)]
                    if None not in v and v[1] == v[2] and abs(v[0] - v[1]) >= 1: c += 1
            S[f'{who}_outlier_off_by_1plus'] = c
    os.makedirs(f'{RESULTS}/{ROUND}', exist_ok=True)
    json.dump(S, open(f'{RESULTS}/{ROUND}/scores.json', 'w'), ensure_ascii=False, indent=1)
    # print summary
    for L in langs + ['pooled']:
        print(f'\n== {L}')
        for j in JUDGES:
            t = S['panels'][L]['table']['by_judge'].get(j, {})
            print(f'  {j:5s} ' + '  '.join(f"{a} {v['fidelity']:.2f}({v['n']}) r{v['reversals_per_100']:.0f}" for a, v in t.items()))
        for k, v in S['panels'][L]['pairs'].items():
            print(f'  {k:10s} head={v["headline_judge"]:5s} ' + '  '.join(f"{j} {v[j]['mean']:+.2f} {v[j]['ci_by_work']}" for j in JUDGES if v.get(j)) + ('' if v['judges_agree_on_sign'] else '  SPLIT'))
    print('\nplant controls', {j: (v['located'], v['lower'], v['n']) for j, v in S['plant_controls'].items()})
    print('agreement', {k: (v['pooled']['alpha'], v['pooled']['ci_by_work'], v['span_f1']['f1'], v['ranking']['share']) for k, v in S['agreement'].items()})
    print('retest', {j: (v['alpha'], v['units']) for j, v in S['retest'].items()})
    print('self-pref', {L: (v or {}).get('did') for L, v in S.get('self_preference', {}).items()})
    for a, o in S.get('correction', {}).items():
        print(a, 'edit', o['edit_share'], 'inside-flagged', o['changed_chars_inside_flagged_spans'], 'planted', {k: v for k, v in o['planted'].items() if k != 'rows'}, 'overcorr', o['over_correction'])
        print('   ', o['by_judge'], o['gain_by_draft_noise'])
    print('run', S['run'])


if __name__ == '__main__':
    main()
