#!/usr/bin/env python3
"""assemble.py — turn the per-image reads of each arm into one text per page, in kanjur_align.py's pages.jsonl shape,
split by reference index (#60).

PRIOR ART: yig_leaf_worker.py's own page assembly (leaves joined top to bottom with "\n": copied here for A, A2 and B,
because those arms were read as one `path` row per leaf); halfjoin.join_leaf for C / C3. None existed for pieces.

Usage: python3 assemble.py <jobdir>
  reads  <jobdir>/work/pages.json, <jobdir>/work/geometry.jsonl, <jobdir>/reads/<arm>/txt/*.txt
  writes <jobdir>/score-in/<arm>-<kangyur|nyingma>.jsonl ({"id","arm","text"}) and <jobdir>/score-in/pages-meta.jsonl
"""
import json, os, sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from halfjoin import join_leaf, lines_of  # noqa: E402

ARMS = ["A", "A2", "W", "B", "C", "C3"]


def main():
    J = Path(sys.argv[1]); out = J / "score-in"; out.mkdir(exist_ok=True)
    pages = {p["id"]: p for p in json.load(open(J / "work" / "pages.json"))}
    geo = {g["id"]: g for g in map(json.loads, open(J / "work" / "geometry.jsonl"))}
    files = {}
    meta = []
    for pid, p in pages.items():
        g = geo.get(pid)
        if not g:
            continue
        m = {"id": pid, "set": p["set"], "collection": p["collection"], "w": g["w"], "h": g["h"],
             "guttered": g["guttered"], "A_path": g["A_path"], "A_n": g["A_n"], "old_identity": p["old"]}
        for arm in ARMS:
            d = J / "reads" / arm / "txt"
            if not d.is_dir():
                continue
            nleaf = g.get("B_n") if arm == "B" else g["A_n"]
            if arm == "B" and nleaf is None:
                continue
            k = {"C": 2, "C3": 3}.get(arm, 0)
            leaf_texts, flags, missing = [], {"mismatch_leaves": 0, "joins": 0, "no_overlap": 0}, 0
            if arm == "W":
                f = d / f"{pid}.txt"
                if not f.exists():
                    missing = 1
                leaf_texts = [f.read_text() if f.exists() else ""]
            else:
                for li in range(nleaf):
                    if k:
                        ps = []
                        for hi in range(k):
                            f = d / f"{pid}__L{li}h{hi}.txt"
                            missing += not f.exists(); ps.append(f.read_text() if f.exists() else "")
                        t, info = join_leaf(ps)
                        flags["mismatch_leaves"] += int(info["line_mismatch"])
                        flags["joins"] += info["joins"]; flags["no_overlap"] += info["no_overlap"]
                        leaf_texts.append(t)
                    else:
                        f = d / f"{pid}__L{li}.txt"
                        missing += not f.exists(); leaf_texts.append(f.read_text() if f.exists() else "")
            text = "\n".join(t.strip("\n") for t in leaf_texts if t.strip())
            m[arm] = {"lines": len(lines_of(text)), "missing": missing, **(flags if k else {})}
            key = (arm, p["set"])
            if key not in files:
                files[key] = open(out / f"{arm}-{p['set']}.jsonl", "w")
            files[key].write(json.dumps({"id": pid, "arm": arm, "text": text}, ensure_ascii=False) + "\n")
        meta.append(m)
    with open(out / "pages-meta.jsonl", "w") as f:
        for m in meta:
            f.write(json.dumps(m) + "\n")
    for f in files.values():
        f.close()
    print({f"{a}-{s}": sum(1 for _ in open(out / f"{a}-{s}.jsonl")) for a, s in files})


if __name__ == "__main__":
    main()
