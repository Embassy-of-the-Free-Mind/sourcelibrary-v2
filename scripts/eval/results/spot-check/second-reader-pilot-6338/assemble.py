#!/usr/bin/env python3
# PRIOR ART: scripts/eval/second-reader/lib.mjs validateOutput (#6347, unmerged) validates the full-book file schema; these replies are one page or one book object each.
# Parse and schema-check every reply; assemble each arm's page + book replies into REVIEWER.md's OUTPUT_FILE shape
# (reviews/<arm>/greek-latin-classics.json), and tabulate the step-3 feasibility numbers per arm.
import json, os, re, statistics, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PACKET = '/mnt/HC_Volume_105839809/worktrees/job-second-reader-pilot-6338/scripts/eval/results/spot-check/overview-2026-10-07-eternity2/packets/greek-latin-classics.json'
books = json.load(open(PACKET, encoding='utf-8'))
SEV = {'serious', 'moderate', 'minor'}


def parse(text):
    t = text.strip()
    m = re.match(r'^```(?:json)?\s*(.*?)\s*```$', t, re.S)
    fenced = bool(m)
    if m: t = m.group(1)
    try:
        return json.loads(t), fenced, None
    except ValueError as e:
        return None, fenced, f'json: {e}'


def check_page(p, want_pn):
    errs = []
    if not isinstance(p, dict): return ['not an object']
    if p.get('page_number') != want_pn: errs.append(f"page_number {p.get('page_number')} != {want_pn}")
    if p.get('right_page') not in ('yes', 'no', 'unsure'): errs.append(f"right_page {p.get('right_page')!r}")
    for k in ('ocr_score', 'tr_score'):
        if not (p.get(k) is None or p.get(k) in (1, 2, 3, 4, 5)): errs.append(f'{k} {p.get(k)!r}')
    for k in ('ocr_errors', 'tr_errors', 'other'):
        if not isinstance(p.get(k), list): errs.append(f'{k} missing'); continue
        for e in p[k]:
            if not isinstance(e, dict) or e.get('severity') not in SEV: errs.append(f'{k}: bad severity'); continue
            if e['severity'] == 'serious' and not e.get('class'): errs.append(f'{k}: serious without class')
    if p.get('confidence') not in ('high', 'medium', 'low'): errs.append(f"confidence {p.get('confidence')!r}")
    return errs


def check_book(b):
    errs = []
    if not isinstance(b, dict): return ['not an object']
    if b.get('fit_to_show') not in ('show', 'show_with_caveat', 'do_not_show'): errs.append(f"fit_to_show {b.get('fit_to_show')!r}")
    if b.get('shelf_fit') not in ('fits', 'doubtful', 'wrong'): errs.append(f"shelf_fit {b.get('shelf_fit')!r}")
    if not isinstance(b.get('on_sight_defect'), bool): errs.append('on_sight_defect not bool')
    if not isinstance(b.get('showcase_pages'), list): errs.append('showcase_pages missing')
    for k in ('book_verdict', 'reader_summary'):
        if not b.get(k): errs.append(f'{k} missing')
    return errs


def rows(path):
    last = {}
    if os.path.exists(path):
        for l in open(path, encoding='utf-8'):
            if l.strip():
                r = json.loads(l); last[r['uid']] = r
    return last


summary = {}
for arm in ('pro', 'f38h', 'f38l'):
    pg, bk = rows(f'{HERE}/out/{arm}-page.jsonl'), rows(f'{HERE}/out/{arm}-book.jsonl')
    out, problems = [], []
    secs_page, secs_book = [], []
    st = dict(page_calls=0, book_calls=0, attempts=0, nudged=0, empty=0, blocked=0, fenced=0, schema_fail=0, pages_reviewed=0)
    for b in books:
        bobj = None
        r = bk.get(b['book_id'])
        if r:
            st['book_calls'] += 1; st['attempts'] += r['attempts']; st['nudged'] += r['nudged']; st['empty'] += bool(r['empty']); st['blocked'] += r['blocked']
            secs_book.append(r['secs'])
            j, fenced, err = parse(r['text']) if r['text'] else (None, False, 'empty')
            st['fenced'] += fenced
            if isinstance(j, list) and len(j) == 1: j = j[0]
            e = [err] if err else check_book(j)
            if e: st['schema_fail'] += 1; problems.append(f"book {b['book_id']}: {e}")
            bobj = j if isinstance(j, dict) else None
        rec = {k: b[k] for k in ('book_id', 'slot', 'tradition')}
        rec['title'] = b['book']['title']
        if bobj:
            for k, v in bobj.items():
                if k not in ('pages', 'book_id', 'slot'): rec[k] = v
        rec['pages'] = []
        for p in b['pages']:
            uid = f"{b['book_id']}_{p['page_number']}"
            r = pg.get(uid)
            if not r: problems.append(f'page {uid}: no row'); continue
            st['page_calls'] += 1; st['attempts'] += r['attempts']; st['nudged'] += r['nudged']; st['empty'] += bool(r['empty']); st['blocked'] += r['blocked']
            secs_page.append(r['secs'])
            j, fenced, err = parse(r['text']) if r['text'] else (None, False, 'empty')
            st['fenced'] += fenced
            if isinstance(j, list) and len(j) == 1: j = j[0]
            e = [err] if err else check_page(j, p['page_number'])
            if e: st['schema_fail'] += 1; problems.append(f'page {uid}: {e}')
            if isinstance(j, dict) and not err:
                rec['pages'].append(j); st['pages_reviewed'] += 1
        out.append(rec)
    os.makedirs(f'{HERE}/reviews/{arm}', exist_ok=True)
    json.dump(out, open(f'{HERE}/reviews/{arm}/greek-latin-classics.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    st['secs_page_median'] = statistics.median(secs_page) if secs_page else None; st['secs_page_max'] = max(secs_page) if secs_page else None
    st['secs_book_median'] = statistics.median(secs_book) if secs_book else None; st['secs_book_max'] = max(secs_book) if secs_book else None
    st['secs_total'] = round(sum(secs_page) + sum(secs_book), 1)
    st['problems'] = problems
    # the four-image book call
    b4 = rows(f'{HERE}/out/{arm}-book4.jsonl')
    for uid, r in b4.items():
        j, fenced, err = parse(r['text']) if r['text'] else (None, False, 'empty')
        if isinstance(j, dict): j = [j]
        e = [err] if err else []
        if not e:
            if not (isinstance(j, list) and len(j) == 1): e.append('not a one-book array')
            else:
                e += check_book(j[0])
                want = [p['page_number'] for b in books if b['book_id'] == uid for p in b['pages']]
                got = [p.get('page_number') for p in j[0].get('pages', [])]
                if got != want: e.append(f'pages {got} != {want}')
                for p, pn in zip(j[0].get('pages', []), want): e += check_page(p, pn)
        st['book4'] = dict(uid=uid, secs=r['secs'], attempts=r['attempts'], nudged=r['nudged'], fenced=fenced, schema_errors=e, chars=len(r['text']))
        if not e:
            os.makedirs(f'{HERE}/reviews/{arm}-book4', exist_ok=True)
            json.dump(j, open(f'{HERE}/reviews/{arm}-book4/greek-latin-classics.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    summary[arm] = st
json.dump(summary, open(f'{HERE}/summary.json', 'w'), indent=1)
print(json.dumps(summary, indent=1))
