#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/spot-check/ and the weekly audit render nothing for a person to judge; the blind-check MCP tool
(start_blind_check) serves random pages one at a time with no prefilled spans and keeps no per-span verdicts. This
builds Derek's one-sitting page for the calibration set (CALIBRATION-SET-DESIGN.md, ESA-AI design): each page with
the UNION of the two rubric readers' marked errors, merged where they quote the same words, with no label saying
which model marked what, and no block, stratum or planted answer.

derek-packet.py <cal-dir> <assets.json> <out.html>
  assets.json  {"<image basename>": "<asset url>"} from the Artifact asset upload (images shrunk first, see README)
Writes out.html and <cal-dir>/derek-spans.json (span ids → which reader marked it, for scoring; never in the page).
"""
import json, os, re, sys, hashlib
CAL, ASSETS, OUT = sys.argv[1:4]
HERE = os.path.dirname(os.path.abspath(__file__))
assets = json.load(open(ASSETS))
ids = open(f'{CAL}/runs/derek/packets.txt').read().split()
def load(run, name, p):
    f = f'{CAL}/runs/{run}/readers/{name}/reviews/{p}.json'
    try: return json.load(open(f))[0]['pages'][0]
    except Exception: return None
norm = lambda s: re.sub(r'\s+', ' ', (s or '').strip().lower())
SEV = {'serious': 'critical', 'moderate': 'major', 'minor': 'minor'}
items = []; provenance = {}
for p in ids:
    rec = json.load(open(f'{CAL}/packets/{p}.json'))[0]; pg = rec['pages'][0]
    spans = []
    for reader in ('opus-rubric', 'gem-rubric'):
        rv = load('rubric', reader, p)
        if not rv: continue
        marks = [('ocr', e.get('ocr'), e.get('image'), e) for e in rv.get('ocr_errors') or []] + \
                [('english', e.get('english'), e.get('source'), e) for e in rv.get('tr_errors') or []] + \
                [('page', None, None, e) for e in rv.get('other') or []]
        if rv.get('right_page') == 'no':
            marks.append(('page', None, None, {'severity': 'serious', 'problem': 'The text is not of the leaf shown: image and text are different pages.'}))
        for pane, quote, should, e in marks:
            q = (quote or '').strip(); key = (pane, norm(q)[:60]) if q else (pane, norm(e.get('problem') or e.get('note'))[:40])
            hit = next((s for s in spans if s['_key'] == key or (q and s['pane'] == pane and len(norm(q)) >= 6 and (norm(q) in norm(s['quote']) or norm(s['quote']) in norm(q)) and s['quote'])), None)
            if hit: hit['_readers'].add(reader); continue
            spans.append(dict(_key=key, _readers={reader}, pane=pane, quote=q[:300], should=(should or '')[:300], problem=(e.get('problem') or e.get('note') or '')[:500], severity=SEV.get(e.get('severity'), 'major')))
    for s in spans:
        s['id'] = hashlib.sha1(f"{p}|{s['pane']}|{s['quote']}|{s['problem']}".encode()).hexdigest()[:10]
        provenance[f"{p}:{s['id']}"] = sorted(s.pop('_readers')); s.pop('_key')
    order = {'critical': 0, 'major': 1, 'minor': 2}
    spans.sort(key=lambda s: (order[s['severity']], s['pane']))
    img = os.path.basename(pg['image_file'])
    items.append(dict(packet=p, title=(rec['book'].get('display_title') or rec['book'].get('title') or '')[:140], language=rec['book'].get('language'), published=str(rec['book'].get('published') or '')[:20],
                      page_number=pg['page_number'], image=assets[img], ocr=pg['ocr'], translation=pg.get('translation') or '', spans=spans))
data = json.dumps(dict(items=items), ensure_ascii=False).replace('</', '<\\/').replace('�', '\\ufffd')
page = open(f'{HERE}/derek-packet.html', encoding='utf-8').read()
assert page.count('__DATA__') == 1
open(OUT, 'w', encoding='utf-8').write(page.replace('__DATA__', data))
json.dump(provenance, open(f'{CAL}/derek-spans.json', 'w'))
print(len(items), 'pages,', sum(len(i['spans']) for i in items), 'marks;', sum(1 for v in provenance.values() if len(v) == 2), 'marked by both readers')
