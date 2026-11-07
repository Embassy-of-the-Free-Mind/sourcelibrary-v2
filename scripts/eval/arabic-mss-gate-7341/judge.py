#!/usr/bin/env python3
# PRIOR ART: scripts/eval/mss-thinking-6544/worst-packets.py + its byeye verdicts (an Opus reviewer reading the 10
# worst pages per arm against the image, free-form) and build-keys.py's planted controls (one-character corruptions a
# span referee must catch). Neither grades EVERY read for a reader's purpose, nor with two families; #7341 needs a
# per-page usability grade that does not lean on the model key, and a catch rate for word-, line- and invention-sized
# plants, because those are the errors that make a page misleading.
"""
Image-grounded usability judgement, Arabic gate (#7341). Every read of every arm, shown to two judges from different
families with the page image and no arm name: Opus (`claude -p`, run-claude-arm.py) and Gemini 3.8 Flash low
(`agy -p`, run-cli-arm.py --kind judge). Failed reads (#6523 rules) are graded FAILED without a call.

  python3 judge.py requests   # g/judge/req-claude.jsonl, req-gemini.jsonl, items.json, plants.json
  python3 judge.py score      # g/judge/out-{claude,gemini}.jsonl -> verdict tables, judge agreement, plant catch rate

Controls: 6 reads (seeded; 3 Opus, 3 Gemini, from six manuscript books) are copied with 3 plants each: a word swapped
for another word of the same page, an invented clause inserted mid-line (taken from a read of another book), and one
line dropped. The copies are mixed in as ordinary items. A plant is caught when the judge's error list cites it.
"""
import argparse, collections, importlib.util, json, os, random, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'replicate-6547'))
from textmetrics import unwrap  # noqa: E402
from disagree import load  # noqa: E402
spec = importlib.util.spec_from_file_location('s6544', os.path.join(HERE, '..', 'mss-thinking-6544', 'score.py'))
s6544 = importlib.util.module_from_spec(spec); spec.loader.exec_module(s6544)

ARMS = {'lite': 'lite', 'f38l': 'pro', 'opus': 'opus'}
VERDICTS = ('USABLE', 'NOTICEABLE', 'MISLEADING', 'FAILED')
PROMPT = ('Below is a transcription of the Arabic page in the image, made by an automatic reader. Check it against '
          'the image, line by line, as an editor would before publishing it for readers of Arabic.\n\n'
          'List every error a reader would care about: a wrong word, a word or passage that is not on the page '
          '(invented), a word, line or passage of the page that is left out, text in the wrong script or language, '
          'repeated text. Ignore punctuation, vowel marks (ḥarakāt), hamza spelling, alef/yāʾ/tāʾ marbūṭa spelling and '
          'where the lines break.\n\nThen give ONE verdict:\n'
          'USABLE: the text matches the page; at most a few small slips that do not change what it says.\n'
          'NOTICEABLE: usable, but with misread words a reader would notice; nothing invented, no line left out.\n'
          'MISLEADING: wrong words in many places, OR any invented text, OR any line or passage left out: a reader '
          'would be misled about what the page says.\n'
          'FAILED: empty, a refusal, a loop of repeated text, the wrong script, or not a transcription of this page.\n\n'
          'Answer in exactly this format, between two marker lines <<<BEGIN>>> and <<<END>>>, nothing outside them:\n'
          '<<<BEGIN>>>\nERRORS:\n- READ: <the words as in the transcription, or (missing)> | PAGE: <what the page shows, '
          'or (not on page)> | KIND: misread|invented|skipped|wrong-script|repeated|other\n(one line per error, at most '
          '30; write "ERRORS: none" if there are none)\nSKIPPED_LINES: <number of lines of the page missing from the '
          'transcription>\nVERDICT: USABLE|NOTICEABLE|MISLEADING|FAILED\n<<<END>>>\n\n'
          '--- TRANSCRIPTION ---\n{text}\n--- END OF TRANSCRIPTION ---')


def J(root, *a):
    return os.path.join(root, 'judge', *a)


def arm_reads(S, uids):
    out = {}
    for arm, stem in ARMS.items():
        texts, fails, _ = s6544.reads('lite' if arm == 'lite' else arm, load(os.path.join(S, 'out', f'{stem}.jsonl')), uids)
        out[arm] = texts
    return out


def toks(t):
    return [w for w in re.split(r'\s+', t) if w]


def plant3(text, donor, rng):
    """(planted text, plants): a same-page word swap, an invented clause from another book's read, a dropped line."""
    lines = [l for l in text.split('\n')]
    idx = [i for i, l in enumerate(lines) if len(toks(l)) >= 5]
    if len(idx) < 4:
        return None, None
    i_sw, i_in, i_dr = rng.sample(idx[1:-1] if len(idx) > 4 else idx, 3)
    plants = []
    w = toks(lines[i_sw]); words = [x for x in toks(text) if len(re.sub(r'\W', '', x)) >= 4]
    j = rng.randrange(1, len(w) - 1)
    new = rng.choice([x for x in words if x != w[j]])
    plants.append({'kind': 'swap', 'line': i_sw, 'orig': w[j], 'planted': new, 'context': ' '.join(w[max(0, j - 2):j])})
    w[j] = new; lines[i_sw] = ' '.join(w)
    dw = toks(rng.choice([l for l in donor.split('\n') if len(toks(l)) >= 6]))
    k = rng.randrange(0, len(dw) - 4); clause = ' '.join(dw[k:k + 4])
    w = toks(lines[i_in]); j = len(w) // 2
    lines[i_in] = ' '.join(w[:j] + [clause] + w[j:])
    plants.append({'kind': 'invented', 'line': i_in, 'planted': clause})
    plants.append({'kind': 'dropped', 'line': i_dr, 'orig': lines[i_dr]})
    lines = lines[:i_dr] + lines[i_dr + 1:]
    return '\n'.join(lines), plants


def requests(root):
    S = os.path.join(root, 'setB')
    picks = json.load(open(os.path.join(S, 'draw.json')))['picks']
    uids = [p['uid'] for p in picks]; img = {p['uid']: p['image'] for p in picks}
    R = arm_reads(S, uids)
    rng = random.Random(7341)
    items = []
    for u in uids:
        for arm in ARMS:
            if u in R[arm]:
                items.append({'iid': f'{arm}|{u}', 'uid': u, 'arm': arm, 'text': R[arm][u]})
    # controls: six manuscript books, one page each, alternating Opus / Gemini reads both arms have
    ms = [p for p in picks if p['cell'] == 'ar-ms']
    books = sorted({p['book_id'] for p in ms}); rng.shuffle(books)
    plants, n = {}, 0
    for b in books:
        if n == 6:
            break
        u = rng.choice([p['uid'] for p in ms if p['book_id'] == b])
        arm = 'opus' if n % 2 == 0 else 'f38l'
        if u not in R[arm]:
            continue
        donor_u = rng.choice([x for x in R['opus'] if x.split('_')[0] != b and x in R['opus']])
        t, pl = plant3(R[arm][u], R['opus'][donor_u], rng)
        if not t:
            continue
        iid = f'plant-{arm}|{u}'
        items.append({'iid': iid, 'uid': u, 'arm': f'plant-{arm}', 'text': t})
        plants[iid] = pl; n += 1
    rng.shuffle(items)
    os.makedirs(J(root), exist_ok=True)
    json.dump(items, open(J(root, 'items.json'), 'w'), ensure_ascii=False, indent=1)
    json.dump(plants, open(J(root, 'plants.json'), 'w'), ensure_ascii=False, indent=1)
    for fam in ('claude', 'gemini'):
        with open(J(root, f'req-{fam}.jsonl'), 'w') as f:
            for it in items:
                f.write(json.dumps({'uid': it['iid'], 'image': img[it['uid']], 'prompt': PROMPT.format(text=it['text'])}, ensure_ascii=False) + '\n')
    print(len(items), 'items;', len(plants), 'planted copies; failed reads graded FAILED without a call:',
          sum(1 for u in uids for a in ARMS if u not in R[a]))


def parse(raw):
    body = unwrap(raw or '')[0] or (raw or '')
    v = re.search(r'VERDICT:\s*\**\s*(USABLE|NOTICEABLE|MISLEADING|FAILED)', body, re.I)
    sk = re.search(r'SKIPPED_LINES:\s*(\d+)', body)
    errs = []
    for m in re.finditer(r'^\s*-\s*READ:\s*(.*?)\s*\|\s*PAGE:\s*(.*?)\s*\|\s*KIND:\s*([\w-]+)', body, re.M):
        errs.append({'read': m.group(1), 'page': m.group(2), 'kind': m.group(3).lower()})
    return {'verdict': v.group(1).upper() if v else None, 'skipped': int(sk.group(1)) if sk else None, 'errors': errs}


def norm(s):
    return re.sub(r'[^\w]', '', re.sub(r'[ً-ٰٟ]', '', s or ''))


def caught(p, j):
    E = j['errors']
    if p['kind'] == 'swap':
        return any(norm(p['planted']) and norm(p['planted']) in norm(e['read']) for e in E)
    if p['kind'] == 'invented':
        w = [norm(x) for x in p['planted'].split() if len(norm(x)) >= 3]
        return any(sum(x in norm(e['read']) for x in w) >= 2 for e in E)
    w = [norm(x) for x in p['orig'].split() if len(norm(x)) >= 3]  # dropped line: cited as missing, or counted
    return any(e['kind'] == 'skipped' and sum(x in norm(e['page']) for x in w) >= 2 for e in E)


def score(root):
    S = os.path.join(root, 'setB')
    picks = json.load(open(os.path.join(S, 'draw.json')))['picks']
    uids = [p['uid'] for p in picks]; cell = {p['uid']: p['cell'] for p in picks}; book = {p['uid']: p['book_id'] for p in picks}
    items = {it['iid']: it for it in json.load(open(J(root, 'items.json')))}
    plants = json.load(open(J(root, 'plants.json')))
    R = arm_reads(S, uids)
    J_ = {}
    for fam in ('claude', 'gemini'):
        rows = load(J(root, f'out-{fam}.jsonl'))
        J_[fam] = {iid: parse((rows.get(iid) or {}).get('raw') or (rows.get(iid) or {}).get('text')) for iid in items}
    grade = collections.defaultdict(dict)  # (arm, uid) -> fam -> verdict
    for u in uids:
        for arm in ARMS:
            for fam in J_:
                grade[(arm, u)][fam] = J_[fam][f'{arm}|{u}']['verdict'] if u in R[arm] else 'FAILED'
    out = {'tables': {}, 'agreement': {}, 'plants': {}, 'unparsed': {}}
    for fam in J_:
        out['unparsed'][fam] = sum(1 for iid in items if not J_[fam][iid]['verdict'])
    for c in ('ar-ms', 'ar-print'):
        for arm in ARMS:
            for fam in list(J_) + ['worse']:
                cnt = collections.Counter()
                for u in uids:
                    if cell[u] != c:
                        continue
                    g = grade[(arm, u)]
                    if fam == 'worse':  # the stricter of the two judges' grades
                        vs = [x for x in g.values() if x]
                        v = max(vs, key=VERDICTS.index) if vs else None
                    else:
                        v = g[fam]
                    cnt[v or 'unparsed'] += 1
                out['tables'][f'{c}|{arm}|{fam}'] = dict(cnt)
    pairs = [(g['claude'], g['gemini']) for k, g in grade.items() if g.get('claude') and g.get('gemini') and k[1] in R[k[0]]]
    out['agreement'] = {'n': len(pairs), 'exact': sum(a == b for a, b in pairs),
                        'usable_vs_not': sum((a == 'USABLE') == (b == 'USABLE') for a, b in pairs),
                        'confusion': dict(collections.Counter(f'{a}/{b}' for a, b in pairs))}
    for fam in J_:
        c = collections.Counter(); per = []
        for iid, pl in plants.items():
            j = J_[fam][iid]
            for p in pl:
                ok = caught(p, j); c[(p['kind'], ok)] += 1
            orig = J_[fam].get(iid.replace('plant-', ''), {}).get('verdict')
            per.append({'iid': iid, 'planted_verdict': j['verdict'], 'original_verdict': orig, 'caught': [caught(p, j) for p in pl]})
        out['plants'][fam] = {'by_kind': {f'{k}|{"caught" if ok else "missed"}': n for (k, ok), n in c.items()},
                              'caught': sum(n for (k, ok), n in c.items() if ok), 'total': sum(c.values()), 'pages': per}
    out['per_item'] = {f'{a}|{u}': g for (a, u), g in grade.items()}
    json.dump(out, open(J(root, 'judge-scores.json'), 'w'), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in out.items() if k != 'per_item'}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('step'); ap.add_argument('--root', default=os.path.join(os.environ.get('JOB_SCRATCH', ''), 'g'))
    a = ap.parse_args()
    {'requests': lambda: requests(a.root), 'score': lambda: score(a.root)}[a.step]()
