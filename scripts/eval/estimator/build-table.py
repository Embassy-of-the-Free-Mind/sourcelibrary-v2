#!/usr/bin/env python3
# PRIOR ART: scripts/eval/pareto-6182/score-xl.py, score-tib.py — each scores ONE instrument and reports
# arm means; none emits a pooled page-level long table across experiments, which the estimator (#6557) needs.
# xlref-synthesis-2026-10/build.mjs pools the served arm only, not the judged arms.
"""Build the long table of every page-level judged translation score we hold (#6557).

One row per (experiment, page, arm, judge). Failed reads (refusals, null scores) are kept with
scored=false and never scored. Reads only committed result files; no model calls, no DB.

  python3 scripts/eval/estimator/build-table.py --out $JOB_SCRATCH/table.jsonl --manifest scripts/eval/estimator/manifest.json
"""
import argparse, collections, glob, json, os

R = 'scripts/eval/results'

# arm label -> (model, family, route). Families follow the brief: gemini-lite / gemini-flash / gemini-pro;
# claude-haiku / claude-sonnet / claude-opus. Stored and A-vs-A arms resolve to the page's production engine.
ARM = {
    'L31': ('gemini-3.1-flash-lite', 'gemini-lite', 'api'),
    'L35': ('gemini-3.5-flash-lite', 'gemini-lite', 'api'),
    'FP': ('gemini-3-flash-preview', 'gemini-flash', 'api'),
    'G35': ('gemini-3.5-flash', 'gemini-flash', 'api'),
    'G36': ('gemini-3.6-flash', 'gemini-flash', 'api'),
    'G37': ('gemini-3.7-flash', 'gemini-flash', 'api'),
    'G38': ('gemini-3.8-flash', 'gemini-flash', 'api'),
    'C38': ('gemini-3.8-flash', 'gemini-flash', 'cli'),
    'PRO': ('gemini-3.1-pro-t128', 'gemini-pro', 'api'),
    'O': ('claude-opus-5.5', 'claude-opus', 'sub'),
    'CS': ('claude-sonnet-5.5', 'claude-sonnet', 'sub'),
    'CH': ('claude-haiku-4.5', 'claude-haiku', 'sub'),
    'S': ('gemini-3-flash-preview', 'gemini-flash', 'stored'),
}
PRODMODEL = {'L31': 'L31', 'FP': 'FP', 'gemini-3.1-flash-lite-preview': 'L31', 'gemini-3-flash-preview': 'FP',
             'gemini-3.1-flash-lite': 'L31'}
SCRIPT_FAMILY = {
    'Sanskrit': ('sa', 'indic'), 'Pali': ('pi', 'indic'), 'Tibetan': ('bo', 'tibetan'),
    'Chinese': ('lzh', 'sinitic'), 'Classical Chinese': ('lzh', 'sinitic'),
    'Hebrew': ('he', 'semitic'), 'Arabic': ('ar', 'semitic'), 'Aramaic': ('arc', 'semitic'), 'Syriac': ('syc', 'semitic'),
    'Persian': ('fa', 'iranian'),
    'Latin': ('la', 'classical-eu'), 'Greek': ('grc', 'classical-eu'), 'Ancient Greek': ('grc', 'classical-eu'),
    'German': ('de', 'vernacular-eu'), 'French': ('fr', 'vernacular-eu'), 'Italian': ('it', 'vernacular-eu'),
    'Dutch': ('nl', 'vernacular-eu'), 'Spanish': ('es', 'vernacular-eu'), 'English': ('en', 'vernacular-eu'),
    'Portuguese': ('pt', 'vernacular-eu'), 'Coptic': ('cop', 'other'), 'Armenian': ('hy', 'other'),
}


def lang_info(lang):
    lc, sf = SCRIPT_FAMILY.get(lang, (lang.lower()[:3] if lang else 'unk', 'other'))
    return lc, sf


def arm_model(arm, prod):
    if arm in ('PROD', 'AA'):
        base = PRODMODEL.get(prod, prod)
        m, f, _ = ARM.get(base, (str(prod), 'unknown', 'api'))
        return m, f, 'stored' if arm == 'PROD' else 'api', arm == 'AA'
    m, f, r = ARM[arm]
    return m, f, r, False


def emit(out, exp, round_, page, work, lang, arm, prod, judge, v, failed=False):
    lc, sf = lang_info(lang)
    m, fam, route, is_aa = arm_model(arm, prod)
    fid = None if (v is None or failed) else v.get('fid')
    rev = None if v is None else (v.get('rev') if 'rev' in v else v.get('inv'))
    out.append(dict(experiment=exp, round=round_, page=page, work=work, language=lc, lang_name=lang,
                    script_family=sf, arm=arm, model=m, model_family=fam, route=route, repeat=is_aa,
                    judge=judge, judge_model='claude-opus-5.5', judge_family='claude',
                    score=fid, scored=fid is not None, reversal=(None if rev is None else int(bool(rev))),
                    failed_read=fid is None, variant='', instrument=None))


def xl_instrument(out, path, exp, round_):
    d = json.load(open(path))
    refused = {(a, p) for a, ps in (d.get('refused_after_retry') or {}).items() for p in ps}
    for r in d['rows']:
        for j, arms in r.get('J', {}).items():
            for arm, v in arms.items():
                if arm not in ARM and arm not in ('PROD', 'AA'):
                    continue
                emit(out, exp, round_, r['page_id'], r.get('book'), r.get('lang'), arm, r.get('prod'), j, v,
                     failed=(arm, r['page_id']) in refused)
        # arms the page was meant to carry but no judge scored (failed reads)
        for arm in r.get('arms', []):
            if (arm, r['page_id']) in refused and not any(arm in a for a in r.get('J', {}).values()):
                emit(out, exp, round_, r['page_id'], r.get('book'), r.get('lang'), arm, r.get('prod'), 'none', None, failed=True)


def tib_instrument(out, path, exp, round_):
    d = json.load(open(path))
    for r in d['rows']:
        for j, arms in r.get('J', {}).items():
            for arm, v in arms.items():
                if arm not in ARM and arm not in ('PROD', 'AA'):
                    continue
                emit(out, exp, round_, r['page_id'], r.get('toh'), 'Tibetan', arm, 'FP', j, v)


def canon_ref(out, path, exp, round_):
    # canon-ref-6331 rows hold the judge mean per arm; per-judge scores are not stored -> judge='mean'
    d = json.load(open(path))
    for r in d['rows']:
        for arm, f in (r.get('fid') or {}).items():
            if arm not in ARM:
                continue
            v = None if f is None else {'fid': f, 'rev': (r.get('rev') or {}).get(arm)}
            emit(out, exp, round_, r['uid'], r.get('work'), r.get('lang'), arm, 'FP', 'mean', v)


# xlref t1–t5 (#5695): judged against a human reference by two blind Opus judges. Baseline arms map to an
# engine; lever arms (thinking, context, check-and-fix, fixed OCR, …) are kept with variant=<arm> and are
# left out of the model fit, because they are not the engine as routed.
XLREF_BASE = {'served': None, 'prod-A': 'AA', 'prod-B': 'AA', 'flash-0': 'FP', 'flash': 'FP', 'F0': 'FP',
              'lite': 'L31', 'lite2': 'L31', 'lite-a': 'L31', 'lite-b': 'L31', 'L1': 'L31', 'L2': 'L31',
              'opus': 'O', 'O': 'O'}
CANON = {'gemini-3.1-flash-lite-preview': 'L31', 'gemini-3.1-flash-lite': 'L31', 'gemini-3-flash-preview': 'FP'}


def xlref_scores(r):
    bj = r.get('fidelity_by_judge') or r.get('by_judge')
    if isinstance(bj, str):
        bj = json.loads(bj)
    if not bj and isinstance(r.get('core_packet'), dict):
        bj = r['core_packet'].get('by_judge')
    if not bj and isinstance(r.get('arms_packet'), dict):
        bj = {r['arms_packet'].get('judge', 'j1'): r['arms_packet']}
    out = {}
    for j, v in (bj or {}).items():
        if isinstance(v, dict):
            out[j] = {'fid': v.get('fidelity'), 'rev': v.get('reversal')}
        else:
            out[j] = {'fid': v, 'rev': r.get('reversal')}
    return out


def xlref(out, path, exp):
    for line in open(path):
        r = json.loads(line)
        arm = r.get('arm')
        model = r.get('model') or r.get('arm_model') or ''
        page = r.get('id') or f"{r['book_id']}_{int(r['page_number']):05d}"
        lang = r.get('lang')
        if lang in ('Ancient Greek', 'Byzantine Greek'):
            lang = 'Greek'
        base = XLREF_BASE.get(arm, 'VARIANT')
        prod = CANON.get(model, model)
        if base is None:      # served = stored production text
            code, label = 'PROD', 'PROD'
        elif base == 'AA':
            code, label = 'AA', 'AA'
        elif base == 'VARIANT':
            code, label = (CANON.get(model) or ('O' if 'opus' in model else None)), arm
        else:
            code, label = base, base
        if code is None or (code in ('PROD', 'AA') and prod not in ARM):
            continue
        for j, v in xlref_scores(r).items():
            n0 = len(out)
            emit(out, exp, exp, page, r.get('book_id'), lang, code, prod, j, v)
            out[n0]['variant'] = '' if label == code else label
            out[n0]['instrument'] = 'reference'


def ab5606(out, base):
    # #5606: blind A/B/C/D against a human reference; Opus AND Sonnet judges (the only non-Opus judge we hold)
    model_of = {'flash': 'FP', 'lite': 'L31', 'lite-rerun': 'L31'}
    for lang in ('Pali', 'Chinese', 'Sanskrit'):
        key = json.load(open(f'{base}/{lang}/key.json'))['pages']
        for jm, jname in (('opus', 'claude-opus-5.5'), ('sonnet', 'claude-sonnet-5.5')):
            p = f'{base}/{lang}/verdicts-{jm}-{lang}.jsonl'
            if not os.path.exists(p):
                continue
            for line in open(p):
                v = json.loads(line)
                labels = key.get(v['id'], {})
                for t, sc in (v.get('scores') or {}).items():
                    arm = labels.get(t, '')
                    if arm not in model_of:
                        continue
                    n0 = len(out)
                    emit(out, '5606-ab', '5606-ab', v['id'], v['id'].rsplit('_', 1)[0], lang, model_of[arm], 'FP',
                         jm, {'fid': sc.get('fidelity'), 'rev': sc.get('inversion')})
                    out[n0]['judge_model'] = jname
                    out[n0]['instrument'] = 'reference'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--manifest', required=True)
    a = ap.parse_args()
    out = []
    xl_instrument(out, f'{R}/pareto-6182/xljudge/scores.json', '6182-xl', 'r6182a')
    xl_instrument(out, f'{R}/cli-arm-6182/xljudge/scores.json', '6331-cli38-xl', 'r6331xl')
    xl_instrument(out, f'{R}/pareto-6182/claude/xljudge/scores.json', '6182-claude-xl', 'r6182c')
    tib_instrument(out, f'{R}/pareto-6182/tibjudge/scores.json', '6182-tib', 'r6182t')
    tib_instrument(out, f'{R}/pareto-6182/claude/tibjudge/scores.json', '6182-claude-tib', 'r6182ct')
    tib_instrument(out, f'{R}/cli-arm-6182/refjudge/scores.json', '6331-cli38-tib58', 'r6331t58')
    tib_instrument(out, f'{R}/cli-arm-6182/refjudge113/scores.json', '6331-cli38-tib113', 'r6331t113')
    canon_ref(out, f'{R}/canon-ref-6331/judge/scores.json', '6331-canon-ref', 'r6331c')
    for r in out:
        r['instrument'] = 'reference'   # every #6182/#6331 instrument judged against a published reference
    for t in (1, 2, 3, 4, 5):
        xlref(out, f'{R}/xlref-t{t}-2026-10/' + ('rows.jsonl' if t == 1 else 'pages.jsonl'), f'xlref-t{t}')
    ab5606(out, f'{R}/translation-ab-5606-2026-10-02')
    with open(a.out, 'w') as f:
        for r in out:
            f.write(json.dumps(r) + '\n')
    man = {'built_by': 'scripts/eval/estimator/build-table.py', 'rows': len(out),
           'scored': sum(r['scored'] for r in out), 'failed_reads': sum(not r['scored'] for r in out),
           'by_experiment': collections.Counter(r['experiment'] for r in out),
           'by_language': collections.Counter(r['language'] for r in out if r['scored']),
           'by_model': collections.Counter(f"{r['model']}|{r['route']}" for r in out if r['scored']),
           'judges': collections.Counter(r['judge_model'] for r in out),
           'variant_rows_not_fitted': sum(1 for r in out if r['variant']),
           'by_experiment_language': {e: dict(collections.Counter(r['language'] for r in out
                                                                  if r['scored'] and r['experiment'] == e))
                                      for e in sorted({r['experiment'] for r in out})},
           'scored_pages_by_experiment': {e: len({r['page'] for r in out if r['scored'] and r['experiment'] == e})
                                          for e in sorted({r['experiment'] for r in out})}}
    json.dump(man, open(a.manifest, 'w'), indent=1, sort_keys=True)
    print(json.dumps(man, indent=1, sort_keys=True))


if __name__ == '__main__':
    main()
