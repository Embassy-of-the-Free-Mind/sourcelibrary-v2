#!/usr/bin/env python3
"""p5.py — PaddleOCR 3.x PP-OCRv5 with the Devanagari recogniser over the #7243 pages (arm P5). Runs in /root/pz/venv.

PRIOR ART: scripts/gpu/paddle-zh-run.py (PaddleOCR-VL through the genai server: a different model and API). This is the
classic det+rec pipeline, which no house script runs. Lines are kept in the detector's order (top to bottom).
  p5.py <img dir> <out.jsonl> [--device gpu:0]
"""
import json, os, sys, time
from paddleocr import PaddleOCR
imgs, out = sys.argv[1], sys.argv[2]
dev = sys.argv[sys.argv.index('--device') + 1] if '--device' in sys.argv else 'gpu:0'
o = PaddleOCR(text_detection_model_name='PP-OCRv5_server_det', text_recognition_model_name='devanagari_PP-OCRv5_mobile_rec',
              use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False, device=dev)
names = sorted(f for f in os.listdir(imgs) if f.endswith('.jpg')); t0 = time.time()
with open(out, 'w') as f:
    for n in names:
        s = time.time(); rec = {'page_id': n[:-4]}
        try:
            r = list(o.predict(os.path.join(imgs, n)))[0]
            rec.update(text='\n'.join(r['rec_texts']), secs=round(time.time() - s, 2), lines=len(r['rec_texts']))
        except Exception as e:  # noqa: BLE001
            rec['error'] = str(e)[:300]
        f.write(json.dumps(rec, ensure_ascii=False) + '\n'); f.flush()
wall = time.time() - t0
json.dump({'pages': len(names), 'wall_secs': round(wall, 1), 'pages_per_hour': round(len(names) / wall * 3600), 'device': dev}, open(out + '.run.json', 'w'))
