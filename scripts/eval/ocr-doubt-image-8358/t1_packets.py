#!/usr/bin/env python3
# PRIOR ART: scripts/eval/ocr-error-to-translation-7611/judge.py (tasks of {key,image,…} for one claude -p a page) and
# scripts/eval/lib/plant-ocr-errors (planted positives for a SCREEN over stored text; here the plant goes into a read
# the judge checks, one character, so it tests the judge, not a detector). Builds the test-1 judge packets for #8358:
# each read with its doubt marks stripped (so the judge cannot tell L from D), the known error spots, and a list of
# spans to check: every marked span (D), as many random unmarked spans, and one random span with a planted
# one-character misread. Writes tasks.json and key.json; read-only.
#   python3 t1_packets.py <scratch>
import json, gzip, os, random, re, sys, unicodedata
S = sys.argv[1].rstrip('/')
HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.join(HERE, '../ocr-error-to-translation-7611/results/2026-11-02/')
N = lambda s: unicodedata.normalize('NFC', s or '')
pages = json.load(open(f'{S}/pages.json'))
spots = [json.loads(l) for l in gzip.open(R + 'spots.jsonl.gz')]
conf = [s for s in spots if s['transcription_matches_image'] is False]
err_pages = json.load(open(f'{S}/t1/error-pages.json'))
ids = json.load(open(f'{S}/t1/ids.json'))
rng = random.Random(8358)
MAX_MARKS = 15

def strip_marks(t):
    """Text without ⟦ ⟧, a list of (start, end) mark spans in the stripped text."""
    out, marks, open_at = [], [], None
    for ch in t:
        if ch == '⟦':
            if open_at is None: open_at = len(out)
            continue
        if ch == '⟧':
            if open_at is not None: marks.append((open_at, len(out))); open_at = None
            continue
        out.append(ch)
    return ''.join(out), marks

def mode(t):
    han = len(re.findall(r'[一-鿿]', t)); tib = len(re.findall(r'[ཀ-ྼ]', t))
    letters = max(1, len(re.findall(r'\w', t)))
    return 'han' if han > 0.3 * letters else 'tib' if tib > 0.3 * letters else 'alpha'

OFF_PAGE = 'vocab|script|scan-quality|page-type|language|warning|meta|note|columns|unclear|image-desc|summary|keywords'
def tag_ranges(t):
    """Tag markup, and the whole content of tags that are not words on the page (or are already a doubt signal)."""
    return [m.span() for m in re.finditer(r'<[^>]*>', t)] + [m.span() for m in re.finditer(rf'<({OFF_PAGE})>.*?</\1>', t, re.S)]

def candidates(t, m):
    if m == 'han': pat = r'[一-鿿]{2}'
    elif m == 'tib': pat = r'[ཀ-ྼ]+་[ཀ-ྼ]+'
    else: pat = r'[^\W\d_][^\s\d<>/\[\]().,;:!?·"“”‘’|=⟦⟧-]{2,}'
    tags = tag_ranges(t)
    return [mm.span() for mm in re.finditer(pat, t) if not any(a <= mm.start() < b for a, b in tags)]

SAFE = {'alpha_cons': 'mnrlbdgp', 'alpha_vow': 'aeo'}
def plant(word, t, m):
    """Change one base character of word: a clear misread, never a convention pair (u/v, i/j, s/ſ, c/t)."""
    chars = list(word)
    if m == 'han':
        pool = sorted(set(re.findall(r'[一-鿿]', t)) - set(word)); i = rng.randrange(len(chars)); chars[i] = rng.choice(pool)
    elif m == 'tib':
        pool = sorted(set(re.findall(r'[ཀ-ཀྵ]', t)))
        idx = [i for i, c in enumerate(chars) if 'ཀ' <= c <= 'ཀྵ']; i = rng.choice(idx); chars[i] = rng.choice([c for c in pool if c != chars[i]])
    else:
        idx = [i for i, c in enumerate(chars) if unicodedata.category(c) in ('Ll', 'Lo') and unicodedata.combining(c) == 0]
        i = rng.choice(idx); c = chars[i]
        if 'a' <= c <= 'z' or c in 'áéíóúàèìòùâêîôûæœ':
            chars[i] = rng.choice([x for x in (SAFE['alpha_vow'] if c in 'aeiouáéíóúàèìòùâêîôûæœ' else SAFE['alpha_cons']) if x != c])
        else:
            pool = sorted({x for x in t if unicodedata.category(x) == unicodedata.category(c) and unicodedata.name(x, '').split()[0] == unicodedata.name(c, '').split()[0] and x != c and x not in 'ויוֹ'})
            if not pool: return None
            chars[i] = rng.choice(pool)
    return ''.join(chars)

def ctx(t, a, b, w=30):
    return (t[max(0, a - w):a] + '»' + t[a:b] + '«' + t[b:b + w]).replace('\n', ' ⏎ ')

tasks, key = [], []
for arm in ('L', 'D'):
    for pid in ids:
        if arm == 'L' and pid not in err_pages: continue  # L on no-error pages adds nothing the decision uses
        f = f'{S}/t1/{arm}/{pid}.json'
        if not os.path.exists(f): print('missing', arm, pid); continue
        r = json.load(open(f)); text, marks = strip_marks(N(r['text']))
        m = mode(text)
        sp = [s for s in conf if s['page_id'] == pid]
        uniq = sp  # all confirmed spots, duplicates included, so the counts stay the #7611 109
        avoid = [N(u['image_reading']) for u in uniq] + [N(u['quote']) for u in uniq]
        cands = [c for c in candidates(text, m) if not any(a < c[1] and c[0] < b for a, b in marks) and not any(text[c[0]:c[1]] in x for x in avoid)]
        mk = marks if len(marks) <= MAX_MARKS else sorted(rng.sample(marks, MAX_MARKS))
        nrand = max(0, min(max(3, len(mk)), len(cands) - 1))
        picks = rng.sample(cands, nrand + 1) if cands else []
        planted_span = picks[0] if picks else None; rand_spans = picks[1:]
        word = text[planted_span[0]:planted_span[1]] if picks else ''; pw = plant(word, text, m) if picks else None
        if not picks: print('no candidate spans on', arm, pid)
        jtext = text
        items = [('mark', a, b) for a, b in mk] + [('random', a, b) for a, b in rand_spans]
        if pw:
            jtext = text[:planted_span[0]] + pw + text[planted_span[1]:]
            delta = len(pw) - len(word)
            assert delta == 0
            items.append(('planted', planted_span[0], planted_span[1]))
        rng.shuffle(items)
        spans = [{'n': i + 1, 'kind': k, 'start': a, 'end': b, 'text': jtext[a:b], 'shown': ctx(jtext, a, b)} for i, (k, a, b) in enumerate(items)]
        k = f'{arm}-{pid}'
        tasks.append({'key': k, 'image': pages[pid]['image_file'], 'transcription': jtext,
            'spots': [f"{i+1}. The page reads here: {u['image_reading']}\n   Another transcription once read it as: {u['quote']}" for i, u in enumerate(uniq)],
            'spans': [f"{s['n']}. …{s['shown']}…" for s in spans]})
        key.append({'key': k, 'arm': arm, 'page_id': pid, 'mode': m, 'text': text, 'marks': marks, 'marks_checked': mk, 'planted': {'orig': word, 'planted': pw} if pw else None,
            'spots': [{'n': i + 1, 'quote': u['quote'], 'image_reading': u['image_reading'], 'outcome_7611': u['outcome'], 'stratum': u['stratum'], 'class': u['class']} for i, u in enumerate(uniq)],
            'spans': spans})
json.dump(tasks, open(f'{S}/t1/judge-tasks.json', 'w'), ensure_ascii=False)
json.dump(key, open(f'{S}/t1/judge-key.json', 'w'), ensure_ascii=False)
print(len(tasks), 'packets;', sum(len(k['spots']) for k in key if k['arm'] == 'D'), 'D spots;', sum(1 for k in key if k['planted']), 'planted')
