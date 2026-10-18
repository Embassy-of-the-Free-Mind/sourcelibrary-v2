#!/usr/bin/env python3
"""guard.py — the frozen output guard for production Paddle on held Chinese table + mixed pages (#6871 row 3).

PRIOR ART: scripts/eval/zh-residue-bakeoff-6871/score.py (its "overrun" count needs the reference; this needs only
the output and the image); scripts/eval/zh-residue-refs-6871/compare.py (`han()`, imported unchanged). The #5660
fleet's own checks (paddle-zh-run.py) catch errors and empty output, not loops or collapse.

Designed from the 100 bake-off pages ONLY (PR #6895: P0 reads + ink.py on the same images), then frozen before the
fresh draw (preregistration 2026-10-18-zh-guarded-paddle-prereg-6871.md). Do not tune these constants on the fresh
pages; a changed guard needs a new draw.

Rules, on the Han string of Paddle's output (HTML stripped; no reference needed) and ink.py's image features:
  LOOP     n >= 30 and (zlib ratio < 0.25 or some 6-gram repeats >= 20 times)
           bake-off: every loop had ratio <= 0.03 / 6-gram count >= 35; no real page under 0.33 / above 11
  OVERRUN  n > 1.2 * ink        (ink = dark px per 10,000 after ruling lines are removed)
           real pages reach 0.84 chars per ink unit (a dense ephemeris table); the blank-leaf loop was 26
  COLLAPSE ink >= 300 and n < 0.06 * ink
           collapses: 0.001-0.047; real text pages >= 0.075, except one 啟蒙意見 diagram page at 0.047, which this flags
           (the one in-sample false positive: 15 of 16 collapses/loops caught, 1 of ~80 good pages flagged)
  NUMERIC  (n >= 50 and numeral share >= 0.6) or blobs >= 2000
           the dense ephemeris tables Paddle loops or collapses on: 2,231 and 2,499 glyph blobs, all else <= 1,721
Route: no flag -> PADDLE.  Any flag -> FLASH if ink >= 250, else HOLD (a near-blank leaf: leave it unread).
"""
import os, re, sys, zlib
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'zh-residue-refs-6871'))
from compare import han  # noqa: E402

NUMERALS = set('〇○一二三四五六七八九十百千萬')
TAGS = re.compile(r'<[^>]+>')
K = dict(loop_min_n=30, loop_zlib=0.25, loop_rep=20, overrun_per_ink=1.2, collapse_min_ink=300, collapse_per_ink=0.06,
         num_min_n=50, num_share=0.6, num_blobs=2000, hold_below_ink=250)


def features(text, ink):
    h = han(TAGS.sub('\n', text or ''), box=False)
    n = len(h)
    g = Counter(h[i:i + 6] for i in range(max(0, n - 5)))
    return {'n': n, 'zlib': round(len(zlib.compress(h.encode())) / len(h.encode()), 3) if n else None,
            'rep6': max(g.values()) if g else 0, 'num': round(sum(c in NUMERALS for c in h) / n, 3) if n else 0.0,
            'ink': ink['ink'], 'blobs': ink['blobs']}


def guard(text, ink):
    f = features(text, ink)
    n = f['n']
    flags = []
    if n >= K['loop_min_n'] and (f['zlib'] < K['loop_zlib'] or f['rep6'] >= K['loop_rep']): flags.append('LOOP')
    if n > K['overrun_per_ink'] * f['ink']: flags.append('OVERRUN')
    if f['ink'] >= K['collapse_min_ink'] and n < K['collapse_per_ink'] * f['ink']: flags.append('COLLAPSE')
    if (n >= K['num_min_n'] and f['num'] >= K['num_share']) or f['blobs'] >= K['num_blobs']: flags.append('NUMERIC')
    route = 'PADDLE' if not flags else 'FLASH' if f['ink'] >= K['hold_below_ink'] else 'HOLD'
    return {'route': route, 'flags': flags, **f}
