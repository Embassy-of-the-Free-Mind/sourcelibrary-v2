#!/usr/bin/env python3
"""
PRIOR ART: select_eval.py (chooses the pages), segment.py (cuts the columns), the 2026-10-04 probe's proportional
folio->Derge-side mapping (derge-targets.json), generalised here to a column position.

Freezes the evaluation for the synthetic-trained Kanjur reader (#5664). For each fetched page: segment it, cut the
column(s) the model will read, and attach the Tibetan the judge will compare against.

  meaning items: the middle column of the leaf. Its position in the text (side index + column fraction) maps
                 proportionally onto the Derge sides of the same text; the window is that side +/- w sides,
                 w = max(2, min(4, round(8% of the Derge span))). Shuffled control: the window of the item 15 places
                 further on (a derangement: never the same text).
  name units:    every column of the two sides on which the text starts; expected: Sanskrit, Tibetan and Mongolian
                 titles from rKTs. Shuffled control: the titles of the unit 5 places further on.

  python3 freeze_eval.py found.json ESUKHIA_TEXT_DIR OUTDIR
  -> OUTDIR/columns.jsonl, meaning.json, names.json, img/*.jpg, seg/*.jpg (segmentation overlays)
"""
import json, os, re, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import segment as S  # noqa: E402
from select_eval import sides_between  # noqa: E402

OUT_H = 84


def column_image(im, box):
    x0, y0, x1, y1 = box
    c = im.crop((x0, y0, x1, y1)).rotate(90, expand=True)  # CCW: the column now reads left to right
    return c.resize((max(32, int(c.width * OUT_H / c.height)), OUT_H), Image.LANCZOS)


def derge_sides(path):
    sides = {}; cur = None
    for line in open(path, encoding='utf8'):
        m = re.match(r'^\[(\d+)([ab])\]\s*$', line.strip())
        if m:
            cur = (int(m.group(1)), m.group(2)); sides.setdefault(cur, ''); continue
        m = re.match(r'^\[(\d+)([ab])\.\d+\](.*)$', line.strip())
        if m:
            cur = (int(m.group(1)), m.group(2))
            sides[cur] = sides.get(cur, '') + m.group(3)
    return sides


def main():
    found = json.load(open(sys.argv[1], encoding='utf8'))
    esu, out = sys.argv[2], sys.argv[3]
    os.makedirs(os.path.join(out, 'img'), exist_ok=True); os.makedirs(os.path.join(out, 'seg'), exist_ok=True)
    cols = []; meaning = []; names = {}
    dcache = {}
    for w in found:
        if w.get('error'):
            print('SKIP', w['key'], w['error'], file=sys.stderr); continue
        seg = S.segment(w['image'], os.path.join(out, 'seg', w['key'] + '.jpg'))
        im = Image.open(w['image']).convert('RGB')
        boxes = seg['columns']
        if w['set'] == 'meaning':
            ci = len(boxes) // 2
            fn = f'img/{w["key"]}_c{ci + 1:02d}.jpg'
            column_image(im, boxes[ci]).save(os.path.join(out, fn), quality=95)
            cid = f'{w["key"]}/c{ci + 1:02d}'
            cols.append({'id': cid, 'image': fn, 'set': 'meaning'})
            d = w['derge']
            dfile = os.path.join(esu, w['derge_file'])
            if dfile not in dcache:
                dcache[dfile] = derge_sides(dfile)
            ds = sides_between([d['start'][0], d['start'][1]], [d['end'][0], d['end'][1]])
            frac = (w['side_index'] + (ci + 0.5) / len(boxes)) / w['n_sides']
            idx = int(round(frac * (len(ds) - 1)))
            k = max(2, min(4, round(0.08 * len(ds))))
            win = ds[max(0, idx - k): idx + k + 1]
            tib = ' '.join(f'[{f}{s}] ' + dcache[dfile].get((f, s), '').strip() for f, s in win)
            meaning.append({'id': cid, 'vol': w['vol'], 'folio': f'{w["folio"]}{w["side"]}', 'page_number': w['page_number'],
                            'book_id': w['book_id'], 'column': ci + 1, 'n_columns': len(boxes), 'frame_kind': seg['frame_kind'],
                            'rkts': w['rkts'], 'mng1': f'Mng1.{w["mng1"]["no"]}', 'toh': d['toh'], 'titles': w['titles'],
                            'mng_span': f'{w["mng1"]["start"][0]}{w["mng1"]["start"][1]}-{w["mng1"]["end"][0]}{w["mng1"]["end"][1]}',
                            'derge_span': f'{d["start"][0]}{d["start"][1]}-{d["end"][0]}{d["end"][1]} (vol {d["vol"]})',
                            'frac': round(frac, 4), 'derge_window': [f'{f}{s}' for f, s in win], 'tibetan': tib,
                            # judge calibration: the catalogue's Unicode title beside the Derge text's opening sides
                            'calib': {'mongolian': w.get('mng1_title_unicode'),
                                      'tibetan': ' '.join(f'[{f}{s}] ' + dcache[dfile].get((f, s), '').strip() for f, s in ds[:2])}})
        else:
            u = names.setdefault(w['unit'], {'unit': w['unit'], 'vol': w['vol'], 'rkts': w['rkts'], 'mng1': f'Mng1.{w["mng1"]["no"]}',
                                             'toh': w['derge']['toh'], 'titles': w['titles'], 'pages': [], 'columns': []})
            u['pages'].append({'folio': f'{w["folio"]}{w["side"]}', 'page_number': w['page_number'], 'book_id': w['book_id'], 'n_columns': len(boxes)})
            for ci, b in enumerate(boxes):
                fn = f'img/{w["key"]}_c{ci + 1:02d}.jpg'
                column_image(im, b).save(os.path.join(out, fn), quality=95)
                cid = f'{w["key"]}/c{ci + 1:02d}'
                cols.append({'id': cid, 'image': fn, 'set': 'name', 'unit': w['unit']})
                u['columns'].append(cid)
    n = len(meaning)
    for i, m in enumerate(meaning):
        o = meaning[(i + 15) % n]
        m['control'] = {'from': o['id'], 'toh': o['toh'], 'derge_window': o['derge_window'], 'tibetan': o['tibetan']}
    units = list(names.values())
    for i, u in enumerate(units):
        o = units[(i + 5) % len(units)]
        u['control'] = {'from': o['unit'], 'titles': o['titles']}
    with open(os.path.join(out, 'columns.jsonl'), 'w', encoding='utf8') as f:
        for c in cols:
            f.write(json.dumps(c, ensure_ascii=False) + '\n')
    json.dump(meaning, open(os.path.join(out, 'meaning.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    json.dump(units, open(os.path.join(out, 'names.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(f'{len(meaning)} meaning columns, {len(units)} name units ({sum(len(u["columns"]) for u in units)} columns)', file=sys.stderr)


if __name__ == '__main__':
    main()
