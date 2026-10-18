#!/usr/bin/env python3
"""
PRIOR ART: the ink-projection column count in scripts/eval/mongol-ocr-probe-5664.mjs's write-up (2026-10-04,
counts columns only, no boxes, no frame); scripts/eval/mongol-argon-probe-5664.mjs (4 fixed vertical strips, not
columns). Nothing in the repo cuts a Kanjur leaf into its columns.

Column segmenter for the Beijing Mongolian Kanjur (BDRC W4CZ5370, #5664): red ink on toned paper, a ruled frame,
22-31 vertical columns per side, a Chinese margin label at the right. Returns one box per text column, in reading
order (left to right), in full-resolution pixel coordinates.

  python3 segment.py page.jpg [--debug out.jpg]     -> JSON on stdout: {frame, pitch, columns:[[x0,y0,x1,y1],...]}

Method: an ink mask from the Lab a* channel (red ink sits well above the paper's a*), long horizontal runs give the
top/bottom frame rules, long vertical runs give the side rules (outer frame, inner rule, the Chinese-margin rules).
Inside the text box, the vertical ink profile is smoothed and cut at the valley between neighbouring peaks, regularised
to the page's own pitch (spectrum of the ink profile): one column per profile peak, at least 0.7 pitch apart, so a
tail swash that crosses a gap neither merges two columns nor splits one.
"""
import json, sys
import numpy as np
import cv2

W_AN = 2000  # analysis width


def ink_mask(bgr):
    """Ink = darker than the local paper and redder than it. Local background by a large median blur, so stains
    and uneven toning cancel; the threshold is set from the page's own noise (robust MAD), so faint and strong
    impressions both binarise."""
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    L = lab[..., 0].astype(np.float32); a = lab[..., 1].astype(np.float32)
    bgL = cv2.medianBlur(lab[..., 0], 51).astype(np.float32)
    bga = cv2.medianBlur(lab[..., 1], 51).astype(np.float32)
    d = (bgL - L) + 1.5 * (a - bga)
    med = np.median(d); mad = np.median(np.abs(d - med)) * 1.4826 + 1e-3
    m = (d > med + max(5.0, 3.5 * mad)).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return m


def runs(prof, frac):
    """indices where a profile exceeds frac of its max, grouped into runs -> list of (start, end)."""
    on = prof > frac * prof.max()
    out = []; s = None
    for i, v in enumerate(on):
        if v and s is None: s = i
        if not v and s is not None: out.append((s, i - 1)); s = None
    if s is not None: out.append((s, len(on) - 1))
    return out


def segment(path, debug=None):
    full = cv2.imread(path)
    H0, W0 = full.shape[:2]
    sc = W_AN / W0
    img = cv2.resize(full, (W_AN, int(H0 * sc)), interpolation=cv2.INTER_AREA)
    H, W = img.shape[:2]
    m = ink_mask(img)
    # frame rules. Rows: the strongest ink row in the top and bottom thirds (inner band of x, so the
    # paper edge and the margin label do not count). Columns: rules are the narrow columns whose ink covers most
    # of the frame height; text columns cover <= ~40% (word gaps), rules > 60%.
    r = np.convolve(m[:, W // 4: 3 * W // 4].mean(1), np.ones(3) / 3, mode='same')
    top = float(np.argmax(r[: int(H * 0.35)]))
    bot = float(int(H * 0.65) + np.argmax(r[int(H * 0.65):]))
    if r[int(top)] < 0.15 or r[int(bot)] < 0.15:
        raise RuntimeError('no frame rules found')
    # Side rules. The leaf has a double rule on each side: outer frame, then (about one column pitch in) the inner
    # rule that fences off a narrow margin strip (left: a small Mongolian running title; right: the Chinese
    # section/volume/folio label). A rule is a thin line: dense in a 3 px band, sparse 5-10 px either side.
    c = m[int(top) + 8:int(bot) - 8].mean(0)
    thin = np.zeros(W)
    for x in range(11, W - 11):
        thin[x] = c[x - 1:x + 2].mean() - np.concatenate([c[x - 10:x - 4], c[x + 5:x + 11]]).mean()
    # pitch from the spectrum of the column profile over the middle of the leaf
    mid = c[int(W * 0.3):int(W * 0.7)] - c[int(W * 0.3):int(W * 0.7)].mean()
    spec = np.abs(np.fft.rfft(mid * np.hanning(len(mid))))
    f = np.fft.rfftfreq(len(mid))
    ok = (f > 1 / (W * 0.05)) & (f < 1 / (W * 0.018))
    pitch = 1 / f[ok][np.argmax(spec[ok])]
    def strongest(lo, hi):
        lo, hi = int(max(11, lo)), int(min(W - 11, hi))
        if hi <= lo: return None
        x = lo + int(np.argmax(thin[lo:hi]))
        return x if thin[x] > 0.35 and c[x] > 0.5 else None
    oL = strongest(0, W * 0.15); oR = strongest(W * 0.85, W)
    iL = strongest(oL + 0.6 * pitch, oL + 1.4 * pitch) if oL is not None else None
    iR = strongest(oR - 1.4 * pitch, oR - 0.6 * pitch) if oR is not None else None
    x0 = float(iL if iL is not None else (oL + pitch if oL is not None else 0)) + 3
    x1 = float(iR if iR is not None else (oR - pitch if oR is not None else W - 1)) - 3
    rule_kind = 'double' if None not in (oL, iL, oR, iR) else 'partial'
    pad_y = 0.01 * H
    y0, y1 = top + pad_y, bot - pad_y
    sub = m[int(y0):int(y1), int(x0):int(x1)].astype(float)
    prof = sub.sum(0)
    # column centres = peaks of the profile smoothed over ~half a pitch, at least 0.7 pitch apart
    ks = max(3, int(pitch * 0.5)) | 1
    pv = np.convolve(prof, np.hanning(ks) / np.hanning(ks).sum(), mode='same')
    cand = [i for i in range(1, len(pv) - 1) if pv[i] >= pv[i - 1] and pv[i] >= pv[i + 1] and pv[i] > 0.25 * pv.max()]
    cand.sort(key=lambda i: -pv[i])
    peaks = []
    for i in cand:
        if all(abs(i - q) >= 0.7 * pitch for q in peaks):
            peaks.append(i)
    peaks.sort()
    # a peak hugging the box edge is a rule the frame finder left inside, not a column
    peaks = [q for q in peaks if 0.4 * pitch <= q <= len(pv) - 1 - 0.4 * pitch]
    # cut halfway between centres (Mongolian tails swash left of the spine, so the valley is not a safer cut)
    edges = [max(0, int(peaks[0] - pitch / 2))] + [int(np.argmin(pv[a_:b_]) + a_) if b_ - a_ > 2 else (a_ + b_) // 2
                                                  for a_, b_ in zip(peaks[:-1], peaks[1:])] + [min(len(pv) - 1, int(peaks[-1] + pitch / 2))]
    boxes = []
    for a_, b_ in zip(edges[:-1], edges[1:]):
        seg = sub[:, a_:b_]
        rowsum = seg.sum(1)
        nz = np.nonzero(rowsum > 0)[0]
        ya, yb = (nz[0], nz[-1]) if len(nz) else (0, sub.shape[0] - 1)
        boxes.append([int((x0 + a_) / sc), int(max(0, (y0 + ya - 4) / sc)), int((x0 + b_) / sc), int(min(H0, (y0 + yb + 4) / sc))])
    out = {'size': [W0, H0], 'frame': [int(x0 / sc), int(top / sc), int(x1 / sc), int(bot / sc)],
           'pitch': round(pitch / sc, 1), 'frame_kind': rule_kind, 'columns': boxes}
    if debug:
        d = img.copy()
        cv2.rectangle(d, (int(x0), int(top)), (int(x1), int(bot)), (255, 0, 0), 2)
        for i, (a, b_, c, e) in enumerate(boxes):
            cv2.rectangle(d, (int(a * sc), int(b_ * sc)), (int(c * sc), int(e * sc)), (0, 160, 0), 1)
            cv2.putText(d, str(i + 1), (int(a * sc) + 2, int(b_ * sc) - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 200), 1)
        cv2.imwrite(debug, d)
    return out


if __name__ == '__main__':
    dbg = sys.argv[sys.argv.index('--debug') + 1] if '--debug' in sys.argv else None
    print(json.dumps(segment(sys.argv[1], dbg)))
