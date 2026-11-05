# PRIOR ART: scripts/eval/benchmark/script-class/ (Sonnet by eye: print technique + spread, not page kind),
# paddle_table_corrections_6561 (Opus layout call, Chinese flagged pages only). This labels a fresh random draw by
# eye on all three classifier outputs at once, so the classifier is scored outside the sets it was trained on (#5122).
# Opus on the subscription through `claude -p` (rule 2 of ocr-lane-decision-tree.md: never the API). $0. Read only.
# Usage: python label-check.py MANIFEST IMGDIR OUTDIR [workers]
import sys, json, hashlib, subprocess, os, concurrent.futures as cf
man, imgdir, outdir = sys.argv[1:4]; W = int(sys.argv[4]) if len(sys.argv) > 4 else 4
os.makedirs(outdir, exist_ok=True)
PROMPT = """You are labelling one page image for a pre-read classifier. Read the image file {path} with the Read tool
and look at it closely (do not transcribe it). Judge only from the image; ignore any catalogue idea of what the book is.

Answer with ONE line of JSON and nothing else:
{{"script": "<ISO 15924 code of the main writing on the page: Latn, Grek, Hebr, Arab, Syrc, Hani, Jpan (kana with or without kanji), Kore, Cyrl, Armn, Geor, Deva, Beng, Tibt, Ethi, Copt, Mong, Thai, other, or none if there is no writing>",
 "script_secondary": ["<other scripts present in more than a word or two>"],
 "kind": "<one of: prose | table | date-dense | music | plate | blank>",
 "leaves": <integer: how many distinct book pages/leaves are photographed in this one image; a thin sliver of the next page or a ruler/colour chart does not count>,
 "confidence": "high|medium|low",
 "note": "<under 20 words: what you saw>"}}

kind definitions:
- prose: running text (verse, commentary, multi-column text and footnotes included) that is not dense in numbers.
- table: a grid or aligned columns of cells meant to be read across rows (tables of figures, registers, almanac grids, indexes laid out as tables).
- date-dense: running text or lists in which numerals are frequent: at least ~6 numbers of 2-4 digits (years, dates, page or chapter references, counts) on the page, and not a table.
- music: musical notation occupies a substantial part of the page.
- plate: an illustration, diagram, map or chart occupies most of the page; any text is a caption or labels.
- blank: no writing (blank leaf, endpaper, binding, colour target), or only a stray mark or shelfmark.
If a page could be two kinds, pick the one a reader would route on: table > date-dense > prose; music and plate when they dominate."""
rows = [json.loads(l) for l in open(man)]
rows = [r for r in rows if r['set'] == 'check']
def key(u): return hashlib.sha1(u.encode()).hexdigest()[:16]
def one(r):
    dst = f"{outdir}/{r['uid'].replace(':', '_')}.json"
    if os.path.exists(dst): return 'cached'
    path = f"{imgdir}/{key(r['image_url'])}.jpg"
    if not os.path.exists(path): return 'noimg'
    for attempt in range(2):
        p = subprocess.run(['claude', '-p', '--model', 'opus', '--allowedTools', 'Read', '--output-format', 'text'],
                           input=PROMPT.format(path=path), capture_output=True, text=True, timeout=600, cwd=imgdir)
        txt = p.stdout.strip()
        try:
            j = json.loads(txt[txt.index('{'): txt.rindex('}') + 1])
            j.update(uid=r['uid'], labelled_by='claude-opus-5-5 by eye (claude -p, dereklomas@gmail subscription)', image=path)
            json.dump(j, open(dst, 'w')); return 'ok'
        except Exception:
            err = txt[-300:] + p.stderr[-300:]
    json.dump({'uid': r['uid'], 'error': err}, open(dst + '.err', 'w')); return 'err'
from collections import Counter
with cf.ThreadPoolExecutor(W) as ex: print(Counter(ex.map(one, rows)))
