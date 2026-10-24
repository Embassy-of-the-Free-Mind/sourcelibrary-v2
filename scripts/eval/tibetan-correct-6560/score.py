#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tibetan-proofread/score.mjs (served read vs a human correction of the same leaf; no Derge
# reference, no arms) and kanjur_align.py score (one read vs a RETRIEVED Derge window; no pairing across arms, no
# failed-read accounting, no anchoring or recitation). This scores every arm of #6560 against the SAME fixed Derge
# window per folio (the window the served read was scored against), with the same tokeniser and NW.
"""
#6560 scorer.

  python3 score.py readoff-prep --settler pro-settles|opus-settles   # recitation spans -> read-off requests
  python3 score.py score --root $JOB_SCRATCH [--out results.json]

Arms: baseline (served Yigdzin), opus-corr, pro-corr, opus-redo, pro-redo; plus opus-corr-anchor, pro-corr-anchor on
the 10 planted folios, scored separately. Outputs live in <root>/out/<arm>.jsonl (runner rows).

identity = NW matches against the folio's Derge window (derge_vol, imgnum ± 2) / syllables of the read — the
           orientation of kanjur_align.py, so the baseline reproduces the manifest's derge_identity.
recall   = the read's NW matches that land on Derge positions the SERVED read covers / those positions (derge_cover:
           runs between served-read matches ≤ 10 apart). Fixed per folio; sees dropped lines, which identity cannot.
did-not-read = empty reply, timeout, refusal, no Tibetan, or nothing between the sentinels: counted, not scored.
Intervals: 95% percentile bootstrap over books (one folio per book, so over folios), 4000 draws, seed 6560.
"""
import argparse, gzip, json, os, random, re, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from alignpairs import syllables, align, matches  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '../../..'))
RES = os.path.join(REPO, 'scripts/eval/results/tibetan-correct-6560')
MANIFEST = os.path.join(REPO, 'scripts/eval/results/tibetan-proofread-2026-10/manifest.jsonl')
ARMS = ['opus-corr', 'pro-corr', 'opus-redo', 'pro-redo', 'sonnet-corr', 'haiku-corr',  # #6667 added sonnet, haiku
        'flash-low-corr', 'flash-high-corr',  # Gemini 3.8 Flash at low and high thinking (agy -p), same CORR prompt
        'g4l-corr',  # Gemini 4 Argon at low thinking (agy -p), same CORR prompt (2026-10-15)
        'lite-corr', 'lite-noimg-corr', 'lite-corr-r2', 'lite-p2-corr']  # #7263: gemini-3.1-flash-lite (paid API), same CORR prompt;
#   noimg = no image attached (control), r2 = a repeat read on 10 folios (noise floor), p2 = the production-shaped
#   prompt (PREREG amendment 1: live OCR prompt + correctInstruction + Siku v2 rule)
ANCHOR_ARMS = ['opus-corr-anchor', 'pro-corr-anchor', 'sonnet-corr-anchor', 'haiku-corr-anchor',
               'flash-low-corr-anchor', 'flash-high-corr-anchor', 'g4l-corr-anchor',
               'lite-corr-anchor', 'lite-noimg-corr-anchor', 'lite-p2-corr-anchor']
FAMILY = {'opus': 'claude', 'pro': 'gemini'}
# who reads off whose toward-Derge changes: always the other family. The Flash arms get their own Opus key so the
# committed opus-settles key (Pro's arms) is not rebuilt.
SETTLERS = {'pro-settles': ['opus-corr', 'opus-redo'], 'opus-settles': ['pro-corr', 'pro-redo'],
            'opus-settles-flash': ['flash-low-corr', 'flash-high-corr'], 'opus-settles-g4l': ['g4l-corr']}
TIB = re.compile('[ཀ-ྼ]')
REFUSAL = re.compile(r"\bI (?:cannot|can't|am unable to)|content (?:safety )?filter|blocked by Gemini", re.I)


def load_manifest():
    rows = [json.loads(l) for l in open(MANIFEST, encoding='utf-8')]
    return {r['id']: r for r in rows if r['stratum'] == 'kangyur'}


def manuscript_text(text):
    # drop machine markup lines (score.mjs isMarkup): no Tibetan letters, or a whole-line <tag/> element
    keep = []
    for l in text.split('\n'):
        s = l.strip()
        if not s or not TIB.search(s) or re.fullmatch(r'<[\w-]+[^>]*/>', s) or re.fullmatch(r'<([\w-]+)[^>]*>.*</\1>', s):
            continue
        keep.append(l)
    return '\n'.join(keep)


def extract(reply):
    """The text between <<<BEGIN>>> and <<<END>>> (#6523). Returns (text, problem)."""
    if not reply:
        return '', 'empty'
    b = reply.find('<<<BEGIN>>>')
    e = reply.rfind('<<<END>>>')
    if b == -1:
        body, prob = reply, 'no_sentinel'
    else:
        body = reply[b + len('<<<BEGIN>>>'):e if e > b else None]
        prob = None if e > b else 'no_end_sentinel'
    body = re.sub(r'^```\w*\n|\n```$', '', body.strip())
    if not TIB.search(body):
        return '', 'refusal' if REFUSAL.search(reply) else 'no_tibetan'
    return body.strip(), prob


def jopen(path):
    """path, or the committed path + '.gz' (results/tibetan-correct-6560 keeps the large files gzipped)"""
    if os.path.exists(path):
        return open(path, encoding='utf-8')
    return gzip.open(path + '.gz', 'rt', encoding='utf-8') if os.path.exists(path + '.gz') else None


def load_arm(root, arm):
    # the run's scratch copy if there is one, else the gzipped copy committed under results/
    p = os.path.join(root or '', 'out', arm + '.jsonl')
    if not os.path.exists(p):
        p = os.path.join(RES, 'out', arm + '.jsonl')
    rows = {}
    f = jopen(p)
    if f:
        for l in f:
            if l.strip():
                r = json.loads(l)
                rows[r['uid']] = r  # last row wins (the runner retries rows without text)
    return rows


def boot(ids, f, n=4000, seed=6560):
    rng = random.Random(seed)
    vals = []
    for _ in range(n):
        s = [rng.choice(ids) for _ in ids]
        v = f(s)
        if v is not None:
            vals.append(v)
    vals.sort()
    return [round(vals[int(0.025 * len(vals))], 4), round(vals[int(0.975 * len(vals)) - 1], 4)] if vals else None


def derge_cover(base_syls, w, gap=10):
    """Derge window positions the served read covers: every run between consecutive served-read matches no more than
    `gap` apart. A frame holds two leaves that need not be contiguous in Derge, so one first..last span would count
    the text between them as missed."""
    js = sorted(j for i, j in align(base_syls, w) if i is not None and j is not None and base_syls[i] == w[j])
    cov = set(js)
    for a_, b_ in zip(js, js[1:]):
        if b_ - a_ <= gap:
            cov.update(range(a_, b_))
    return cov


def recall(x, w, cov):
    return round(sum(1 for i, j in align(x, w) if i is not None and j is not None and x[i] == w[j] and j in cov) / len(cov), 4)


def toward_derge(base_syls, arm_syls, w, arm_line_of=None):
    """Spans of the Derge window where the served read differs from Derge and the arm agrees with Derge.
    Returns [{j0, j1, base, arm, before, after, line}] over Derge positions j0..j1-1; `before`/`after` are the arm's
    own syllables around the spot and `line` its 1-based line in the arm's read (arm_line_of[i])."""
    def by_j(syls):
        m, first = defaultdict(list), {}  # j -> syllables aligned at j (an insertion before j attaches to j)
        pend = []
        for i, j in align(syls, w):
            if j is None:
                pend.append(i); continue
            idx = pend + ([i] if i is not None else []); pend = []
            m[j] = [syls[k] for k in idx]
            if idx:
                first[j] = idx[0]
        return m, first
    (B, _), (X, XI) = by_j(base_syls), by_j(arm_syls)
    cov = derge_cover(base_syls, w)
    spans, cur = [], None
    for j in sorted(cov):
        bad_b = B.get(j, []) != [w[j]]
        good_x = X.get(j, []) == [w[j]]
        if bad_b and good_x:
            if cur and cur[1] == j:
                cur[1] = j + 1
            else:
                cur = [j, j + 1]; spans.append(cur)
    out = []
    for j0, j1 in spans:
        i0 = XI[j0]; i1 = XI[j1 - 1] + 1
        out.append({'j0': j0, 'j1': j1, 'base': '་'.join(s for j in range(j0, j1) for s in B.get(j, [])),
                    'arm': '་'.join(w[j0:j1]), 'before': '་'.join(arm_syls[max(0, i0 - 4):i0]), 'after': '་'.join(arm_syls[i1:i1 + 4]),
                    'line': arm_line_of[i0] if arm_line_of else None})
    return out


def syllables_by_line(text):
    """syllables of a read and, for each, its 1-based manuscript line (markup lines dropped, as manuscript_text)"""
    syls, line_of = [], []
    for k, l in enumerate(manuscript_text(text).split('\n'), 1):
        s = syllables(l)
        syls += s; line_of += [k] * len(s)
    return syls, line_of


READOFF = ('You are checking a transcription of a Tibetan Kangyur manuscript against its image. Below are numbered '
           'items. Each gives the approximate line (counting from the top of the image; a frame may show two leaves '
           'of about 7 lines each, upper leaf first), the syllables just before the spot, and two or more candidate '
           'readings for the spot. Look at the image and say which candidate the manuscript actually shows. Judge '
           'only by what is written on this leaf, not by what the text ought to say. If none of the candidates '
           'matches, answer "other" and write what you see. If you cannot find or read the spot, answer "unclear".\n\n'
           'Reply with one JSON object per line, one per item, between two marker lines <<<BEGIN>>> and <<<END>>>, '
           'nothing outside the markers: {{"item": <n>, "answer": "A"|"B"|"other"|"unclear", "seen": "<what the '
           'leaf shows, in Tibetan Unicode>"}}\n\nItems:\n{items}')


def readoff_prep(a):
    man = load_manifest()
    win = json.load(jopen(os.path.join(RES, 'derge-windows.json')))['windows']
    reqs = {k: [] for k in SETTLERS}
    key = {}
    for pid, m in man.items():
        rng = random.Random(f'6560|{a.settler}|{pid}')
        w = win[pid]['syllables']
        base, base_line = syllables_by_line(m['served_text'])
        items = {k: [] for k in SETTLERS}  # opus settles Pro's changes; Pro settles Opus's
        for arm in SETTLERS[a.settler]:
            r = load_arm(a.root, arm).get(pid)
            text, prob = extract((r or {}).get('text', ''))
            if not text:
                continue
            settler = a.settler
            xs, xl = syllables_by_line(text)
            for sp in toward_derge(base, xs, w, xl):
                same = next((x for x in items[settler] if x['j0'] == sp['j0'] and x['j1'] == sp['j1'] and x['base'] == sp['base']), None)
                if same:
                    same['arms'].append(arm); continue
                sp.update({'arms': [arm], 'kind': 'span'})
                items[settler].append(sp)
        # known-answer controls: 2 per call, a syllable where served == Derge, offered against a one-letter change
        base_pairs = [(i, j) for i, j in align(base, w) if i is not None and j is not None and base[i] == w[j]]
        for settler in [a.settler]:
            for _ in range(2):
                i, j = rng.choice(base_pairs[5:-5])
                s = base[i]
                alt = None
                for src, dst in (('པ', 'བ'), ('བ', 'པ'), ('ད', 'ང'), ('ང', 'ད'), ('ས', 'མ'), ('མ', 'ས'), ('ི', 'ེ'), ('ེ', 'ི'), ('ུ', 'ོ'), ('ོ', 'ུ'), ('ག', 'ཀ'), ('ན', 'ཏ')):
                    if src in s:
                        alt = s.replace(src, dst, 1); break
                if not alt:
                    continue
                items[settler].append({'kind': 'control', 'j0': j, 'j1': j + 1, 'base': s, 'arm': alt, 'arms': [],
                                       'before': '་'.join(base[max(0, i - 4):i]), 'after': '་'.join(base[i + 1:i + 5]),
                                       'line': base_line[i]})
        for settler, its in items.items():
            if settler != a.settler or not any(x['kind'] == 'span' for x in its):
                continue
            rng.shuffle(its)
            lines = []
            for n, it in enumerate(its, 1):
                opts = [it['base'] or '(nothing: the syllables before go straight on to the syllables after)', it['arm']]
                flip = rng.random() < 0.5
                if flip:
                    opts = opts[::-1]
                it.update({'item': n, 'A_is': 'arm' if flip else 'base'})
                lines.append(f"{n}. line ≈ {it['line'] or '?'}; just before: {it['before'] or '(start)'}; "
                             f"A: {opts[0]}   B: {opts[1]}; just after: {it['after'] or '(end)'}")
            uid = f'{pid}'
            reqs[settler].append({'uid': uid, 'image': os.path.join(a.root, 'img', pid + '.jpg'),
                                  'prompt': READOFF.format(items='\n'.join(lines))})
            key[f'{settler}|{pid}'] = its
    os.makedirs(os.path.join(a.root, 'req'), exist_ok=True)
    k = a.settler
    with open(os.path.join(a.root, 'req', f'readoff-{k}.jsonl'), 'w', encoding='utf-8') as f:
        for x in reqs[k]:
            f.write(json.dumps(x, ensure_ascii=False) + '\n')
    json.dump(key, open(os.path.join(a.root, f'readoff-key-{k}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(k, 'folios', len(reqs[k]), 'spans', sum(sum(1 for x in key[f'{k}|{r["uid"]}'] if x['kind'] == 'span') for r in reqs[k]))


def parse_readoff(reply):
    body, _ = extract(reply) if reply else ('', None)
    body = body or reply or ''
    out = {}
    for l in body.split('\n'):
        l = l.strip().rstrip(',')
        if not l.startswith('{'):
            continue
        try:
            j = json.loads(l)
            out[int(j['item'])] = j
        except (ValueError, KeyError, TypeError):
            pass
    return out


def score(a):
    man = load_manifest()
    win = json.load(jopen(os.path.join(RES, 'derge-windows.json')))['windows']
    plants = json.load(open(os.path.join(RES, 'plants.json'), encoding='utf-8'))
    ids = sorted(man, key=lambda k: man[k]['seq'])
    pages = defaultdict(dict)
    cov = {}
    for pid in ids:
        m, w = man[pid], win[pid]['syllables']
        b = syllables(manuscript_text(m['served_text']))
        cov[pid] = derge_cover(b, w)
        mb = matches(b, w)
        pages[pid]['baseline'] = {'syl': len(b), 'match': mb, 'identity': round(mb / len(b), 4), 'recall': recall(b, w, cov[pid]), 'cover': len(cov[pid])}
    for arm in ARMS + ANCHOR_ARMS:
        rows = load_arm(a.root, arm)
        for pid in ids:
            if arm in ANCHOR_ARMS and pid not in plants['plants']:
                continue
            r = rows.get(pid)
            if r is None:
                pages[pid][arm] = {'status': 'not_run'}
                continue
            text, prob = extract(r.get('text', ''))
            if not text:
                pages[pid][arm] = {'status': 'did_not_read', 'why': prob if r.get('text') else (r.get('error') or 'empty')[:80], 'secs': r.get('secs')}
                continue
            x = syllables(manuscript_text(text))
            w = win[pid]['syllables']
            mx = matches(x, w)
            pages[pid][arm] = {'status': 'read', 'syl': len(x), 'match': mx, 'identity': round(mx / len(x), 4),
                               'recall': recall(x, w, cov[pid]), 'secs': r.get('secs'), 'sentinel': prob,
                               'lines': len([l for l in manuscript_text(text).split('\n') if l.strip()])}
    # anchoring
    anchoring = {}
    for arm in ANCHOR_ARMS:
        rows = load_arm(a.root, arm)
        res = []
        for pid, pv in plants['plants'].items():
            if pid not in rows:
                continue
            text, _ = extract(rows[pid].get('text', ''))
            if not text:
                res.extend({'id': pid, 'outcome': 'did_not_read', **p} for p in pv['plants']); continue
            # planted draft tokens (the regex prep.py planted on), against the corrector's tokens
            draft = man[pid]['served_text'].split('\n')
            for p in sorted(pv['plants'], key=lambda p: (p['line'], -p['offset'])):
                l = draft[p['line']]; draft[p['line']] = l[:p['offset']] + p['planted'] + l[p['offset'] + len(p['orig']):]
            dt = [t for l in draft for t in re.findall('[ཀ-ྼ]+', l)]
            ot = [t for l in text.split('\n') for t in re.findall('[ཀ-ྼ]+', l)]
            pr = dict((i, j) for i, j in align(dt, ot) if i is not None)
            for p in pv['plants']:
                i = p['token_index']; assert dt[i] == p['planted'], (pid, dt[i], p)
                j = pr.get(i)
                got = ot[j] if j is not None else None
                oc = 'survived' if got == p['planted'] else 'fixed' if got == p['orig'] else 'deleted' if got is None else 'changed_other'
                res.append({'id': pid, 'seq': pv['seq'], 'kind': p['kind'], 'orig': p['orig'], 'planted': p['planted'], 'got': got, 'outcome': oc})
        cnt = defaultdict(int)
        for x in res:
            cnt[x['outcome']] += 1
        anchoring[arm] = {'n': len(res), **cnt, 'survival': round(cnt['survived'] / max(1, len(res) - cnt['did_not_read']), 3), 'detail': res}
    # recitation read-offs
    recitation = {}
    for settler in SETTLERS:
        f = jopen(os.path.join(a.root or '', f'readoff-key-{settler}.json')) or jopen(os.path.join(RES, f'readoff-key-{settler}.json'))
        if not f:
            continue
        key = json.load(f)
        if True:
            rows = load_arm(a.root, 'readoff-' + settler)
            for k, its in key.items():
                if not k.startswith(settler + '|'):
                    continue
                pid = k.split('|', 1)[1]
                ans = parse_readoff((rows.get(pid) or {}).get('text', ''))
                for it in its:
                    j = ans.get(it['item'])
                    v = (j or {}).get('answer', 'no_answer')
                    verdict = {'A': it['A_is'], 'B': 'base' if it['A_is'] == 'arm' else 'arm'}.get(v, v)
                    it.update({'settler': settler, 'verdict': verdict, 'seen': (j or {}).get('seen'), 'id': pid, 'seq': man[pid]['seq']})
                    if it['kind'] == 'control':
                        recitation.setdefault('_controls_' + settler, []).append(it)
                    else:
                        for arm in it['arms']:
                            recitation.setdefault(arm, []).append(it)
    # summaries
    summary = {}
    def pooled(arm, sel):
        def f(s):
            g = [pages[p][arm] for p in s if pages[p].get(arm, {}).get('status', 'read') == 'read' and 'match' in pages[p].get(arm, {})]
            t = sum(x['syl'] for x in g)
            return sum(x['match'] for x in g) / t if t else None
        return f
    for arm in ['baseline'] + ARMS + ANCHOR_ARMS:
        sel = [p for p in ids if arm in pages[p]]
        rd = [p for p in sel if pages[p][arm].get('status', 'read') == 'read']
        dnr = [p for p in sel if pages[p][arm].get('status') == 'did_not_read']
        nr = [p for p in sel if pages[p][arm].get('status') == 'not_run']
        s = {'n': len(sel), 'read': len(rd), 'did_not_read': len(dnr), 'not_run': len(nr),
             'did_not_read_why': [pages[p][arm]['why'] for p in dnr]}
        if rd:
            f = pooled(arm, rd)
            s['identity'] = round(f(rd), 4); s['identity_ci'] = boot(rd, f)
            fr = lambda S: (lambda g: sum(x['recall'] for x in g) / len(g) if g else None)([pages[p][arm] for p in S])
            s['recall_mean'] = round(fr(rd), 4); s['recall_ci'] = boot(rd, fr)
            if arm != 'baseline':
                fb = pooled('baseline', rd)
                fd = lambda S: (lambda x, y: None if x is None or y is None else x - y)(f(S), fb(S))
                s['delta_vs_baseline'] = round(fd(rd), 4); s['delta_ci'] = boot(rd, fd)
                s['better'] = sum(pages[p][arm]['identity'] > pages[p]['baseline']['identity'] for p in rd)
                s['worse'] = sum(pages[p][arm]['identity'] < pages[p]['baseline']['identity'] for p in rd)
                # #7263 wreck count: duplication or a looped/garbled read (more lines than the draft + 2, syllables
                # over 115% of the draft's, or identity below 0.85)
                bl = lambda p: len([l for l in manuscript_text(man[p]['served_text']).split('\n') if l.strip()])
                s['wreck'] = [man[p]['seq'] for p in rd if pages[p][arm].get('lines', 0) > bl(p) + 2
                              or pages[p][arm]['syl'] > 1.15 * pages[p]['baseline']['syl'] or pages[p][arm]['identity'] < 0.85]
                secs = [pages[p][arm]['secs'] for p in sel if pages[p][arm].get('secs') is not None]
                s['secs_median'] = sorted(secs)[len(secs) // 2] if secs else None
                s['secs_mean'] = round(sum(secs) / len(secs), 1) if secs else None
        if arm in recitation:
            its = recitation[arm]
            c = defaultdict(int)
            for it in its:
                c[it['verdict']] += 1
            s['toward_derge_spans'] = len(its)
            s['toward_derge_image_supports_change'] = c['arm']
            s['toward_derge_NOT_supported'] = c['base'] + c['other']
            s['toward_derge_image_supports_draft'] = c['base']
            s['toward_derge_other'] = c['other']
            s['toward_derge_unclear'] = c['unclear'] + c['no_answer']
        if arm in anchoring:
            s['anchoring'] = {k: v for k, v in anchoring[arm].items() if k != 'detail'}
        summary[arm] = s
    for k in [k for k in recitation if k.startswith('_controls_')]:
        its = recitation[k]
        summary[k] = {'n': len(its), 'right': sum(it['verdict'] == 'base' for it in its), 'wrong': sum(it['verdict'] == 'arm' for it in its),
                      'other_unclear': sum(it['verdict'] not in ('base', 'arm') for it in its)}
    # Pro-correct against Opus-correct, paired on the same folios
    # (#6667: the same for Sonnet and Haiku, on all 30 folios and on the 10 planted ones, with folios better / worse)
    for arm, ref in [('pro-corr', 'opus-corr'), ('sonnet-corr', 'opus-corr'), ('haiku-corr', 'opus-corr'), ('sonnet-corr', 'haiku-corr'),
                     ('sonnet-corr-anchor', 'opus-corr-anchor'), ('haiku-corr-anchor', 'opus-corr-anchor'),
                     ('flash-low-corr', 'opus-corr'), ('flash-high-corr', 'opus-corr'), ('flash-high-corr', 'flash-low-corr'),
                     ('flash-low-corr', 'pro-corr'), ('flash-high-corr', 'pro-corr'),
                     ('flash-low-corr-anchor', 'opus-corr-anchor'), ('flash-high-corr-anchor', 'opus-corr-anchor'),
                     ('g4l-corr', 'flash-low-corr'), ('g4l-corr', 'opus-corr'), ('g4l-corr-anchor', 'flash-low-corr-anchor'),
                     ('lite-corr', 'opus-corr'), ('lite-corr', 'flash-low-corr'), ('lite-corr', 'lite-noimg-corr'),
                     ('lite-corr-r2', 'lite-corr'), ('lite-corr-anchor', 'opus-corr-anchor'),
                     ('lite-p2-corr', 'opus-corr'), ('lite-p2-corr', 'lite-corr'), ('lite-p2-corr-anchor', 'opus-corr-anchor')]:
        both = [p for p in ids if pages[p].get(arm, {}).get('status') == 'read' and pages[p].get(ref, {}).get('status') == 'read']
        if both:
            fp, fo = pooled(arm, both), pooled(ref, both)
            fd = lambda S: fp(S) - fo(S)
            summary[f"_{arm.replace('-', '_')}_minus_{ref.replace('-', '_')}"] = {
                'n': len(both), 'delta': round(fd(both), 4), 'ci': boot(both, fd),
                'better': sum(pages[p][arm]['identity'] > pages[p][ref]['identity'] for p in both),
                'worse': sum(pages[p][arm]['identity'] < pages[p][ref]['identity'] for p in both)}
    # toward-Derge spans of an arm that had no image read-off (#6667 ran none: the settler would be Gemini or Opus)
    for arm in ARMS:
        if arm in recitation or not summary[arm].get('read'):
            continue
        rows, n, unchanged = load_arm(a.root, arm), 0, 0
        for pid in ids:
            text, _ = extract((rows.get(pid) or {}).get('text', ''))
            if text:
                n += len(toward_derge(syllables(manuscript_text(man[pid]['served_text'])), syllables(manuscript_text(text)), win[pid]['syllables']))
                unchanged += syllables(manuscript_text(text)) == syllables(manuscript_text(man[pid]['served_text']))
        summary[arm]['toward_derge_spans_no_readoff'] = n
        summary[arm]['folios_returned_unchanged'] = unchanged
    # what the toward-Derge spans are: a restored tsheg (Yigdzin joined two syllables or wrote ':' for a tsheg), a
    # ya-btags spelling (mi/myi, med/myed: the reference e-text's archaic spelling), or anything else
    def span_type(it):
        b, x = re.sub('[་:]', '', it['base']), re.sub('[་:]', '', it['arm'])
        if b == x:
            return 'tsheg'
        if it['arm'].replace('ྱ', '') == it['base'] or it['base'].replace('ྱ', '') == it['arm']:
            return 'ya_btags'
        return 'other'
    for arm in ARMS:
        if arm in recitation:
            t = defaultdict(lambda: defaultdict(int))
            for it in recitation[arm]:
                t[span_type(it)][it['verdict']] += 1
            summary[arm]['toward_derge_by_type'] = {k: dict(v) for k, v in t.items()}
    # settler test-retest: a folio read off twice (two runner rows for one uid) — answer agreement per item
    for settler in SETTLERS:
        p_ = os.path.join(a.root or '', 'out', f'readoff-{settler}.jsonl')
        f = jopen(p_) or jopen(os.path.join(RES, 'out', f'readoff-{settler}.jsonl'))
        if not f:
            continue
        by = defaultdict(list)
        for l in f:
            if l.strip():
                r = json.loads(l); by[r['uid']].append(parse_readoff(r.get('text', '')))
        pairs = [(x[0][k].get('answer'), x[1][k].get('answer')) for x in by.values() if len(x) >= 2 for k in x[0] if k in x[1]]
        if pairs and '_controls_' + settler in summary:
            summary['_controls_' + settler]['repeat_items'] = len(pairs)
            summary['_controls_' + settler]['repeat_agree'] = sum(u == v for u, v in pairs)
    out = {'summary': summary, 'pages': {p: {'seq': man[p]['seq'], 'leaf_seam': man[p]['leaf_seam'], 'derge_identity': man[p]['derge_identity'], **pages[p]} for p in ids},
           'anchoring': anchoring, 'recitation': {k: v for k, v in recitation.items()}}
    if a.out:
        with (gzip.open(a.out, 'wt', encoding='utf-8') if a.out.endswith('.gz') else open(a.out, 'w', encoding='utf-8')) as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    for p in ids:
        row = pages[p]
        print(f"{man[p]['seq']:>2} base {row['baseline']['identity']:.3f} " + ' '.join(
            f"{arm} {row[arm]['identity']:.3f}/{row[arm]['recall']:.3f}" if row.get(arm, {}).get('status') == 'read' else f"{arm} {row.get(arm, {}).get('status', '-')}"
            for arm in ARMS))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['readoff-prep', 'score'])
    ap.add_argument('--root', default=os.environ.get('JOB_SCRATCH'))
    ap.add_argument('--out')
    ap.add_argument('--settler', choices=list(SETTLERS), help='readoff-prep: Opus settles Pro\'s (and Flash\'s) changes, Pro settles Opus\'s')
    a = ap.parse_args()
    (readoff_prep if a.cmd == 'readoff-prep' else score)(a)


if __name__ == '__main__':
    main()
