#!/usr/bin/env python3
# PRIOR ART: /root/tibetan-eval/kanjur_align.py (Hetzner) `index` reads an OpenPecha OPF (base/vNNN.txt +
# layers/vNNN/Pagination.yml); /root/derge-kangyur/P000001.opf is the Derge model. No Nyingma reference existed —
# this converts one into that exact shape so the same aligner scores the non-Kangyur BL stratum (#4523).
"""Convert the rKTs e-text of the snga 'gyur rgyud 'bum phyogs bsgrigs (sigla Gpb) into an OPF the aligner indexes.

Source: https://github.com/brunogml/rKTs/tree/master/etexts/Gpb  (CC0, rKTs / Tibetan Manuscript Project Vienna).
One XML per volume, named by BDRC image group (1KG21606 = bdr:I1KG21606, work bdr:W1KG14783); rows are
<item><p>{folio}{a|b}{line}</p><section>..</section><text>{EWTS}</text></item>.

Output pages are FOLIO SIDES (1a, 1b, 2a ...). imgnum = 2*folio + (0 for a, 1 for b), so neighbouring sides are
neighbouring imgnums (the aligner's +/-2 window) and a missing folio stays a gap instead of joining two unrelated
sides. Volume names are v001.. in BDRC image-group order; vol_map.json records the mapping.

  python3 build_gpb_opf.py --src /root/nyingma-ref/gpb --out /root/nyingma-ref/Gpb.opf
"""
import argparse, json, re, sys
from collections import OrderedDict
from pathlib import Path

import pyewts
import yaml

ITEM = re.compile(r"<item><p>(\d+)([ab])(\d+)</p>(?:<section>[^<]*</section>)?<text>(.*?)</text></item>", re.S)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    conv = pyewts.pyewts()
    src, out = Path(args.src), Path(args.out)
    (out / "base").mkdir(parents=True, exist_ok=True)
    vol_map, totals = {}, {"volumes": 0, "sides": 0, "lines": 0, "ewts_warnings": 0}
    for i, f in enumerate(sorted(src.glob("1KG*.xml")), start=1):
        vol = f"v{i:03d}"
        vol_map[vol] = f"bdr:I{f.stem}"
        sides = OrderedDict()  # (folio, side) -> [ewts lines]
        for folio, side, _line, text in ITEM.findall(f.read_text(encoding="utf-8")):
            sides.setdefault((int(folio), side), []).append(text.strip())
            totals["lines"] += 1
        base, anns, pos = [], {}, 0
        for (folio, side), lines in sides.items():
            warns = []
            uni = conv.toUnicode(" ".join(lines), warns)
            totals["ewts_warnings"] += len(warns)
            start = pos
            base.append(uni)
            pos += len(uni)
            anns[f"{vol}-{folio}{side}"] = {"imgnum": 2 * folio + (0 if side == "a" else 1),
                                           "reference": f"{f.stem}:{folio}{side}",
                                           "span": {"start": start, "end": pos}}
            base.append("\n\n")
            pos += 2
        (out / "base" / f"{vol}.txt").write_text("".join(base), encoding="utf-8")
        (out / "layers" / vol).mkdir(parents=True, exist_ok=True)
        (out / "layers" / vol / "Pagination.yml").write_text(
            yaml.safe_dump({"annotation_type": "Pagination", "annotations": anns}, allow_unicode=True),
            encoding="utf-8")
        totals["volumes"] += 1
        totals["sides"] += len(sides)
        print(f"{vol} {f.stem}: {len(sides)} sides", file=sys.stderr)
    (out / "vol_map.json").write_text(json.dumps(vol_map, indent=1))
    (out / "meta.json").write_text(json.dumps({
        "source": "https://github.com/brunogml/rKTs/tree/master/etexts/Gpb",
        "edition": "snga 'gyur rgyud 'bum phyogs bsgrigs (rKTs sigla Gpb), BDRC bdr:W1KG14783",
        "licence": "CC0-1.0 (rKTs repository README)", **totals}, indent=1))
    print(json.dumps(totals), file=sys.stderr)


if __name__ == "__main__":
    main()
