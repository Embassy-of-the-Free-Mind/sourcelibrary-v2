"""Pick title pages with text for each saved language, for the Languages hero.
Reads the saved language snapshots, downloads each book's small first-page image (public files),
and scores how much it looks like printed or written text: many small dark strokes in rows.
Bindings, blank pages and pictures-only pages score low and are left out.
Writes _data/snap/_language-pages.json {slug: [{src, score, title}]} and a contact sheet to check by eye."""
import json, glob, io, os, sys, time, urllib.request
import numpy as np
from PIL import Image

SNAP = os.path.join(os.path.dirname(__file__), '../_data/snap')
OUT = os.path.join(SNAP, '_language-pages.json')
SHEET = sys.argv[1] if len(sys.argv) > 1 else '/tmp/text-pages'
os.makedirs(SHEET, exist_ok=True)

def score(img):
    g = np.asarray(img.convert('L').resize((160, 220)), dtype=np.float32) / 255
    g = g[11:-11, 8:-8]  # leave out the page edge and gutter
    # Ink: pixels much darker than their surroundings (local contrast), as small strokes
    k = 9
    pad = np.pad(g, k // 2, mode='edge')
    from numpy.lib.stride_tricks import sliding_window_view
    local = sliding_window_view(pad, (k, k)).mean(axis=(-1, -2))
    ink = (local - g) > 0.08
    ink_frac = ink.mean()
    # Text sits in rows: row-by-row ink varies a lot (lines and gaps); a binding or plate does not.
    rows = ink.mean(axis=1)
    row_var = rows.std() / (rows.mean() + 1e-6)
    # A page, not a dark binding: the background is light.
    light = np.median(g)
    # Text strokes are small: many short horizontal runs.
    runs = (np.diff(ink.astype(np.int8), axis=1) == 1).sum() / ink.shape[0]
    # Lines of text: the ink profile across rows (or columns, for vertical scripts) rises and falls
    # many times. A picture rises and falls a few times at most.
    def lines(profile):
        p = np.convolve(profile, np.ones(3) / 3, mode='same')
        on = p > p.mean() * 1.15
        return int((np.diff(on.astype(np.int8)) == 1).sum())
    nl = max(lines(ink.mean(axis=1)), lines(ink.mean(axis=0)))
    s = 0.0
    if light > 0.45 and 0.015 < ink_frac < 0.35 and nl >= 7:
        s = min(runs / 12, 1.5) + min(row_var, 1.5) * 0.6
    return round(float(s), 3), dict(lines=nl, ink=round(float(ink_frac), 3), row_var=round(float(row_var), 2), light=round(float(light), 2), runs=round(float(runs), 1))

out = {}
for f in sorted(glob.glob(os.path.join(SNAP, 'language-*.json'))):
    slug = os.path.basename(f)[:-5]
    books = json.load(open(f))['c']['books']
    picks = []
    for b in books:
        src = b.get('thumbnail_blob') or b.get('thumbnail')
        if not src: continue
        try:
            raw = urllib.request.urlopen(urllib.request.Request(src, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30).read()
            img = Image.open(io.BytesIO(raw)); img.load()
        except Exception as e:
            print('skip', slug, src[-40:], e); continue
        s, d = score(img)
        picks.append({'src': src, 'score': s, 'title': (b.get('display_title') or b.get('title') or '')[:80], 'id': b.get('id'), **d})
        time.sleep(0.15)
    picks.sort(key=lambda x: -x['score'])
    out[slug] = picks
    # Contact sheet: kept on the left of the line, left out after it.
    W, H, cols = 90, 124, 15
    sheet = Image.new('RGB', (W * cols, H * ((len(picks) + cols - 1) // cols)), 'white')
    for i, p in enumerate(picks):
        try:
            im = Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(p['src'], headers={'User-Agent': 'Mozilla/5.0'}), timeout=30).read())).convert('RGB')
            im.thumbnail((W - 4, H - 16))
            sheet.paste(im, ((i % cols) * W + 2, (i // cols) * H + 2))
            from PIL import ImageDraw
            ImageDraw.Draw(sheet).text(((i % cols) * W + 2, (i // cols) * H + H - 13), f"{p['score']:.2f}", fill=(0, 0, 0) if p['score'] >= 0.9 else (200, 0, 0))
        except Exception: pass
    sheet.save(os.path.join(SHEET, slug + '.jpg'))
    print(slug, len(picks), 'pages,', sum(1 for p in picks if p['score'] >= 0.9), 'scored as text')
    json.dump(out, open(OUT, 'w'), indent=1, ensure_ascii=False)
