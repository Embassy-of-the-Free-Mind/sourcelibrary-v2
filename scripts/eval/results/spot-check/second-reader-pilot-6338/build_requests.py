#!/usr/bin/env python3
# PRIOR ART: scripts/eval/second-reader/ (#6347, unmerged) builds sealed calibration packets for claude -p readers with files; this pilot sends one page inline in a plan-mode CLI prompt, which that harness does not do.
# Builds the #6338 pilot's requests for run-cli-arm.py: one request per PAGE (image attached), and, once page results
# exist, one text-only request per BOOK. The frozen briefs are sent verbatim (everything after each file's leading
# <!-- … --> comment); the WRAPPER texts below are the only words added, and are recorded in the experiment file.
import json, os, re, sys

REPO = '/mnt/HC_Volume_105839809/worktrees/job-second-reader-pilot-6338'
PACKET = f'{REPO}/scripts/eval/results/spot-check/overview-2026-10-07-eternity2/packets/greek-latin-classics.json'
HERE = os.path.dirname(os.path.abspath(__file__))


def body(path):
    t = open(path, encoding='utf-8').read()
    return re.sub(r'^\s*<!--.*?-->\s*', '', t, count=1, flags=re.S)


BRIEF = body(f'{REPO}/scripts/eval/spot-check/REVIEWER.md').rstrip() + '\n\n' + body(f'{REPO}/scripts/eval/spot-check/OVERVIEW-ADDENDUM.md').rstrip()

PAGE_WRAPPER = """## How this request is run (wrapper for this pilot, not part of the brief)

You cannot open files, run commands or write files here; do not try. PACKET_FILE is given inline below. It holds ONE book and only ONE of its pages; the book's other packet pages are judged in separate requests, so ignore the instruction to review every page. The page image is already downloaded: it is the file attached at the end of this message (skip the download in step 2). Do steps 3 and 4 for this page. OUTPUT_FILE is your reply: reply with ONLY one JSON object, the page entry from the schema (`page_number`, `right_page`, `ocr_score`, `ocr_errors`, `tr_score`, `tr_errors`, `other`, `confidence`), with no prose and no markdown fence.

PACKET_FILE:
"""

BOOK_WRAPPER = """## How this request is run (wrapper for this pilot, not part of the brief)

You cannot open files, run commands or write files here; do not try. In earlier requests you judged each of this book's 4 packet pages against its image, one request per page. PACKET_FILE is given inline below without the page texts: the book's metadata, its `structure` counts and the page numbers in `run`. YOUR_PAGE_RESULTS below are your own page entries from those requests. Now judge the book. OUTPUT_FILE is your reply: reply with ONLY one JSON object, the book object from the schema with the addendum's fields and without `pages` (`book_id`, `slot`, `title`, `tradition`, `shelf_fit`, `shelf_note`, `rights_flag`, `structure_note`, `on_sight_defect`, `fit_to_show`, `showcase_pages`, `reader_summary`, `book_verdict`), with no prose and no markdown fence.

PACKET_FILE:
"""

BOOK4_WRAPPER = """## How this request is run (wrapper for this pilot, not part of the brief)

You cannot open files, run commands or write files here; do not try. PACKET_FILE is given inline below and holds ONE book with its 4 pages. The 4 page images are already downloaded: they are the files attached at the end of this message, named `<book_id>_<page_number>.jpg` (skip the download in step 2). OUTPUT_FILE is your reply: reply with ONLY the JSON array from the schema (one book object, with all 4 pages and the addendum's fields), with no prose and no markdown fence.

PACKET_FILE:
"""


def dump(x):
    return json.dumps(x, ensure_ascii=False, indent=1)


def main(kind, arm=None):
    books = json.load(open(PACKET, encoding='utf-8'))
    out = []
    if kind == 'page':
        for b in books:
            for p in b['pages']:
                one = dict(b); one['pages'] = [p]
                out.append({'uid': f"{b['book_id']}_{p['page_number']}", 'image': f"{HERE}/images/{b['book_id']}_{p['page_number']}.jpg",
                            'prompt': BRIEF + '\n\n' + PAGE_WRAPPER + dump([one])})
    elif kind == 'book':
        res = {}
        for l in open(f'{HERE}/out/{arm}-page.jsonl', encoding='utf-8'):
            r = json.loads(l)
            if r.get('text'):
                res[r['uid']] = r['text']
        for b in books:
            meta = {k: v for k, v in b.items() if k != 'pages'}
            pages = []
            for p in b['pages']:
                t = res.get(f"{b['book_id']}_{p['page_number']}")
                pages.append(t.strip() if t else json.dumps({'page_number': p['page_number'], 'missing': 'no result from the page request'}))
            out.append({'uid': b['book_id'], 'prompt': BRIEF + '\n\n' + BOOK_WRAPPER + dump([meta]) + '\n\nYOUR_PAGE_RESULTS:\n' + '\n'.join(pages)})
    elif kind == 'book4':
        b = books[int(arm)]
        out.append({'uid': b['book_id'], 'prompt': BRIEF + '\n\n' + BOOK4_WRAPPER + dump([b]),
                    'images': [f"{HERE}/images/{b['book_id']}_{p['page_number']}.jpg" for p in b['pages']]})
    for r in out:
        print(json.dumps(r, ensure_ascii=False))


if __name__ == '__main__':
    main(*sys.argv[1:])
