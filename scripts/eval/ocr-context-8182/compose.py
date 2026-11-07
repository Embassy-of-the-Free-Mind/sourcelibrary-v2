#!/usr/bin/env python3
"""#8182 step 3: same pixels, different context. Segment real glyph units on a leaf (Chinese: characters in columns;
Tibetan: letter stacks, since the tsheg is not separable on Derge prints, PREREGISTRATION.md), from the PP-OCRv6 boxes
of ppseg.py, then build, from the SAME unit crops and one composer:

  N   units in their original order (controls for the recomposition itself)
  N2  N with a different margin and gap (layout noise floor: same context, shifted pixels)
  S   the same units in a seeded order that never existed, across lines, each line keeping its unit count
  W   N with a few single units replaced by another unit of the same leaf (same width class)
  B   N with ~10% of units Gaussian-blurred (instrument check: their reads must change more than the rest)

Writes <out>/<stem>/{N,N2,S,W,B}.png, manifest.json (unit ids per position per line for every image, the swaps,
the blurred set, segmentation counts) and seg.jpg (unit boxes drawn on the leaf, for opening by eye).

PRIOR ART: scripts/gpu/yigdzin-vllm/leafsplit.py (leaf bands of a pecha capture: reused via import for the leaf
crop); scripts/eval/split-leaf-5771/ (leaf crops, no glyph units). Nothing in scripts/eval segments glyphs or builds
scrambled images (`git grep -il "tsheg" scripts/eval` hits only text-side syllable splitters).

Run (gex45, /root/pz/venv):
  python compose.py --todo todo.jsonl --out DIR --prep   (rows: {stem, script: tib|zh, path}) -> DIR/<stem>/leaf.png
  python ppseg.py --todo DIR/pp-todo.jsonl --out DIR                                     -> DIR/<stem>.pp.json
  python compose.py --todo todo.jsonl --out DIR                                          -> the images
"""
import argparse, json, os, random, sys
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFilter

Image.MAX_IMAGE_PIXELS = None
SEED = 8182


# ── shared ────────────────────────────────────────────────────────────────────────────────────────────────
def runs(on):
    out, s = [], None
    for i, v in enumerate(on):
        if v and s is None: s = i
        elif not v and s is not None: out.append((s, i)); s = None
    if s is not None: out.append((s, len(on)))
    return out


# ── leaves ────────────────────────────────────────────────────────────────────────────────────────────────
MAX_SIDE = 4000


def leaf_of(path, script):
    """Tibetan: the tallest detected leaf band of the capture (leafsplit). Chinese: the whole page. Max side 4000."""
    im = Image.open(path).convert("RGB")
    if script == "tib":
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        try:
            from leafsplit import detect
            info = detect(im); bands = info.get("bands") or []
            if info.get("path") == "detected" and len(bands) >= 2:
                y0, y1 = max(bands, key=lambda b: b[1] - b[0])[:2]
                im = im.crop((0, max(0, int(y0)), im.width, min(im.height, int(y1))))
        except Exception as e:  # noqa: BLE001
            print(f"leafsplit failed: {e}", file=sys.stderr)
    s = MAX_SIDE / max(im.size)
    if s < 1: im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    return im


# ── Tibetan: lines from the PP-OCR detector, syllables at the tsheg ──────────────────────────────────────────
def norm_ink(rgb):
    """Background-normalised ink mask (textured or stained paper): min channel / its local background, Otsu."""
    m = rgb.min(axis=2).astype(np.uint8)
    bg = cv2.medianBlur(cv2.dilate(m, np.ones((9, 9), np.uint8)), 31).astype(np.float32)
    r = np.clip(m.astype(np.float32) / np.maximum(bg, 1) * 255, 0, 255).astype(np.uint8)
    _, th = cv2.threshold(r, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return (th > 0).astype(np.uint8)


def segment_tib(im, pp):
    rgb = np.asarray(im); H, W = rgb.shape[:2]
    boxes = [b for b in pp["boxes"] if (b[2] - b[0]) > 1.5 * (b[3] - b[1])]       # horizontal text boxes
    if len(boxes) < 2: return None, {"fail": "no detector lines", "boxes": len(pp["boxes"])}
    hmed = float(np.median([b[3] - b[1] for b in boxes]))
    boxes = [b for b in boxes if 0.5 * hmed <= b[3] - b[1] <= 1.8 * hmed]
    # lines: boxes whose vertical centres lie within 0.5 box-height of each other
    boxes.sort(key=lambda b: (b[1] + b[3]) / 2); lines = []
    for b in boxes:
        c = (b[1] + b[3]) / 2
        if lines and abs(c - lines[-1]["c"]) < 0.5 * hmed: lines[-1]["b"].append(b); lines[-1]["c"] = np.mean([(x[1] + x[3]) / 2 for x in lines[-1]["b"]])
        else: lines.append({"c": c, "b": [b]})
    ink = norm_ink(rgb)
    # specks: components smaller than (0.06 h)^2
    n, lab, st, _ = cv2.connectedComponentsWithStats(ink, 8)
    keep = np.zeros(n, bool); keep[1:] = st[1:, cv2.CC_STAT_AREA] >= max(3, (0.06 * hmed) ** 2)
    ink = keep[lab]
    cs = [l["c"] for l in lines]; pitch = float(np.median(np.diff(cs))) if len(cs) > 1 else 1.6 * hmed
    stats = {"lines": len(lines), "units": 0, "tsheg": 0, "shad": 0, "big_units": 0, "box_h": hmed, "pitch": pitch}
    out = []
    for L in lines:
        x0s = min(b[0] for b in L["b"]); x1s = max(b[2] for b in L["b"])
        top = int(min(b[1] for b in L["b"])); bot = int(max(b[3] for b in L["b"]))
        t, bm = max(0, int(L["c"] - 0.5 * pitch)), min(H, int(L["c"] + 0.5 * pitch))
        prof_rows = ink[top:bot, x0s:x1s].sum(axis=1)
        hy = top + int(np.argmax(prof_rows[: max(1, (bot - top) // 2)]))             # headline: upper half's peak
        # Units: ink-free column gaps in the letter-body zone (headline .. baseline). Measured 2026-11-04 by eye on the
        # pilot: on Derge prints the tsheg is not separable from its letters (PREREGISTRATION.md), so a unit is a
        # letter stack or a run of touching stacks, never cut through ink. Slivers (a tsheg dot, a broken stroke)
        # join their left neighbour.
        z0, z1 = max(0, hy), min(H, hy + int(0.45 * hmed))
        cover = np.zeros(W, bool)
        for b in L["b"]: cover[max(0, b[0]):b[2]] = True
        cp = ink[z0:z1].sum(axis=0) * cover
        segs = [list(sg) for sg in runs(cp > 0)]
        merged = []
        for sg in segs:
            if merged and (sg[1] - sg[0] < 0.15 * hmed or merged[-1][1] - merged[-1][0] < 0.15 * hmed) and sg[0] - merged[-1][1] < 0.12 * hmed:
                merged[-1][1] = sg[1]
            else:
                merged.append(sg)
        # equal granularity across prints: a run wider than 0.9 x-box-height is cut at column-profile minima into
        # pieces of ~0.6 (about one stack). N is built from the same cut crops, so a cut through touching ink is
        # in every image of the page alike.
        fine = []
        for ua, ub in merged:
            w = ub - ua; m = int(round(w / (0.6 * hmed)))
            if w > 0.9 * hmed and m >= 2:
                cs = [ua]
                for q in range(1, m):
                    c = ua + int(q * w / m); lo, hi = max(ua + 1, c - int(0.15 * hmed)), min(ub - 1, c + int(0.15 * hmed))
                    cs.append(lo + int(np.argmin(cp[lo:hi])) if hi > lo else c)
                cs.append(ub); fine += [[a2, b2] for a2, b2 in zip(cs, cs[1:]) if b2 > a2]; stats["cut_runs"] = stats.get("cut_runs", 0) + 1
            else:
                fine.append([ua, ub])
        merged = fine
        units = []
        for i, (ua, ub) in enumerate(merged):
            pl = merged[i - 1][1] if i else ua - 2; nx = merged[i + 1][0] if i + 1 < len(merged) else ub + 2
            ua2, ub2 = (pl + ua) // 2, (ub + nx + 1) // 2
            hgt = ink[t:bm, ua:ub].any(axis=1).sum()
            kd = "shad" if (ub - ua) < 0.2 * hmed and hgt > 0.7 * hmed else "syl"
            stats["shad"] += kd == "shad"
            units.append(([(ua2, ub2)], kd))
        row = []
        for i, (u, kd) in enumerate(units):
            ux0, ux1 = max(0, u[0][0]), min(W, u[-1][1])
            if ux1 - ux0 > 4 * hmed: stats["big_units"] += 1
            row.append({"box": [int(ux0), t, int(ux1), bm], "kind": kd, "img": rgb[t:bm, ux0:ux1].copy()})
        if row: out.append(row); stats["units"] += len(row)
    if not out: return None, {"fail": "no units", **stats}
    paper = tuple(int(v) for v in np.median(rgb[~ink.astype(bool)], axis=0))
    return {"lines": out, "paper": paper, "W": W, "xh": hmed, "line_pitch": pitch, "direction": "h"}, stats


# ── Chinese: columns and characters from the PP-OCR detector + CTC character boxes ───────────────────────────
HAN = lambda ch: any(0x3400 <= ord(c) <= 0x9FFF or 0x20000 <= ord(c) <= 0x3FFFF or 0xF900 <= ord(c) <= 0xFAFF for c in ch)  # noqa: E731


def segment_zh(im, pp):
    rgb = np.asarray(im); H, W = rgb.shape[:2]
    INK = norm_ink(rgb)
    cols, stats = [], {"boxes": len(pp["boxes"]), "vertical": 0, "units": 0, "non_han_dropped": 0}
    for b, chs, cbs in zip(pp["boxes"], pp["chars"], pp["char_boxes"]):
        if (b[3] - b[1]) < 1.5 * (b[2] - b[0]) or len(cbs) < 2: continue          # vertical columns of >= 2 chars
        stats["vertical"] += 1
        units = []
        bx0, bx1 = b[0] + int(0.06 * (b[2] - b[0])), b[2] - int(0.06 * (b[2] - b[0]))
        rp = INK[:, max(0, bx0):min(W, bx1)].sum(axis=1)
        cbs = [list(c) for c in cbs]
        for i in range(len(cbs) - 1):                       # snap each shared boundary to the emptiest row near it
            mid = (cbs[i][3] + cbs[i + 1][1]) // 2; r = max(2, int(0.2 * (cbs[i][3] - cbs[i][1])))
            lo, hi = max(0, mid - r), min(H, mid + r)
            if hi > lo: y = lo + int(np.argmin(rp[lo:hi])); cbs[i][3] = y; cbs[i + 1][1] = y
        for ch, cb in zip(chs, cbs):
            if not HAN(ch): stats["non_han_dropped"] += 1; continue
            x0, y0, x1, y1 = max(0, bx0), max(0, cb[1]), min(W, bx1), min(H, cb[3])
            if y1 - y0 < 3: continue
            units.append({"box": [x0, y0, x1, y1], "kind": "han", "img": rgb[y0:y1, x0:x1].copy()})
        if len(units) >= 2: cols.append((b[0], units))
    if not cols: return None, {"fail": "no vertical columns", **stats}
    cols.sort(key=lambda c: -c[0])                                                    # right to left
    out = [u for _, u in cols]; stats["units"] = sum(len(c) for c in out); stats["columns"] = len(out)
    ink = norm_ink(rgb); paper = tuple(int(v) for v in np.median(rgb[~ink.astype(bool)], axis=0))
    wmed = float(np.median([u["box"][2] - u["box"][0] for c in out for u in c]))
    return {"lines": out, "paper": paper, "W": W, "H": H, "xh": wmed, "direction": "v"}, stats


# ── composition ───────────────────────────────────────────────────────────────────────────────────────────
def compose(seg, order, margin=40, gap_add=0, blur=frozenset(), sigma=0.0):
    """order: list of lines, each a list of unit keys (line, idx) to place. One composer for every image."""
    U = {(li, ui): u for li, row in enumerate(seg["lines"]) for ui, u in enumerate(row)}
    xh = seg["xh"]; paper = seg["paper"]
    if seg["direction"] == "h":
        gap = int(round(0.05 * xh)) + gap_add
        slot_h = max(u["img"].shape[0] for u in U.values())
        pitch = int(max(seg["line_pitch"], slot_h * 0.75))
        width = max(sum(U[k]["img"].shape[1] for k in line) + gap * (len(line) - 1) for line in order) + 2 * margin
        height = pitch * (len(order) - 1) + slot_h + 2 * margin
        canvas = Image.new("RGB", (width, height), paper)
        for li, line in enumerate(order):
            x = margin
            for k in line:
                im = Image.fromarray(U[k]["img"])
                if k in blur: im = im.filter(ImageFilter.GaussianBlur(sigma))
                canvas.paste(im, (x, margin + li * pitch)); x += im.width + gap
        return canvas
    # vertical (Chinese): columns right to left, units top to bottom, each centred in a column of the max width
    gap = int(round(0.12 * xh)) + gap_add
    col_w = max(u["img"].shape[1] for u in U.values()); cgap = int(round(0.35 * col_w))
    height = max(sum(U[k]["img"].shape[0] for k in col) + gap * (len(col) - 1) for col in order) + 2 * margin
    width = len(order) * col_w + (len(order) - 1) * cgap + 2 * margin
    canvas = Image.new("RGB", (width, height), paper)
    for ci, col in enumerate(order):
        x = width - margin - (ci + 1) * col_w - ci * cgap; y = margin
        for k in col:
            im = Image.fromarray(U[k]["img"])
            if k in blur: im = im.filter(ImageFilter.GaussianBlur(sigma))
            canvas.paste(im, (x + (col_w - im.width) // 2, y)); y += im.height + gap
    return canvas


def build(row, out):
    stem = row["stem"]; d = os.path.join(out, stem); os.makedirs(d, exist_ok=True)
    im = Image.open(os.path.join(d, "leaf.png")).convert("RGB")
    pp = json.load(open(os.path.join(out, stem + ".pp.json")))
    if "error" in pp: seg, stats = None, {"fail": "detector error"}
    else: seg, stats = (segment_tib if row["script"] == "tib" else segment_zh)(im, pp)
    man = {"stem": stem, "script": row["script"], "seg": stats}
    if seg is None:
        man["outcome"] = "segmentation_failed"; json.dump(man, open(os.path.join(d, "manifest.json"), "w")); return man
    rng = random.Random(f"{SEED}:{stem}")
    N = [[(li, ui) for ui in range(len(r))] for li, r in enumerate(seg["lines"]) if r]
    keys = [k for line in N for k in line]
    if len(keys) < 20:
        man["outcome"] = "too_few_units"; json.dump(man, open(os.path.join(d, "manifest.json"), "w")); return man
    # S: a seeded permutation of every unit across the page; each line keeps its unit count. Re-drawn until no unit
    # keeps its N neighbour on either side (so no unit sits in its original bigram).
    best = None
    for _ in range(50):
        perm = keys[:]; rng.shuffle(perm)
        S, i = [], 0
        for line in N: S.append(perm[i:i + len(line)]); i += len(line)
        nb = {(a, b) for line in N for a, b in zip(line, line[1:])}
        kept = sum((a, b) in nb for line in S for a, b in zip(line, line[1:]))
        if best is None or kept < best[0]: best = (kept, S)
        if kept == 0: break
    S = best[1]
    U = {k: seg["lines"][k[0]][k[1]] for k in keys}
    # W: k single swaps; the target and the donor are syllable/han units of similar width (+-30%), donor elsewhere
    body = [k for k in keys if U[k]["kind"] != "shad"]
    kW = max(3, round(0.05 * len(body)))
    targets = rng.sample(body, min(kW, len(body)))
    swaps = {}
    for t in targets:
        wt = U[t]["img"].shape[1 if seg["direction"] == "h" else 0]
        cands = [k for k in body if k not in targets and k != t and k not in swaps.values() and
                 abs(U[k]["img"].shape[1 if seg["direction"] == "h" else 0] - wt) <= 0.3 * wt and abs(k[0] - t[0]) + abs(k[1] - t[1]) > 3]
        if cands: swaps[t] = rng.choice(cands)
    Wo = [[swaps.get(k, k) for k in line] for line in N]
    # B: ~10% of units blurred, sigma 0.22 x-height
    blur = set(rng.sample(body, max(3, round(0.10 * len(body)))))
    sigma = 0.22 * seg["xh"]
    imgs = {"N": compose(seg, N), "N2": compose(seg, N, margin=72, gap_add=3), "S": compose(seg, S),
            "W": compose(seg, Wo), "B": compose(seg, N, blur=frozenset(blur), sigma=sigma)}
    for name, c in imgs.items(): c.save(os.path.join(d, f"{name}.png"))
    # seg.jpg: the boxes on the leaf, for opening by eye
    dbg = im.copy(); dr = ImageDraw.Draw(dbg)
    for li, r in enumerate(seg["lines"]):
        for ui, u in enumerate(r):
            dr.rectangle(u["box"], outline=(0, 90, 255) if u["kind"] != "shad" else (0, 170, 0), width=1)
    dbg.save(os.path.join(d, "seg.jpg"), quality=85)
    j = lambda o: [[list(k) for k in line] for line in o]   # noqa: E731
    man.update({"outcome": "ok", "units": len(keys), "kinds": {k[0]: U[k]["kind"] for k in []},
                "unit_kind": {f"{k[0]}.{k[1]}": U[k]["kind"] for k in keys},
                "order": {"N": j(N), "N2": j(N), "S": j(S), "W": j(Wo), "B": j(N)},
                "swaps": {f"{t[0]}.{t[1]}": f"{s[0]}.{s[1]}" for t, s in swaps.items()},
                "blurred": [f"{k[0]}.{k[1]}" for k in sorted(blur)], "sigma": sigma, "S_kept_bigrams": best[0],
                "size": {k: list(v.size) for k, v in imgs.items()}})
    del man["kinds"]
    json.dump(man, open(os.path.join(d, "manifest.json"), "w"))
    return man


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--todo", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--prep", action="store_true", help="only cut the leaves (leaf.png) and write the detector todo")
    a = ap.parse_args()
    if a.prep:
        with open(os.path.join(a.out, "pp-todo.jsonl"), "w") as f:
            for line in open(a.todo):
                row = json.loads(line); d = os.path.join(a.out, row["stem"]); os.makedirs(d, exist_ok=True)
                lp = os.path.join(d, "leaf.png")
                if not os.path.exists(lp): leaf_of(row["path"], row["script"]).save(lp)
                f.write(json.dumps({"stem": row["stem"], "path": lp}) + "\n")
        return
    for line in open(a.todo):
        row = json.loads(line)
        try:
            m = build(row, a.out)
        except Exception as e:  # noqa: BLE001  an exception is an outcome, recorded, never a silent drop
            m = {"stem": row["stem"], "outcome": "error", "error": repr(e)[:300]}
            os.makedirs(os.path.join(a.out, row["stem"]), exist_ok=True)
            json.dump(m, open(os.path.join(a.out, row["stem"], "manifest.json"), "w"))
        print(json.dumps({k: m.get(k) for k in ("stem", "outcome", "units", "seg")}), flush=True)


if __name__ == "__main__":
    main()
