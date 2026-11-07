#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/router-table/evidence/derive_backfill.py (#7606, job router-backfill-7263) turns the
# 10-27/28 tests into route-judge-format score.json files; this is the same job for the EARLIER image-judged tests, with
# its conventions unchanged (score.json schema, per-source book weighting, wrong text = the instrument's misleading /
# material / serious call, accept = not that, a read that never arrives = not accepted). Kept separate so each source
# is one function and one file. scripts/eval/estimator/ocr/failure-observations.jsonl records some of the same k/n as
# rate rows for the failure model, by hand from the write-ups; it is not router evidence and is not read here.
"""Router-table evidence from every earlier image-judged route test (#7263, job router-backfill-all-7263, 2026-10-28).

  python3 scripts/eval/estimator/router-table/evidence/derive_backfill_all.py [source ...]   (repo root)

Reads only stored verdict files (no model calls) and writes one score.json per source beside this file, the schema
build.py's `evidence` entries read (cells -> routes -> accept, wrong_text_pages, books, classes_k_of_n). Sources, oldest
first; the classification of all 214 judged write-ups is on #7263 and in the experiment entry:

  tengyur-6361     2026-10-10 Tengyur CLI retranslation gate (blind A/B per volume, Opus, image + OCR): per side, the
                   count of serious meaning errors. wrong text = >= 1 serious error; accept = none.
  siku-tr-6567     2026-10-12 stale-Siku retranslation pilot (30 random written pages, Opus judge, MQM against the image
                   and the Paddle reading). wrong text = >= 1 material (major / critical accuracy) error. The Gemini 3.1
                   Pro judge's counts are recorded beside, not used (the table's judge is Opus).
  latin-served-5924  2026-10-22 served Latin pages by eye (3 Opus readers, Step T verdicts on the served page). Every
                   misleading page there is OCR-caused (the write-up checks each), so wrong text = misleading; the route
                   is the page's stored ocr_model.
  latin-250-5924   2026-10-23/24 #5924 Latin 250 (10 lite-read books x 25 pages; Step C pairwise packets C, C2, C3, C4,
                   C5, each text judged misleading / flawed / sound against the image). Every judged reading of a
                   route counts once; a reading the packet copied from an earlier step (`shown: false`) is not counted
                   again for the copied side. k / n then pool the readings and build.py's book scaling gives the source
                   its 10 books, whatever the number of readings.
  cells-6553       2026-10-25 untested language cells (sealed Opus judge, image open; status text / refusal / empty /
                   invented + serious). wrong text = serious or invented; accept = text and not serious; a page the
                   judge could not read (`can_read: no`), a page with no text, or a page with no image is not counted.
                   Cells with >= 10 judged lite pages.
  arabic-7341      2026-10-25/26 Jabir manuscripts gate + Kraus print (judge.py USABLE / NOTICEABLE / MISLEADING /
                   FAILED). The Opus judge's call only (the table's judge); wrong text = MISLEADING, accept = USABLE or
                   NOTICEABLE, FAILED (a read that never came) = not accepted. Two sources: the manuscripts (13 books)
                   and Kraus (1 book, the gate's 4 pages + the 25 of the whole-book draw), so the one book does not
                   carry 13 books' weight.
"""
import collections, glob, gzip, json, os, re, sys

D = 'scripts/eval/estimator/router-table/evidence/'
frac = lambda k, n: f'{k}/{n}'
GEN = D + 'derive_backfill_all.py (2026-10-28, #7263; no model calls)'


def route(rows, served, extra=None):
    """rows: [(book, accepted, wrong, classes)] -> one route's score.json entry."""
    n = len(rows)
    cls = collections.Counter(c for r in rows for c in set(r[3]))
    wcls = collections.Counter(c for r in rows if r[2] for c in set(r[3]))
    return dict(served=served, n=n, books=len({r[0] for r in rows}), accept=frac(sum(r[1] for r in rows), n),
                wrong_text_pages=frac(sum(r[2] for r in rows), n), classes_k_of_n={c: frac(k, n) for c, k in cls.most_common()},
                wrong_text_classes={c: frac(k, n) for c, k in wcls.most_common()}, **(extra or {}))


def write(name, provenance, judge, mapping, cells):
    json.dump(dict(generated_by=GEN, provenance=provenance, judge=judge, mapping=mapping, cells=cells),
              open(D + name + '.score.json', 'w'), indent=1, ensure_ascii=False)
    for c, v in cells.items():
        print(name, c, {k: (x['accept'], x['wrong_text_pages'], x['books']) for k, x in v['routes'].items()})


def tclass(s):
    s = s.lower()
    return 'T8' if re.search(r'revers|invert|opposite', s) else 'T9' if re.search(r'omit|dropp|missing', s) else 'E2'


def tengyur_6361():
    F = 'scripts/maintenance/tengyur-cli-6361/results/byeye/'
    u = json.load(open(F + 'unblinded.json'))
    rows = {'agy-flash-low@1': [], '3flash': []}
    for key, v in u.items():
        vol = key.split(':')[0]
        for side, rt in (('staged', 'agy-flash-low@1'), ('stored', '3flash')):
            rows[rt].append((vol, v[side] == 0, v[side] > 0, [tclass(c) for c in v[side + '_classes']]))
    write('tengyur-6361', f'#6361 (2026-10-10), {F}unblinded.json: one blind Opus reviewer per volume, staged vs stored English '
          'side by side with the page image (whole + 2x crops) and the OCR; serious meaning errors per side. 5 seeded volumes + 2 chosen '
          'for extreme length ratio, 3 consecutive pages each. The staged pages are the gate-passing ones (23% of staged replies were '
          'plan-mode chatter and never written).',
          'claude-opus-5-5 (claude -p), blind A/B reviewer, image + OCR', 'wrong_text = >= 1 serious meaning error; accept = none; classes: T8 reversed, T9 omitted, E2 other',
          {'tengyur-tr': dict(task='translation', lang='Tibetan', pages=len(u), routes={
              'agy-flash-low@1': route(rows['agy-flash-low@1'], 'agy gemini-3.8-flash-low CLI (plan mode), Standard Translation v13, one page a call; applied to 17,135 pages after the gate'),
              '3flash': route(rows['3flash'], 'stored gemini-3-flash-preview English, v13')})})


def siku_tr_6567():
    F = 'scripts/eval/stale-retranslate-6567/'
    pr, mp = json.load(open(F + 'pilot-results.json')), {i['uid']: i for i in json.load(open(F + 'pilot-map.json'))['items']}
    cat = lambda spans: [s.split('/')[0].strip() for s in spans]
    rows, pro = {'agy-flash-low@1': [], 'stored': []}, collections.Counter()
    for p in pr['per_page']:
        b = mp[p['uid']]['book_id']
        for side, rt in (('new', 'agy-flash-low@1'), ('old', 'stored')):
            m = p['O'][side]['material']
            rows[rt].append((b, m == 0, m > 0, cat(p['O'][side]['material_spans'])))
            pro[(rt, p['P'][side]['material'] == 0)] += 1
    n = len(pr['per_page'])
    pro_note = lambda rt: {'gemini_3_1_pro_judge_accept': frac(pro[(rt, True)], n)}
    write('siku-tr-6567', f'#6567 (2026-10-12), {F}pilot-results.json + pilot-map.json: 30 random pages, one a book, of the 289 the '
          'stale-Siku retranslation pilot wrote; both texts judged blind against the page image and the Paddle reading (MQM spans).',
          'claude-opus-5-5 (claude -p), MQM against the image; the Gemini 3.1 Pro High judge is recorded per route, not used',
          'wrong_text = >= 1 material (major / critical accuracy) error; accept = none',
          {'zh-siku-tr': dict(task='translation', lang='Classical Chinese', pages=n, routes={
              'agy-flash-low@1': route(rows['agy-flash-low@1'], 'agy gemini-3.8-flash-low, Standard Translation v13 + CLI suffix, one page a call, from the Paddle reading', pro_note('agy-flash-low@1')),
              'stored': route(rows['stored'], 'the stored (stale) English, made from the old 3 Flash / Flash-Lite OCR', pro_note('stored'))})})


def latin_served_5924():
    F = 'scripts/eval/spotcheck-latin-5924/results/'
    eng = {(b['book_id'], p['page_number']): p['ocr_model'] for b in json.load(open(F + 'spotcheck-draw.json')) for p in b['pages']}
    rt = lambda m: 'lite' if 'flash-lite' in m else '3flash' if m.startswith('gemini-3-flash') else None
    rows, other = collections.defaultdict(list), collections.Counter()
    for v in json.load(open(F + 'spotcheck-verdicts.json')):
        m = eng[(v['book_id'], v['page_number'])]; r = rt(m)
        if not r: other[m] += 1; continue
        rows[r].append((v['book_id'], v['verdict'] != 'misleading', v['verdict'] == 'misleading',
                        [d['class'] for d in v['defects'] if d.get('cause') == 'OCR' and d.get('class')]))
    write('latin-served-5924', f'#5924 (2026-10-22), {F}spotcheck-verdicts.json + spotcheck-draw.json: visible Latin print 1500-1800 '
          'stratified by typeface x columns, 3 books a stratum, 3 consecutive pages a book, the page as SERVED (OCR and English). '
          f'Pages whose stored OCR is neither Flash-Lite nor 3 Flash are left out: {dict(other)}.',
          'claude-opus-5-5 subagent readers (3), Step T against the R2 image and the display photo',
          'wrong_text = misleading (all 5 misleading pages are OCR-caused per the write-up); accept = not misleading; classes = OCR-caused defects',
          {'latin-served': dict(task='ocr', lang='Latin', pages=sum(len(v) for v in rows.values()), routes={
              k: route(v, f'the stored {k} OCR as served') for k, v in sorted(rows.items())})})


def latin_250_5924():
    F = 'scripts/eval/flash-reread-5924/results/'
    J = lambda f: json.load(open(F + f))
    # (file, side letter in the packet, route); a side whose reading was copied from an earlier step (shown: false) is skipped
    PLAN = [('step-c.json', 'L', 'lite', False), ('step-c.json', 'F', 'agy-flash-low-read', False),
            ('oc-step-c2.json', 'O', 'lite>opus-correct', False), ('oc-step-c2.json', 'L', 'lite', True),
            ('oc-step-c3.json', 'O', 'lite>opus-correct', False), ('oc-step-c3.json', 'F', 'agy-flash-low-read', False),
            ('fc-step-c4.json', 'FC', 'lite>agy-flash-low', False), ('fc-step-c4.json', 'L', 'lite', True),
            ('fc-step-c5.json', 'FC', 'lite>agy-flash-low', False), ('fc-step-c5.json', 'O', 'lite>opus-correct', False)]
    rows, readings = collections.defaultdict(list), collections.defaultdict(list)
    for f, s, rt, skip_copied in PLAN:
        for r in J(f):
            if skip_copied and r.get('shown') is False: continue
            v = r['C_' + s]; mis = v == 'misleading' or bool(r.get('ntl_' + s))
            rows[rt].append((r['slug'].rsplit('-p', 1)[0], not mis, mis, [d['class'] for d in r.get('defects_' + s, []) if d.get('class')]))
            readings[rt].append(f.split('.')[0] + ':' + s)
    served = {'lite': 'the stored Flash-Lite text (incl. the long-s pass)', 'agy-flash-low-read': 'cli-ocr.mjs read, agy gemini-3.8-flash-low, one page a call, no draft',
              'lite>opus-correct': 'correct.mjs --model=opus --per-call=10 over the lite text (lite served on contain)',
              'lite>agy-flash-low': 'cli-ocr.mjs read --correct-prompt (the #5924 one-page template the lane uses), agy gemini-3.8-flash-low'}
    write('latin-250-5924', f'#5924 (2026-10-23/24, PRs on #5924), {F}{{step-c,oc-step-c2,oc-step-c3,fc-step-c4,fc-step-c5}}.json: 10 visible '
          'Latin books 1500-1800 (>= 70% lite pages), 25 spread body pages each; one blind Opus reader per book per packet. The route-judge '
          "pilot's 30 Latin pages and the router tests' Latin lite>agy-flash-low reads are drawn from these books (book group 5924-latin in rules.json).",
          'claude-opus-5-5 subagent readers, C-TASK.md: misleading / flawed / sound against the image, two texts a packet',
          'wrong_text = misleading or not this leaf; accept = not misleading; every judged reading of a route counts (n = readings); readings copied from an earlier step are skipped',
          {'la-lite-250': dict(task='ocr', lang='Latin', pages=250, routes={
              k: route(v, served[k], {'readings': dict(collections.Counter(readings[k]))}) for k, v in rows.items()})})


CELLS_6553 = ['Italian', 'Spanish', 'Korean', 'Russian', 'Portuguese', 'Danish', 'Hindi', 'Middle English', 'Middle High German',
              'Old French', 'Ottoman Turkish', 'Tamil', 'Turkish']


def cells_6553():
    F = 'scripts/eval/results/cells-6553-2026-10-25/'
    rows, dropped = collections.defaultdict(lambda: collections.defaultdict(list)), collections.Counter()
    for r in map(json.loads, open(F + 'scored.jsonl')):
        if r.get('cell_name') not in CELLS_6553: continue
        if not r.get('judged') or r.get('leaf') != 'text' or r.get('can_read') == 'no':
            dropped[r['cell_name']] += 1; continue
        for arm, rt in (('lite', 'lite'), ('agy', 'agy-flash-low-read')):
            a = r.get(arm)
            if not a: continue
            wrong = bool(a.get('serious')) or a['status'] == 'invented'
            rows[r['cell_name']][rt].append((r['book_id'], a['status'] == 'text' and not a.get('serious'), wrong, [a['status']] if a['status'] != 'text' else []))
    served = {'lite': 'a fresh gemini-3.1-flash-lite read, Standard OCR v19.1, temp 0.1 (the lane\'s draft route)',
              'agy-flash-low-read': 'cli-ocr.mjs read, agy gemini-3.8-flash-low, one page a call, no draft'}
    write('cells-6553', f'#6553 (2026-10-25), {F}scored.jsonl: one interior page per live book per language cell, read fresh; '
          f'not counted (no image, no text on the leaf, or the judge could not read the script): {dict(dropped)}.',
          'claude-opus-5-5 sealed judge (JUDGE-CELLS.md v1), image open, reads blind as X / Y',
          'wrong_text = serious or invented; accept = status text and not serious; refusal / empty = not accepted, not wrong text',
          {f'{c}': dict(task='ocr', lang=c, pages=len(rows[c]['lite']), routes={rt: route(v, served[rt]) for rt, v in rows[c].items()}) for c in CELLS_6553})


def arabic_7341():
    rt = {'gemini-3.1-flash-lite': 'lite', 'gemini-3.8-flash+antigravity-cli': 'agy-flash-low-read-diplomatic', 'claude-opus-5-5': 'opus-read'}
    served = {'lite': 'gemini-3.1-flash-lite, production OCR prompt, temp 0.1 (paid API)',
              'agy-flash-low-read-diplomatic': 'agy gemini-3.8-flash-low, the #6544 diplomatic READ prompt (not cli-ocr\'s live prompt: its own route), one page a call',
              'opus-read': 'claude-opus-5-5 claude -p --restricted, the same diplomatic READ prompt, one page a call'}
    src = collections.defaultdict(lambda: collections.defaultdict(dict))
    for f in ('scripts/eval/results/arabic-mss-gate-7341/gate-rows.jsonl', 'scripts/eval/results/kraus-print-7341/kraus-rows.jsonl'):
        for r in map(json.loads, open(f)):
            s = 'kraus' if r['kind'] == 'print' else 'mss'
            src[s][rt[r['engine']]][r['page'].split('|')[1]] = r  # one verdict per page per route (gate + Kraus draws are distinct pages)
    for s, name, prov in (('mss', 'arabic-mss-7341', '#7341 (2026-10-25) Jabir manuscripts gate, scripts/eval/results/arabic-mss-gate-7341/gate-rows.jsonl: 2 pages a manuscript, screened by eye, held books.'),
                          ('kraus', 'arabic-kraus-7341', '#7341 (2026-10-25/26) Kraus 1935 Arabic print: the gate\'s 4 pages (gate-rows.jsonl) + the whole-book stratified draw of 25 (scripts/eval/results/kraus-print-7341/kraus-rows.jsonl); one book.')):
        routes = {}
        for r_id, pages in src[s].items():
            rows = [(p['work'], p['usability_claude'] in ('USABLE', 'NOTICEABLE'), p['usability_claude'] == 'MISLEADING',
                     ['FAILED'] if p['usability_claude'] == 'FAILED' else []) for p in pages.values()]
            routes[r_id] = route(rows, served[r_id], {'gemini_judge_misleading': frac(sum(p['usability_gemini'] == 'MISLEADING' for p in pages.values()), len(rows))})
        write(name, prov + ' Three reads a page, judged blind by Opus and by Gemini 3.8 Flash (judge.py).',
              'claude-opus-5-5 (claude -p), judge.py USABLE / NOTICEABLE / MISLEADING / FAILED against the image; the Gemini judge\'s misleading count is recorded, not used. '
              'Opus judges its own read here (self-preference unmeasured).',
              'wrong_text = MISLEADING; accept = USABLE or NOTICEABLE; FAILED (no read: agy filter cut / did_not_read) = not accepted, not wrong text',
              {'ar-' + s: dict(task='ocr', lang='Arabic', pages=len(next(iter(src[s].values()))), routes=routes)})


SOURCES = dict(tengyur=tengyur_6361, siku=siku_tr_6567, latin_served=latin_served_5924, latin_250=latin_250_5924, cells=cells_6553, arabic=arabic_7341)
if __name__ == '__main__':
    for k in (sys.argv[1:] or SOURCES):
        SOURCES[k]()
