#!/usr/bin/env python3
"""
#4747 widened — the FREE arm: an open-source document-layout detector on CPU.

PRIOR ART: scripts/eval/image-extraction-lite-eval.mjs (the paid arms; this writes a
raw-*.jsonl in the same record shape so its `score` / `grade-sheets` / `grade-score` read it
unchanged). No layout detector existed in the repo before; none — looked in scripts/eval/,
scripts/lib/, scripts/workers/.

Model: DocLayout-YOLO, DocStructBench checkpoint (juliozhao/DocLayout-YOLO-DocStructBench on
Hugging Face, AGPL-3.0, arXiv 2410.12628). Classes: title, plain text, abandon, figure,
figure_caption, table, table_caption, table_footnote, isolate_formula, formula_caption. Only
`figure` is an illustration in our sense. Output boxes are PIXEL xyxy on the image as given
(ultralytics `boxes.xyxy`); they are divided by that image's own width/height here, so the
fractions are in the getPageSource() coordinate space like every other arm — the same
bytes from the shared image cache.

Reads only local files. Never touches Mongo.

usage (Hetzner venv): python image-extraction-doclayout.py --out <results dir> --img-cache <dir> [--conf 0.25] [--imgsz 1024]
"""
import argparse, io, json, os, time

from PIL import Image
from huggingface_hub import hf_hub_download
from doclayout_yolo import YOLOv10

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--img-cache", required=True)
ap.add_argument("--conf", type=float, default=0.25)
ap.add_argument("--imgsz", type=int, default=1024)
a = ap.parse_args()

MODEL_ID = "doclayout-yolo-docstructbench"
weights = hf_hub_download(repo_id="juliozhao/DocLayout-YOLO-DocStructBench", filename="doclayout_yolo_docstructbench_imgsz1024.pt")
model = YOLOv10(weights)
names = model.names

sample = json.load(open(os.path.join(a.out, "sample.json")))
out_file = os.path.join(a.out, "raw-doclayout-local.jsonl")
done = set()
if os.path.exists(out_file):
    for line in open(out_file):
        r = json.loads(line)
        if not r.get("error"):
            done.add(r["page_id"])

n = 0
with open(out_file, "a") as fh:
    for item in sample["items"]:
        pid = item["page"]["id"]
        if pid in done or not item.get("image_url"):
            continue
        rec = {"page_id": pid, "cls": item["cls"], "model": MODEL_ID, "mode": "local", "format": "frac",
               "params": {"conf": a.conf, "imgsz": a.imgsz}, "cost_usd": 0}
        f = os.path.join(a.img_cache, f"{pid}.bin")
        if not os.path.exists(f):
            rec["error"] = "no-image-in-cache"
        else:
            try:
                img = Image.open(io.BytesIO(open(f, "rb").read())).convert("RGB")
                W, H = img.size
                t0 = time.time()
                res = model.predict(img, imgsz=a.imgsz, conf=a.conf, device="cpu", verbose=False)[0]
                rec["ms"] = int((time.time() - t0) * 1000)
                images = []
                for (x1, y1, x2, y2), c, k in zip(res.boxes.xyxy.tolist(), res.boxes.conf.tolist(), res.boxes.cls.tolist()):
                    if names[int(k)] != "figure":
                        continue
                    bw, bh = (x2 - x1) / W, (y2 - y1) / H
                    if bw < 0.005 or bh < 0.005:
                        continue
                    images.append({"bbox": {"x": x1 / W, "y": y1 / H, "width": bw, "height": bh}, "type": "figure", "confidence": round(c, 3)})
                rec["images"] = images
            except Exception as e:  # recorded, never silently skipped
                rec["error"] = str(e)[:200]
        fh.write(json.dumps(rec) + "\n")
        fh.flush()
        n += 1
        if n % 25 == 0:
            print(f"[doclayout] {n} pages", flush=True)
print(f"[doclayout] finished {n} pages -> {out_file}")
