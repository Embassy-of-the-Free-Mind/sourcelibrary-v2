#!/usr/bin/env python3
# PRIOR ART: build-edition-refs.mjs + lib/edition-window.mjs (cut a window from a flat edition text for one
# page, located by the production read — no page breaks used), the ocr-bakeoff-5660c job's TCP fetch (whole
# TCP files for single-page references). Neither splits a TCP TEI file at its <pb facs> page breaks or maps
# every scan page of a book to its TCP page; this does, for line-level training data (#5730).
"""
tcp_pages.py — split an EEBO-TCP TEI file into its printed pages and map our scan pages to them.

  venv/bin/python tcp_pages.py --pages=/root/kraken-ft-5730/pages/<book>.json --tcp=<A12345> \
      --cache=/root/kraken-ft-5730/tcp --out=/root/kraken-ft-5730/map/<book>.json

Transcription rule (stated in the prereg, §Normalisation): TCP's characters are kept as keyed — ſ, combining
abbreviation strokes (U+0304 via <g ref="char:cmbAbbrStroke">), ꝰ, ũ, &, æ. Two TCP markers are rendered:
  <g ref="char:EOLhyphen"/>   → "-" (a hyphen printed at a line end; the aligner puts it at the line end)
  <g ref="char:EOLunhyphen"/> → ""  (a word broken across lines without a printed hyphen)
  <gap .../>                  → "◊" (illegible in the microfilm; any line touching one is dropped)
Notes (<note>) are kept in reading order; the line aligner drops whatever does not align.

Mapping: TCP numbers page-sides in reading order (two <pb> per microfilm image for an opening). Our bim_
scans are single pages. For each scan page with a stored read we take the TCP page-side with the best
character-trigram similarity in a search window; a book's mapping is accepted only if the matched pages agree
(similarity ≥ 0.5) on at least half the pages with a stored read and the median similarity is ≥ 0.5. Each
page's TCP side is then chosen from its own Kraken read in align_lines.py (the offset drifts inside books). A book whose TCP text is a different
edition (e.g. the English translation of our Latin book) fails here and contributes nothing.
"""
import argparse, json, os, re, sys, unicodedata, urllib.request
from collections import Counter
from lxml import etree

TEI = '{http://www.tei-c.org/ns/1.0}'


def fetch(tcp, cache):
    os.makedirs(cache, exist_ok=True)
    f = os.path.join(cache, f'{tcp}.xml')
    if not os.path.exists(f):
        url = f'https://raw.githubusercontent.com/textcreationpartnership/{tcp}/master/{tcp}.xml'
        with urllib.request.urlopen(url, timeout=60) as r:
            data = r.read()
        with open(f, 'wb') as fh:
            fh.write(data)
    return f


def split_pages(xml_path):
    """→ list of page-sides: {facs, text}. Text in document order between <pb> elements."""
    tree = etree.parse(xml_path)
    text_el = tree.find(f'.//{TEI}text')
    pages = []
    cur = {'facs': None, 'parts': []}

    def emit(s):
        if s:
            cur['parts'].append(s)

    BLOCK = {'p', 'l', 'head', 'item', 'note', 'closer', 'signed', 'dateline', 'trailer', 'label', 'lg', 'list', 'sp', 'speaker', 'cell', 'row', 'byline', 'salute', 'argument', 'opener', 'postscript'}

    def walk(el):
        nonlocal cur
        tag = etree.QName(el).localname if isinstance(el.tag, str) else None
        if tag == 'pb':
            if cur['facs'] is not None or cur['parts']:
                pages.append(cur)
            cur = {'facs': el.get('facs'), 'parts': []}
            emit(el.tail)
            return
        if tag == 'g':
            ref = el.get('ref') or ''
            if ref == 'char:EOLhyphen':
                emit('- ')   # line-separator hint: a printed hyphen at a line end
            elif ref == 'char:EOLunhyphen':
                emit('')
            else:
                emit(el.text)
            emit(el.tail)
            return
        if tag == 'gap':
            emit(' ◊ ')
            emit(el.tail)
            return
        if tag in ('desc',):          # gap descriptions etc.
            emit(el.tail)
            return
        if tag in BLOCK:
            emit(' ')
        emit(el.text)
        for ch in el:
            walk(ch)
        if tag in BLOCK:
            emit(' ')
        if el.tail:
            emit(el.tail)

    walk(text_el)
    pages.append(cur)
    out = []
    for p in pages:
        t = ''.join(p['parts'])
        t = unicodedata.normalize('NFC', t)
        t = re.sub(r'- \s*', '- ', t)
        t = re.sub(r'[ \t\r\n]+', ' ', t).strip()
        out.append({'facs': p['facs'], 'text': t})
    return out


def norm(s):
    s = unicodedata.normalize('NFD', s.lower()).replace('ſ', 's')
    s = ''.join(c for c in s if c.isalpha())
    return s.replace('u', 'v').replace('j', 'i')


def grams(s, n=3):
    return Counter(s[i:i + n] for i in range(len(s) - n + 1))


def sim(a, b):
    ga, gb = grams(a), grams(b)
    if not ga or not gb:
        return 0.0
    inter = sum((ga & gb).values())
    return 2 * inter / (sum(ga.values()) + sum(gb.values()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pages', required=True)
    ap.add_argument('--tcp', required=True)
    ap.add_argument('--cache', default='/root/kraken-ft-5730/tcp')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    book = json.load(open(a.pages))
    sides = split_pages(fetch(a.tcp, a.cache))
    nsides = [norm(s['text']) for s in sides]
    matches = []
    probe = [p for p in book['pages'] if len(norm(p.get('ocr_text') or '')) >= 200]
    if len(probe) > 40:   # acceptance only needs a sample: 40 evenly spaced pages with a stored read
        probe = [probe[round(i * (len(probe) - 1) / 39)] for i in range(40)]
    for p in probe:
        q = norm(p.get('ocr_text') or '')
        best = max(range(len(sides)), key=lambda i: sim(q, nsides[i]) if len(nsides[i]) > 50 else 0)
        s = sim(q, nsides[best])
        matches.append({'page_number': p['page_number'], 'side': best, 'sim': round(s, 3), 'offset': p['page_number'] - best})
    good = [m for m in matches if m['sim'] >= 0.5]
    offs = Counter(m['offset'] for m in good)
    off, n_off = offs.most_common(1)[0] if offs else (None, 0)
    med = sorted(m['sim'] for m in matches)[len(matches) // 2] if matches else 0
    # The offset can drift inside a book (plates, sub-sections keyed as separate sides), so a book is accepted on
    # the probe similarity alone; every page is mapped later from its own Kraken read (align_lines.py).
    accepted = bool(matches) and len(good) >= 0.5 * len(matches) and med >= 0.5
    # a scan page → TCP side; TCP side index = page_number − offset
    mapping = [{'page_number': p['page_number'], 'image_url': p['image_url']} for p in book['pages']] if accepted else []
    res = {'book_id': book['book_id'], 'title': book['title'], 'published': book['published'], 'tcp': a.tcp, 'n_sides': len(sides),
           'n_probe': len(matches), 'n_probe_good': len(good), 'offset': off, 'offset_votes': n_off, 'median_sim': med, 'accepted': accepted,
           'probe': matches, 'pages': mapping, 'sides': sides if accepted else []}
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(res, open(a.out, 'w'), ensure_ascii=False, indent=1)
    print(f"{book['book_id']} {a.tcp}: sides={len(sides)} probe={len(matches)} good={len(good)} offset={off} votes={n_off} median_sim={med:.2f} accepted={accepted} mapped={len(mapping)}")


if __name__ == '__main__':
    main()
