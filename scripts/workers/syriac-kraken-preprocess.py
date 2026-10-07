#!/usr/bin/env python3
# PRIOR ART: scripts/eval/ocr-preprocessing/preprocess.py (#5250 rounds 1-3) holds the arm functions; this file IMPORTS
# them by path (one definition, the measured one) and adds only what the lane needs: a capture-class classifier and
# the per-class arm choice. scripts/eval/ocr-preprocessing/gutter.py is the other Python port of lane code; the
# gutter cut itself stays in scripts/lib/syriac-kraken-lane.mjs.
"""Per-stratum image preprocessing for the Syriac Kraken lane (#5277). CPU only.

WHY: #5250 round 3 confirmed, on 80 fresh published-GT folios read by Kraken Sophro Mhiro, that the arms are OPPOSITE
in kind per capture class: sauvola helps dark spreads (38-2, -3.8 pp CER) and flatten helps clean leaves (40-0,
-10.6 pp), while flatten HURTS dark spreads (11-29) and sauvola hurt clean leaves in round 1 (6-14). So an arm may
only be applied to a page whose class is known, and a page of neither class gets no arm.

VERDICT (#5277, 2026-09-30): REJECTED for the live lane. The classifier splits the 120 GT pages 60/60 but does NOT
transfer to library captures: it keys on the black surround of the Jerusalem photographs, so it found 0 of the 6
by-eye dark/stained library pages (40 drawn) and 1 dark page in a 190-page cohort sample; and on library pages the
clean-leaf arm (flatten) moved letters read by +0.7 % (13-7-20, p 0.26), inside the resize floor. Keep the lane's
flag at `none`. Results: scripts/eval/results/syriac-preproc-5277-2026-09-30/.

CLASSIFIER (fit on the 120 GT pages, 60 per manuscript):
  features on a 600-px-wide greyscale copy of the ORIGINAL image:
    dark_share = share of pixels < 50 (the black surround of the capture)
    aspect     = width / height of the capture
  dark   iff dark_share >= 0.20 and aspect >= 1.2   (Jerusalem SMMJ 36: 0.29-0.34, aspect 1.5 on all 60)
  clean  iff dark_share <= 0.12                      (ONB Cod. Syr. 1: 0.027-0.099 on all 60)
  unsure otherwise (a single leaf on black, a spread on grey ...) -> no arm
The gap between the two manuscripts is 0.099..0.29; the thresholds sit inside it with margin on both sides.

ARMS (exactly the measured ones: preprocess.apply(arm, img) = Lanczos downscale to <= 2400 px wide, then the arm):
  dark -> sauvola (window 25, k 0.2); clean -> flatten (51-px Gaussian background division)
When the chosen arm is `none` no file is written and the lane reads its original image, byte for byte as before.

CLI:
  syriac-kraken-preprocess.py classify <img>                  -> JSON {klass, features}
  syriac-kraken-preprocess.py apply <mode> <in.jpg> <out.jpg>  -> JSON {mode, klass, arm, features, meta, wrote}
     mode: none | auto | sauvola | flatten   (auto = class arm; a forced arm ignores the class but still records it)
"""
import importlib.util
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ARMS_PATH = os.environ.get("SYRIAC_PREPROCESS_ARMS",
                           os.path.join(HERE, "..", "eval", "ocr-preprocessing", "preprocess.py"))

CLASSIFIER_VERSION = "5277-v1"
DARK_SHARE_DARK = 0.20
DARK_ASPECT_MIN = 1.2
DARK_SHARE_CLEAN = 0.12
ARM_FOR_CLASS = {"dark": "sauvola", "clean": "flatten", "unsure": "none"}
MODES = ("none", "auto", "sauvola", "flatten")


def _arms():
    spec = importlib.util.spec_from_file_location("pp5250_arms", ARMS_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def features(img):
    """Capture features on a 600-px-wide greyscale copy. `img` is a BGR uint8 array."""
    h, w = img.shape[:2]
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    if w > 600:
        g = cv2.resize(g, (600, max(1, round(h * 600 / w))), interpolation=cv2.INTER_AREA)
    return {"w": int(w), "h": int(h), "aspect": round(w / h, 3), "dark_share": round(float((g < 50).mean()), 4)}


def classify_features(f):
    if f["dark_share"] >= DARK_SHARE_DARK and f["aspect"] >= DARK_ASPECT_MIN:
        return "dark"
    if f["dark_share"] <= DARK_SHARE_CLEAN:
        return "clean"
    return "unsure"


def classify(img):
    f = features(img)
    return classify_features(f), f


def choose_arm(mode, klass):
    if mode not in MODES:
        raise ValueError(f"unknown preprocess mode {mode!r}; one of {MODES}")
    return ARM_FOR_CLASS[klass] if mode == "auto" else mode


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "classify" and len(sys.argv) == 3:
        img = cv2.imread(sys.argv[2], cv2.IMREAD_COLOR)
        if img is None:
            sys.exit(f"cannot read {sys.argv[2]}")
        k, f = classify(img)
        print(json.dumps({"klass": k, "features": f, "classifier": CLASSIFIER_VERSION}))
        return
    if cmd == "apply" and len(sys.argv) == 5:
        mode, src, dst = sys.argv[2:5]
        img = cv2.imread(src, cv2.IMREAD_COLOR)
        if img is None:
            sys.exit(f"cannot read {src}")
        k, f = classify(img)
        arm = choose_arm(mode, k)
        out = {"mode": mode, "klass": k, "arm": arm, "features": f, "classifier": CLASSIFIER_VERSION, "wrote": False}
        if arm != "none":
            res, meta = _arms().apply(arm, img)
            cv2.imwrite(dst, res, [cv2.IMWRITE_JPEG_QUALITY, 95])
            out.update(meta=meta, out_px=list(res.shape[1::-1]), wrote=True)
        print(json.dumps(out))
        return
    sys.exit(__doc__)


if __name__ == "__main__":
    main()
