# /// script
# requires-python = ">=3.10"
# dependencies = ["pymongo[srv]>=4.6", "opencv-python-headless>=4.9", "numpy>=1.26"]
# ///
"""
page-image-same-printing — are two book records the same PRINTING? Answered from page images, before OCR.

PRIOR ART: scripts/clip-find-duplicates.mjs — CLIP over illustrations (finds a reused woodblock, which
different editions share, so it cannot separate editions); scripts/lib/page-alignment.mjs dHash — tested
here and rejected: two libraries' photographs of one printing differ by crop, lighting and skew, so
whole-page dHash scores positives and negatives alike (~30 of 256 bits); it only catches the same scan
stored twice. scripts/README-dedup.md records a 9x8 dHash over-grouping text pages. #4285's page-text
comparator needs OCR on both sides, which is what this screen exists to avoid paying for.

WHY. Duplicate records cost twice at OCR and translation. The title/author/year keys miss most real
duplicates and pass some false ones (#6019, #4285), and an unread book has no text to compare.
Two photographs of one printing show the same glyphs in the same geometry; a reset edition does
not, even with identical wording. ORB keypoints + a RANSAC homography count how many matched points
agree on one geometric mapping (inliers), which survives crop, scale, lighting and slight rotation.

METHOD. Sample 8 interior leaves of A (12%..94%). For each, compare against B's leaves in a window
(same relative position +-8 and same absolute leaf +-8, or +-(|nA-nB|+10) with --wide), keep the best
inlier count. Verdict on the MEDIAN over samples (one shared copper plate or woodcut must not decide):
  same_printing   median >= 40
  different       median <= 15
  unclear         otherwise, or fewer than 4 scorable samples
Calibration (2026-10-21, 25 pairs, scripts/eval/experiments/2026-10-21-page-image-same-printing.md):
different editions / printings / volumes 6-16 (max single page 32, except a reused plate at 265);
same printings 56-1,400. Two Nosologia 1615 records scored 10: title pages read by eye show two
typesettings of one year, so the metadata keys were wrong and the images were right.

THIS SCRIPT READS ONLY. It writes nothing to Mongo. It fetches page images (R2 first, then the
provider's IIIF at 1000px) into a local cache.

Usage:
  uv run scripts/audit/page-image-same-printing.py --pair <bookA> <bookB> [--wide]
  uv run scripts/audit/page-image-same-printing.py --pairs pairs.tsv --out verdicts.jsonl [--wide]
      pairs.tsv: one "bookA<TAB>bookB" per line
Env: MONGODB_URI (load with: set -a; source .env.production.local; set +a).
Options: --cache DIR (default /tmp/page-image-same-printing), --workers N (default 6).
"""
import argparse, concurrent.futures as cf, hashlib, json, os, re, statistics, sys, time, urllib.request

import cv2
import numpy as np
from pymongo import MongoClient

RELS = [0.12, 0.24, 0.36, 0.48, 0.60, 0.72, 0.84, 0.94]
SAME, DIFF, MIN_SCORED = 40, 15, 4
MIN_SPREAD = 0.08  # share of the leaf the inliers' central 80% box must cover
UA = 'SourceLibrary page-image-same-printing (team@sourcelibrary.org)'


def image_url(p):
    a = p.get('archived_photo')
    if isinstance(a, str) and a.startswith('http') and not re.search(r'fail|unavailable', a, re.I):
        return a
    u = p.get('photo') or p.get('photo_original')
    return re.sub(r'/full/(full|max|pct:\d+|\d*,\d*)/0/', '/full/1000,/0/', u) if u else None


class Images:
    def __init__(self, cache_dir):
        self.dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)
        self.orb = cv2.ORB_create(nfeatures=3000)
        self.feats = {}
        self.failures = 0

    def fetch(self, url):
        fp = os.path.join(self.dir, hashlib.sha1(url.encode()).hexdigest() + '.jpg')
        if os.path.exists(fp):
            return fp
        for attempt in range(4):
            try:
                data = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60).read()
                # Keep only what features() reads: grayscale, long side 1000px. R2 originals average
                # ~1 MB, and a 1,300-pair run cached 111 GB of them and filled a shared box (2026-10-22).
                img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
                if img is None:
                    break
                h, w = img.shape
                s = 1000.0 / max(h, w)
                if s < 1:
                    img = cv2.resize(img, (int(w * s), int(h * s)))  # same resize features() applied to originals
                cv2.imwrite(fp, img, [cv2.IMWRITE_JPEG_QUALITY, 90])
                return fp
            except Exception:
                time.sleep(2 * (attempt + 1))
        self.failures += 1
        return None

    def features(self, url):
        if url in self.feats:
            return self.feats[url]
        r = None
        fp = self.fetch(url) if url else None
        img = cv2.imread(fp, cv2.IMREAD_GRAYSCALE) if fp else None
        if img is not None:
            h, w = img.shape
            s = 1000.0 / max(h, w)
            img = cv2.resize(img, (int(w * s), int(h * s)))
            if img.std() > 12:  # blank leaves match everything; skip them
                kp, des = self.orb.detectAndCompute(img, None)
                if des is not None and len(kp) > 50:
                    r = (np.float32([k.pt for k in kp]), des, img.shape)
        self.feats[url] = r
        return r


cv2.setNumThreads(1)  # parallelism comes from running shards; OpenCV's own pool oversubscribes a shared box
BF = cv2.BFMatcher(cv2.NORM_HAMMING)


def inliers(fa, fb):
    if not fa or not fb:
        return None
    good = [m[0] for m in BF.knnMatch(fa[1], fb[1], k=2) if len(m) == 2 and m[0].distance < 0.75 * m[1].distance]
    if len(good) < 8:
        return 0
    src = fa[0][[g.queryIdx for g in good]].reshape(-1, 1, 2)
    dst = fb[0][[g.trainIdx for g in good]].reshape(-1, 1, 2)
    _, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
    if mask is None:
        return 0
    n = int(mask.sum())
    # A provider watermark or colour chart stamped on every photograph matches itself across
    # unrelated books (National Museum New Delhi: a music grid and a Persian text scored 150+).
    # Printed text spreads its matches over the leaf; a stamp keeps them in one corner. Count
    # inliers only when their bounding box covers a real share of the page.
    pts = src.reshape(-1, 2)[mask.ravel() == 1]
    # 10th-90th percentile, so a few stray inliers outside the stamp cannot stretch the box.
    span = lambda v: float(np.percentile(v, 90) - np.percentile(v, 10)) if len(v) else 0.0
    if n and span(pts[:, 0]) * span(pts[:, 1]) < MIN_SPREAD * fa[2][0] * fa[2][1]:
        return 0
    return n


def pages_of(db, book_id):
    return list(db.pages.find({'book_id': book_id}, {'page_number': 1, 'photo': 1, 'photo_original': 1, 'archived_photo': 1}).sort('page_number', 1))


def compare(db, imgs, a, b, wide, workers):
    A, B = pages_of(db, a), pages_of(db, b)
    if not A or not B:
        return {'a': a, 'b': b, 'verdict': 'unclear', 'why': 'no pages on one side'}
    radius = abs(len(A) - len(B)) + 10 if wide else 8
    samples = []
    for r in RELS:
        ia, ib = int(r * len(A)), int(r * len(B))
        win = sorted({k for d in range(-radius, radius + 1) for k in (ia + d, ib + d) if 0 <= k < len(B)})
        samples.append((image_url(A[ia]), [image_url(B[k]) for k in win]))
    urls = {u for s in samples for u in [s[0], *s[1]] if u}
    with cf.ThreadPoolExecutor(workers) as ex:
        list(ex.map(imgs.fetch, urls))
    best = []
    for ua, wb in samples:
        fa = imgs.features(ua) if ua else None
        scores = [x for x in (inliers(fa, imgs.features(u)) for u in wb if u) if x is not None] if fa else []
        best.append(max(scores) if scores else None)
    scored = [x for x in best if x is not None]
    med = statistics.median(scored) if scored else None
    if len(scored) < MIN_SCORED:
        verdict = 'unclear'
    elif med >= SAME:
        verdict = 'same_printing'
    elif med <= DIFF:
        verdict = 'different'
    else:
        verdict = 'unclear'
    return {'a': a, 'b': b, 'nA': len(A), 'nB': len(B), 'window': radius, 'inliers': best, 'median': med, 'verdict': verdict}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pair', nargs=2)
    ap.add_argument('--pairs')
    ap.add_argument('--out')
    ap.add_argument('--wide', action='store_true')
    ap.add_argument('--cache', default='/tmp/page-image-same-printing')
    ap.add_argument('--workers', type=int, default=6)
    args = ap.parse_args()
    pairs = [tuple(args.pair)] if args.pair else [tuple(l.split('\t')[:2]) for l in open(args.pairs).read().splitlines() if l.strip()]
    if not pairs:
        sys.exit('--pair A B or --pairs <tsv> is required')
    db = MongoClient(os.environ['MONGODB_URI'], serverSelectionTimeoutMS=30000).bookstore
    imgs = Images(args.cache)
    out = open(args.out, 'a') if args.out else None
    for a, b in pairs:
        res = compare(db, imgs, a.strip(), b.strip(), args.wide, args.workers)
        line = json.dumps(res)
        print(line, flush=True)
        if out:
            out.write(line + '\n')
            out.flush()
    if imgs.failures:
        print(f'image fetch failures: {imgs.failures} (those leaves were skipped, not scored)', file=sys.stderr)


if __name__ == '__main__':
    main()
