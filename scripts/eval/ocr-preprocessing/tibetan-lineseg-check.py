#!/usr/bin/env python3
# PRIOR ART: hetzner:/root/tibetan-ocr-app/BDRC/Inference.py OCRPipeline.run_ocr() — the BDRC tibetan-ocr line path
# (PhotiLines.onnx mask -> build_raw_line_data -> filter_line_contours -> sort_lines_by_threshold2, merge_lines=True).
# The Yigdzin lane itself has no line segmenter (it reads whole leaves), so this is the nearest one in the BDRC
# stack; it is used here only as the #5250 round-2 gate for the `leaf-lines` arm, calling those functions unchanged.
"""#5250 round 2, `leaf-lines` gate (pre-registered): per-line strips are made only if the line segmenter is
reliable on >= 95% of the 100 referenced pages. Reliable = the number of lines it finds, summed over the page's
production leaf crops (round-1 img/leafcrop/<stem>.L<i>.jpg), equals the book's line mode.

Run on Hetzner from /root/tibetan-ocr-app with its venv:
  venv/bin/python /root/pp5250/code/tibetan-lineseg-check.py
Writes /root/pp5250/tibetan/lineseg.jsonl {stem, substratum, mode, leaves:[{n, angle, ys:[[y0,y1],..]}], total, ok}
and prints the pass count.
"""
import glob
import json
import os
import sys

import cv2

sys.path.insert(0, "/root/tibetan-ocr-app")
from BDRC.Data import LineDetectionConfig  # noqa: E402
from BDRC.Inference import LineDetection  # noqa: E402
from BDRC.Utils import get_platform  # noqa: E402
from BDRC.line_detection import (build_line_data, build_raw_line_data, filter_line_contours,  # noqa: E402
                                 sort_lines_by_threshold2)

W = "/root/pp5250/tibetan"


def lines_of(det, img):
    mask = det.predict(img)
    rot_img, rot_mask, contours, angle = build_raw_line_data(img, mask)
    if not contours:
        return 0, float(angle), []
    filt = filter_line_contours(rot_mask, contours)
    data = [build_line_data(c) for c in filt]
    srt, _ = sort_lines_by_threshold2(rot_mask, data, group_lines=True)
    ys = []
    for ln in srt:
        b = ln.bbox
        ys.append([int(b.y), int(b.y + b.h)])
    return len(srt), float(angle), ys


def main():
    os.chdir("/root/tibetan-ocr-app")
    det = LineDetection(get_platform(), LineDetectionConfig(model_file="Models/Lines/PhotiLines.onnx", patch_size=512))
    pages = [("referenced", json.loads(l)) for l in open(f"{W}/referenced.jsonl")]
    pages += [("control", json.loads(l)) for l in open("/root/tibetan-reocr/_tmp-reread-control18.jsonl")]
    out = open(f"{W}/lineseg.jsonl", "w")
    ok = n = 0
    for sub, r in pages:
        stem = f"{r['book']}_{int(r['page']):05d}"
        files = sorted(glob.glob(f"{W}/img/leafcrop/{stem}.L*.jpg"))
        if not files:
            continue
        mode = 14 if sub == "control" else r.get("mode")
        leaves = []
        for f in files:
            k, a, ys = lines_of(det, cv2.imread(f))
            leaves.append({"n": k, "angle": a, "ys": ys})
        total = sum(x["n"] for x in leaves)
        good = mode is not None and total == mode
        out.write(json.dumps({"stem": stem, "substratum": sub, "mode": mode, "leaves": leaves, "total": total, "ok": good}) + "\n")
        out.flush()
        if sub == "referenced":
            n += 1; ok += int(good)
    print(json.dumps({"referenced_pages": n, "segmenter_matches_mode": ok, "rate": round(ok / max(n, 1), 3),
                      "gate_95": ok / max(n, 1) >= 0.95}))


if __name__ == "__main__":
    main()
