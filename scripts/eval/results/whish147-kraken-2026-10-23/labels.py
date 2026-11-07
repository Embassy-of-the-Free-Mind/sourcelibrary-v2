"""Whish 147 Kraken line model (#7119): line labels from the edition-anchored page texts.
PRIOR ART: ../whish147-best-attempt-2026-10-22/apply-fresh.mjs (page text shape: "**Rows of this leaf**", the IAST
section, the <note> holding the fresh Opus read) and mlym.py (IAST -> Malayalam with the scribe's spellings, used
unchanged); score_lib.py is copied from ../whish147-stability-recall-2026-10-23/ (#7203) for norm/mal2iast/best.
Neither builds training lines: this keeps one row of a physical-row leaf as a label only if
  - the row carries no doubt mark ([leaf: …?], [illegible], "not in edition", ?, …) and
  - the stored fresh Opus read of the leaf (no edition shown) has a stretch within CER 0.15 of it (best window over
    the read's rows i-1..i+1, normalised IAST).
Hand A only (leaf pages 7–129, 223–310). Held out entirely: every leaf of the Sāṅkhyakārikā (scans 4–11t: the 9 test
leaves of the stability test and their neighbours, so no kārikā line is trained on).
Usage: JOB_SCRATCH=… python labels.py <pages.json> <out.json>     (pages.json: the book's pages, ocr.data + leaf_split)
"""
import json, os, re, subprocess, sys
from pathlib import Path
HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from score_lib import norm, mal2iast, best, LOC  # noqa: E402

TEST = ['4-b', '5-t', '5-b', '6-t', '6-b', '7-t', '8-t', '8-b', '9-t']
MAXCER = float(os.environ.get('MAXCER', '0.15'))
DOUBT = re.compile(r'\[|\]|\?|…|\.\.\.|not in edition', re.I)
MLYM = HERE.parent / 'whish147-best-attempt-2026-10-22' / 'mlym.py'
PY = os.environ.get('VENV_PY', '/mnt/HC_Volume_105839809/jobs/whish147-best/venv/bin/python')

def hand(pn):
    return 'A' if 7 <= pn <= 129 or 223 <= pn <= 310 else 'B' if 131 <= pn <= 221 else None

def rows_of(section):
    return [(int(m.group(1)), m.group(2).strip()) for m in re.finditer(r'^(\d+)\.\s+(.*)$', section, re.M)]

def parse(data):
    """-> (iast rows, fresh rows (malayalam) or None, physical-row layout?)"""
    body, _, note = data.partition('<note>Fresh direct reading')
    if '**IAST transliteration**' not in body: return None, None, False
    iast = body.split('**IAST transliteration**')[-1]
    physical = '**Rows of this leaf**' in iast
    fresh = None
    if note:
        fresh = [re.sub(r'\s*\(IAST:.*$', '', t) for _, t in rows_of(note.split('</note>')[0])]
    return rows_of(iast.split('<note>')[0]), fresh, physical

def clean(t):
    t = re.sub(r'//|\|\||[|।॥/,;\'’()"“”]|\d+', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()

def main():
    pages = json.load(open(sys.argv[1]))
    cand, leafrows, stats = [], {}, dict(leaves=0, physical=0, rows=0, doubt=0, short=0, disagree=0, nofresh=0, kept=0)
    for p in pages:
        ls = (p.get('ocr') or {}).get('leaf_split')
        if not ls: continue
        key = f"{ls['from_page_number']}-{ls['leaf']}"
        lv = ((p['ocr'].get('engine') or {}).get('input') or {}).get('whish147', {}).get('leaves', {})
        meth = [v.get('method') for v in lv.values()]
        if hand(p['page_number']) != 'A' or 'edition-anchored' not in meth: continue
        if any('sk' in (v.get('works') or []) for v in lv.values()) or key in TEST: continue
        stats['leaves'] += 1
        rows, fresh, physical = parse(p['ocr']['data'])
        if not physical or not rows: continue
        stats['physical'] += 1
        leafrows[key] = len(rows)
        fr = [norm(mal2iast(x)) for x in fresh] if fresh else None
        prev = ''
        for i, (n, t) in enumerate(rows):
            stats['rows'] += 1
            raw = t
            # the re-layout repeats the syllable split at a row end ("kai-" / "kaivalyaṃ"); the leaf writes it once
            if prev.endswith('-'):
                frag = prev.rstrip('-').split()[-1].split('‖')[-1].strip() if prev.rstrip('-').split() else ''
                if frag and t.startswith(frag) and len(frag) <= 6: t = t[len(frag):]
            prev = raw
            if DOUBT.search(t): stats['doubt'] += 1; continue
            c = clean(t)
            nl = norm(c.replace('‖', ''))
            if len(nl) < 15: stats['short'] += 1; continue
            if not fr: stats['nofresh'] += 1; continue
            win = ''.join(fr[max(0, i - 1):i + 2])
            d, _ = best(nl, win)
            cer = d / len(nl)
            if cer > MAXCER: stats['disagree'] += 1; cand.append(dict(key=key, page=p['page_number'], row=n, iast=c, cer=round(cer, 3), keep=False)); continue
            stats['kept'] += 1
            cand.append(dict(key=key, page=p['page_number'], row=n, iast=c, cer=round(cer, 3), keep=True))
    # Malayalam, with the scribe's spellings (mlym.py), then the hole marker and the row-end hyphen dropped
    r = subprocess.run([PY, str(MLYM)], input=json.dumps({str(j): x['iast'] for j, x in enumerate(cand)}), capture_output=True, text=True, check=True)
    mal = json.loads(r.stdout)
    for j, x in enumerate(cand):
        m = mal[str(j)].replace('‖', ' ').replace('-', '')
        x['mal'] = re.sub(r'\s+', ' ', m).strip()
    json.dump(dict(stats=stats, maxcer=MAXCER, leafrows=leafrows, lines=cand), open(sys.argv[2], 'w'), ensure_ascii=False, indent=0)
    print(stats)

if __name__ == '__main__':
    main()
