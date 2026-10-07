#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tibetan-mt-ab/draw-replacements.py and the ops-repo refs-final.json of #4742 —
# the same output shape (ids-final.txt + refs-final.json keyed by `<book>_<page5>`) so batch-arms.mjs,
# build-judge-packet.mjs and score.mjs read it unchanged; those were cut from the 84000 TM for one
# language. This merges three reference sources (align-pali.py's SuttaCentral cut, and the hand-cut
# Sanskrit / Chinese public-domain references) and applies the recorded exclusions.
"""assemble-sample.py --work /root/tab5606 --out <data dir>

Writes <out>/<Lang>/ids-final.txt ("book page" per line), refs-final.json ({id: {text, title_en, toh,
sides, source, url, licence, coverage_note, confidence}} — `toh`/`sides` are the field names
build-judge-packet.mjs reads: here the located span and the reference's bibliographic source),
src/<id>.txt (the stored OCR the arms were given, as drawn) and sample.json (every row incl. exclusions).
"""
import json, os, glob, argparse
ap = argparse.ArgumentParser(); ap.add_argument('--work'); ap.add_argument('--out'); a = ap.parse_args()

# Exclusions, decided by reading the page before any arm ran (reasons recorded in sample.json):
EXCLUDE = {
    '6a308263675ed2bdbe36f2e5': 'book is Stcherbatsky\'s 1904 edition of the TIBETAN Nyāyabindu, mislabelled Sanskrit',
    '69dea23c4d19ec2e9ba75f5e': 'page is mostly Monier-Williams\'s English notes; little Sanskrit to translate',
    '69e8b25c2ff2a8dc09e7773b': 'page carries Julien\'s French translation beside the Chinese (bilingual edition)',
    '6a3c61a3879008ba7e15f5dd': 'page holds only the sūtra\'s one closing sentence and end-title',
}
cands = {}
for f in glob.glob(os.path.join(a.work, '*cands*.jsonl')):
    for l in open(f):
        c = json.loads(l); cands[(c['book_id'], c['page_number'])] = c
rows = []
for l in open(os.path.join(a.work, 'pali-refs.jsonl')):
    r = json.loads(l)
    rows.append({'lang': 'Pali', 'book_id': r['book_id'], 'page_number': r['page_number'], 'title': r['title'],
                 'located': f"{r['segments'][0]} – {r['segments'][1]}", 'reference': r['reference'], 'source': r['reference_source'],
                 'url': 'https://github.com/suttacentral/bilara-data/tree/published/' + ' '.join(r['en_files']), 'licence': r['reference_licence'],
                 'coverage_note': f"automatic segment alignment (align-pali.py): coverage {r['coverage']}, shingle density {r['density']}; lines marked [context] are outside the located span",
                 'confidence': None})
for lang in ('Sanskrit', 'Chinese'):
    for f in sorted(glob.glob(os.path.join(a.work, 'refs', lang, '*.json'))):
        r = json.load(open(f))
        row = {'lang': lang, 'book_id': r['book_id'], 'page_number': r.get('page_number'), 'located': r.get('located'),
               'reference': r.get('reference'), 'source': r.get('reference_source'), 'url': r.get('reference_url'),
               'licence': r.get('reference_licence'), 'coverage_note': r.get('coverage_note'), 'confidence': r.get('confidence')}
        if r.get('unlocated'): row['excluded'] = 'no candidate page could be located in a public-domain English: ' + (r.get('reason') or '')[:200]
        elif r.get('page_is_english'): row['excluded'] = 'page is English'
        elif r['book_id'] in EXCLUDE: row['excluded'] = EXCLUDE[r['book_id']]
        rows.append(row)
summary = {}
for lang in ('Pali', 'Sanskrit', 'Chinese'):
    d = os.path.join(a.out, lang); os.makedirs(os.path.join(d, 'src'), exist_ok=True)
    keep = [r for r in rows if r['lang'] == lang and not r.get('excluded')]
    refs, ids = {}, []
    for r in keep:
        pid = f"{r['book_id']}_{str(r['page_number']).zfill(5)}"
        c = cands[(r['book_id'], r['page_number'])]
        r['title'] = r.get('title') or c['title']
        open(os.path.join(d, 'src', pid + '.txt'), 'w').write(c['ocr'])
        ids.append(f"{r['book_id']} {r['page_number']}")
        refs[pid] = {'text': r['reference'], 'title_en': r['title'], 'toh': r['located'], 'sides': r['source'],
                     'source': r['source'], 'url': r['url'], 'licence': r['licence'], 'coverage_note': r['coverage_note'], 'confidence': r['confidence']}
    open(os.path.join(d, 'ids-final.txt'), 'w').write('\n'.join(ids) + '\n')
    json.dump(refs, open(os.path.join(d, 'refs-final.json'), 'w'), ensure_ascii=False, indent=1)
    summary[lang] = {'pages': len(keep), 'books': len({r['book_id'] for r in keep}), 'excluded': [(r['book_id'], r['excluded']) for r in rows if r['lang'] == lang and r.get('excluded')]}
json.dump(rows, open(os.path.join(a.out, 'sample.json'), 'w'), ensure_ascii=False, indent=1)
print(json.dumps(summary, ensure_ascii=False, indent=1))
