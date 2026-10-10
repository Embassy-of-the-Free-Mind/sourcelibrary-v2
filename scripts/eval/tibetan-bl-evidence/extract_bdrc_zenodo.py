#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tibetan-nyingma-reference/build_gpb_opf.py (rKTs XML -> OPF for one edition). That
# converts ONE known edition; this flattens the whole BDRC 2017 etext dump (Zenodo 821218, CC-BY 4.0) so the
# terma/biography works of the BL stratum (#4523) can be FOUND first, then built into OPFs (build_ref_opf.py).
"""Flatten BDRC Zenodo 821218 TEI files into gzip JSONL: one row per text file.

Row: {coll, w (TBRC_RID), rid (TBRC_TEXT_RID), title, licence, pages: [[n, text], ...]}
  python3 extract_bdrc_zenodo.py --zips /root/tib-bl-evidence/zenodo --out /root/tib-bl-evidence/bdrc-etexts.jsonl.gz
"""
import argparse, gzip, json, re, sys, zipfile
from pathlib import Path

TITLE = re.compile(r'<tei:title>(.*?)</tei:title>', re.S)
LIC = re.compile(r'<tei:licence[^>]*target="([^"]*)"', re.S)
W = re.compile(r'<tei:idno type="TBRC_RID">([^<]*)</tei:idno>')
RID = re.compile(r'<tei:idno type="TBRC_TEXT_RID">([^<]*)</tei:idno>')
PAGE = re.compile(r'<tei:p\b([^>]*)>(.*?)</tei:p>', re.S)
PN = re.compile(r'n="([^"]*)"')
TAG = re.compile(r'<[^>]+>')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zips", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--glob", default="*.zip")
    a = ap.parse_args()
    n = 0
    with gzip.open(a.out, "wt", encoding="utf-8") as out:
        for z in sorted(Path(a.zips).glob(a.glob)):
            coll = z.stem
            with zipfile.ZipFile(z) as zf:
                for name in zf.namelist():
                    if "__MACOSX" in name or not name.endswith(".xml") or name.endswith("__contents__.xml"):
                        continue
                    x = zf.read(name).decode("utf-8", "replace")
                    pages = [[(PN.search(at).group(1) if PN.search(at) else str(i)), TAG.sub("", t)]
                             for i, (at, t) in enumerate(PAGE.findall(x))]
                    if not pages:
                        continue
                    g = lambda r: (r.search(x).group(1).strip() if r.search(x) else None)
                    out.write(json.dumps({"coll": coll, "w": g(W), "rid": g(RID), "title": g(TITLE), "licence": g(LIC),
                                          "pages": pages}, ensure_ascii=False) + "\n")
                    n += 1
            print(coll, n, file=sys.stderr)


if __name__ == "__main__":
    main()
