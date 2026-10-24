"""Score the multi-leaf collation run (#5935): planted errors caught, false flags, copy-through.

PRIOR ART: ../collation-planted4-*.txt were scored by eye for the one-leaf pilot; this is the
same scoring, written down so ten leaves can be scored the same way.

A plant is CAUGHT when a DIFFERENCES line within one verse of it names the planted form in the
edition column (or, for an omission, names the dropped word in the leaf column). It is RESTORED
when the leaf column also matches the true GRETIL word. A missed plant is COPY-THROUGH when the
planted form appears in the model's own reading of the leaf (it "read" the error), else SILENT.
A spelling note whose leaf column is the planted word itself counts as copy-through, not a catch.
Every DIFFERENCES line that matches no plant (or no part of an omitted compound) is a FALSE FLAG; it is ORTHOGRAPHIC when the two
columns agree after folding Malayalam-script spelling habits (visarga before s, anusvāra/m/n,
gemination, punctuation), and SUBSTANTIVE otherwise.

Run: python3 score.py   -> prints the table and writes score.json
"""
import json, re, unicodedata
from difflib import SequenceMatcher
from pathlib import Path

HERE = Path(__file__).parent
PLANTS = json.loads((HERE / 'plants.json').read_text())
MODELS = ['opus', 'fable']


def norm(s):
    s = unicodedata.normalize('NFC', s.lower())
    s = re.sub(r"\(.*?\)|\[|\]", lambda m: m.group(0).strip('[]()') if m.group(0) in '[]' else '', s)
    s = re.sub(r"[\-'`’‘.\^\d\s?*…,;:\"_|/]", '', s)
    return s.replace('ṃ', 'm').replace('ḥ', '')


def fold(s):
    s = norm(s)
    s = re.sub(r'([kgcjṭḍtdpbmnyrlvśṣs])\1', r'\1', s)       # scribal gemination
    s = s.replace('ṅ', 'm').replace('ñ', 'm').replace('ṇ', 'n').replace('n', 'm')
    s = re.sub(r's(?=[sśṣ])|ś(?=ś)', '', s)                  # visarga sandhi before sibilants
    s = re.sub(r'[sr]$', '', s)
    return s


def sim(a, b):
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0.0
    if len(a) >= 3 and len(b) >= 3 and (a in b or b in a):
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def parse(text):
    body, _, diffs = text.partition('DIFFERENCES')
    rows = []
    for line in diffs.splitlines():
        parts = [p.strip(' -*•\t') for p in line.split('|')]
        if len(parts) < 4:
            continue
        vs = [int(x) for x in re.findall(r'(\d+)', parts[0])]
        if not vs:
            continue
        rows.append({'verse': vs[0], 'edition': parts[1], 'reading': parts[2], 'cert': 'uncertain' if 'uncertain' in parts[3].lower() else ('certain' if 'certain' in parts[3].lower() else parts[3].lower())})
    return body, rows


OMIT = re.compile(r'omit|missing|absent|none|^—$|^-$|^\(?\s*\)?$|not in', re.I)


def match(plant, row):
    if abs(row['verse'] - plant['verse']) > 1:
        return False
    if plant['kind'] == 'omission':
        o = norm(plant['original'])
        named = sim(row['reading'], plant['original']) >= 0.8 or (len(o) >= 5 and o[:5] in norm(row['reading']))
        return named and (OMIT.search(row['edition']) or o[:5] not in norm(row['edition']))
    fr, fp = fold(row['reading']), fold(plant['planted'])
    if len(fr) >= 4 and (fr == fp or fr in fp) and sim(row['reading'], plant['original']) < 0.85:
        return False  # a spelling note on the planted word: the model read the plant as present
    return sim(row['edition'], plant['planted']) >= 0.85 and sim(row['edition'], plant['original']) < 1.0 or (
        sim(row['reading'], plant['original']) >= 0.85 and sim(row['edition'], plant['planted']) >= 0.6)


def main():
    out = {}
    for m in MODELS:
        tally = {'plants': 0, 'caught_certain': 0, 'caught_uncertain': 0, 'restored': 0, 'copy_through': 0, 'silent': 0,
                 'flags': 0, 'false_orthographic': 0, 'false_substantive': 0, 'false_substantive_certain': 0}
        per_leaf, false_flags, by_kind = {}, [], {}
        for leaf, p in PLANTS.items():
            text = (HERE / 'outputs' / f'{leaf}-{m}.txt').read_text()
            body, rows = parse(text)
            used = set()
            leaf_row = []
            for pl in p['plants']:
                tally['plants'] += 1
                k = by_kind.setdefault(pl['kind'], [0, 0])
                k[1] += 1
                hit = next((i for i, r in enumerate(rows) if i not in used and match(pl, r)), None)
                if hit is None:
                    ct = pl['kind'] != 'omission' and fold(pl['planted']) in fold(body)
                    tally['copy_through' if ct else 'silent'] += 1
                    leaf_row.append('copy' if ct else 'miss')
                    continue
                used.add(hit)
                k[0] += 1
                r = rows[hit]
                tally['caught_certain' if r['cert'] == 'certain' else 'caught_uncertain'] += 1
                restored = sim(r['reading'], pl['original']) >= 0.85
                tally['restored'] += restored
                leaf_row.append(('C' if r['cert'] == 'certain' else 'u') + ('' if restored else '?'))
            tally['flags'] += len(rows)
            omitted_parts = [(pl['verse'], c) for pl in p['plants'] if pl['kind'] == 'omission' for c in norm(pl['original']).split() + [norm(x) for x in pl['original'].split('-')] if len(c) >= 4]
            for i, r in enumerate(rows):
                if i in used:
                    continue
                if any(v == r['verse'] and c[:4] in norm(r['reading']) for v, c in omitted_parts):
                    continue  # a second line about the same omitted compound (e.g. prakṛti-vi-rūpaṃ split in two)
                if fold(r['edition']) == fold(r['reading']) or (fold(r['edition']) and fold(r['reading']) and SequenceMatcher(None, fold(r['edition']), fold(r['reading'])).ratio() >= 0.9 and len(fold(r['edition'])) > 5):
                    tally['false_orthographic'] += 1
                    kind = 'orthographic'
                else:
                    tally['false_substantive'] += 1
                    tally['false_substantive_certain'] += r['cert'] == 'certain'
                    kind = 'substantive'
                false_flags.append({'leaf': leaf, 'kind': kind, **r})
            per_leaf[leaf] = leaf_row
        out[m] = {'tally': tally, 'per_leaf': per_leaf, 'by_kind': by_kind, 'false_flags': false_flags}
    # unplanted substantive flags both models raise on the same verse and word
    agree = []
    for a in out['opus']['false_flags']:
        if a['kind'] != 'substantive':
            continue
        for b in out['fable']['false_flags']:
            if b['kind'] == 'substantive' and a['leaf'] == b['leaf'] and abs(a['verse'] - b['verse']) <= 1 and sim(a['edition'], b['edition']) >= 0.8:
                agree.append({'leaf': a['leaf'], 'verse': a['verse'], 'edition': a['edition'], 'opus_reads': a['reading'], 'fable_reads': b['reading'], 'opus_cert': a['cert'], 'fable_cert': b['cert']})
                break
    out['both_agree_unplanted'] = agree
    (HERE / 'score.json').write_text(json.dumps(out, ensure_ascii=False, indent=1))
    for m in MODELS:
        t = out[m]['tally']
        print(m, t)
        print('  by kind (caught/planted):', out[m]['by_kind'])
        print('  per leaf:', out[m]['per_leaf'])
    print('both models, unplanted substantive:', len(agree))
    for a in agree:
        print('  ', a)


if __name__ == '__main__':
    main()
