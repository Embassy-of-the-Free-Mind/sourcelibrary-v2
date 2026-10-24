#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/results/mongol-ocr-probe-5664/{pages.json,derge-targets.json} — 10 pages, proportional
Mongolian-folio -> Derge-side mapping, done by hand; this generalises that mapping and adds the column position.
scripts/eval/results/mongol-argon-probe-5664/derge-passages.json — the Tibetan windows for those 10 pages.

Chooses the FROZEN evaluation for the synthetic-trained Kanjur reader (#5664), from parsed rKTs catalogue pages
(parse_rkts.py) and the Esukhia Derge e-text. Deterministic (no randomness beyond a fixed seed).

  meaning set: 30 volumes spread over 1..108; in each, one text with a Derge parallel and a Mongolian span of 4-30
               folios (closest to 12); its middle leaf; the middle column of that leaf (fixed after segmentation).
  name set:    10 further volumes; in each, one text whose catalogue gives Sanskrit and Tibetan titles; the
               side on which the text starts plus the next side (the opening formula "in the language of India: ...,
               in Tibetan: ..." names the text there).

  python3 select_eval.py rkts.jsonl ESUKHIA_TEXT_DIR [SKIP_VOLS] > want.json

  python3 select_eval.py rkts.jsonl ESUKHIA_TEXT_DIR 8,80 61 > want.json   (as frozen)

SKIP_VOLS=8,80: their middle leaves' labels are duplicated in the stored page labels (f. 384b, 385a twice).
SKIP_NAME_VOLS=61: the chosen opening (f. 344b) has no page with that label.
"""
import json, os, random, re, sys

SEED = 5664


def sides_between(start, end):
    """[(folio, 'a'|'b'), ...] inclusive."""
    out = []
    f, s = start[0], start[1]
    while (f, s) <= (end[0], end[1]) and len(out) < 4000:
        out.append((f, s))
        f, s = (f, 'b') if s == 'a' else (f + 1, 'a')
    return out


def main():
    rk = [json.loads(l) for l in open(sys.argv[1], encoding='utf8')]
    esu = sys.argv[2]
    vfiles = {int(n[:3]): n for n in os.listdir(esu) if re.match(r'^\d{3}_', n)}
    by_vol = {}
    for r in rk:
        if not r['mng1'] or not r['derge']:
            continue
        m = r['mng1'][0]; d = r['derge'][0]
        if d['vol'] not in vfiles:
            continue
        r['_span'] = len(sides_between(m['start'], m['end']))
        by_vol.setdefault(m['vol'], []).append(r)
    skip = {int(x) for x in (sys.argv[3].split(',') if len(sys.argv) > 3 else []) if x}
    vols = sorted(v for v in by_vol if v not in skip)  # skip: volumes whose chosen leaf has no (or a duplicated) page label
    # 30 meaning volumes, evenly spaced over the volumes that have a usable text
    want_m = []
    picks = [vols[round(i * (len(vols) - 1) / 29)] for i in range(30)]
    for v in picks:
        cands = [r for r in by_vol[v] if 8 <= r['_span'] <= 60]
        if not cands:
            cands = by_vol[v]
        r = min(cands, key=lambda r: (abs(r['_span'] - 24), r['rkts']))
        m = r['mng1'][0]
        sides = sides_between(m['start'], m['end'])
        i = len(sides) // 2
        f, s = sides[i]
        want_m.append({'key': f'm{v:03d}', 'set': 'meaning', 'vol': v, 'folio': f, 'side': s, 'rkts': r['rkts'],
                       'mng1': m, 'derge': r['derge'][0], 'derge_file': vfiles[r['derge'][0]['vol']],
                       'side_index': i, 'n_sides': len(sides), 'titles': r['titles'], 'mng1_title_unicode': r.get('mng1_title_unicode')})
    # 10 name volumes: not used above; a text with Skt + Tib titles, starting on any side
    rnd = random.Random(SEED)
    skip_n = {int(x) for x in (sys.argv[4].split(',') if len(sys.argv) > 4 else []) if x}
    rest = [v for v in vols if v not in picks and v not in skip_n]
    rnd.shuffle(rest)
    want_n = []
    for v in rest:
        c = [r for r in by_vol[v] if len(r['titles'].get('skt') or '') > 3 and len(r['titles'].get('tib') or '') > 3 and r['_span'] >= 4]
        if not c:
            continue
        r = rnd.choice(sorted(c, key=lambda r: r['rkts']))
        m = r['mng1'][0]
        for j, (f, s) in enumerate(sides_between(m['start'], m['end'])[:2]):
            want_n.append({'key': f'n{v:03d}{"ab"[j]}', 'set': 'name', 'unit': f'n{v:03d}', 'vol': v, 'folio': f, 'side': s,
                           'rkts': r['rkts'], 'mng1': m, 'derge': r['derge'][0], 'titles': r['titles']})
        if len({w['unit'] for w in want_n}) >= 10:
            break
    print(json.dumps(want_m + want_n, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
