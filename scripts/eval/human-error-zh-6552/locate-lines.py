#!/usr/bin/env python3
"""locate-lines.py: PP-OCRv5 text-line boxes for page images, used ONLY to find where a span sits for a crop (#6552).

PRIOR ART: /root/pz/code/paddle-vl-run.py (PaddleOCR-VL reads a page but returns blocks, no line geometry). This text is never
a witness and is never scored; a span's line box is the only thing kept.

  locate-lines.py <outdir> <img>...   writes <outdir>/<stem>.lines.json: [{box:[x0,y0,x1,y1], text, score}]
"""
import json, os, sys
os.environ.setdefault('PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK', 'True')
from paddleocr import PaddleOCR
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
ocr = PaddleOCR(use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False, text_det_limit_side_len=2500, text_det_limit_type='max')
for f in sys.argv[2:]:
    dst = os.path.join(out, os.path.splitext(os.path.basename(f))[0] + '.lines.json')
    if os.path.exists(dst): continue
    r = ocr.predict(f)[0]
    rows = [{'box': [int(v) for v in b], 'text': t, 'score': round(float(s), 3)} for b, t, s in zip(r['rec_boxes'], r['rec_texts'], r['rec_scores'])]
    json.dump(rows, open(dst, 'w'), ensure_ascii=False); print(os.path.basename(f), len(rows), flush=True)
