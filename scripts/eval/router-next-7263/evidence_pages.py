# PRIOR ART: scripts/eval/route-judge-6740/judge.mjs `score`, scripts/eval/tibetan-correct-6560/profiles-diffqa/translate-router.mjs `score`, scripts/eval/estimator/router-table/evidence/derive_backfill{,_all}.py — each writes only the AGGREGATE score.json (k/n, w/n, books); none keeps the per-page rows. This mirrors their rules page by page and proves it by reproducing every aggregate the router table reads.
"""Per-page evidence for the router table (#7263 router-next, 2026-10-28). Stdlib only; no model calls, no DB writes.

  python3 scripts/eval/router-next-7263/evidence_pages.py [--out=FILE] [--no-mongo]     (repo root)

Writes ONE ROW PER JUDGED PAGE READING that scripts/eval/estimator/router-table/rules.json counts (each route's
`pilot` entry and every `evidence` entry) to $JOB_SCRATCH/evidence-pages.jsonl:

  {score, cell, route, page_id, book_id, uid, accept, wrong_text, classes, name_check_accept, page_number}

then aggregates the rows per (score, cell, route) and compares with the score.json entry: accept k/n, wrong_text_pages
w/n, books, classes_k_of_n and, for `use: name_check`, name_check.accept_after_name_check / with_name_error. Exit 1 on any
mismatch. Sources keyed by (book, page number) only (slugs, Arabic page keys, Tengyur vol:page via draw.json) are mapped
to pages.id by one read-only Mongo query per book (node + mongodb, MONGODB_URI from /root/sourcelibrary/.env.production.local),
cached in $JOB_SCRATCH/page-ids.json; --no-mongo leaves those page_id null.

Per-source rules (each mirrors the code that wrote the score.json):
  route-judge dirs   judge.mjs score(): key rows kind 'item' with a verdict (last verdict row per judged id wins);
                     accept = verdict.accept; wrong text = a defect of severity wrong_text; classes = defect class
                     ^[IOTDE]\\d+ else E2; name check folds GLYPH_VARIANTS over Han-only text (kanFold) when the
                     names file keeps the candidate texts; the committed router-tests one does not, so the per-page
                     outcome there is score.json's own name_check.errors list (checked = a name verdict exists).
  Arabic page keys <book>_<page>_<half> are crops of one page: two readings may share a page_id (uid differs).
  translation-router translate-router.mjs score: judge-out keyed by uid (last wins, an unparseable reply counts as none).
  derived *.score.json derive_backfill.py / derive_backfill_all.py, function by function.
"""
import collections, gzip, json, os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
os.chdir(ROOT)
SCR = os.environ.get('JOB_SCRATCH', '/data/scratch/sl/jobs/router-next-7263')
OUT = next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--out=')), os.path.join(SCR, 'evidence-pages.jsonl'))
ENV = '/root/sourcelibrary/.env.production.local'
EV = 'scripts/eval/estimator/router-table/evidence/'
RJ = 'scripts/eval/route-judge-6740/results/'
TR = 'scripts/eval/results/tibetan-correct-6560/profiles-diffqa-6560/translation-router/'

J = lambda f: json.load(open(f))
JL = lambda f: [json.loads(l) for l in (gzip.open(f, 'rt') if f.endswith('.gz') else open(f)) if l.strip()]


def row(book, accept, wrong, classes, page_id=None, uid=None, page_number=None, **kw):
    return dict(page_id=page_id, book_id=book, uid=uid, page_number=page_number, accept=bool(accept), wrong_text=bool(wrong),
                classes=sorted(set(classes)), name_check_accept=None, **kw)


# ---------- judge.mjs score() ----------
CLS = lambda d: (re.match(r'^[IOTDE]\d+', str(d.get('class') or '').upper()) or [None])[0] or 'E2'
KAN_APP = 'vocab|warning|meta|note|header|summary|keywords|image-desc|page-num|sig|scan-quality|language|script|page-type|columns'
# \p{Script=Han} without the regex module: the Unicode Han script blocks
HAN = re.compile('[^⺀-⺙⺛-⻳⼀-⿕々〇〡-〩〸-〻㐀-䶿一-鿿'
                 '豈-舘並-龎\U00016fe2\U00016fe3\U00016ff0\U00016ff1\U00020000-\U0003134a\U00031350-\U000323af]')
kan_fold = lambda t: HAN.sub('', re.sub(r'<[^>]+>', '', re.sub(rf'<({KAN_APP})\b[^>]*>[\s\S]*?</\1>', '', str(t or ''))))
GLYPH_VARIANTS = ['恵惠', '隠隱', '瓉瓚', '高髙', '荆荊', '虚虛', '温溫', '渉涉', '濵濱', '逹達', '禇褚', '己已巳']


def glyph_fold(t):
    for g in GLYPH_VARIANTS: t = re.sub(f'[{g}]', g[0], t)
    return t


def route_judge(d):
    """judge.mjs score() for one results dir -> {(cell, route): rows}."""
    keys, s = J(d + 'key.json'), J(d + 'sample.json')
    V = {r['id']: r['verdict'] for r in JL(d + 'verdicts-opus.jsonl.gz') if r.get('verdict')}
    name_of = {}
    if os.path.exists(d + 'names-opus.jsonl.gz'):
        for r in JL(d + 'names-opus.jsonl.gz'):
            if r.get('verdict'):
                for lab, jid in r['labels'].items(): name_of[f"{r['page_id']}:{jid}"] = (r, lab)

    # The committed names file drops `texts` (the candidates came from packet.json, not committed), so the folded compare
    # cannot be rerun; the per-page outcome is score.json's own name_check.errors list (book:page -> names), stored per
    # page. checked = the page has a name verdict for this judged id (as judge.mjs); error = it is in that list.
    sc = J(d + 'score.json') if name_of else {'cells': {}}

    def name_errors(k):
        x = name_of.get(f"{k['page_id']}:{k['judged_as']}")
        if not x: return None
        r, lab = x
        if 'texts' in r:
            t = glyph_fold(kan_fold(r['texts'][lab]))
            return [n for n in (r['verdict'].get('names') or []) if len(kan_fold(n['image'])) >= 2 and glyph_fold(kan_fold(n['image'])) not in t]
        errs = sc['cells'][k['cell']]['routes'][k['route']]['name_check']['errors']
        return [n for e in errs if e['page'] == f"{k['book_id']}:{k['page_number']}" for n in e['names']]

    out = collections.defaultdict(list)
    for k in keys:
        v = V.get(k['judged_as'])
        if k['kind'] != 'item' or not v: continue
        x = row(k['book_id'], v['accept'], any(dd.get('severity') == 'wrong_text' for dd in v.get('defects') or []),
                [CLS(dd) for dd in v.get('defects') or []], k['page_id'], k.get('uid') or k['id'], k.get('page_number'))
        if s['cells'][k['cell']].get('kanripo') and v['accept']:
            e = name_errors(k); x['name_check_accept'] = None if e is None else not e; x['_name_error'] = bool(e)
        elif s['cells'][k['cell']].get('kanripo'): x['name_check_accept'] = False
        out[(k['cell'], k['route'])].append(x)
    return out


def translation_router():
    """translate-router.mjs score: judge-key + judge-out (uid -> parsed verdict; last wins, unparseable = none)."""
    key = json.load(gzip.open(TR + 'judge-key.json.gz', 'rt'))

    def parse(t):
        m = re.search(r'\{[\s\S]*\}', str(t or ''))
        try: v = json.loads(m.group(0)) if m else None
        except ValueError: return None
        return v if isinstance(v, dict) and isinstance(v.get('accept'), bool) and 1 <= float(v.get('fidelity', 0) or 0) <= 5 else None
    V = {r['uid']: parse(r['text']) for r in JL(TR + 'judge-out.jsonl.gz') if r.get('text')}
    out = collections.defaultdict(list)
    for uid, k in key.items():
        v = V.get(uid)
        if k['kind'] != 'item' or not v: continue
        out[('tibetan-tr', k['route'])].append(row(k['book_id'], v['accept'], any(dd.get('severity') == 'wrong_text' for dd in v.get('defects') or []),
                                                   [CLS(dd) for dd in v.get('defects') or []], k['page_id'], uid, k['page_number']))
    return out


# ---------- derive_backfill.py ----------
def slug_bp(slug):
    b, p = slug.rsplit('-p', 1); return b, int(p)


def correct_vs_reread_7568():
    out = collections.defaultdict(list)
    arms = {'L': 'lite', 'C': 'lite>opus-correct', 'R': 'agy-flash-low-read'}
    for lang in ('zh', 'de', 'el', 'sa', 'ar'):
        for r in J(f'scripts/eval/flash-reread-5924/results-7568/{lang}/step-t.json'):
            b, p = slug_bp(r['slug'])
            for a, rt in arms.items():
                mis = r['V'][a] == 'misleading' or r['ntl'][a]
                out[(f'{lang}-lite', rt)].append(row(b, not mis, mis, [dd['class'] for dd in r['defects'][a] if dd.get('class')], uid=r['slug'], page_number=p))
    return out


def fresh_7517():
    """agy-flash-low judged items + every sample page whose read never arrived (not accepted, class filter_cut)."""
    d = RJ + 'fresh-7517-2026-10-27/'
    rj, s = route_judge(d), J(d + 'sample.json')
    out = {}
    for cell in ('de-lite', 'fr-lite'):
        rows = rj[(cell, 'agy-flash-low')]; got = {x['page_id'] for x in rows}
        cut = [row(p['book_id'], False, False, ['filter_cut'], p['page_id'], p['page_id'], p['page_number'], not_delivered=True)
               for p in s['cells'][cell]['pages'] if p['page_id'] not in got]
        out[(cell, 'agy-flash-low-read')] = rows + cut
    return out


def router_next_7263():
    """#7263 router-next (2026-10-28): waiting pages, one per book; a fresh read that never arrived (agy reply cut) is
    not accepted, class filter_cut, as fresh_7517."""
    d = RJ + 'router-next-2026-10-28/'
    rj, s = route_judge(d), J(d + 'sample.json')
    out = {}
    for cell, route in (('latin-lite', 'agy-flash-low'), ('latin-flash3', '3flash>agy-flash-low')):
        rows = rj[(cell, route)]; got = {x['page_id'] for x in rows}
        cut = [row(p['book_id'], False, False, ['filter_cut'], p['page_id'], p['page_id'], p['page_number'], not_delivered=True)
               for p in s['cells'][cell]['pages'] if p['page_id'] not in got]
        out[(cell, route)] = rows + cut
    return out


# ---------- derive_backfill_all.py ----------
def tclass(s):
    s = s.lower()
    return 'T8' if re.search(r'revers|invert|opposite', s) else 'T9' if re.search(r'omit|dropp|missing', s) else 'E2'


def tengyur_6361():
    F = 'scripts/maintenance/tengyur-cli-6361/results/byeye/'
    pid = {f"{v['vol']}:{p['page_number']}": (v['book_id'], p['page_id'], p['page_number']) for v in J(F + 'draw.json')['draw'] for p in v['pages']}
    out = collections.defaultdict(list)
    for key, v in J(F + 'unblinded.json').items():
        b, p, n = pid.get(key, (None, None, None))
        for side, rt in (('staged', 'agy-flash-low@1'), ('stored', '3flash')):
            out[('tengyur-tr', rt)].append(row(b, v[side] == 0, v[side] > 0, [tclass(c) for c in v[side + '_classes']], p, key, n, _book=key.split(':')[0]))
    return out


def siku_tr_6567():
    F = 'scripts/eval/stale-retranslate-6567/'
    mp = {i['uid']: i for i in J(F + 'pilot-map.json')['items']}
    out = collections.defaultdict(list)
    for p in J(F + 'pilot-results.json')['per_page']:
        m = mp[p['uid']]
        for side, rt in (('new', 'agy-flash-low@1'), ('old', 'stored')):
            o = p['O'][side]
            out[('zh-siku-tr', rt)].append(row(m['book_id'], o['material'] == 0, o['material'] > 0, [x.split('/')[0].strip() for x in o['material_spans']],
                                               m.get('page_id') or p.get('page_id'), p['uid'], m.get('page_number')))
    return out


def latin_served_5924():
    F = 'scripts/eval/spotcheck-latin-5924/results/'
    eng = {(b['book_id'], p['page_number']): p['ocr_model'] for b in J(F + 'spotcheck-draw.json') for p in b['pages']}
    rt = lambda m: 'lite' if 'flash-lite' in m else '3flash' if m.startswith('gemini-3-flash') else None
    out = collections.defaultdict(list)
    for v in J(F + 'spotcheck-verdicts.json'):
        r = rt(eng[(v['book_id'], v['page_number'])])
        if not r: continue
        out[('latin-served', r)].append(row(v['book_id'], v['verdict'] != 'misleading', v['verdict'] == 'misleading',
                                            [d['class'] for d in v['defects'] if d.get('cause') == 'OCR' and d.get('class')], uid=v['slug'], page_number=v['page_number']))
    return out


def latin_250_5924():
    F = 'scripts/eval/flash-reread-5924/results/'
    PLAN = [('step-c.json', 'L', 'lite', False), ('step-c.json', 'F', 'agy-flash-low-read', False),
            ('oc-step-c2.json', 'O', 'lite>opus-correct', False), ('oc-step-c2.json', 'L', 'lite', True),
            ('oc-step-c3.json', 'O', 'lite>opus-correct', False), ('oc-step-c3.json', 'F', 'agy-flash-low-read', False),
            ('fc-step-c4.json', 'FC', 'lite>agy-flash-low', False), ('fc-step-c4.json', 'L', 'lite', True),
            ('fc-step-c5.json', 'FC', 'lite>agy-flash-low', False), ('fc-step-c5.json', 'O', 'lite>opus-correct', False)]
    out = collections.defaultdict(list)
    for f, s, rt, skip_copied in PLAN:
        for r in J(F + f):
            if skip_copied and r.get('shown') is False: continue
            mis = r['C_' + s] == 'misleading' or bool(r.get('ntl_' + s)); b, p = slug_bp(r['slug'])
            out[('la-lite-250', rt)].append(row(b, not mis, mis, [d['class'] for d in r.get('defects_' + s, []) if d.get('class')],
                                                uid=r['slug'], page_number=p, reading=f.split('.')[0] + ':' + s))
    return out


def cells_6553():
    out = collections.defaultdict(list)
    for r in JL('scripts/eval/results/cells-6553-2026-10-25/scored.jsonl'):
        if not r.get('judged') or r.get('leaf') != 'text' or r.get('can_read') == 'no': continue
        for arm, rt in (('lite', 'lite'), ('agy', 'agy-flash-low-read')):
            a = r.get(arm)
            if not a or not r.get('cell_name'): continue
            out[(r['cell_name'], rt)].append(row(r['book_id'], a['status'] == 'text' and not a.get('serious'), bool(a.get('serious')) or a['status'] == 'invented',
                                                 [a['status']] if a['status'] != 'text' else [], r['page_id'], r['page_id']))
    return out


def arabic_7341(which):
    rt = {'gemini-3.1-flash-lite': 'lite', 'gemini-3.8-flash+antigravity-cli': 'agy-flash-low-read-diplomatic', 'claude-opus-5-5': 'opus-read'}
    src = collections.defaultdict(dict)
    for f in ('scripts/eval/results/arabic-mss-gate-7341/gate-rows.jsonl', 'scripts/eval/results/kraus-print-7341/kraus-rows.jsonl'):
        for r in JL(f):
            if ('kraus' if r['kind'] == 'print' else 'mss') == which: src[rt[r['engine']]][r['page'].split('|')[1]] = r  # last wins, as derive does
    out = collections.defaultdict(list)
    for route, pages in src.items():
        for key, p in pages.items():
            b, n = re.match(r'^([0-9a-f]+)_(\d+)', key).groups(); u = p['usability_claude']  # <book>_<page>[_<half>]: a crop of that page
            out[('ar-' + which, route)].append(row(b, u in ('USABLE', 'NOTICEABLE'), u == 'MISLEADING', ['FAILED'] if u == 'FAILED' else [],
                                                   uid=p['page'], page_number=int(n), _book=p['work']))
    return out


SOURCES = {
    RJ + 'pilot-2026-10-26/score.json': lambda: route_judge(RJ + 'pilot-2026-10-26/'),
    RJ + 'router-tests-2026-10-26/score.json': lambda: route_judge(RJ + 'router-tests-2026-10-26/'),
    RJ + 'tibetan-30-2026-10-27/score.json': lambda: route_judge(RJ + 'tibetan-30-2026-10-27/'),
    RJ + 'router-tests-2026-10-28/score.json': lambda: route_judge(RJ + 'router-tests-2026-10-28/'),
    TR + 'score.json': translation_router,
    EV + 'correct-vs-reread-7568.score.json': correct_vs_reread_7568, EV + 'fresh-7517.score.json': fresh_7517,
    EV + 'tengyur-6361.score.json': tengyur_6361, EV + 'siku-tr-6567.score.json': siku_tr_6567,
    EV + 'latin-served-5924.score.json': latin_served_5924, EV + 'latin-250-5924.score.json': latin_250_5924,
    EV + 'cells-6553.score.json': cells_6553, EV + 'router-next-7263.score.json': router_next_7263,
    EV + 'arabic-mss-7341.score.json': lambda: arabic_7341('mss'), EV + 'arabic-kraus-7341.score.json': lambda: arabic_7341('kraus'),
}


def used_pairs():
    R = J('scripts/eval/estimator/router-table/rules.json')
    pairs = {}
    for c in R['cells']:
        for r in c['routes']:
            if r.get('pilot'): pairs.setdefault((R['inputs']['pilot'], c['pilot'], r['pilot']), set())
            for e in r.get('evidence') or []: pairs.setdefault((e['score'], e['cell'], e['route']), set()).add(e.get('use'))
    return pairs


def map_page_ids(rows):
    """(book_id, page_number) -> pages.id, one read-only query per book; cached."""
    cache_f = os.path.join(SCR, 'page-ids.json')
    cache = J(cache_f) if os.path.exists(cache_f) else {}
    need = collections.defaultdict(set)
    for x in rows:
        if not x['page_id'] and x['book_id'] and x['page_number'] is not None and f"{x['book_id']}:{x['page_number']}" not in cache:
            need[x['book_id']].add(x['page_number'])
    if need and '--no-mongo' not in sys.argv:
        js = ("import {MongoClient} from 'mongodb'; let s='';for await (const c of process.stdin) s+=c; const need=JSON.parse(s);"
              "const c=new MongoClient(process.env.MONGODB_URI); await c.connect(); const P=c.db('bookstore').collection('pages'); const o={};"
              "for (const [b,ns] of Object.entries(need)) for (const p of await P.find({book_id:b,page_number:{$in:ns}},{projection:{_id:0,id:1,page_number:1}}).toArray()) o[b+':'+p.page_number]=p.id;"
              "await c.close(); console.log(JSON.stringify(o));")
        res = subprocess.run(['node', f'--env-file={ENV}', '--input-type=module', '-e', js], input=json.dumps({b: sorted(n) for b, n in need.items()}),
                             capture_output=True, text=True, cwd=ROOT, check=True)
        cache.update(json.loads(res.stdout)); os.makedirs(SCR, exist_ok=True); json.dump(cache, open(cache_f, 'w'), indent=0)
    for x in rows:
        if not x['page_id']: x['page_id'] = cache.get(f"{x['book_id']}:{x['page_number']}")


def main():
    pairs, built, rows, report, bad = used_pairs(), {}, [], [], 0
    for (score, cell, route), uses in sorted(pairs.items()):
        if score not in SOURCES:
            report.append((score, cell, route, 'UNRECOVERABLE', 'no per-page reader for this score.json', '')); bad += 1; continue
        if score not in built: built[score] = SOURCES[score]()
        xs = [dict(x, score=score, cell=cell, route=route) for x in built[score].get((cell, route), [])]
        exp = J(score)['cells'][cell]['routes'][route]
        n, nc = len(xs), [x for x in xs if x['accept']]
        got = dict(accept=f"{len(nc)}/{n}", wrong_text_pages=f"{sum(x['wrong_text'] for x in xs)}/{n}",
                   books=len({x.get('_book') or x['book_id'] for x in xs}),
                   classes=dict(collections.Counter(c for x in xs for c in x['classes'])))
        want = dict(accept=exp['accept'], wrong_text_pages=exp['wrong_text_pages'], books=exp['books'],
                    classes={c: int(v.split('/')[0]) for c, v in exp['classes_k_of_n'].items()})
        if 'name_check' in uses:
            got.update(accept_after_name_check=f"{sum(x['name_check_accept'] is True for x in xs)}/{n}", with_name_error=sum(x.get('_name_error', False) for x in xs))
            want.update(accept_after_name_check=exp['name_check']['accept_after_name_check'], with_name_error=exp['name_check']['with_name_error'])
        diff = {k: (want[k], got[k]) for k in want if want[k] != got[k]}
        bad += bool(diff)
        report.append((score, cell, route, 'MISMATCH' if diff else 'OK', f"{got['accept']} w {got['wrong_text_pages']} b {got['books']}" + (f" nc {got['accept_after_name_check']}" if 'name_check' in uses else ''), diff or ''))
        rows += xs
    map_page_ids(rows)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        for x in rows:
            f.write(json.dumps({k: v for k, v in x.items() if not k.startswith('_')}, ensure_ascii=False) + '\n')
    found = collections.Counter((x['score'], x['cell'], x['route'], x['page_id'] is not None) for x in rows)
    print(f"{'pair':<92} {'status':<13} got (accept / wrong / books [/ name check])   page ids found   diff")
    for score, cell, route, st, g, diff in report:
        nn = found[(score, cell, route, True)] + found[(score, cell, route, False)]
        print(f"{os.path.basename(os.path.dirname(score)) if score.endswith('/score.json') else os.path.basename(score)} | {cell} | {route}".ljust(92),
              st.ljust(13), g.ljust(44), f"{found[(score, cell, route, True)]}/{nn}".ljust(16), diff)
    print(f"\n{len(report)} pairs: {sum(r[3] == 'OK' for r in report)} OK, {sum(r[3] == 'MISMATCH' for r in report)} mismatch, "
          f"{sum(r[3] == 'UNRECOVERABLE' for r in report)} unrecoverable; {len(rows)} rows ({sum(x['page_id'] is None for x in rows)} without page_id) -> {OUT}")
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
