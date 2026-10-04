#!/usr/bin/env python3
# PRIOR ART: tcp_pages.py (this lane: splits TCP into page sides, accepts a book), lib/edition-window.mjs (cuts a
# PAGE window from an edition for scoring; no line geometry). Kraken's own `ketos align`-style tools need an
# existing model + exact text; none fits a keyed text with no line breaks onto blla baselines. This does (#5730).
"""
align_lines.py — turn Kraken ALTO (blla baselines + a CATMuS-Print read) plus the book's TCP page sides into
line-level training ALTO with the TCP transcription as each line's text.

  python align_lines.py --map=map/<book>.json --alto-dir=alto/<book> --img-dir=img/<book> \
      --out=train/<book> --stats=stats/<book>.json

Per page:
  1. Page match: the read (all lines joined) is compared with every TCP side and every pair of consecutive sides
     (an opening keyed as two sides) by character-trigram Dice on a folded form (lower case, ſ→s, u/v, i/j, letters
     only). The best candidate must reach PAGE_MIN (0.55); else the page is dropped ("no-page-match").
  2. Line cut: the read and the side text are aligned globally (edlib, unit costs, on the NFD-folded alignment form);
     each line's span in the read is mapped through the alignment to a span of the TCP text, and that span — in
     TCP's own characters — is the line's ground truth.
  3. Line keep: CER(read, truth) on the folded form ≤ LINE_MAX (0.30), truth ≥ 4 letters, no ◊ (TCP <gap>), and
     length ratio within [0.6, 1.6]. Everything else is dropped and counted by reason.
A page enters training only if ≥ 50 % of its lines are kept (otherwise it is "low-confidence" and dropped whole —
reading-order or segmentation trouble that would teach the wrong thing at the kept lines' edges too).

Normalisation of the TRUTH (stated in the prereg): TCP characters as keyed (ſ, abbreviation strokes, ę, &, æ, ꝰ),
EOL hyphen kept as "-", whitespace collapsed, then Unicode NFD (the base model's codec is NFD).
"""
import argparse, json, os, re, unicodedata
from collections import Counter
from xml.sax.saxutils import quoteattr
import edlib
from lxml import etree

PAGE_MIN, LINE_MAX, PAGE_KEEP = 0.55, 0.30, 0.5
NS = {'a': 'http://www.loc.gov/standards/alto/ns-v4#'}


def fold_char(c):
    c = c.lower()
    if c == 'ſ':
        return 's'
    if c == 'v':
        return 'u'
    if c == 'j':
        return 'i'
    return c


def fold(s):
    s = unicodedata.normalize('NFD', s)
    return ''.join(fold_char(c) for c in s if c.isalpha())


def grams(s, n=3):
    return Counter(s[i:i + n] for i in range(len(s) - n + 1))


def dice(a, b):
    ga, gb = grams(a), grams(b)
    if not ga or not gb:
        return 0.0
    return 2 * sum((ga & gb).values()) / (sum(ga.values()) + sum(gb.values()))


def lev(a, b):
    if not b:
        return len(a)
    return edlib.align(a, b, task='distance')['editDistance'] if a else len(b)


def align_form(s):
    """Alignment form, char-by-char with an index map back into s: NFD, folded, spaces collapsed; marks dropped."""
    out, idx = [], []
    for i, c in enumerate(s):
        if unicodedata.combining(c):
            continue
        if c.isspace() or c == ' ':
            if out and out[-1] == ' ':
                continue
            out.append(' '); idx.append(i)
            continue
        out.append(fold_char(c)); idx.append(i)
    return ''.join(out), idx


def read_alto(path):
    t = etree.parse(path)
    lines = []
    for tl in t.iterfind('.//a:TextLine', NS):
        text = ' '.join(s.get('CONTENT', '') for s in tl.iterfind('a:String', NS)).strip()
        poly = tl.find('a:Shape/a:Polygon', NS)
        lines.append({'id': tl.get('ID'), 'baseline': tl.get('BASELINE'), 'polygon': poly.get('POINTS') if poly is not None else None, 'text': text})
    page = t.find('.//a:Page', NS)
    return lines, int(page.get('WIDTH')), int(page.get('HEIGHT'))


def write_alto(path, image, w, h, lines):
    parts = [f'<?xml version="1.0" encoding="UTF-8"?>\n<alto xmlns="http://www.loc.gov/standards/alto/ns-v4#">',
             f'<Description><MeasurementUnit>pixel</MeasurementUnit><sourceImageInformation><fileName>{image}</fileName></sourceImageInformation></Description>',
             f'<Layout><Page WIDTH="{w}" HEIGHT="{h}" PHYSICAL_IMG_NR="0" ID="page_0"><PrintSpace HPOS="0" VPOS="0" WIDTH="{w}" HEIGHT="{h}"><TextBlock ID="b0">']
    for i, l in enumerate(lines):
        parts.append(f'<TextLine ID="l{i}" BASELINE="{l["baseline"]}"><Shape><Polygon POINTS="{l["polygon"]}"/></Shape><String CONTENT={quoteattr(l["truth"])}/></TextLine>')
    parts.append('</TextBlock></PrintSpace></Page></Layout></alto>\n')
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(parts))


def best_side(read_f, sides_f):
    best = (0.0, None)
    for i, s in enumerate(sides_f):
        if len(s) < 40:
            continue
        d = dice(read_f, s)
        if d > best[0]:
            best = (d, (i,))
        if i + 1 < len(sides_f):
            d2 = dice(read_f, s + sides_f[i + 1])
            if d2 > best[0] + 0.05:
                best = (d2, (i, i + 1))
    return best


def align_page(lines, side_text):
    """→ list of (line, truth or None, reason)."""
    joined, spans, pos = [], [], 0
    for l in lines:
        a, _ = align_form(l['text'])
        a = a.strip()
        spans.append((pos, pos + len(a)))
        joined.append(a)
        pos += len(a) + 1
    H = ' '.join(joined)
    R, ridx = align_form(side_text)
    if not H.strip() or not R.strip():
        return [(l, None, 'empty') for l in lines]
    res = edlib.align(H, R, mode='NW', task='path')
    # walk the CIGAR: for each H position, the R position it aligns to (or the last one before it)
    h2r = [None] * (len(H) + 1)
    hi = ri = 0
    for n, op in re.findall(r'(\d+)([=XID])', res['cigar']):
        n = int(n)
        for _ in range(n):
            if op in '=X':
                h2r[hi] = ri; hi += 1; ri += 1
            elif op == 'I':      # in query (H) only
                h2r[hi] = ri; hi += 1
            else:                # D: in target (R) only
                ri += 1
    h2r[len(H)] = ri
    out = []
    for l, (a, b), seg in zip(lines, spans, joined):
        if b - a < 4:
            out.append((l, None, 'short')); continue
        ra, rb = h2r[a], h2r[b] if h2r[b] is not None else len(R)
        if ra is None or rb is None or rb <= ra:
            out.append((l, None, 'unaligned')); continue
        # back into TCP's own characters (combining marks between the two ends included)
        sa = ridx[ra] if ra < len(ridx) else len(side_text)
        sb = ridx[rb - 1] + 1 if rb - 1 < len(ridx) else len(side_text)
        while sb < len(side_text) and unicodedata.combining(side_text[sb]):
            sb += 1
        truth = side_text[sa:sb].replace(' ', '')
        truth = re.sub(r'\s+', ' ', truth).strip()
        if '◊' in truth:
            out.append((l, None, 'gap')); continue
        tf, hf = fold(truth), fold(l['text'])
        if len(tf) < 4:
            out.append((l, None, 'short')); continue
        ratio = len(hf) / max(1, len(tf))
        if not 0.6 <= ratio <= 1.6:
            out.append((l, None, 'length')); continue
        cer = lev(hf, tf) / len(tf)
        if cer > LINE_MAX:
            out.append((l, None, f'cer>{LINE_MAX}')); continue
        out.append((l, unicodedata.normalize('NFD', truth), f'ok:{cer:.3f}'))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--map', required=True)
    ap.add_argument('--alto-dir', required=True)
    ap.add_argument('--img-dir', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--stats', required=True)
    a = ap.parse_args()
    m = json.load(open(a.map))
    sides = [s['text'] for s in m['sides']]
    sides_f = [fold(s) for s in sides]
    os.makedirs(a.out, exist_ok=True)
    st = {'book_id': m['book_id'], 'tcp': m['tcp'], 'pages': 0, 'pages_kept': 0, 'page_drop': Counter(), 'lines': 0, 'lines_kept': 0, 'line_drop': Counter(), 'kept_cer': [], 'per_page': []}
    for f in sorted(os.listdir(a.alto_dir)):
        if not f.endswith('.xml'):
            continue
        st['pages'] += 1
        pn = f[:-4]
        try:
            lines, w, h = read_alto(os.path.join(a.alto_dir, f))
        except Exception as e:  # noqa: BLE001
            st['page_drop']['alto-error'] += 1; continue
        st['lines'] += len(lines)
        read_f = fold(' '.join(l['text'] for l in lines))
        if len(read_f) < 100:
            st['page_drop']['too-little-text'] += 1; st['line_drop']['page-dropped'] += len(lines); continue
        score, which = best_side(read_f, sides_f)
        if score < PAGE_MIN:
            st['page_drop']['no-page-match'] += 1; st['line_drop']['page-dropped'] += len(lines)
            st['per_page'].append({'page': pn, 'match': round(score, 3), 'kept': 0, 'lines': len(lines)}); continue
        side_text = ' '.join(sides[i] for i in which)
        res = align_page(lines, side_text)
        kept = [(l, t) for l, t, r in res if t]
        for _, _, r in res:
            if r.startswith('ok:'):
                st['kept_cer'].append(float(r[3:]))
            else:
                st['line_drop'][r] += 1
        st['per_page'].append({'page': pn, 'match': round(score, 3), 'sides': list(which), 'kept': len(kept), 'lines': len(lines)})
        if len(kept) < PAGE_KEEP * len(lines):
            st['page_drop']['low-confidence'] += 1
            st['line_drop']['page-low-confidence'] += len(kept)
            st['kept_cer'] = st['kept_cer'][:len(st['kept_cer']) - len(kept)]
            continue
        st['pages_kept'] += 1
        st['lines_kept'] += len(kept)
        img = os.path.abspath(os.path.join(a.img_dir, pn + '.jpg'))
        write_alto(os.path.join(a.out, pn + '.xml'), img, w, h, [dict(l, truth=t) for l, t in kept])
    cers = sorted(st['kept_cer'])
    st['kept_read_cer_median'] = cers[len(cers) // 2] if cers else None
    st['kept_read_cer_mean'] = round(sum(cers) / len(cers), 4) if cers else None
    del st['kept_cer']
    os.makedirs(os.path.dirname(a.stats) or '.', exist_ok=True)
    json.dump(st, open(a.stats, 'w'), indent=1, default=dict)
    print(f"{m['book_id']}: pages {st['pages_kept']}/{st['pages']} lines {st['lines_kept']}/{st['lines']} drops {dict(st['page_drop'])} {dict(st['line_drop'])} kept-read-CER median {st['kept_read_cer_median']}")


if __name__ == '__main__':
    main()
