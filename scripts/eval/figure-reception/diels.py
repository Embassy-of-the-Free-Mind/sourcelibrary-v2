# What Diels collected and what he did not: tag every passage naming a figure with the Diels entry it retells (#7073).
# Usage: python3 scripts/eval/figure-reception/diels.py <figure> [--read N]   → <out>/diels.json
#
# PRIOR ART: scripts/eval/fragment-sort/build-reference.mjs (#7065) parses the same Diels 1912 chapters from the
# German/Greek OCR to match ORIGINAL-language attributions in pre-1700 books. The passages here are English (the
# library's translations, as the theme map, trees and Told once list read them), so this segments the ENGLISH
# translation of the same pages and compares by meaning (nomic-embed-text, local ollama, free) in the space
# passages.py already embeds them in. Chapter concordance (1912 ch. 32 = DK 44, 35 = DK 47) is #7065's.
#
# Source: Diels, Die Fragmente der Vorsokratiker, 3rd ed. 1912 (book 6a3f0220661123baf6fe9d4e); figures.json `diels`
# gives each figure's chapters. Entries are the numbered items ("N." at the start of a line) under the chapter's
# section letters (A testimonia, B fragments; ch. 45 has A–E). Diels's own headings decide the kind: a B entry under
# ZWEIFELHAFTES / DOUBTFUL is doubtful, under GEFÄLSCHTES / FORGERIES / SPURIOUS spurious. A page's repeated
# rendering of an entry (Diels prints the Greek, then his German) is added to the same entry. Four pages have no
# OCR (52, 53, 338, 340); HAND below gives the entries on them, read by eye from the page images on 2026-10-22.
#
# Matching: each entry is cut into windows of one and of two sentences; a passage's similarity to an entry is its best
# window. Score = best entry minus the passage's median over all entries: every passage naming him sits close to every
# entry naming him (the name and the subject carry much of the vector), so the raw best is flat, and what marks a
# retelling is one entry standing out. figures.json `dielsMatch.in` = [margin, raw] a passage needs to be tagged.
# Read on 2026-10-22 (--read and samples by band, judged by Claude against the entry text):
#   Philolaus, Archytas: margin >= 0.15 16/16 right entry or right subject; 0.12-0.15 14/16 (misses: Philolaus the
#   Cynthian in Philostratus, Boeckh on Archytas's genuine pieces); 0.09-0.12 about half; below, mostly passing
#   mentions and Reuchlin's speaker. Tag at 0.12 (about 9 in 10 right).
#   Pythagoras (124 entries, many broad): margin >= 0.16 with raw >= 0.88 6/9, 0.13-0.16 2/10; margin >= 0.18 with
#   raw >= 0.90 15/16. Tag there. Recall is low on purpose: a passage naming the dove of Archytas among other marvels
#   scores 0.07, so "not tagged" does not mean "not in Diels"; Outside Diels therefore goes to a reader (below).
# Only claims are tagged (passages.py `claim`): lists of names and headings passed the bar otherwise. A passage that
# closely retells a tagged one (`dielsMatch.hop`) takes its tag, one hop: read 2026-10-22, Pythagoras at 0.88 about
# half right, at 0.92 12/14; Philolaus and Archytas at 0.88 17/18 retell their source (wrong only where the source
# was, which `dielsOverrides` "none" now untags). Without the hop the anger story, Diels A 7, read as three-quarters
# outside Diels.
#
# Output diels.json: {edition, book, chapters: [[1912 ch., DK ch.]], threshold, entries: [[label, kind, page, source,
# gist, passages, works, earliest]], tags: {passage key: [entry index, similarity %]}, themes: {map theme: [passages
# in Diels, passages]}, outside: [[authors, theme, gist, year, book id, page, passage, title, [[year, book id, page,
# title]...], edition year when the year is the author's (else null)]]}. Passage key = passages.py passage_key.
# Passages in Diels's own volumes are not counted.
import collections, json, os, re, sys
import numpy as np
from passages import HERE as HERE_DIR, REPO, figure, load_rows, embed_rows, embed, passage_key

DIELS = '6a3f0220661123baf6fe9d4e'
OWN = {DIELS, '69e8b21f2ff2a8dc09e768ea', '69ae66d04b74f168e0c15412'}  # Diels 1912, 1906, Wortindex 1954
SAME = 0.84  # rare.py's RARE: candidate groups are formed at this bar
RETELL = 0.88  # tree.py's bar for one telling hanging from another: a group's authors are counted at this bar
KEY = sys.argv[1]
READ = int(sys.argv[sys.argv.index('--read') + 1]) if '--read' in sys.argv else 0
F, W = figure(KEY)
T = F['dielsMatch']  # {in: [margin, raw], hop: similarity, judgeTop: n}

# Entries on pages with no OCR, read from the images (English gist of the Greek/Latin, by eye).
HAND = {
    32: [('B', '18', 338, 'Stobaeus I 25, 8', 'From Philolaus, the Bacchae: the quotation on the sun is lost.'),
         ('B', '19', 338, 'Proclus, Commentary on Euclid p. 22, 9', 'Plato teaches many wonderful doctrines about the gods through mathematical forms, and the philosophy of the Pythagoreans hides its mystical teaching about the gods behind these veils; so do the Sacred Discourse, Philolaus in the Bacchae, and the whole manner of Pythagoras\'s teaching about the gods.')],
    4: [('A', '10', 52, 'Plato, Republic X 600 A; Diogenes Laertius VIII 45-46', 'Pythagoras was loved for a way of life he handed down, and his followers still call it the Pythagorean way of life. He flourished in the sixtieth Olympiad and his school lasted nine or ten generations; the last Pythagoreans, whom Aristoxenus saw, were Xenophilus, Phanton, Echecrates, Diocles and Polymnastus, hearers of Philolaus and Eurytus.'),
        ('A', '11', 52, 'Hippolytus, Refutation I 2, 12', 'Diodorus of Eretria and Aristoxenus the musician say that Pythagoras went to Zaratas the Chaldaean (Zoroaster).'),
        ('A', '12', 52, 'Diogenes Laertius VIII 14; Porphyry, Life of Pythagoras 22', 'Pythagoras was the first to bring measures and weights to the Greeks, as Aristoxenus says; Lucanians, Messapians, Peucetians and Romans came to him.'),
        ('A', '13', 53, 'Porphyry, Life of Pythagoras 4; Justin XX 4', 'Timaeus says that the daughter of Pythagoras led the maidens of Croton and later the women; the Crotoniates made his house a temple of Demeter and called the lane the Museum. After twenty years at Croton Pythagoras moved to Metapontum and died there, so admired that they made his house a temple.'),
        ('A', '14', 53, 'Diodorus XII 9, 2 ff.', 'Telys of Sybaris persuaded the Sybarites to exile five hundred of their richest citizens; the exiles fled to the altars at Croton; Pythagoras advised the Crotoniates to save the suppliants, and Milo, crowned with his Olympic crowns and dressed as Heracles with lion skin and club, led them to victory and Sybaris was destroyed.'),
        ('A', '15', 53, 'Diogenes Laertius II 46', 'Aristotle says that Cylon and Onatas were rivals of Pythagoras, as Antilochus was of Socrates.'),
        ('A', '16', 53, 'Iamblichus, Life of Pythagoras 248 ff.', 'All agree that the plot against Pythagoras took place while he was away; they differ about where he had gone.')],
}
# Text on the no-OCR pages that continues an entry begun on the page before (added to that entry), and pages that
# open in the middle of an entry whose number was printed on the missing page.
CONTINUES = {
    (4, 'A', '9'): 'He sacrificed only lifeless offerings, or cocks and sucking kids, never lambs; Aristoxenus says he ate every other animal and abstained only from the ploughing ox and the ram. Gellius: the old false opinion that Pythagoras ate no animals and abstained from beans; Aristoxenus says he ate beans more than any other pulse, and young pigs and kids. Aristotle says the Pythagoreans abstain from the womb, the heart and the sea-nettle.',
    (32, 'B', '21'): 'One part of the world is unchanging, from the world-soul that encloses the whole down to the moon, and one changing, from the moon to the earth. So he said the world is the eternal activity of god and of becoming; the one remains forever the same, while the things that come to be and perish are many, and they keep their forms and restore by generation the same form as the father and maker who begot them.',
}
FORCED = {32: {339: ('B', '20')}}
# A numbered list printed inside one entry: its items become sub-entries ("45 C 6.37" = symbol 37 of C 6), until the
# section changes. Iamblichus, Protrepticus 21, the thirty-nine Pythagorean symbols.
SUBLIST = {45: re.compile(r'Let these be the Symbols')}

# --- Segment the chapters -------------------------------------------------------------------------------------
STRIP = re.compile(r'<(note|margin|meta|header|insert|gloss)\b[^>]*>(?:[^<]|<(?!/?\1\b))*?</\1>', re.S)
NUM = re.compile(r'^(?:#+ )?(?:\*\*)?(\d{1,2})([a-zᵃᵇ]?)\.(?:\*\*)?\s')
SECTION = re.compile(r'^#+ ([A-E])\.\s')
KIND = [(re.compile(r'GEFÄLSCHT|FORGER|SPURIOUS|UNECHT', re.I), 'spurious'), (re.compile(r'ZWEIFELHAFT|DOUBTFUL', re.I), 'doubtful')]
book = {}
for l in open(os.path.expanduser(f'~/sl-corpus/books/{DIELS}.jsonl')):
    d = json.loads(l)
    book[d['p']] = d.get('tr') or ''

entries, index = [], {}


def clean(t):
    for _ in range(3):  # nested notes
        t = STRIP.sub(' ', t)
    return re.sub(r'</?[a-z][^<>\n]*>', ' ', t)  # tags only: "-> DOCTRINE. <-" is a centred heading, not a tag


for C in F['diels']:
    ch, start, end = C['ch'], re.compile(C['start']), re.compile(C['end'])
    on, section, kind, cur, sub = False, 'A', None, None, None
    hand = {p: [h for h in HAND.get(ch, []) if h[2] == p] for p in range(C['pages'][0], C['pages'][1] + 1)}

    def new(sec, n, page, text=''):
        k = (ch, sec, n)
        if k not in index:
            index[k] = len(entries)
            entries.append({'ch': ch, 'dk': C['dk'], 'sec': sec, 'n': n, 'label': f'{ch} {sec} {n}', 'page': page,
                            'kind': 'testimony' if sec != 'B' else (kind or 'fragment'), 'text': text})
        return entries[index[k]]

    for page in range(C['pages'][0], C['pages'][1] + 1):
        if cur and (ch, section, cur['n']) in CONTINUES and not book.get(page):
            cur['text'] += CONTINUES[(ch, section, cur['n'])] + '\n'
        for sec, n, _, cite, gist in hand[page]:
            cur = new(sec, n, page, f'**{cite}**: {gist}\n')
            section = sec
        if not book.get(page):
            continue
        if page in FORCED.get(ch, {}):
            section, n = FORCED[ch][page]
            cur = new(section, n, page)
        for line in clean(book[page]).split('\n'):
            s = line.strip()
            if not on:
                on = bool(start.search(s))
                continue
            if end.search(s):
                on = False
                break
            if s == '---' or s.startswith('|'):
                continue
            m = SECTION.match(s)
            if m and m.group(1) != section:
                section, kind, cur, sub = m.group(1), None, None, None
            m = NUM.match(s)
            if s.startswith('#') and not m:  # a heading; "### 3. HORACE, Odes I 28" is an entry
                kind = next((k for r, k in KIND if r.search(s)), kind)
                continue
            if m:
                n = m.group(1) + m.group(2).replace('ᵃ', 'a').replace('ᵇ', 'b')
                if sub:
                    n = f"{sub['n']}.{n}"
                    cur = new(section, n, page)
                    cur['text'] += s + '\n'
                    continue
                last = int(re.match(r'\d+', cur['n']).group()) if cur and cur['sec'] == section else 0
                if (ch, section, n) in index:  # the same entry again (Diels's translation block)
                    cur = entries[index[(ch, section, n)]]
                elif last <= int(m.group(1)) <= last + 3:
                    cur = new(section, n, page)
            if cur is not None:
                cur['text'] += s + '\n'
            if cur and SUBLIST.get(ch) and SUBLIST[ch].search(s):
                sub = cur
missing = [(e['label']) for e in entries if len(e['text']) < 40]
print(f'{KEY}: {len(entries)} Diels entries', ', '.join(e['label'] for e in entries), file=sys.stderr)
if missing:
    print('  nearly empty:', missing, file=sys.stderr)

CITE = re.compile(r'^(?:\*\*(.+?)\*\*\s*([^:]{0,80}?)|([A-Z\[][^:.]{2,60}?[,*] [^:]{0,60}?\d+[a-z]?(?: ?[A-F]\b)?))\s?[:.]\s+')
for e in entries:
    t = re.sub(r'\s+', ' ', re.sub(r'^(?:#+ )?(?:\*\*)?\d{1,2}[a-z]?\.(?:\*\*)?\s*', '', e['text'].strip())).strip()
    m = CITE.match(t)
    e['source'] = re.sub(r'\b[A-ZË]{3,}\b', lambda w: w.group().capitalize(), re.sub(r'[*_]|\s+$', '', ' '.join(x for x in m.groups() if x))) if m else ''
    if '.' in e['n'] and not e['source']:
        e['source'] = 'Iamblichus, Protrepticus 21 (symbol ' + e['n'].split('.')[1] + ')'
    body = re.sub(r'[*_]|-> | <-|^> ', '', t[m.end():] if m else t)
    e['gist'] = body[:220]
    sents = [x for x in re.split(r'(?<=[.;:?!"”])\s+', re.sub(r'[*_#>]|->|<-', '', body)) if len(x) > 3]
    # single sentences (a quotation on its own) and pairs (a claim with its context)
    e['windows'] = [x for x in sents if len(x) >= 40] + [' '.join(sents[i:i + 2]) for i in range(0, max(1, len(sents) - 1))] or [body]

# --- Embed and match ------------------------------------------------------------------------------------------
win, owner = [], []
for i, e in enumerate(entries):
    for w in e['windows']:
        win.append(w[:600])
        owner.append(i)
WE = np.concatenate([embed(win[i:i + 64]) for i in range(0, len(win), 64)])
owner = np.array(owner)

rows, _ = load_rows(KEY)
E = embed_rows(KEY, rows)
# The theme map's reported sayings, with their own embeddings (map.py / extend.py), so every map point gets a tag.
pts = json.load(open(os.path.join(W, 'map-points.json')))['points']
ME = np.load(os.path.join(W, 'emb.npy'))
assert len(ME) == len(pts)


def best(V):
    S = V @ WE.T
    out = np.full((len(V), len(entries)), -1.0, np.float32)
    for j in range(len(entries)):
        out[:, j] = S[:, owner == j].max(1)
    return out


SR, SM = best(E), best(ME)
def score(s):
    return float(s.max() - np.median(s)), float(s.max())


tags = {}
for r, s in zip(rows, SR):
    tags[passage_key(r['id'], r['p'], r['s'])] = (int(s.argmax()), *score(s), r)
for p, s in zip(pts, SM):
    k = passage_key(p['id'], p['p'], p['s'])
    if k not in tags:
        tags[k] = (int(s.argmax()), *score(s), {'id': p['id'], 'p': p['p'], 's': p['s'], 't': p.get('t') or '', 'y': p.get('yr'), 'claim': True})

if READ:  # print pairs in score bands, to choose the thresholds by reading
    rng = np.random.default_rng(7)
    items = [(v[1], v[0], v[3], v[2]) for v in tags.values() if v[3]['id'] not in OWN]
    print('scores', np.percentile([x[0] for x in items], [10, 25, 50, 75, 90, 95, 99]).round(3), file=sys.stderr)
    for lo in (0.16, 0.13, 0.11, 0.09, 0.07, 0.05):
        band = [x for x in items if lo <= x[0] < (lo + 0.02 if lo < 0.16 else 1)]
        print(f'\n===== margin {lo:.2f}+: {len(band)} passages', file=sys.stderr)
        for k in rng.choice(len(band), min(READ, len(band)), replace=False) if band else []:
            sc, j, r, raw = band[k]
            e = entries[j]
            print(f"{sc:.3f}/{raw:.2f} {e['label']:9} [{e['source'][:30]}] {e['gist'][:140]}\n      ← {r['t'][:30]} p{r['p']} | {r['s'][:240]}", file=sys.stderr)
    sys.exit(0)

# --- Publish ----------------------------------------------------------------------------------------------------
passes = lambda v, t: v[1] >= t[0] and v[2] >= t[1]
# Only a claim about him (a reported saying, or his name with a verb of saying or attributing: passages.py) can retell
# an entry. On 2026-10-22 lists of names and headings ("FROM HIPPARCHUS THE PYTHAGOREAN, On Tranquillity") passed the
# similarity bar and then lent their tags to their neighbours.
# figures.json `dielsOverrides` with to = "none" untag a passage the measure put under the wrong entry (see below).
UNTAG = {k for k, v in F.get('dielsOverrides', {}).items() if v['to'] == 'none'}
tagged = {k: v for k, v in tags.items() if v[3]['id'] not in OWN and v[3].get('claim') and passes(v, T['in'])
          and f"{v[3]['id']}:{v[3]['p']}" not in UNTAG}
per = collections.defaultdict(list)
for v in tagged.values():
    per[v[0]].append(v[3])
for j, e in enumerate(entries):
    ys = [r['y'] for r in per[j] if r.get('y') is not None]
    e['out'] = [e['label'], e['kind'], e['page'], e['source'][:90], e['gist'][:200], len(per[j]),
                len({r['id'] for r in per[j]}), min(ys) if ys else None]

# One hop of retelling: a passage at figures.json `dielsMatch.hop` to a tagged passage retells the same entry, so it
# takes that tag (read on 2026-10-22: see the header). The tags above are strict (a list of marvels naming the dove scores 0.07), and without this the anger
# story, which is Diels A 7, read as three-quarters outside Diels. One hop only, so tags do not chain.
def inherit(V, items):
    src = [(k, v) for k, v in tagged.items() if 'hop' not in v[3]]
    if not src:
        return
    vec = {pk(i): E[i] for i in range(len(rows))}
    vec.update({passage_key(p['id'], p['p'], p['s']): ME[n] for n, p in enumerate(pts)})
    S = np.stack([vec[k] for k, _ in src])
    for (k, r), v in zip(items, V):
        if k in tagged or r['id'] in OWN or not r.get('claim', True):
            continue
        sim = S @ v
        j = int(sim.argmax())
        if sim[j] >= T['hop']:
            e = src[j][1][0]
            tagged[k] = (e, 0.0, float(sim[j]), {**r, 'hop': src[j][0]})


pk = lambda i: passage_key(rows[i]['id'], rows[i]['p'], rows[i]['s'])
inherit(np.concatenate([E, ME]), [(pk(i), rows[i]) for i in range(len(rows))] +
        [(passage_key(p['id'], p['p'], p['s']), {'id': p['id'], 'p': p['p'], 's': p['s'], 't': p.get('t') or '', 'y': p.get('yr')}) for p in pts])
print(f"{sum('hop' in v[3] for v in tagged.values())} passages inherit a tag by retelling", file=sys.stderr)

# Share of each map theme in Diels: published map.json rows (pages > 0), as prep-map.py writes them.
mp = json.load(open(os.path.join(REPO, F['out'], 'map.json')))
th = collections.defaultdict(lambda: [0, 0])
for row in mp['rows']:
    k = passage_key(row[4], row[5], row[6])
    th[row[2]][1] += 1
    th[row[2]][0] += k in tagged
theme_of = {passage_key(row[4], row[5], row[6]): row[2] for row in mp['rows']}

# Outside Diels: claims about him that several authors repeat and that retell no Diels entry. Claims are grouped
# greedily (earliest first) at SAME, the bar at which rare.py treats two passages as the same claim. The embedding
# cannot decide the rest: on 2026-10-22 the true outside claims (Olympiodorus's temple rule, Proclus's three
# demiurges) scored the same margins as loose retellings of B 20 and B 8. So groups that two or more authors make and
# that no member tags (above) go to a reader: `--judge` asks Claude (claude -p, subscription, Opus), 40 groups per
# call, which entry of the chapter each retells, or none, and whether it is a claim about him at all (a name in a
# list is not). Opus, not Sonnet: on Philolaus Sonnet answered "none" for A 29 (reason, not the senses, is the
# criterion) and for B 6 (the names of the strings) when the entry was in the prompt; a "none" here becomes a public
# "not in Diels". Verdicts are kept in verdicts/<figure>.json (committed), keyed by the judged passage; members of a group
# judged to an entry are tagged with it too. Told once covers the claims only one author makes.
ci = [i for i, r in enumerate(rows) if r['claim'] and r['id'] not in OWN]
ci.sort(key=lambda i: (rows[i]['y'] is None, rows[i]['y'] or 0))
CE = E[ci]
group = np.full(len(ci), -1)
for n in range(len(ci)):
    if group[n] < 0:
        group[n] = n
        free = group[n + 1:] < 0
        group[n + 1:][free & (CE[n + 1:] @ CE[n] >= SAME)] = n
members = collections.defaultdict(list)
for n, g in enumerate(group):
    members[g].append(ci[n])
# A passage with a figures.json note (Boulliau's own Philolaus of 1639, the Illuminati's code names) is about
# something else and stays out.
cands = [[i for i in ms if rows[i]['note'] < 0] for ms in members.values()]
cands = [ms for ms in cands if len({rows[i]['a'] for i in ms}) >= 2 and not any(pk(i) in tagged for i in ms)]
cands.sort(key=lambda ms: -len({rows[i]['a'] for i in ms}))
cands = cands[:T.get('judgeTop', 200)]

vfile = os.path.join(HERE_DIR, 'verdicts', KEY + '.json')  # committed: the reader's verdicts are work, not cache
verdicts = json.load(open(vfile)) if os.path.exists(vfile) else {}
labels = {e['label'] for e in entries}


def judged(ms):  # the member the reader judged; any member counts, so a regrouped group (a new date) keeps its verdict
    return next((i for i in ms if pk(i) in verdicts), None)


def verdict(ms):
    i = judged(ms)
    return None if i is None else verdicts[pk(i)]


if '--judge' in sys.argv:
    import subprocess
    todo = [ms for ms in cands if verdict(ms) is None]
    chapter = '\n'.join(f"{e['label']} [{e['kind']}] {e['source'][:60]}: {re.sub(r'[*_#>]|->|<-', '', re.sub(r'\s+', ' ', e['text']))[:900]}" for e in entries)
    for n in range(0, len(todo), 40):
        batch = todo[n:n + 40]
        items = '\n\n'.join(f"#{k} ({len({rows[i]['a'] for i in ms})} authors)\n" + '\n'.join(f"- {rows[i]['t'][:50]} ({rows[i]['y']}): {rows[i]['s'][:300]}" for i in ms[:3]) for k, ms in enumerate(batch))
        prompt = f"""You are checking passages about {F['name'].split('|')[0].capitalize()} against Diels, Fragmente der Vorsokratiker (1912). Below is every numbered entry Diels collected for him (label, kind, source, text; an entry covers everything it quotes or refers to), then numbered groups of passages from later books that repeat one claim.

For each group decide:
- claim: true if the passages say something ABOUT him (what he said, taught, did, wrote, or what happened to him, or what is attributed to him); false if he is only named in a list, as a book title, as a date marker, as an editor's citation or note, in modern scholarship about how his fragments were transmitted or whether they are genuine, or if the passages are about someone else of the same name.
- entry: the label of the Diels entry the claim retells or reports (same content, even if worded differently, in another language, or from a different ancient source), or null if no entry contains it. Read each entry in full before answering null. Content only loosely related (same topic, different claim) is null.
- gist: the claim in at most 12 plain English words.

Diels entries:
{chapter}

Groups:
{items}

Answer with only a JSON array, one object per group: {{"g": <group number>, "claim": true|false, "entry": "<label>"|null, "gist": "..."}}"""
        out = subprocess.run(['claude', '-p', '--model', 'opus'], input=prompt, capture_output=True, text=True, timeout=900).stdout
        try:
            got = json.loads(out[out.index('['):out.rindex(']') + 1])
        except ValueError:
            print('unparsed judge output:', out[:300], file=sys.stderr)
            continue
        for v in got:
            if isinstance(v, dict) and isinstance(v.get('g'), int) and 0 <= v['g'] < len(batch):
                if v.get('entry') not in labels:
                    v['entry'] = None if not v.get('entry') else v['entry'] + '?'
                verdicts[pk(batch[v['g']][0])] = {'claim': bool(v.get('claim')), 'entry': v.get('entry'), 'gist': (v.get('gist') or '')[:120]}
        json.dump(verdicts, open(vfile, 'w'), ensure_ascii=False, indent=0)
        print(f'judged {min(n + 40, len(todo))}/{len(todo)}', file=sys.stderr)

by_label = {e['label']: j for j, e in enumerate(entries)}
outside, unjudged = [], 0
# figures.json `dielsOverrides`: "<book id>:<page>" of any passage in a group → an entry label the reader missed,
# "elsewhere" for a claim Diels prints in another chapter, or "drop" for a group that mixes unrelated claims; each
# with its reason in `why`. ("none", above, untags a passage before any of this.)
OVR = {k: v['to'] for k, v in F.get('dielsOverrides', {}).items()}
for ms in cands:
    v = verdict(ms)
    o = next((OVR[f"{rows[i]['id']}:{rows[i]['p']}"] for i in ms if f"{rows[i]['id']}:{rows[i]['p']}" in OVR), None)
    if o and v:
        v = {**v, 'entry': o} if o in labels else {**v, 'entry': o, 'claim': o != 'drop'}
    if v is None:
        unjudged += 1
        continue
    if v['entry'] in by_label:  # judged a retelling: tag its members
        j = by_label[v['entry']]
        lead = judged(ms)
        for i in (i for i in ms if E[i] @ E[lead] >= RETELL and rows[i]['claim']):  # not the whole greedy group: it chains
            tagged.setdefault(pk(i), (j, float(SR[i][j] - np.median(SR[i])), float(SR[i][j]), rows[i]))
        continue
    if not v['claim'] or v['entry']:  # not a claim, or an entry label the reader made up ("…?"): leave it out
        continue
    # Show the passage the reader judged, so the gist describes the passage shown; the others follow in date order.
    # Counted and listed: only passages at RETELL to it. A greedy group chains neighbours, and on Pythagoras 0.84 joins
    # passages on the same broad topic (the One above intellect; the soul) rather than the same claim.
    lead = judged(ms)
    r0, seen_a, others = rows[lead], {rows[lead]['a']}, []
    for i in (i for i in ms if E[i] @ E[lead] >= RETELL):
        if rows[i]['a'] not in seen_a:
            seen_a.add(rows[i]['a'])
            others.append([rows[i]['y'], rows[i]['id'], rows[i]['p'], rows[i]['t'][:70]])
    ed = r0['ey'] if r0['ey'] != r0['y'] else None
    themes = collections.Counter(theme_of[pk(i)] for i in ms if pk(i) in theme_of)
    if len(seen_a) < 2:
        continue
    outside.append([len(seen_a), themes.most_common(1)[0][0] if themes else -1, v['gist'], r0['y'], r0['id'], r0['p'], r0['s'][:320], r0['t'][:80], others[:8], ed])
if unjudged:
    print(f'{unjudged} candidate groups have no verdict yet: run with --judge', file=sys.stderr)

# Recount entries and themes with the judged tags included.
per = collections.defaultdict(list)
for v in tagged.values():
    per[v[0]].append(v[3])
for j, e in enumerate(entries):
    ys = [r['y'] for r in per[j] if r.get('y') is not None]
    e['out'][5:] = [len(per[j]), len({r['id'] for r in per[j]}), min(ys) if ys else None]
th = collections.defaultdict(lambda: [0, 0])
for k, c in theme_of.items():
    th[c][1] += 1
    th[c][0] += k in tagged
outside.sort(key=lambda o: (-o[0], o[3] is None, o[3] or 0))

OUT = os.path.join(REPO, F['out'], 'diels.json')
json.dump({'edition': 'Diels, Die Fragmente der Vorsokratiker, 3rd ed. 1912', 'book': DIELS,
           'chapters': [[c['ch'], c['dk']] for c in F['diels']], 'threshold': T,
           'entries': [e['out'] for e in entries],
           'tags': {k: [v[0], round(v[2] * 100)] for k, v in sorted(tagged.items())},
           'themes': {str(c): v for c, v in sorted(th.items())}, 'outside': outside[:60]},
          open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
inmap = sum(v[0] for v in th.values()), sum(v[1] for v in th.values())
print(f'{KEY}: {len(tagged)} passages tagged to {sum(1 for j in per if per[j])} of {len(entries)} entries; map {inmap[0]}/{inmap[1]} in Diels; '
      f'{len(outside)} repeated claims outside Diels (of {len(cands)} judged groups) → {OUT} ({os.path.getsize(OUT)} bytes)', file=sys.stderr)
for o in outside[:int(os.environ.get('SHOW', 0))]:
    print(f"{o[0]:3d} th{o[1]:5} {o[3]} {o[7][:24]:24} p{o[5]} [{o[2]}] | {o[6][:200]}", file=sys.stderr)
