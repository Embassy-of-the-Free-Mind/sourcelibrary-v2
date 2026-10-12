#!/usr/bin/env python3
# PRIOR ART: score-greif.py (same failed-read rule and bootstrap; one document = 3 pages there, one page here) and
# disagree.py (spans, anchoring, word edit script). Humphries' own CER_WER.py (Transcription Pearl) needs enchant +
# nltk to forgive spelling modernisation and is not runnable here; its strict/modified split is ported (#6547).
"""
  python3 score-bentham.py --root $JOB_SCRATCH [--json out.json]

Two measures per reading, both against the Bentham R0 page reference (lines sorted top to bottom):
  page      the whole reading against the whole reference (text the reference never transcribed counts as error);
  anchored  only the reading's words that fall in some reference line's best-matching window, in reference order
            (forgives marginal archive notes the reference omits, and line order; also forgives invented extra text).
Each in Humphries' strict (case + punctuation count) and modified (both ignored) forms.
"""
import argparse, json, os
from textmetrics import unwrap, failed_kind, counts, ratio_ci, plant_verdict, plant_ambiguous, humphries_modified, lev
from disagree import load, toks, anchored_indices, disagreement_spans, word_ops

READERS = ('pro', 'flash', 'opus')


def mkey(t):
    return humphries_modified(t)


def anchored_text(text, gt):
    T = toks(text)
    return ' '.join(T[i].strip() for i in anchored_indices(gt, T))


def measure(texts, gt):
    """texts {uid: text}. Pooled CER/WER with page-resampled CIs, page and anchored, strict and modified."""
    out = {}
    for view in ('page', 'anchored'):
        for n in ('humphries_strict', 'humphries_modified'):
            uc, uw = [], []
            for u, t in texts.items():
                h = anchored_text(t, gt[u]) if view == 'anchored' else t
                cd, cl, wd, wl = counts(h, gt[u], n)
                uc.append((cd, cl)); uw.append((wd, wl))
            out[f'{view}/{n}'] = {'cer': ratio_ci(uc), 'wer': ratio_ci(uw)}
    out['pages'] = len(texts)
    return out


def oracle(primary, others, gt):
    """Humphries' 'if the flagged spans were resolved correctly'. Errors are the primary's word edits against the
    reference (modified form, anchored); an error is caught when its primary word is flagged (a missing word: when a
    neighbour is). Returns counts and the oracle text's word keys."""
    P = toks(primary)
    spans = disagreement_spans(primary, others)
    flagged = {k for s, e in spans for k in range(s, e)}
    idx = [i for i in anchored_indices(gt, P) if mkey(P[i])]
    hk = [mkey(P[i]) for i in idx]
    rk = [k for k in (mkey(t) for t in gt.split()) if k]
    ops = word_ops(hk, rk)
    errs = caught = 0
    oracle_keys, last_h = [], None
    for n, (op, hi, ri) in enumerate(ops):
        if op == 'eq':
            oracle_keys.append(hk[hi]); last_h = hi; continue
        errs += 1
        if op in ('sub', 'ins'):
            c = idx[hi] in flagged
            last_h = hi
        else:
            nxt = next((o[1] for o in ops[n + 1:] if o[1] is not None), None)
            c = any(h is not None and idx[h] in flagged for h in (last_h, nxt))
        caught += c
        if op == 'sub':
            oracle_keys.append(rk[ri] if c else hk[hi])
        elif op == 'ins':
            if not c:
                oracle_keys.append(hk[hi])
        elif c:
            oracle_keys.append(rk[ri])
    flagged_chars = sum(len(P[k].strip()) for k in flagged)
    return {'words': len(P), 'flagged_words': len(flagged), 'chars': sum(len(t.strip()) for t in P), 'flagged_chars': flagged_chars,
            'spans': len(spans), 'errors': errs, 'caught': caught, 'ref_words': len(rk),
            'oracle_cd': lev(' '.join(oracle_keys), ' '.join(rk)), 'primary_cd': lev(' '.join(hk), ' '.join(rk)), 'ref_chars': len(' '.join(rk)),
            'oracle_wd': lev(oracle_keys, rk), 'primary_wd': lev(hk, rk)}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--root', default=os.environ.get('JOB_SCRATCH')); ap.add_argument('--json')
    a = ap.parse_args()
    b = os.path.join(a.root, 'bentham')
    gt = json.load(open(os.path.join(b, 'gt.json')))
    arms = {os.path.basename(p)[:-6]: load(os.path.join(b, 'out', p)) for p in sorted(os.listdir(os.path.join(b, 'out'))) if p.endswith('.jsonl')}
    rep = {'single': {}, 'disagreement': {}, 'correction': {}, 'anchoring': {}}

    def reads(rows, uids):
        texts, fails = {}, {}
        for u in uids:
            k = failed_kind(rows.get(u))
            if k == 'missing':
                continue
            if k:
                fails[k] = fails.get(k, 0) + 1
            else:
                texts[u] = unwrap(rows[u]['text'])[0]
        return texts, fails

    # (b) single readers, and the resolver scored as a reading
    for arm in [x for x in ('pro', 'flash', 'opus', 'resolve') if x in arms]:
        texts, fails = reads(arms[arm], gt)
        rep['single'][arm] = {'did_not_read': fails, **measure(texts, gt)}

    # (c) disagreement, on pages all three read
    if all(r in arms for r in READERS):
        T = {r: reads(arms[r], gt)[0] for r in READERS}
        common = [u for u in gt if all(u in T[r] for r in READERS)]
        for name, others in (('pro|flash+opus', ('flash', 'opus')), ('pro|opus', ('opus',)), ('pro|flash', ('flash',))):
            per = {u: oracle(T['pro'][u], [T[o][u] for o in others], gt[u]) for u in common}
            S = lambda k: sum(p[k] for p in per.values())
            res = {'pages': len(common), 'flagged_word_share': S('flagged_words') / max(1, S('words')),
                   'flagged_char_share': S('flagged_chars') / max(1, S('chars')), 'spans': S('spans'),
                   'primary_errors': S('errors'), 'caught': S('caught'), 'caught_share': ratio_ci([(p['caught'], p['errors']) for p in per.values()]),
                   'primary_cer_mod_anchored': ratio_ci([(p['primary_cd'], p['ref_chars']) for p in per.values()]),
                   'oracle_cer_mod_anchored': ratio_ci([(p['oracle_cd'], p['ref_chars']) for p in per.values()]),
                   'primary_wer_mod_anchored': ratio_ci([(p['primary_wd'], p['ref_words']) for p in per.values()]),
                   'oracle_wer_mod_anchored': ratio_ci([(p['oracle_wd'], p['ref_words']) for p in per.values()]),
                   'flag_share_ci': ratio_ci([(p['flagged_words'], p['words']) for p in per.values()])}
            if name == 'pro|flash+opus' and 'resolve' in arms:
                # pages with no disagreement keep the primary unchanged; the others take the resolver's text
                rt, rf = reads(arms['resolve'], common)
                final = {u: rt.get(u, T['pro'][u]) for u in common}
                no_flag = [u for u in common if u not in arms['resolve']]
                res['resolver'] = {'did_not_read': rf, 'pages_with_flags': len(common) - len(no_flag), **measure(final, gt)}
                res['primary_same_pages'] = measure({u: T['pro'][u] for u in common}, gt)
            rep['disagreement'][name] = res

    # (d) stand-in: correction of the Flash read; and anchoring
    plants = json.load(open(os.path.join(b, 'plants.json')))['plants'] if os.path.exists(os.path.join(b, 'plants.json')) else {}
    for arm in [x for x in arms if x.endswith('-corr')]:
        texts, fails = reads(arms[arm], gt)
        draft = {u: reads(arms['flash'], [u])[0].get(u) for u in texts}
        draft = {u: t for u, t in draft.items() if t is not None}
        texts = {u: t for u, t in texts.items() if u in draft}  # pages whose draft was itself a read
        rep['correction'][arm] = {'did_not_read': fails, 'corrected': measure(texts, gt), 'draft_same_pages': measure(draft, gt)}
    for arm in [x for x in arms if x.endswith('-corr-anchor')]:
        v = {'survived': 0, 'corrected': 0, 'other': 0, 'site_not_found': 0, 'ambiguous': 0}
        per = {}
        detail = []
        for u, pl in plants.items():
            r = arms[arm].get(u)
            if failed_kind(r):
                continue
            t = unwrap(r['text'])[0]
            for x in pl:
                vv = 'ambiguous' if plant_ambiguous(x, gt[u]) else plant_verdict(t, x)
                v[vv] += 1; detail.append({'uid': u, **x, 'verdict': vv})
                if vv not in ('ambiguous', 'site_not_found'):
                    pp = per.setdefault(u, [0, 0]); pp[0] += vv == 'survived'; pp[1] += 1
        n = v['survived'] + v['corrected'] + v['other']
        rep['anchoring'][arm] = {**v, 'rate': v['survived'] / n if n else None, 'ci': ratio_ci(list(per.values())), 'pages': len(per), 'detail': detail}

    pc = lambda x: '—' if x is None else f'{100 * x:.2f}%'
    ci = lambda c: f'{pc(c[0])} [{pc(c[1])}, {pc(c[2])}]' if c and c[0] is not None else '—'
    for arm, v in rep['single'].items():
        print(f"{arm:8s} pages {v['pages']} fail {v['did_not_read']}")
        for k in ('page/humphries_strict', 'page/humphries_modified', 'anchored/humphries_strict', 'anchored/humphries_modified'):
            print(f"   {k:28s} CER {ci(v[k]['cer'])}  WER {ci(v[k]['wer'])}")
    for name, v in rep['disagreement'].items():
        print(f"DISAGREE {name}: pages {v['pages']} flagged {pc(v['flagged_word_share'])} of words ({pc(v['flagged_char_share'])} chars), "
              f"errors {v['primary_errors']}, caught {v['caught']} = {ci(v['caught_share'])}; CER mod anchored primary {ci(v['primary_cer_mod_anchored'])} -> oracle {ci(v['oracle_cer_mod_anchored'])}; "
              f"WER {ci(v['primary_wer_mod_anchored'])} -> {ci(v['oracle_wer_mod_anchored'])}")
        if 'resolver' in v:
            r = v['resolver']; p = v['primary_same_pages']
            for k in ('page/humphries_modified', 'anchored/humphries_modified', 'anchored/humphries_strict'):
                print(f"   resolver {k}: CER {ci(r[k]['cer'])} WER {ci(r[k]['wer'])}  (primary same pages CER {ci(p[k]['cer'])})  fail {r['did_not_read']}")
    for arm, v in rep['correction'].items():
        for k in ('page/humphries_strict', 'anchored/humphries_modified', 'anchored/humphries_strict'):
            print(f"CORR {arm} {k}: draft CER {ci(v['draft_same_pages'][k]['cer'])} -> {ci(v['corrected'][k]['cer'])}  fail {v['did_not_read']}")
    for arm, v in rep['anchoring'].items():
        print(f"ANCHOR {arm}: survived {v['survived']} corrected {v['corrected']} other {v['other']} ambiguous {v['ambiguous']} notfound {v['site_not_found']} -> {pc(v['rate'])} {ci(v['ci'])}")
    if a.json:
        json.dump(rep, open(a.json, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
