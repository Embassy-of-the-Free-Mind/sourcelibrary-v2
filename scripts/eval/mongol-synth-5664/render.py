#!/usr/bin/env python3
"""
PRIOR ART: ManchuAI-OCR (arXiv 2507.06761, github.com/mic7ch1/ManchuAI-OCR): synthetic word images only, then a
VLM LoRA; its renderer is for black-on-white Manchu words and has no woodblock model. IMU-MnOCR's synthesis code is
not public (repo 404, see 2026-10-18-mongol-imu-dataset-gate-5664.md). Nothing in this repo renders Mongolian.

Synthetic Kanjur-style column renderer (#5664). Draws one column of Classical Mongolian Unicode text the way a
column of the 1720 Beijing red Kanjur looks AFTER the real-page pipeline (segment.py box -> rotate 90 deg CCW ->
height 84 px): red ink on toned, stained paper, low contrast, heavy strokes, thin tail swashes, fragments of the
neighbouring columns at the edges, sometimes a frame rule, blur, warp, ink bleed, JPEG.

Horizontal Mongolian rendering IS the vertical column turned 90 deg counter-clockwise (checked by eye against real
crops: tails and teeth point the same way), so we render horizontally and never rotate.

  python3 render.py --lines lines.txt --out DIR --n 60000 --seed 1 [--workers 8] [--sheet sheet.jpg]
  -> DIR/img/NNNNNN.jpg + DIR/labels.jsonl  {"image": "img/NNNNNN.jpg", "text": "..."}
"""
import argparse, json, os, random, re, sys, unicodedata
from multiprocessing import Pool
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

OUT_H = 84
HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIRS = [os.environ.get('MONGOL_FONT_DIR', ''), os.path.join(HERE, 'fonts')]
# Paper and ink colours (RGB), measured by eye-picking on 5 real leaves (v001, v047, v077, v087, v098): paper runs
# from grey-green to warm beige, ink from pale pink to brick red.
PAPER = [(190, 186, 172), (198, 192, 176), (182, 178, 164), (204, 197, 180), (176, 172, 158), (194, 186, 166)]
INK = [(196, 128, 110), (186, 112, 96), (204, 146, 128), (176, 98, 84), (210, 160, 140), (168, 92, 80)]
PUNCT = ['\u1803', '\u1803', '\u1802', '\u1804']  # full stop (the '::' of the blocks), comma, colon


def font_path():
    for d in FONT_DIRS:
        p = os.path.join(d, 'NotoSansMongolian-Regular.ttf')
        if d and os.path.exists(p):
            return p
    raise SystemExit('NotoSansMongolian-Regular.ttf not found (set MONGOL_FONT_DIR)')


_FONTS = {}


def font(size):
    if size not in _FONTS:
        _FONTS[size] = ImageFont.truetype(font_path(), size, layout_engine=ImageFont.Layout.RAQM)
    return _FONTS[size]


def render_mask(text, size):
    """Ink mask (float 0..1) of one horizontal line, tightly cropped in x, with the font's full line height in y."""
    f = font(size)
    l, t, r, b = f.getbbox(text, language='mn')
    w = r - l + size; h = int(size * 2.2)
    im = Image.new('L', (w, h), 0)
    ImageDraw.Draw(im).text((size // 2 - l, int(size * 0.55)), text, font=f, fill=255, language='mn')
    a = np.asarray(im, dtype=np.float32) / 255.0
    xs = np.nonzero(a.max(0) > 0.1)[0]
    if len(xs) == 0:
        return None
    return a[:, max(0, xs[0] - 2): xs[-1] + 3]


def smooth_noise(h, w, scale, rng):
    """Low-frequency noise in [-1,1]."""
    sh, sw = max(2, int(h / scale)), max(2, int(w / scale))
    n = rng.standard_normal((sh, sw)).astype(np.float32)
    n = cv2.resize(n, (w, h), interpolation=cv2.INTER_CUBIC)
    return n / (np.abs(n).max() + 1e-6)


def woodblock(a, size, rng):
    """Heavier strokes and uneven impression: dilate (the blocks cut a thick, slightly blobby line), random
    erosion holes, bleed."""
    k = int(round(size * rng.uniform(0.02, 0.10)))
    if k >= 1:
        kx, ky = k + int(rng.integers(0, 2)), k + int(rng.integers(0, 3))
        a = cv2.dilate(a, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kx, ky)))
    if rng.random() < 0.5:  # worn block: specks of missing ink
        holes = (smooth_noise(*a.shape, size * 0.08, rng) > rng.uniform(0.55, 0.85)).astype(np.float32)
        a = a * (1 - holes * rng.uniform(0.5, 1.0))
    s = rng.uniform(0.4, 1.6) * size / 40
    a = cv2.GaussianBlur(a, (0, 0), s)
    a = np.clip((a - rng.uniform(0.2, 0.45)) * rng.uniform(2.0, 4.0), 0, 1)  # bleed edge
    return a


def add_swashes(a, size, rng):
    """The blocks' long thin tails: from the end of some words, a thin stroke sweeping up-right (this orientation)."""
    h, w = a.shape
    cols = a.max(0) > 0.3
    # word ends: last ink column before a gap of >= 0.4 em
    gap = int(size * 0.4); ends = []
    run = 0
    for x in range(w):
        if cols[x]:
            if run >= gap and ends is not None:
                pass
            run = 0; last = x
        else:
            run += 1
            if run == gap:
                ends.append(last)
    ends.append(int(np.nonzero(cols)[0][-1]) if cols.any() else w - 1)
    img = (a * 255).astype(np.uint8)
    for x in ends:
        if rng.random() > 0.45:
            continue
        ys = np.nonzero(a[:, max(0, x - 2):x + 1].max(1) > 0.3)[0]
        if len(ys) == 0:
            continue
        y = int(ys[0] + rng.uniform(0.0, 0.3) * (ys[-1] - ys[0]))
        L = size * rng.uniform(0.5, 1.3)
        pts = []
        for t in np.linspace(0, 1, 12):
            pts.append((x - 2 + L * 0.55 * t, y - L * (0.25 * t + 0.6 * t * t)))
        pts = np.array(pts, np.int32).reshape(-1, 1, 2)
        cv2.polylines(img, [pts], False, 255, thickness=max(1, int(size * rng.uniform(0.03, 0.07))), lineType=cv2.LINE_AA)
    return img.astype(np.float32) / 255.0


def warp(a, rng, amp):
    h, w = a.shape
    dx = smooth_noise(h, w, max(8, h / 2), rng) * amp
    dy = smooth_noise(h, w, max(8, h / 2), rng) * amp + smooth_noise(1, w, w / 3, rng).repeat(h, 0) * amp * 1.5
    mx, my = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    return cv2.remap(a, mx + dx, my + dy, cv2.INTER_LINEAR, borderValue=0)


def column(text, neighbours, rng):
    size = int(rng.integers(44, 64))
    # the blocks leave wide gaps between words: widen some (the label keeps single spaces)
    drawn = ' '.join(w + ' ' * int(rng.integers(0, 3)) for w in text.split(' '))
    a = render_mask(drawn, size)
    if a is None:
        return None
    a = add_swashes(a, size, rng)
    a = woodblock(a, size, rng)
    rows = np.nonzero(a.max(1) > 0.2)[0]
    a = a[rows[0]:rows[-1] + 1]  # tight ink box: teeth/tails included
    h_line = a.shape[0]
    # canvas = one column pitch across. On the real crops the ink box (with tails) fills ~55-85% of it.
    H = int(h_line / rng.uniform(0.55, 0.85))
    padl, padr = int(size * rng.uniform(0.1, 0.8)), int(size * rng.uniform(0.2, 1.2))
    W = a.shape[1] + padl + padr
    ink = np.zeros((H, W), np.float32)
    y0 = int((H - h_line) * rng.uniform(0.25, 0.75))
    ink[y0:y0 + h_line, padl:padl + a.shape[1]] = a
    # neighbouring columns: their teeth/tails intrude at the top and bottom edge
    for side in (-1, 1):
        if neighbours and rng.random() < 0.7:
            nb = render_mask(neighbours[int(rng.integers(len(neighbours)))], size)
            if nb is None:
                continue
            nb = woodblock(nb, size, rng)
            off = y0 + (int(-nb.shape[0] - (H - h_line) * rng.uniform(0.2, 1.2)) if side < 0 else int(h_line + (H - h_line) * rng.uniform(0.2, 1.2)))
            xs = int(rng.uniform(-0.3, 0.3) * W)
            for yy in range(max(0, off), min(H, off + nb.shape[0])):
                row = nb[yy - off]
                x_a, x_b = max(0, xs), min(W, xs + len(row))
                if x_b > x_a:
                    ink[yy, x_a:x_b] = np.maximum(ink[yy, x_a:x_b], row[x_a - xs:x_b - xs])
    # frame rules: a vertical rule at a column end (the frame top/bottom), or a horizontal one along the edge
    if rng.random() < 0.18:
        x = int(rng.choice([rng.uniform(0, padl * 0.6), W - 1 - rng.uniform(0, padr * 0.6)]))
        cv2.line(ink, (x, 0), (x + int(rng.integers(-2, 3)), H - 1), 1.0, max(1, size // 18))
    if rng.random() < 0.08:
        y = int(rng.choice([rng.uniform(0, H * 0.08), H - 1 - rng.uniform(0, H * 0.08)]))
        cv2.line(ink, (0, y), (W - 1, y + int(rng.integers(-2, 3))), 1.0, max(1, size // 18))
    ink = warp(ink, rng, amp=rng.uniform(0.5, 2.5) * size / 40)
    # paper
    paper = np.array(PAPER[rng.integers(len(PAPER))], np.float32) + rng.normal(0, 3, 1)
    img = np.ones((H, W, 3), np.float32) * paper
    stain = smooth_noise(H, W, rng.uniform(20, 120), rng)[..., None] * rng.uniform(2, 9)
    tint = np.array([1.0, 1.0, rng.uniform(0.85, 1.0)], np.float32)
    img += stain * tint
    if rng.random() < 0.3:  # a darker blotch
        cx, cy, r = rng.uniform(0, W), rng.uniform(0, H), rng.uniform(5, 40)
        yy, xx = np.mgrid[0:H, 0:W]
        img -= (np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * r * r)) * rng.uniform(5, 25))[..., None] * tint
    # ink: colour, uneven impression, contrast (the leaves are faint: the ink sits 15-60 levels below the paper)
    inkc = np.array(INK[rng.integers(len(INK))], np.float32) + rng.normal(0, 8, 3)
    opacity = np.clip(rng.uniform(0.45, 0.95) + smooth_noise(H, W, rng.uniform(15, 60), rng) * rng.uniform(0.05, 0.25), 0.15, 1.0)
    al = (ink * opacity)[..., None]
    img = img * (1 - al) + inkc * al
    img += rng.normal(0, rng.uniform(1.5, 5.0), img.shape)  # grain
    img = np.clip(img, 0, 255).astype(np.uint8)
    # optics + scan: blur, downscale to the model's height, JPEG
    img = cv2.GaussianBlur(img, (0, 0), rng.uniform(0.3, 1.4))
    w_out = max(32, int(W * OUT_H / H))
    if rng.random() < 0.5:  # an intermediate lower resolution, like a smaller scan
        f = rng.uniform(0.6, 0.95)
        img = cv2.resize(img, (max(16, int(w_out * f)), max(16, int(OUT_H * f))), interpolation=cv2.INTER_AREA)
    img = cv2.resize(img, (w_out, OUT_H), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode('.jpg', img[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(45, 92))])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)[..., ::-1]


def norm(t):
    # never str.split(): it treats U+202F (NNBSP, the suffix connector) as whitespace and would rewrite every suffix
    t = unicodedata.normalize('NFC', t)
    return re.sub(r'[ \t\n\u3000]+', ' ', t).strip()


def sample_text(lines, rng, lo=14, hi=64):
    """A run of whole words from one line, lo..hi characters long; sometimes with block punctuation."""
    for _ in range(20):
        ws = [w for w in lines[int(rng.integers(len(lines)))].split(' ') if w]
        if not ws:
            continue
        i = int(rng.integers(0, len(ws)))
        out = []
        while i < len(ws) and len(' '.join(out + [ws[i]])) <= hi:
            out.append(ws[i]); i += 1
            if rng.random() < 0.08 and len(' '.join(out)) < hi - 3:
                out.append(PUNCT[rng.integers(len(PUNCT))])
        s = ' '.join(out)
        if len(s) >= lo:
            return norm(s)
    return None


def work(args):
    idx, seed, lines_path, out = args
    global LINES
    rng = np.random.default_rng(seed)
    t = sample_text(LINES, rng)
    if not t:
        return None
    nb = [sample_text(LINES, rng) or t for _ in range(2)]
    im = column(t, nb, rng)
    if im is None:
        return None
    name = f'img/{idx:06d}.jpg'
    Image.fromarray(im).save(os.path.join(out, name), quality=95)
    return {'image': name, 'text': t}


LINES = None


def init(path):
    global LINES
    LINES = [l.strip() for l in open(path, encoding='utf8') if l.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lines', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--n', type=int, default=1000)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--start', type=int, default=0)
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--sheet')
    a = ap.parse_args()
    os.makedirs(os.path.join(a.out, 'img'), exist_ok=True)
    jobs = [(a.start + i, a.seed * 1_000_003 + a.start + i, a.lines, a.out) for i in range(a.n)]
    rows = []
    with Pool(a.workers, initializer=init, initargs=(a.lines,)) as p, open(os.path.join(a.out, 'labels.jsonl'), 'a', encoding='utf8') as fo:
        for r in p.imap(work, jobs, chunksize=64):
            if r:
                fo.write(json.dumps(r, ensure_ascii=False) + '\n'); rows.append(r)
    print(f'{len(rows)} columns -> {a.out}', file=sys.stderr)
    if a.sheet:
        ims = [Image.open(os.path.join(a.out, r['image'])) for r in rows[:16]]
        Wd = max(i.width for i in ims)
        sh = Image.new('RGB', (Wd, sum(i.height + 6 for i in ims)), 'white'); y = 0
        for i in ims:
            sh.paste(i, (0, y)); y += i.height + 6
        sh.save(a.sheet, quality=92)


if __name__ == '__main__':
    main()
