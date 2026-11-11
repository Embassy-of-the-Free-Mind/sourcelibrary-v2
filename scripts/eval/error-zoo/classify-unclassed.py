#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/error-zoo/zoo.py — counts only findings that already carry a taxonomy code and reports the
rest as "unclassed" (59% of the first pass). scripts/lib/review-vocabulary.mjs kindOfClass() — maps a CLASS to a
KIND, not a free-text finding to a class. Nothing in scripts/eval/lib classifies a reader's prose finding against
.claude/docs/page-error-taxonomy.md; this does, cheaply: legacy strings first, keyword rules second, a small model
(claude -p, haiku, the job's own quota) only for what is left, and a 30-item by-eye spot check of the result.

classify-unclassed.py rules <dir>     labels.jsonl -> <dir>/classes/{rules.jsonl, batches/NNN.json}
classify-unclassed.py merge <dir>     + batches/NNN.out.json -> <dir>/classes/classes.jsonl, spotcheck.md, summary
Run the model pass between them:  for f in <dir>/classes/batches/*.json; do ... claude -p --model haiku ...; done
(see run-batches.sh next to this file).
"""
import json, re, sys, os, random, collections as C

MODE, DIR = sys.argv[1], sys.argv[2]
CD = f'{DIR}/classes'; os.makedirs(f'{CD}/batches', exist_ok=True)
TAX = open(os.path.join(os.path.dirname(__file__), '../../../.claude/docs/page-error-taxonomy.md')).read()
DEFS = {m.group(1): m.group(2).strip() for m in re.finditer(r'^### ([IOTDE]\d+) · (.+?)(?: — .*)?$', TAX, re.M)}
CODE = re.compile(r'\b([IOTDE]\d{1,2})\b')

LEGACY = {'ocr-misread': 'O6', 'ocr-unsettled': 'O6', 'wrong_leaf': 'I1', 'ocr-wrong-leaf': 'I1', 'other:translation-not-of-page': 'T14', 'other:translation not of this text': 'T14',
          'other:mistranslation': 'T8', 'other:lexical mistranslation': 'T8', 'other:lexical mistranslation with correct OCR': 'T8', 'other:column-interleave': 'O9', 'other:name-mistranslated': 'T8',
          'other:ditto-mark read as 一': 'O6', 'other:misattributed citation': 'T10', 'other:ditto-mark-rendered-as-lacuna': 'O6', 'other:technical term mistranslated': 'T8', 'other:name substituted': 'O6',
          'other:headword-citation shift': 'O9', 'other:substance-misidentified': 'T8', 'other:wrong-word-sense': 'T8', 'other:misconstrued syntax': 'T8', 'other:grammar-misconstrued': 'T8',
          'other:column reading order': 'O9', 'other:fabricated bridge': 'T5', 'other:index entry substituted': 'O6', 'other:pasted slip read as page text': 'O13', 'other:legible-lines-collapsed-to-letter-garble': 'O1'}

# (stage filter or None, regex, class) — first hit wins; order matters: specific before general
RULES = [
    (None, r'wrong[ -]leaf|not (on|of) this (leaf|page)|different (leaf|page)|one leaf (behind|ahead|away)|facing page|image and text are not', 'I1'),
    ('ocr', r'catchword', 'O11'), ('translation', r'catchword', 'T6'),
    (None, r'running[ -]head|signature mark|<sig>|page furniture|folio number|page[ -]num', 'O11'),
    ('ocr', r'footnote|marginal|margin(alia)?|side[ -]?note|apparatus|gloss(es)? (dropped|merged|lost)', 'O12'), ('translation', r'footnote|marginal|margin(alia)?|apparatus (is |are )?(dropped|stripped|lost|missing)', 'T13'),
    ('ocr', r'ditto', 'O6'),
    ('ocr', r'abbreviation|expanded|expansion|contraction|suspension|normali[sz]|moderni[sz]|spelling|long[ -]s\b|ligature|umlaut|diacritic|accent|orthograph|u/v|i/j|ampersand|tironian', 'O8'),
    ('ocr', r'number|numeral|date|digit|\b1[0-9]{3}\b|folio', 'O7'),
    ('ocr', r'dropped|omitted|omission|missing|not transcribed|left out|skipped|cut off|truncat|is lost', 'O5'),
    ('ocr', r'repeated|duplicat|twice|loop', 'O4'),
    ('ocr', r'reading order|column|interleav|order of|transposed|line break|hyphen|split (word|across)|run (into|together)|merged into|broken across', 'O9'),
    ('ocr', r'table|row|cell', 'O17'),
    ('ocr', r'image[- ]desc|described|woodcut|diagram|figure|illustration|plate', 'O14'),
    ('ocr', r'handwritten|manuscript note|later hand|annotation|stamp|pencil', 'O13'),
    ('ocr', r'invent|fabricat|not on the (leaf|page)|hallucin|made up|no basis', 'O1'),
    ('ocr', r'script|language tag|wrong language|<language>|<script>|page-type', 'O16'),
    ('ocr', r'misread|read as|— image|wrong (letter|word)|garbled|for ‘|for \'|instead of|mistaken|confus|should (be|read)|miss?pel|wrong name|name', 'O6'),
    ('translation', r'carried over|carry-over|lookahead|leak|repeats? (a |the )?passage|(text|words|sentence|lines?) (of|from) the (previous|next|preceding|following) (page|leaf)|belongs? to the (previous|next) (page|leaf)', 'T5'),
    ('translation', r'<meta>|meta (note|claims|says)|summary of|describes the page|says the page', 'T15'),
    ('translation', r'<summary>|<keywords>|raw (tag|<)|literal tag|<leaf-break|<column-break|tag (appears|stands|sits|is shown)|unrendered|markup', 'D1'),
    ('translation', r'heading|promoted|markdown|\*\*|bold|italic|# |numbering|list (format|structure)|verse|line[- ]break|stanza|form (imposed|lost)|layout|paragraph', 'T16'),
    ('translation', r'image[- ]desc|image description|woodcut|tail-?piece|decorat|ornament|photograph', 'T13'),
    ('translation', r'invented (heading|scholarship|note|gloss|explanation|claim)|adds? (a |an )?(claim|explanation|interpretation)|interpretive|commentary (that|not)|scholarship|not (on|in) the (page|source|text)|adds nothing|editoriali[sz]', 'T10'),
    ('translation', r'carries the (ocr|misread)|from the ocr|ocr misread|ocr error|follows the ocr|inherits the|reproduces the misread|built on (the|a) misread', 'O6'),
    ('translation', r'garbage|garble|gibberish|fluent(ly)? (over|despite|render)|makes sense of|smooth(s|ed)? over', 'T7'),
    ('translation', r'untranslated|left in (latin|greek|german|french|the original)|echo|source language|not translated|same[- ]language', 'T2'),
    ('translation', r'dropped|omitted|omission|missing|left out|skipped|not rendered|is lost|cut|truncat|unfinished|stops', 'T9'),
    ('translation', r'invent|fabricat|hallucin|made up|no basis|not in the (source|text|original)|added (text|words|a sentence|a phrase)', 'T7'),
    ('translation', r'parallel|facing|bilingual|crib|both (languages|texts)', 'T11'),
    ('translation', r'number|numeral|date|digit|reference|citation|verse number|line reference|folio', 'T8'),
    ('translation', r'name|transliterat|pinyin|romani', 'T8'),
    ('translation', r'too literal|literal|sense|means|meaning|mistranslat|misconstru|reversed|inverted|negation|tense|mood|plural|singular|wrong (word|term|sense)|should be|softens|flat|clumsy|strained|awkward|strong|weak|nuance|idiom|renders|rendering|reads as|garbled|unclear to a reader|nonsense|ambiguous|imprecise|loose|paraphras|overtranslat|is not quite|better|would be|construes|takes .* as|understood as|agent|object|subject|case|genitive|dative|accusative|participle|infinitive|word order', 'T8'),
    ('other', r'heading|promoted|markdown|\*\*|bold|italic|# |numbering|running head|furniture|<sig>|<header>|page-num', 'T16'),
    ('other', r'<summary>|<keywords>|raw|literal tag|<leaf-break|<column-break|tag|unrendered|payload|markup', 'D1'),
    ('other', r'<meta>|meta', 'T15'),
    ('other', r'<note>|note|gloss|commentary|interpret|image[- ]desc|description', 'T10'),
    ('other', r'catalogue|title|author|metadata|date of|wrong (book|edition)', 'I7'),
    ('other', r'language|script|page-type|tagged as|<language>', 'O16'),
    ('other', r'spread|two pages|both pages|unsplit|split|strip', 'I3'),
    ('other', r'pinyin|transliterat|romani|table|rhyme', 'T16'),
]

def load():
    rows = [json.loads(l) for l in open(f'{DIR}/labels.jsonl')]
    items = []
    for ri, r in enumerate(rows):
        if r.get('positive_only'): continue
        for ei, e in enumerate(r['errors']):
            if CODE.search(str(e.get('class') or '')): continue
            items.append(dict(id=f'{ri}:{ei}', source=r['source'], stage=e.get('stage') or 'other', severity=e.get('severity'), cls=e.get('class'), problem=(e.get('problem') or '')[:600], bad=(e.get('bad') or '')[:200], good=(e.get('good') or '')[:200], language=r.get('language') or ''))
    return rows, items

if MODE == 'rules':
    rows, items = load()
    out = open(f'{CD}/rules.jsonl', 'w'); rest = []; how = C.Counter()
    for it in items:
        c = None; h = None
        if it['cls'] and it['cls'] in LEGACY: c, h = LEGACY[it['cls']], 'legacy'
        elif it['cls'] and str(it['cls']).startswith('other:'):
            c, h = None, None
        if not c:
            text = it['problem'].lower()  # the reviewer's prose only: quoted page text matched the rules by accident
            for stage, rx, cls in RULES:
                if stage and stage != it['stage']: continue
                if re.search(rx, text, re.I): c, h = cls, f'rule:{rx[:24]}'; break
        if c: out.write(json.dumps(dict(id=it['id'], cls=c, how=h)) + '\n'); how[h.split(':')[0]] += 1
        else: rest.append(it)
    out.close()
    print('unclassed items', len(items), 'classed by', dict(how), 'remaining for model', len(rest))
    for f in os.listdir(f'{CD}/batches'): os.remove(f'{CD}/batches/{f}')
    B = 40
    for i in range(0, len(rest), B):
        json.dump([{k: it[k] for k in ('id', 'stage', 'severity', 'problem', 'bad', 'good')} for it in rest[i:i+B]], open(f'{CD}/batches/{i//B:04d}.json', 'w'), ensure_ascii=False)
    prompt = ['You classify quality findings about pages of old books into a fixed taxonomy. Each finding is a reviewer\'s note about one defect, with its stage (ocr = the transcription against the page image; translation = the English against the transcription or image; other = display, tags, catalogue) and severity.',
              'Classes (code: name). Pick the single best code for WHERE the defect arose, as the taxonomy defines it. Use the stage as a strong hint: ocr findings are usually O-codes (or I-codes for page-unit problems), translation findings T-codes, other findings D1/T16/T15/T10/I7/O16.', '']
    for code, name in DEFS.items(): prompt.append(f'{code}: {name}')
    prompt += ['', 'Guidance: O6 = a meaning-bearing word misread; O7 = a number, date, dose or unit misread; O8 = silent normalisation (abbreviations expanded, spelling modernised, long s, ligatures); O5 = text on the page silently missing from the OCR; O9 = order, line-break, hyphenation or convention problems; O11 = running heads, signatures, page numbers, catchwords mis-tagged; O12 = marginalia, footnotes, apparatus dropped or merged; O14 = a figure or table described instead of transcribed; O17 = table structure; T8 = the OCR is right but the English says something else (sense, nuance, too literal, wrong term, wrong tense, a name or citation changed); T7 = the English fluently covers an OCR misread or garbage; T9 = a quiet omission in the English; T10 = an added note, gloss or interpretation not on the page; T5 = text of the previous or next page leaking in; T13 = apparatus (notes, margins, image descriptions) stripped or mishandled in translation; T15 = the <meta> continuity note is wrong; T16 = form imposed or lost (headings, markdown, numbering, verse layout); D1 = raw tags or broken markup shown to the reader; T2 = source left untranslated; T14 = the English is of a different read than the OCR shown.',
               '', 'Answer with ONLY a JSON array of objects {"id": "<id>", "class": "<code>"}, one per finding, same ids, no prose.', '', 'Findings:']
    open(f'{CD}/prompt.txt', 'w').write('\n'.join(prompt) + '\n')
    print('batches', len(os.listdir(f'{CD}/batches')), 'prompt', f'{CD}/prompt.txt')

elif MODE == 'merge':
    rows, items = load(); byid = {it['id']: it for it in items}
    cls = {}; how = {}
    for l in open(f'{CD}/rules.jsonl'):
        j = json.loads(l); cls[j['id']] = j['cls']; how[j['id']] = j['how'].split(':')[0]
    bad_out = 0
    for f in sorted(os.listdir(f'{CD}/batches')):
        if not f.endswith('.out.json'): continue
        try:
            txt = open(f'{CD}/batches/{f}').read(); m = re.search(r'\[.*\]', txt, re.S); arr = json.loads(m.group(0))
        except Exception: bad_out += 1; continue
        for j in arr:
            c = CODE.search(str(j.get('class') or ''))
            if j.get('id') in byid and c and c.group(1) in DEFS: cls[j['id']] = c.group(1); how[j['id']] = 'model'
    with open(f'{CD}/classes.jsonl', 'w') as out:
        for it in items:
            out.write(json.dumps(dict(id=it['id'], cls=cls.get(it['id']), how=how.get(it['id']), stage=it['stage'], severity=it['severity'], source=it['source'])) + '\n')
    tot = len(items); done = sum(1 for it in items if cls.get(it['id']))
    print(f'unclassed {tot}; classed {done} ({done/tot:.0%}); by', dict(C.Counter(how[i] for i in cls if i in byid)), 'unparsable outputs', bad_out)
    dist = C.Counter((it['stage'], cls.get(it['id'])) for it in items)
    print('classes assigned:', ', '.join(f'{k[1]}({k[0][:2]}):{n}' for k, n in dist.most_common(30)))
    # spot check: 30 items, 10 legacy/rule, 20 model, across stages
    random.seed(11)
    pool_r = [it for it in items if how.get(it['id']) in ('legacy', 'rule')]; pool_m = [it for it in items if how.get(it['id']) == 'model']
    random.shuffle(pool_r); random.shuffle(pool_m)
    pick = pool_r[:10] + pool_m[:20]
    with open(f'{CD}/spotcheck.md', 'w') as sp:
        sp.write('# Spot check of 30 auto-classed findings (10 rule/legacy, 20 model)\n\nVerdict column filled by eye: ok / wrong → <code> / unclear.\n\n| # | how | stage | sev | assigned | finding | bad → good | verdict |\n|---|---|---|---|---|---|---|---|\n')
        for i, it in enumerate(pick, 1):
            c = cls.get(it['id']); esc = lambda s: s.replace('|', '\\|').replace('\n', ' ')
            sp.write(f"| {i} | {how.get(it['id'])} | {it['stage']} | {it['severity']} | {c} {DEFS.get(c,'')[:40]} | {esc(it['problem'][:220])} | {esc(it['bad'][:80])} → {esc(it['good'][:80])} | |\n")
    print('spot check:', f'{CD}/spotcheck.md')
