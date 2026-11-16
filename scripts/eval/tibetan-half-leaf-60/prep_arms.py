#!/usr/bin/env python3
"""prep_arms.py — fetch each scored frame once, cut leaves the production way, write the crop files and the worker
todo rows for arms A (per leaf), W (whole frame), B (frame downscaled to 1,536 px wide, then per leaf) and
C / C3 (each A leaf cut into 2 / 3 overlapping vertical pieces). Files only (#60).

PRIOR ART: scripts/gpu/yigdzin-vllm/yig_leaf_worker.py (fetch, gutter gate, leafsplit.detect + crops_for partition
and prep: imported from it, not copied, so A's cut is the production cut) and scripts/eval/split-leaf-5771/ (cut leaves
for #5771 by the same detector; does not split a leaf horizontally). Neither makes downscaled or half-leaf crops.

Usage: python prep_arms.py <pages.json> <workdir> [shard nshards]   (shards write *-<shard>.jsonl; cat them after)
  writes <workdir>/frames/<id>.jpg (bytes as served), <workdir>/crops/<arm>/<piece-id>.png (lossless, so the worker's
  own prep() is the only resize), <workdir>/todo-<arm>.jsonl ({"id","path"} rows) and <workdir>/geometry.jsonl.
"""
import io, json, os, sys, time
from pathlib import Path

import requests
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "gpu" / "yigdzin-vllm"))
from leafsplit import detect  # noqa: E402
from yig_leaf_worker import UA, crops_for, is_guttered, prep  # noqa: E402
from halfjoin import piece_spans  # noqa: E402

MAX_PIXELS = 1003520            # BDRC/tibetan-ocr processor_config.json size.longest_edge (a pixel budget)
B_SIZE = (1536, 1024)           # EAP105 / EAP039 frame size
B_QUALITY = 85


def model_px(w, h):
    """Pixels the model sees after the worker's prep() and the processor's pixel cap (approximate smart_resize)."""
    if w > 2400:
        w, h = 2400, round(h * 2400 / w)
    if w * h > MAX_PIXELS:
        s = (MAX_PIXELS / (w * h)) ** 0.5
        w, h = w * s, h * s
    return round(w), round(h)


def leaves_of(im):
    info = detect(im)
    spans = crops_for(info, im.height, "partition")
    return info, [im.crop((0, y0, im.width, y1)) for y0, y1 in spans]


def main():
    pages = json.load(open(sys.argv[1])); work = Path(sys.argv[2])
    shard, nsh = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (0, 1)
    sfx = f"-{shard}" if nsh > 1 else ""
    pages = pages[shard::nsh]
    (work / "frames").mkdir(parents=True, exist_ok=True)
    arms = ["A", "W", "B", "C", "C3"]
    for a in arms:
        (work / "crops" / a).mkdir(parents=True, exist_ok=True)
    todo = {a: open(work / f"todo-{a}{sfx}.jsonl", "w") for a in arms}
    geo_out = open(work / f"geometry{sfx}.jsonl", "w")
    sess = requests.Session(); sess.headers["User-Agent"] = UA
    for n, p in enumerate(pages):
        pid = p["id"]; fp = work / "frames" / f"{pid}.jpg"
        if not fp.exists():
            for attempt in range(4):
                try:
                    r = sess.get(p["archived_photo"], timeout=120)
                    if r.status_code == 200 and len(r.content) > 5000:
                        fp.write_bytes(r.content); break
                except Exception as e:  # noqa: BLE001
                    print(pid, "fetch", type(e).__name__, flush=True)
                time.sleep(5 * (attempt + 1))
            else:
                print(pid, "FETCH FAILED", flush=True); continue
            time.sleep(0.2)
        im = Image.open(fp); im.load(); im = im.convert("RGB")
        g = {"id": pid, "set": p["set"], "collection": p["collection"], "w": im.width, "h": im.height,
             "db_w": p.get("db_w"), "db_h": p.get("db_h"), "guttered": is_guttered(im.convert("L"))}
        # W: the frame itself (the worker's prep() is the whole-mode prep)
        todo["W"].write(json.dumps({"id": pid, "path": str(fp)}) + "\n")
        g["W_model_px"] = model_px(im.width, im.height)
        # A: production partition cut
        info, leaves = leaves_of(im)
        g["A_path"] = info["path"]; g["A_n"] = len(leaves); g["A_leaf_px"] = [lf.size for lf in leaves]
        g["A_model_px"] = [model_px(*lf.size) for lf in leaves]
        for li, lf in enumerate(leaves):
            lp = work / "crops" / "A" / f"{pid}__L{li}.png"; lf.save(lp, compress_level=1)
            todo["A"].write(json.dumps({"id": f"{pid}__L{li}", "path": str(lp)}) + "\n")
            for arm, k in (("C", 2), ("C3", 3)):
                ps = []
                for hi, (x0, x1) in enumerate(piece_spans(lf.width, k)):
                    hp = work / "crops" / arm / f"{pid}__L{li}h{hi}.png"; lf.crop((x0, 0, x1, lf.height)).save(hp, compress_level=1)
                    todo[arm].write(json.dumps({"id": f"{pid}__L{li}h{hi}", "path": str(hp)}) + "\n")
                    ps.append(model_px(x1 - x0, lf.height))
                g.setdefault(f"{arm}_model_px", []).append(ps)
        # B: EAP310 only; frame downscaled to the EAP105 size, JPEG round-trip, then the same partition cut
        if p["collection"] == "EAP310":
            small = im.resize(B_SIZE, Image.LANCZOS)
            buf = io.BytesIO(); small.save(buf, "JPEG", quality=B_QUALITY); buf.seek(0)
            small = Image.open(buf); small.load(); small = small.convert("RGB")
            binfo, bleaves = leaves_of(small)
            g["B_path"] = binfo["path"]; g["B_n"] = len(bleaves); g["B_model_px"] = [model_px(*lf.size) for lf in bleaves]
            for li, lf in enumerate(bleaves):
                lp = work / "crops" / "B" / f"{pid}__L{li}.png"; lf.save(lp, compress_level=1)
                todo["B"].write(json.dumps({"id": f"{pid}__L{li}", "path": str(lp)}) + "\n")
        geo_out.write(json.dumps(g) + "\n"); geo_out.flush()
        if n % 20 == 0:
            print(n, pid, g["w"], g["h"], g["A_path"], g["A_n"], flush=True)
    for f in todo.values():
        f.close()
    print("done", flush=True)


if __name__ == "__main__":
    main()
