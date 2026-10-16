#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/build-table.py — the v1 table (19,271 judgements from 14 experiments, every judge
# Claude). v2 imports it unchanged and adds what was scored after the v1 fit (#6740): the first non-Claude judges.
"""Build the v2 translation tables (#6740): the v1 page-level table plus the experiments scored since 12 Oct.

Two outputs:
  --out        page-level rows, v1's schema: every v1 row (byte-identical) + #6559 Nahuatl (Gemini 3.8 Flash High
               judge, both A/B orders).
  --summaries  CELL-MEAN rows, one per (experiment round, language, arm, judge): the experiments whose per-item
               judge scores were never committed, only their panel means with a by-work bootstrap interval.
               #6545 r1s1 / r1s2 / r2s1 (Opus, Gemini 3.1 Pro and Fable judges) and #6690 O1 (Gemini 3.8 Flash High).
               Each row carries the page ids it averages over, so the model can use the pages' own effects.

Not added, and why (listed on #6740):
  #6667  Sonnet/Haiku CORRECT OCR drafts: an OCR experiment (CER), not translation. Goes to the OCR estimator.
  #6361  Tengyur CLI: serious-error counts and A/B preference, not the 1-5 fidelity scale.
  #6729  not landed when this was built.
  #6690  O10 (10 pages per call) is a lever on Opus, kept out of the fit like v1's xlref variant arms.
  #6545  CF/CO/DF/DO correction arms: correction of a stored draft, not an engine as routed (v1 left xlref's
         check-and-fix arms out the same way).

  python3 scripts/eval/estimator/build-table-v2.py --out $S/table-v2.jsonl --summaries $S/summaries-v2.jsonl \
      --manifest scripts/eval/estimator/manifest-v2.json
"""
import argparse, collections, importlib.util, json, math, re, subprocess

spec = importlib.util.spec_from_file_location('bt1', 'scripts/eval/estimator/build-table.py')
bt1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bt1)

R = 'scripts/eval/results'
# #6690's result files are on PR #6700's branch; pinned to the commit that was read.
OPUS10_REF = 'a6cafd0b8bd4a1033477518aedd294cb7dd735c1'

JUDGES = {  # judge label in a result file -> (judge model, judge family)
    'opus': ('claude-opus-5.5', 'claude'), 'pro': ('gemini-3.1-pro', 'gemini'),
    'fable': ('claude-fable-5.1', 'claude'), 'g38high': ('gemini-3.8-flash-high', 'gemini'),
}
# #6545 arm -> v1 arm code (model, family, route). C38 is the stored #6331 CLI output; C38S/C38S2 are fresh CLI runs
# of the same model; PRO is the CLI's gemini-3.1-pro-high with full thinking (a new model id in the gemini-pro family).
ARM6545 = {'FP': 'FP-stored', 'C38': 'C38', 'C38S': 'C38', 'C38S2': 'C38', 'PRO': 'PROCLI', 'OPUS': 'O'}
EXTRA_ARMS = {'FP-stored': ('gemini-3-flash-preview', 'gemini-flash', 'stored'),
              'PROCLI': ('gemini-3.1-pro-high', 'gemini-pro', 'cli')}
SE_FLOOR = 0.6   # a cell-mean's standard error is at least 0.6/sqrt(n): a [5.0, 5.0] bootstrap interval is not certainty


def arm_info(code):
    return EXTRA_ARMS.get(code) or bt1.ARM[code]


def nahuatl(out):
    """#6559: 30 Nahuatl pages, Opus vs 3.8 Flash Low (CLI), one blind Gemini 3.8 Flash High judge, both orders."""
    base = f'{R}/paired-translate-6559'
    for keyf, outf in (('key.json', 'judge-out.jsonl'), ('key-swap.json', 'judge-out-swap.jsonl')):
        key = {k['uid']: k for k in json.load(open(f'{base}/{keyf}'))}
        for line in open(f'{base}/{outf}'):
            r = json.loads(line)
            k = key[r['uid']]
            if not r.get('text'):
                for arm in ('opus', 'gemini'):
                    _row(out, k, arm, None)
                continue
            j = json.loads(re.sub(r'^```[a-z]*\n|```$', '', r['text'].strip()).strip())
            for slot in ('A', 'B'):
                _row(out, k, k[slot], j[slot].get('fidelity'), position=slot)


def _row(out, k, arm, fid, position=None):
    code = 'O' if arm == 'opus' else 'C38'
    m, f, route = bt1.ARM[code]
    out.append(dict(experiment='6559-nah', round='r6559nah', page=k['page_id'], work=k['book_id'], language='nah',
                    lang_name='Nahuatl', script_family='mesoamerican', arm=code, model=m, model_family=f,
                    route=route, repeat=False, judge=f'g38high-{position}', judge_model='gemini-3.8-flash-high',
                    judge_family='gemini', score=fid, scored=fid is not None, reversal=None,
                    failed_read=fid is None, variant='', instrument='no-reference'))


def cell(exp, rnd, lang, arm_label, code, jlabel, n, mean, ci, pages):
    lc, sf = bt1.lang_info(lang)
    m, fam, route = arm_info(code)
    jm, jf = JUDGES[jlabel]
    se = max((ci[1] - ci[0]) / 3.92, SE_FLOOR / math.sqrt(n))
    return dict(experiment=exp, round=rnd, language=lc, lang_name=lang, script_family=sf, arm=arm_label, model=m,
                model_family=fam, route=route, judge_model=jm, judge_family=jf, n=n, mean=mean, se=round(se, 4),
                ci=ci, pages=pages, works=[p.rsplit('_', 1)[0] for p in pages], instrument='reference')


def pro6545(summ):
    for rnd in ('r1s1', 'r1s2', 'r2s1'):
        d = json.load(open(f'{R}/pro-translate-6545/{rnd}/scores.json'))
        key = json.load(open(f'{R}/pro-translate-6545/{rnd}/key.json'))
        items = dict(key['items'])
        fable = set(key.get('fable_items') or [])
        pages_all = collections.defaultdict(list)
        pages_fable = collections.defaultdict(list)
        for it, v in items.items():
            if v['kind'] != 'ARMS':
                continue
            pages_all[v['lang']].append(v['page_id'])
            if it in fable:
                pages_fable[v['lang']].append(v['page_id'])
        for lang, p in d['panels'].items():
            if lang == 'pooled':
                continue
            for jl, arms in p['table']['by_judge'].items():
                for arm, v in arms.items():
                    if arm not in ARM6545 or not v.get('n'):
                        continue
                    pg = pages_fable[lang] if jl == 'fable' else pages_all[lang]
                    if jl == 'fable' and len(pg) != v['n']:
                        pg = pages_all[lang]       # the subsample cannot be recovered: average over the panel
                    summ.append(cell(f'6545-{rnd}', f'r6545{rnd}', lang, arm, ARM6545[arm], jl, v['n'],
                                     v['fidelity'], v['ci_by_work'], sorted(pg)))


def opus10(summ):
    show = lambda p: subprocess.run(['git', 'show', f'{OPUS10_REF}:{p}'], capture_output=True, check=True).stdout
    d = json.loads(show(f'{R}/opus10-6690/scores.json'))
    key = json.loads(show(f'{R}/opus10-6690/key.json'))
    pages = collections.defaultdict(list)
    for v in key['items'].values():
        if v['kind'] == 'ARMS':
            pages[v['run']].append((v['lang'], v['page_id']))
    for run, v in d['by_run'].items():
        a = v['arms']['O1']
        lang = pages[run][0][0]
        summ.append(cell('6690-o1', 'r6690', lang, 'O1', 'O', 'g38high', a['n'], a['fidelity'], a['ci_by_page'],
                         sorted(p for _, p in pages[run])))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--summaries', required=True)
    ap.add_argument('--manifest', required=True)
    a = ap.parse_args()
    v1 = []
    bt1.xl_instrument(v1, f'{R}/pareto-6182/xljudge/scores.json', '6182-xl', 'r6182a')
    bt1.xl_instrument(v1, f'{R}/cli-arm-6182/xljudge/scores.json', '6331-cli38-xl', 'r6331xl')
    bt1.xl_instrument(v1, f'{R}/pareto-6182/claude/xljudge/scores.json', '6182-claude-xl', 'r6182c')
    bt1.tib_instrument(v1, f'{R}/pareto-6182/tibjudge/scores.json', '6182-tib', 'r6182t')
    bt1.tib_instrument(v1, f'{R}/pareto-6182/claude/tibjudge/scores.json', '6182-claude-tib', 'r6182ct')
    bt1.tib_instrument(v1, f'{R}/cli-arm-6182/refjudge/scores.json', '6331-cli38-tib58', 'r6331t58')
    bt1.tib_instrument(v1, f'{R}/cli-arm-6182/refjudge113/scores.json', '6331-cli38-tib113', 'r6331t113')
    bt1.canon_ref(v1, f'{R}/canon-ref-6331/judge/scores.json', '6331-canon-ref', 'r6331c')
    for r in v1:
        r['instrument'] = 'reference'
    for t in (1, 2, 3, 4, 5):
        bt1.xlref(v1, f'{R}/xlref-t{t}-2026-10/' + ('rows.jsonl' if t == 1 else 'pages.jsonl'), f'xlref-t{t}')
    bt1.ab5606(v1, f'{R}/translation-ab-5606-2026-10-02')
    for r in v1:
        r.setdefault('judge_family', 'claude')
    new = []
    nahuatl(new)
    summ = []
    pro6545(summ)
    opus10(summ)
    with open(a.out, 'w') as f:
        for r in v1 + new:
            f.write(json.dumps(r) + '\n')
    with open(a.summaries, 'w') as f:
        for r in summ:
            f.write(json.dumps(r) + '\n')
    rows = v1 + new
    man = {'built_by': 'scripts/eval/estimator/build-table-v2.py', 'v1_rows': len(v1), 'rows': len(rows),
           'scored': sum(r['scored'] for r in rows), 'failed_reads': sum(not r['scored'] for r in rows),
           'new_page_level': collections.Counter(f"{r['experiment']}|{r['model']}|{r['judge_model']}" for r in new
                                                 if r['scored']),
           'summary_cells': len(summ),
           'summary_cells_by': collections.Counter(f"{s['experiment']}|{s['judge_model']}" for s in summ),
           'summary_scores_represented': sum(s['n'] for s in summ),
           'judges': collections.Counter(r['judge_model'] for r in rows),
           'opus10_ref': OPUS10_REF}
    json.dump(man, open(a.manifest, 'w'), indent=1, sort_keys=True)
    print(json.dumps(man, indent=1, sort_keys=True))


if __name__ == '__main__':
    main()
