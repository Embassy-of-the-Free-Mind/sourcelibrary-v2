#!/usr/bin/env python3
# PRIOR ART: hetzner:/root/tibetan-eval/e5_split_binarise.py (2026-09-11, split + OpenCV-adaptive "Sauvola"
# on one EAP page, woodblock ONNX engine, n=1, never logged in EXPERIMENTS.md) and sl-mitra-1:/root/yig/leafsplit.py
# (the #4722 per-leaf partition crops). Neither defines the #5250 arms as one module usable by every engine;
# this does, and imports nothing from either except the leaf splitter (loaded by path, see leafcrop()).
"""Image-preprocessing arms for the #5250 OCR experiment (pre-registered on the issue).

One function per arm, all taking and returning a uint8 BGR numpy image. Every arm starts from the
PRODUCTION input: the page image downscaled to ≤ 2400 px wide with Lanczos (`base()`, the same
`OCR_TARGET_W` the Tibetan worker uses), so only the transform differs between arms.

Arms: none, otsu, sauvola (window 25, k 0.2), clahe (clip 2.0, tile 8), deskew (projection profile,
±5°), upscale2x (Lanczos). Crops are engine-specific and live in the drivers (Tibetan leafcrop,
Syriac gutter). `apply(arm, img)` returns (image, meta) where meta records what the arm did
(e.g. the deskew angle), so a no-op is visible in the results rather than inferred.

Round 2 adds photometric arms (ARMS_R2): unsharp (sigma 2, amount 1.0), gamma08 / gamma12 (out = 255*(in/255)**g),
flatten (divide by a 51-px Gaussian background, min-max renormalise), gray (luma), denoise (fastNlMeansDenoising h=10).

CLI:  preprocess.py <arm> <in.jpg> <out.jpg>   (writes JPEG q95, prints meta as JSON)
"""
import json
import sys

import cv2
import numpy as np
from skimage.filters import threshold_sauvola

TARGET_W = 2400
ARMS = ["none", "otsu", "sauvola", "clahe", "deskew", "upscale2x"]


def base(img):
    """Production input: Lanczos downscale to TARGET_W wide, never enlarge."""
    h, w = img.shape[:2]
    if w <= TARGET_W:
        return img
    return cv2.resize(img, (TARGET_W, round(h * TARGET_W / w)), interpolation=cv2.INTER_LANCZOS4)


def _gray(img):
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img


def _bgr(g):
    return cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)


def otsu(img):
    g = _gray(img)
    t, b = cv2.threshold(cv2.GaussianBlur(g, (3, 3), 0), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return _bgr(b), {"threshold": float(t)}


def sauvola(img, window=25, k=0.2):
    g = _gray(img)
    t = threshold_sauvola(g, window_size=window, k=k)
    return _bgr(((g > t) * 255).astype(np.uint8)), {"window": window, "k": k}


def clahe(img, clip=2.0, tile=8):
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = cv2.createCLAHE(clipLimit=clip, tileGridSize=(tile, tile)).apply(l)
    return cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR), {"clip": clip, "tile": tile}


def _rotate(img, angle):
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(img, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def estimate_skew(img, max_deg=5.0, step=0.25):
    """Angle (degrees) maximising the variance of the ink projection profile, over rows OR columns
    (columns for vertical CJK). Measured on an 800-px-wide Otsu mask of the ink."""
    g = _gray(img)
    s = 800 / g.shape[1]
    g = cv2.resize(g, (800, max(1, round(g.shape[0] * s))), interpolation=cv2.INTER_AREA)
    _, ink = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    best, best_score = 0.0, -1.0
    base_score = None
    for a in np.arange(-max_deg, max_deg + 1e-9, step):
        r = _rotate(ink, a)
        score = max(np.var(r.sum(axis=1)), np.var(r.sum(axis=0)))
        if abs(a) < 1e-9:
            base_score = score
        if score > best_score:
            best, best_score = float(a), score
    return best, (best_score / base_score if base_score else None)


def deskew(img):
    a, gain = estimate_skew(img)
    out = img if abs(a) < 1e-9 else _rotate(img, a)
    return out, {"angle": a, "profile_gain": round(gain, 4) if gain else None}


def upscale2x(img):
    h, w = img.shape[:2]
    return cv2.resize(img, (w * 2, h * 2), interpolation=cv2.INTER_LANCZOS4), {"scale": 2}


# ── Round 2 (#5250, pre-registered 2026-09-29): photometric arms nobody tested in round 1 ──────────────────────
ARMS_R2 = ["unsharp", "gamma08", "gamma12", "flatten", "gray", "denoise"]


def unsharp(img, radius=2.0, amount=1.0):
    """out = img + amount * (img - GaussianBlur(img, sigma=radius))."""
    blur = cv2.GaussianBlur(img, (0, 0), radius)
    return cv2.addWeighted(img, 1.0 + amount, blur, -amount, 0), {"radius": radius, "amount": amount}


def gamma(img, g):
    """out = 255 * (in/255) ** g.  g < 1 lightens mid-tones, g > 1 darkens them (ink gets heavier)."""
    lut = np.clip(255.0 * (np.arange(256) / 255.0) ** g + 0.5, 0, 255).astype(np.uint8)
    return cv2.LUT(img, lut), {"gamma": g}


def flatten(img, ksize=51):
    """Illumination flattening: divide each channel by its 51-px Gaussian background, then min-max renormalise."""
    f = img.astype(np.float32) + 1.0
    bg = cv2.GaussianBlur(f, (ksize, ksize), 0)
    r = f / bg
    lo, hi = np.percentile(r, 0.5), np.percentile(r, 99.5)
    out = np.clip((r - lo) / max(hi - lo, 1e-6) * 255.0, 0, 255).astype(np.uint8)
    return out, {"ksize": ksize, "lo": round(float(lo), 4), "hi": round(float(hi), 4)}


def gray(img):
    """Luma only (BT.601, OpenCV), returned as 3 identical channels so every engine gets the same format."""
    return _bgr(_gray(img)), {}


def denoise(img, h=10):
    """cv2.fastNlMeansDenoising (the grayscale function named in the pre-registration) on the luma, h=10."""
    return _bgr(cv2.fastNlMeansDenoising(_gray(img), None, h=h, templateWindowSize=7, searchWindowSize=21)), {"h": h}


FUNCS = {"otsu": otsu, "sauvola": sauvola, "clahe": clahe, "deskew": deskew, "upscale2x": upscale2x,
         "unsharp": unsharp, "gamma08": lambda i: gamma(i, 0.8), "gamma12": lambda i: gamma(i, 1.2),
         "flatten": flatten, "gray": gray, "denoise": denoise}


def apply(arm, img, already_base=False):
    """Production downscale, then the arm. `none` is the downscale alone."""
    b = img if already_base else base(img)
    if arm == "none":
        return b, {}
    return FUNCS[arm](b)


def main():
    arm, src, dst = sys.argv[1:4]
    img = cv2.imread(src, cv2.IMREAD_COLOR)
    if img is None:
        sys.exit(f"cannot read {src}")
    out, meta = apply(arm, img)
    cv2.imwrite(dst, out, [cv2.IMWRITE_JPEG_QUALITY, 95])
    meta.update({"arm": arm, "in_px": list(img.shape[1::-1]), "out_px": list(out.shape[1::-1])})
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
