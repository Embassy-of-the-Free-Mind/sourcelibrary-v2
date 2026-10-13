#!/usr/bin/env python3
# PRIOR ART: the Greif repo's src/benchmarking/txt_accuracy.py (their scorer: one 3-page document per unit, pooled
# Levenshtein over pooled GT length); textmetrics.py ports its two normalisations. This adds the #6523 failed-read
# rule, a by-document bootstrap, the anchoring key, and a control that rescoring THEIR published outputs reproduces
# THEIR published table (#6547).
"""
  python3 score-greif.py --root $JOB_SCRATCH [--json out.json]

Arms read from <root>/greif/out/<arm>.jsonl (rows from run-cli-arm.py / run-claude-arm.py). Published arms are read
from the Greif repo (results/ and results_revisions/ txt files) and scored the same way as a control.
"""
import argparse, glob, json, os, re, sys
from textmetrics import unwrap, failed_kind, counts, ratio_ci, plant_verdict, plant_ambiguous, NORMS

DOCS = list(range(1, 11))
PUBLISHED = {  # their merged per-document outputs, temperature 0.0 run_01
    'pub-transkribus-printM1': 'results/ocr_img2txt/transkribus/type-{d}/run_01/type-{d}.txt',
    'pub-gemini-2.0-flash-ocr': 'results/llm_img2txt/gemini-2.0/type-{d}/temperature_0.0/run_01/type-{d}.txt',
    'pub-gemini-2.0-flash-corr': 'results/llm_img2txt/gemini-2.0-with-transkribus/type-{d}/temperature_0.0/run_01/type-{d}.txt',
    'pub-gemini-3.1-pro-ocr': 'results_revisions/llm_img2txt/gemini-3.1/type-{d}/temperature_0.0/run_01/type-{d}.txt',
    'pub-gemini-3.1-pro-corr': 'results_revisions/llm_img2txt/gemini-3.1-with-transkribus/type-{d}/temperature_0.0/run_01/type-{d}.txt',
}
NS = ('greif_norm', 'greif_strict', 'ours')


def load_rows(path):
    rows = {}
    if os.path.exists(path):
        for l in open(path, encoding='utf-8'):
            if l.strip():
                r = json.loads(l); rows[r['uid']] = r  # last row wins
    return rows


def score_docs(texts, gt):
    """texts: {doc: text or None}. Returns per-norm pooled numbers with CI, plus per-doc CER."""
    out = {}
    for n in NS:
        units_c, units_w, per = [], [], {}
        for d, t in texts.items():
            if t is None:
                continue
            cd, cl, wd, wl = counts(t, gt[d], n)
            units_c.append((cd, cl)); per[d] = round(cd / cl, 5)
            if wd is not None:
                units_w.append((wd, wl))
        c = ratio_ci(units_c); w = ratio_ci(units_w) if units_w else (None, None, None)
        out[n] = {'cer': c, 'wer': w, 'per_doc': per, 'docs': len(units_c)}
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--root', default=os.environ.get('JOB_SCRATCH')); ap.add_argument('--json')
    a = ap.parse_args()
    repo = os.path.join(a.root, 'llm_historical_dataset_benchmarking')
    gt = {d: open(os.path.join(repo, f'data/ground_truth/txt/type-{d}.txt'), encoding='utf-8').read() for d in DOCS}
    report = {'arms': {}, 'published_control': {}, 'anchoring': {}}

    for name, pat in PUBLISHED.items():
        texts = {}
        for d in DOCS:
            p = os.path.join(repo, pat.format(d=d))
            texts[d] = open(p, encoding='utf-8').read() if os.path.exists(p) else None
        report['published_control'][name] = score_docs(texts, gt)

    plants = json.load(open(os.path.join(a.root, 'greif', 'plants.json')))
    for path in sorted(glob.glob(os.path.join(a.root, 'greif', 'out', '*.jsonl'))):
        arm = os.path.basename(path)[:-6]
        rows = load_rows(path)
        anchor = arm.endswith('-corr-anchor')
        docs = plants['anchor_docs'] if anchor else DOCS
        fails, texts, pages_read, no_sent = {}, {}, 0, 0
        for d in docs:
            parts = []
            for p in (1, 2, 3):
                r = rows.get(f'type-{d}-p{p}')
                k = failed_kind(r)
                if k:
                    if k != 'missing':  # 'missing' = not attempted yet (pilot), not a failed read
                        fails[k] = fails.get(k, 0) + 1
                    parts = None; continue
                t, prob = unwrap(r['text']); no_sent += prob == 'no_sentinel'; pages_read += 1
                if parts is not None:
                    parts.append(t)
            texts[d] = '\n'.join(parts) if parts is not None else None  # a document with a failed page is not scored
        s = score_docs(texts, gt)
        attempted = sum(1 for d in docs for p in (1, 2, 3) if f'type-{d}-p{p}' in rows)
        secs = [r['secs'] for r in rows.values() if r.get('secs')]
        report['arms'][arm] = {'pages_attempted': attempted, 'pages_read': pages_read, 'did_not_read': fails,
                               'no_sentinel': no_sent, 'docs_scored': s['greif_norm']['docs'],
                               'secs_per_page': round(sum(secs) / len(secs), 1) if secs else None, **s}
        if anchor:
            surv = {'survived': 0, 'corrected': 0, 'other': 0, 'site_not_found': 0, 'pages': 0, 'by_kind': {}}
            detail = []
            for uid, pl in plants['plants'].items():
                r = rows.get(uid)
                if failed_kind(r):
                    continue
                t = unwrap(r['text'])[0]
                surv['pages'] += 1
                for x in pl:
                    v = 'ambiguous' if plant_ambiguous(x, gt[int(uid.split('-')[1])]) else plant_verdict(t, x)
                    surv[v] = surv.get(v, 0) + 1
                    if v not in ('site_not_found', 'ambiguous'):
                        bk = surv['by_kind'].setdefault(x['kind'], {'survived': 0, 'n': 0}); bk['n'] += 1; bk['survived'] += v == 'survived'
                    detail.append({'uid': uid, **x, 'verdict': v})
            n = surv['survived'] + surv['corrected'] + surv['other']
            surv['rate'] = round(surv['survived'] / n, 3) if n else None
            # by-page interval for the survival share
            per_page = {}
            for dd in detail:
                if dd['verdict'] in ('site_not_found', 'ambiguous'):
                    continue
                pp = per_page.setdefault(dd['uid'], [0, 0]); pp[0] += dd['verdict'] == 'survived'; pp[1] += 1
            surv['ci'] = ratio_ci(list(per_page.values()))
            surv['detail'] = detail
            report['anchoring'][arm] = surv

    # Paired by document: our arm minus the published arm of the same model and mode, resampled by document.
    import random
    pairs = {'pro-ocr': 'pub-gemini-3.1-pro-ocr', 'pro-corr': 'pub-gemini-3.1-pro-corr', 'opus-ocr': 'pub-gemini-3.1-pro-ocr', 'opus-corr': 'pub-gemini-3.1-pro-corr'}
    report['paired_vs_published'] = {}
    for ours_arm, pub in pairs.items():
        if ours_arm not in report['arms']:
            continue
        for n in ('greif_norm', 'greif_strict'):
            A, P = report['arms'][ours_arm][n]['per_doc'], report['published_control'][pub][n]['per_doc']
            docs = [d for d in A if d in P]
            L = {d: counts(gt[d], gt[d], n)[1] for d in docs}  # reference length per document
            diff = lambda ds: (sum(A[d] * L[d] for d in ds) - sum(P[d] * L[d] for d in ds)) / sum(L[d] for d in ds)
            rng = random.Random(6547); bs = sorted(diff([rng.choice(docs) for _ in docs]) for _ in range(10000))
            report['paired_vs_published'][f'{ours_arm} - {pub} ({n})'] = (diff(docs), bs[250], bs[9749])
    # The anchoring documents scored separately: the same documents under the clean draft, for comparison.
    for arm in [x for x in report['arms'] if x.endswith('-corr-anchor')]:
        clean = report['arms'].get(arm[:-len('-anchor')])
        if clean:
            for n in ('greif_norm', 'greif_strict'):
                docs = plants['anchor_docs']
                L = {d: counts(gt[d], gt[d], n)[1] for d in docs}
                pool = lambda per: sum(per[d] * L[d] for d in docs if d in per) / sum(L[d] for d in docs if d in per)
                report['anchoring'][arm][f'cer_{n}_planted_vs_clean'] = (pool(report['arms'][arm][n]['per_doc']), pool(clean[n]['per_doc']))

    def f(x):
        return '—' if x is None else f'{100 * x:.2f}%'

    def ci(c):
        return f'{f(c[0])} [{f(c[1])}, {f(c[2])}]' if c and c[0] is not None else '—'
    print('PUBLISHED (control: their outputs, our scorer)')
    for k, v in report['published_control'].items():
        print(f"  {k:30s} norm CER {ci(v['greif_norm']['cer'])}  strict CER {ci(v['greif_strict']['cer'])}  ours {ci(v['ours']['cer'])}  docs {v['greif_norm']['docs']}")
    print('OURS')
    for k, v in report['arms'].items():
        print(f"  {k:24s} read {v['pages_read']}/{v['pages_attempted']} fail {v['did_not_read']} docs {v['docs_scored']}  norm CER {ci(v['greif_norm']['cer'])}  strict CER {ci(v['greif_strict']['cer'])}  ours {ci(v['ours']['cer'])}  {v['secs_per_page']}s/p")
    for k, v in report['anchoring'].items():
        print(f"  ANCHOR {k}: survived {v['survived']}, corrected {v['corrected']}, other {v['other']}, site not found {v['site_not_found']}, ambiguous {v.get('ambiguous', 0)} on {v['pages']} pages -> {v['rate']} {ci(v['ci'])} {v['by_kind']}")
    for k, v in report['paired_vs_published'].items():
        print(f"  PAIRED {k}: {ci(v)}")
    for k, v in report['anchoring'].items():
        print(f"  ANCHOR DOCS {k}: norm planted {f(v['cer_greif_norm_planted_vs_clean'][0])} vs clean {f(v['cer_greif_norm_planted_vs_clean'][1])}; strict {f(v['cer_greif_strict_planted_vs_clean'][0])} vs {f(v['cer_greif_strict_planted_vs_clean'][1])}")
    if a.json:
        json.dump(report, open(a.json, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
