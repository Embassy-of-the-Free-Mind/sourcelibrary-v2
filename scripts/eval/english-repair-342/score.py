#!/usr/bin/env python3
# PRIOR ART: scripts/eval/route-judge-6740/defect-rate.py (defects per 1,000 words, gamma-Poisson rule) and
# paired-arm.mjs score (accept / wrong-text k/n, controls, noise floor). defect-rate.py reads router-cell runs
# (source/run/lang rows from the route-judge results tree) and gates a route against the cell's bar; this test has
# no cell and asks for a paired DIFFERENCE per audit group, with the audit's own findings and the decoys counted.
# This script adds only that; the controls and noise floor stay with paired-arm.mjs score.
"""English repair test (#342): score arms B/C/D against A (stored) per audit group.

  python3 scripts/eval/english-repair-342/score.py --set=$JOB_SCRATCH/set --judge=$JOB_SCRATCH/judge --out=FILE.json

Per group (en_only, both, clean, flagged = en_only+both) and arm:
  serious (misleads + wrong_text) per 1,000 words, each severity, on the pages where BOTH the arm and A were judged;
  the difference vs A with a by-book bootstrap 95% interval (one page per book, so book = page);
  audit findings fixed: an English finding's `bad` quote that is in A's text and gone from the arm's text
    (removed is not proof of a right fix; `good_present` counts where the audit's correction now appears);
  new serious: added_net (per page, serious beyond A's count, summed), pages_worse / pages_better, and for the edit
    arms C and D new_serious_quote (a serious defect whose quote does not occur in A's text: the arm wrote it);
  decoys applied (arm C): the planted false text appears in C's text;
  calls vs returned (a refusal or empty reply is a page the arm did not deliver).
Pages where an arm beat A with no new serious error are listed for a follow-up apply.
"""
import argparse, ast, glob, json, os, random, re, unicodedata

ap = argparse.ArgumentParser()
ap.add_argument('--set', required=True); ap.add_argument('--judge', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--boot', type=int, default=4000)
A = ap.parse_args()
SEV = ('misleads', 'wrong_text')
ARMS = {'retranslate': 'B', 'guided': 'C', 'blind': 'D'}

def norm(t):
    t = unicodedata.normalize('NFC', t or '')
    t = re.sub(r'<[^>]+>', ' ', t)
    t = t.replace('*', '').replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')
    return re.sub(r'\s+', ' ', t).strip().lower()

def words(t):
    return len(re.findall(r"\w+", re.sub(r'<[^>]+>', ' ', t or '')))

key = json.load(open(os.path.join(A.judge, 'key.json')))
items = {i['id']: i for i in json.load(open(os.path.join(A.judge, 'packet.json')))['items']}
verd = {}
for l in open(os.path.join(A.judge, 'verdicts-opus.jsonl')):
    r = json.loads(l)
    if r.get('verdict') and isinstance(r['verdict'].get('defects'), list): verd[r['id']] = r['verdict']
setrows = {r['page_id']: r for r in map(json.loads, open(os.path.join(A.set, 'set.jsonl')))}

def errs(r):
    e = r.get('errors')
    if isinstance(e, str):
        try: e = ast.literal_eval(e)
        except Exception: e = json.loads(e)
    return e or []

arm_out = {}
for arm in ('C', 'D'):
    for f in glob.glob(os.path.join(A.set, f'arm{arm}', '*.json')):
        d = json.load(open(f)); arm_out[(d['page_id'], arm)] = d

# one judged row per (page, route), kind item
rows = {}
for k in key:
    if k['kind'] != 'item': continue
    v = verd.get(k['id']); it = items.get(k['id'])
    if not v or not it: continue
    ser = [d for d in v['defects'] if d.get('severity') in SEV]
    rows[(k['page_id'], k['route'])] = dict(page_id=k['page_id'], book_id=k['book_id'], cell=k['cell'], route=k['route'],
        text=it['text'], words=words(it['text']), accept=v.get('accept'), fidelity=v.get('fidelity'), serious=ser,
        **{f'n_{s}': sum(d.get('severity') == s for d in v['defects']) for s in SEV})

def rate(rs, sevs):
    w = sum(r['words'] for r in rs)
    return 1000 * sum(sum(r[f'n_{s}'] for s in sevs) for r in rs) / w if w else None

def boot_diff(pairs, sevs, seed=342):
    rnd = random.Random(seed); out = []
    for _ in range(A.boot):
        s = [pairs[rnd.randrange(len(pairs))] for _ in pairs]
        ra, rb = rate([a for a, _ in s], sevs), rate([b for _, b in s], sevs)
        if ra is not None and rb is not None: out.append(rb - ra)
    out.sort()
    return [round(out[int(0.025 * len(out))], 3), round(out[int(0.975 * len(out)) - 1], 3)] if out else None

def decoy_state(d, text):
    """applied | orig_kept | rewritten. A number or a name is located by its context, never by the bare string
    (a planted '4' occurs on nearly every page)."""
    t = norm(text)
    if d['kind'] == 'negation':
        return 'applied' if norm(d['planted']) in t else 'orig_kept' if norm(d['orig']) in t else 'rewritten'
    ctx = norm(d['context']); o = norm(d['orig'])
    i = ctx.find(o) if d['kind'] != 'number' else next((m.start() for m in re.finditer(r'(?<!\d)' + re.escape(o) + r'(?!\d)', ctx)), -1)
    if i < 0: return 'rewritten'
    left, right = ctx[max(0, i - 15):i], ctx[i + len(o):i + len(o) + 15]
    left, right = left.split(' ', 1)[-1] if ' ' in left else left, right.rsplit(' ', 1)[0] if ' ' in right else right
    def near(word):
        if d['kind'] == 'name': return re.search(r'\b' + re.escape(norm(word)) + r'\b', t) is not None
        return (left + norm(word) + right) in t
    return 'applied' if near(d['planted']) else 'orig_kept' if near(d['orig']) else 'rewritten'

def new_serious(arm_row, a_row):
    at = norm(a_row['text'])
    return [d for d in arm_row['serious'] if norm(d.get('quote', '')) and norm(d.get('quote', '')) not in at]

GROUPS = {'en_only': ['en_only'], 'both': ['both'], 'clean': ['clean'], 'flagged': ['en_only', 'both']}
res = dict(generated_by='scripts/eval/english-repair-342/score.py', n_set=len(setrows), groups={}, beat_A=[], arm_status={})
for g, cells in GROUPS.items():
    pages = [p for p, r in setrows.items() if r['group'] in cells]
    G = {}
    a_rows = [rows[(p, 'stored')] for p in pages if (p, 'stored') in rows]
    G['stored'] = dict(pages=len(a_rows), words=sum(r['words'] for r in a_rows), serious_per_1k=round(rate(a_rows, SEV) or 0, 3),
                       **{f'{s}_per_1k': round(rate(a_rows, (s,)) or 0, 3) for s in SEV}, accept=sum(bool(r['accept']) for r in a_rows))
    for route, letter in ARMS.items():
        pairs = [(rows[(p, 'stored')], rows[(p, route)]) for p in pages if (p, 'stored') in rows and (p, route) in rows]
        if not pairs: continue
        ar, br = [a for a, _ in pairs], [b for _, b in pairs]
        e = dict(arm=letter, pages=len(pairs), words_A=sum(r['words'] for r in ar), words=sum(r['words'] for r in br),
                 A_serious_per_1k=round(rate(ar, SEV), 3), serious_per_1k=round(rate(br, SEV), 3),
                 diff_serious_per_1k=round(rate(br, SEV) - rate(ar, SEV), 3), diff_ci95_by_book=boot_diff(pairs, SEV))
        for s in SEV:
            e[f'A_{s}_per_1k'] = round(rate(ar, (s,)), 3); e[f'{s}_per_1k'] = round(rate(br, (s,)), 3)
            e[f'diff_{s}_ci95_by_book'] = boot_diff(pairs, (s,))
        e['A_serious'] = sum(len(a['serious']) for a in ar); e['serious'] = sum(len(b['serious']) for b in br)
        e['accept_A'] = sum(bool(a['accept']) for a in ar); e['accept'] = sum(bool(b['accept']) for b in br)
        ns = [(b['page_id'], new_serious(b, a)) for a, b in pairs]
        e['new_serious_quote'] = sum(len(x) for _, x in ns); e['pages_with_new_serious_quote'] = sum(bool(x) for _, x in ns)
        if letter == 'B': e['new_serious_quote_note'] = 'B rewrites the page, so every quote is new: use added_net / pages_worse'
        e['added_net'] = sum(max(0, len(b['serious']) - len(a['serious'])) for a, b in pairs)
        e['removed_net'] = sum(max(0, len(a['serious']) - len(b['serious'])) for a, b in pairs)
        e['pages_worse'] = sum(len(b['serious']) > len(a['serious']) for a, b in pairs)
        e['pages_better'] = sum(len(b['serious']) < len(a['serious']) for a, b in pairs)
        e['pages_new_wrong_text'] = sum(b['n_wrong_text'] > a['n_wrong_text'] for a, b in pairs)
        e['fidelity_mean_A'] = round(sum(a['fidelity'] or 0 for a in ar) / len(ar), 3); e['fidelity_mean'] = round(sum(b['fidelity'] or 0 for b in br) / len(br), 3)
        # audit findings in the English
        fx = dict(findings=0, bad_in_A=0, removed=0, good_present=0)
        for a, b in pairs:
            for er in errs(setrows[a['page_id']]):
                if er.get('stage') != 'translation' or er.get('severity') != 'serious': continue
                fx['findings'] += 1
                bad = norm(er.get('bad', ''))
                if not bad or bad not in norm(a['text']): continue
                fx['bad_in_A'] += 1
                if bad not in norm(b['text']):
                    fx['removed'] += 1
                    if er.get('good') and norm(er['good']) in norm(b['text']): fx['good_present'] += 1
        e['audit_findings'] = fx
        if letter == 'C':
            dc = dict(decoys=0, applied=0, orig_kept=0, rewritten=0)
            for a, b in pairs:
                d = arm_out.get((b['page_id'], 'C'), {}).get('decoy')
                if isinstance(d, str):
                    try: d = ast.literal_eval(d)
                    except Exception: d = None
                if not d or not d.get('planted'): continue
                dc['decoys'] += 1
                st = decoy_state(d, b['text']); dc[st] = dc.get(st, 0) + 1
                if st == 'applied': dc.setdefault('applied_pages', []).append(b['page_id'])
            e['decoys'] = dc
        G[route] = e
        if g in ('en_only', 'both', 'clean'):
            for (a, b), (_, x) in zip(pairs, ns):
                # an edit (C, D): no serious defect on a quote A did not have; a rewrite (B): no more wrong_text than A
                clean_new = (b['n_wrong_text'] <= a['n_wrong_text']) if letter == 'B' else not x
                if letter == 'C':  # C's text carries a planted false report: keep it only where the decoy's original
                    d = arm_out.get((b['page_id'], 'C'), {}).get('decoy')  # sentence is still there unchanged
                    d = ast.literal_eval(d) if isinstance(d, str) else d
                    if d and decoy_state(d, b['text']) != 'orig_kept': continue
                if len(b['serious']) < len(a['serious']) and clean_new and (b['fidelity'] or 0) >= (a['fidelity'] or 0):
                    res['beat_A'].append(dict(page_id=b['page_id'], book_id=b['book_id'], group=g, arm=letter,
                                              A_serious=len(a['serious']), serious=len(b['serious']),
                                              A_fidelity=a['fidelity'], fidelity=b['fidelity']))
    res['groups'][g] = G

# B and every arm by the model that made the stored English: is a gain a re-roll, or the newer model?
LIVE = 'gemini-3.8-flash-low'
res['by_stored_model'] = {}
for label, test in (('live_model', lambda m: m == LIVE), ('older_model', lambda m: m != LIVE)):
    pages = [p for p, r in setrows.items() if test(r.get('live_model'))]
    out = {}
    for route, letter in ARMS.items():
        pairs = [(rows[(p, 'stored')], rows[(p, route)]) for p in pages if (p, 'stored') in rows and (p, route) in rows]
        if len(pairs) < 5: continue
        ar, br = [a for a, _ in pairs], [b for _, b in pairs]
        out[letter] = dict(pages=len(pairs), A_serious_per_1k=round(rate(ar, SEV), 3), serious_per_1k=round(rate(br, SEV), 3),
                           diff_ci95_by_book=boot_diff(pairs, SEV), groups=dict(__import__('collections').Counter(setrows[a['page_id']]['group'] for a in ar)))
    res['by_stored_model'][label] = out
    print(label, {k: (v['pages'], v['A_serious_per_1k'], v['serious_per_1k'], v['diff_ci95_by_book']) for k, v in out.items()})

# the experiment header's defect_rates shape (lib/experiment-header.mjs defectRatesShapeOk): one entry per group x arm
res['study_cells'] = {}
for g, cells in GROUPS.items():
    for route in ('stored', *ARMS):
        rs = [rows[(p, route)] for p, r in setrows.items() if r['group'] in cells and (p, route) in rows]
        if rs: res['study_cells'][f'{g}/{route}'] = dict(pages=len(rs), words=sum(r['words'] for r in rs),
            misleads_per_1k=round(rate(rs, ('misleads',)), 3), wrong_text_per_1k=round(rate(rs, ('wrong_text',)), 3),
            serious_per_1k=round(rate(rs, SEV), 3), fidelity_mean=round(sum(r['fidelity'] or 0 for r in rs) / len(rs), 3))

st = os.path.join(A.judge, 'arm-status.json')
if os.path.exists(st): res['arm_status'] = json.load(open(st))
json.dump(res, open(A.out, 'w'), indent=1, ensure_ascii=False)
for g, G in res['groups'].items():
    s = G['stored']; print(f"{g:8} A n={s['pages']} serious/1k={s['serious_per_1k']}")
    for route in ARMS:
        if route in G:
            e = G[route]
            print(f"   {e['arm']} n={e['pages']} A={e['A_serious_per_1k']} arm={e['serious_per_1k']} diff={e['diff_serious_per_1k']} ci={e['diff_ci95_by_book']} added={e['added_net']} worse={e['pages_worse']} better={e['pages_better']} newq={e['new_serious_quote']} fixed={e['audit_findings']['removed']}/{e['audit_findings']['bad_in_A']}" + (f" decoys={e['decoys']}" if 'decoys' in e else ''))
print('beat_A', len(res['beat_A']))
