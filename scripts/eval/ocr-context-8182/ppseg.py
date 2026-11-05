#!/usr/bin/env python3
"""#8182: text boxes for the glyph segmenter (compose.py). PP-OCRv6 medium det + rec with return_word_box: line/column
boxes, and for Chinese per-character boxes (from the CTC alignment). Positions only: the rec's own reading is used
for one thing, to keep units whose character is Han (drops reading marks, numerals, notation). It is not an engine
under test and its reading never enters a score.

PRIOR ART: scripts/workers/paddle-print-lane.mjs and /root/pz/code/paddle-zh-run.py drive PaddleOCR-VL (the engine
under test), not the PP-OCR detector; none returns character boxes.

Run (gex45, /root/pz/venv, CPU): python ppseg.py --todo todo.jsonl --out DIR   -> DIR/<stem>.pp.json
"""
import argparse, json, os
from paddleocr import PaddleOCR

ap = argparse.ArgumentParser(); ap.add_argument("--todo", required=True); ap.add_argument("--out", required=True)
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
ocr = PaddleOCR(text_detection_model_name="PP-OCRv6_medium_det", text_recognition_model_name="PP-OCRv6_medium_rec",
                use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False,
                return_word_box=True, device="cpu", text_det_limit_side_len=4000, text_det_limit_type="max")
for line in open(a.todo):
    row = json.loads(line); dst = os.path.join(a.out, row["stem"] + ".pp.json")
    if os.path.exists(dst): continue
    try:
        j = ocr.predict(row["path"])[0].json["res"]
        out = {"boxes": [list(map(int, b)) for b in j["rec_boxes"]], "chars": j.get("text_word") or [],
               "char_boxes": [[list(map(int, b)) for b in bs] for bs in (j.get("text_word_boxes") or [])],
               "det": [[list(map(int, p)) for p in poly] for poly in j["dt_polys"]]}
    except Exception as e:  # noqa: BLE001
        out = {"error": repr(e)[:300]}
    json.dump(out, open(dst, "w"), ensure_ascii=False)
    print(row["stem"], "error" if "error" in out else len(out["boxes"]), flush=True)
