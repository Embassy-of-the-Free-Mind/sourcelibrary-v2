#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tibetan-nyingma-reference/build_gpb_opf.py — writes the same OPF shape (base/vNNN.txt +
# layers/vNNN/Pagination.yml) that /root/tibetan-eval/kanjur_align.py `index` reads, from rKTs XML. This writes it
# from the flattened BDRC Zenodo dump (extract_bdrc_zenodo.py), one OPF per terma/biography WORK GROUP (#4523).
"""Build one OPF per work group from the BDRC e-text volumes discover_refs.py found for that group.

  python3 build_ref_opf.py --discovery discovery.json --etexts bdrc-etexts.jsonl.gz [...] --out-root refs/ \
      [--min-share 0.2]
A group's reference = every text file in each (W, volume) whose file a DISCOVERY page of that group hit with
share >= min-share. Pages of the OPF are the e-text's own page units; imgnum = running index inside one text
file (one OPF volume per text file), so the aligner's +/-2 window never crosses into another text.
Writes refs/<group>/opf/, refs/<group>/meta.json (W, volumes, titles, licence per file, collection).
"""
import argparse, gzip, json, sys
from collections import defaultdict
from pathlib import Path
import yaml


def vol_key(rid):  # UT1KG14-010-0049 -> (W-part, volume) ; UT30541-003-0002 -> ('UT30541', '003')
    parts = rid.split("-")
    return parts[0], parts[1] if len(parts) > 2 else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--discovery", required=True, nargs="+")
    ap.add_argument("--etexts", required=True, nargs="+")
    ap.add_argument("--out-root", required=True)
    ap.add_argument("--min-share", type=float, default=0.2)
    a = ap.parse_args()
    want = defaultdict(set)  # group -> {(Wpart, vol)}
    for f in a.discovery:
        for r in json.load(open(f)):
            for t in r["top"]:
                if t["share"] >= a.min_share:
                    want[r["work"]].add(vol_key(t["rid"]))
    vols = {k: g for g, ks in want.items() for k in ks}
    print({g: sorted(ks) for g, ks in want.items()}, file=sys.stderr)
    files = defaultdict(list)  # group -> rows
    for f in a.etexts:
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            for line in fh:
                r = json.loads(line)
                k = vol_key(r["rid"])
                for g, ks in want.items():
                    if k in ks:
                        files[g].append(r)
    for g, rows in files.items():
        out = Path(a.out_root) / g / "opf"
        (out / "base").mkdir(parents=True, exist_ok=True)
        meta = {"group": g, "volumes": sorted("-".join(k) for k in want[g]), "files": []}
        for i, r in enumerate(sorted(rows, key=lambda r: r["rid"]), start=1):
            vol = f"v{i:03d}"
            base, anns, pos = [], {}, 0
            for j, (pn, t) in enumerate(r["pages"]):
                start = pos
                base.append(t); pos += len(t)
                anns[f"{vol}-{j}"] = {"imgnum": j, "reference": f"{r['rid']}:{pn}", "span": {"start": start, "end": pos}}
                base.append("\n\n"); pos += 2
            (out / "base" / f"{vol}.txt").write_text("".join(base), encoding="utf-8")
            (out / "layers" / vol).mkdir(parents=True, exist_ok=True)
            (out / "layers" / vol / "Pagination.yml").write_text(
                yaml.safe_dump({"annotation_type": "Pagination", "annotations": anns}, allow_unicode=True), encoding="utf-8")
            meta["files"].append({"vol": vol, "rid": r["rid"], "w": r["w"], "coll": r["coll"], "title": (r["title"] or "")[:200],
                                  "licence": r["licence"], "pages": len(r["pages"])})
        json.dump(meta, open(Path(a.out_root) / g / "meta.json", "w"), ensure_ascii=False, indent=1)
        print(g, len(rows), "files", file=sys.stderr)


if __name__ == "__main__":
    main()
