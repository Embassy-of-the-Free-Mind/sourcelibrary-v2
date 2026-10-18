#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/results/mongol-ocr-probe-5664/pages.json (10 pages identified by hand from the rKTs Ligeti
handlist, the same source); the rKTs Mng1 handlist page itself now returns a truncated page (2026-10-18), so this
reads the per-text catalogue pages (rkts.org/rktsneu/verif/verif2.php?id=N) instead. Nothing in the repo parses them.

Parses saved rKTs Kanjur catalogue pages into one JSON line per text: the Derge location(s), the Mongolian printed
Kanjur (Mng1, Ligeti) location, the Mongolian / Sanskrit / Tibetan titles, and every Mongolian-script string on the
page (titles and colophons from the four Mongolian Kanjurs, Unicode, used as Buddhist-register training text).
rKTs content is CC BY-SA 4.0 (rkts.org/rktsneu/sub/copyrights.php, read 2026-10-18).

  python3 parse_rkts.py DIR_OF_HTML > rkts.jsonl
"""
import glob, html, json, os, re, sys

MONG_RUN = re.compile(r'[\u1800-\u18AF\u202F\u180E][\u1800-\u18AF\u202F\u180E \u3000]*[\u1800-\u18AF]')


def text_of(s):
    t = html.unescape(re.sub(r'<br\s*/?>', '\n', s))
    t = re.sub(r'<[^>]+>', ' ', t)
    return re.sub(r'[ \t\xa0]+', ' ', t)


def field(t, name, nxt):
    m = re.search(re.escape(name) + r'\s+(.+?)\s+' + nxt, t)
    return m.group(1).strip() if m else None


def parse(path):
    rid = int(os.path.basename(path).split('.')[0])
    t = text_of(open(path, encoding='utf8', errors='ignore').read())
    derge = []
    for m in re.finditer(r'\bD(\d+[a-z]?)\s*\n\s*([^\n,]+), (\S+) (\d+)([ab])(\d)-(\d+)([ab])(\d)\s*\(vol\. (\d+)\)', t):
        derge.append({'toh': 'D' + m.group(1), 'section': m.group(2).strip(), 'vol_letter': m.group(3),
                      'start': [int(m.group(4)), m.group(5), int(m.group(6))], 'end': [int(m.group(7)), m.group(8), int(m.group(9))],
                      'vol': int(m.group(10))})
    mng1 = []
    for m in re.finditer(r'Mng1\.(\d+)\s*\n\s*(.+?) (\d+)([ab]) (\d+)([ab])\. Volume (\d+) page (\d+)', t):
        mng1.append({'no': int(m.group(1)), 'section': m.group(2).strip(), 'start': [int(m.group(3)), m.group(4)],
                     'end': [int(m.group(5)), m.group(6)], 'vol': int(m.group(7)), 'page': int(m.group(8))})
    titles = {
        'mong': field(t, 'Title Mong', 'Title Skt'),
        'skt': field(t, 'Title Skt', 'Title Tib'),
        'tib': field(t, 'Title Tib', r'Ref\. Mong\.'),
        'skt_in_mong': field(t, 'Sanskrit Mong.', r'see entry in'),
    }
    mong = []
    for run in MONG_RUN.findall(t):
        r = re.sub(r'[ \u3000]+', ' ', run).strip()  # NOT str.split(): it eats U+202F, the suffix connector
        if len(re.findall(r'[\u1820-\u18AA]', r)) >= 8 and r not in mong:
            mong.append(r)
    # the Unicode title Ligeti's handlist gives for the Mng1 text: the last Mongolian run before the 'Mng1.' marker
    mng1_title = None
    i = t.find('Mng1.')
    if i > 0:
        runs = MONG_RUN.findall(t[max(0, i - 3000):i])
        if runs:
            mng1_title = re.sub(r'[ \u3000]+', ' ', runs[-1]).strip()
    return {'rkts': rid, 'derge': derge, 'mng1': mng1, 'titles': titles, 'mng1_title_unicode': mng1_title, 'mongolian': mong}


if __name__ == '__main__':
    files = sorted(glob.glob(os.path.join(sys.argv[1], '*.html')), key=lambda p: int(os.path.basename(p).split('.')[0]))
    for f in files:
        print(json.dumps(parse(f), ensure_ascii=False))
