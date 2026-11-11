#!/usr/bin/env python3
# PRIOR ART: /root/tibetan-reocr/build-concordance.py on the main box (#4523) locates a manuscript page's Derge folio
# from the 84000 TEI, but it is untracked scratch on another box; tengyur-ref/build-reference.py's syls()/contain() check
# a page against a Derge side whose folio is already known. This finds the folio: syllable 4-gram hits against every
# Derge Kangyur page, then build-reference.py's 70% containment rule on the best side and its two neighbours.
"""
locate.py — $0, offline. For each CANON sample page that is not itself a Derge page, the best Derge Kangyur window.
  python3 scripts/eval/tib-translator-6948/locate.py    reads $JOB_SCRATCH/{sample.jsonl,sample-pages.jsonl,derge-kangyur.jsonl}
Writes $JOB_SCRATCH/located.json: {page_id: {best, window[3 sides], cover, hits, runner_up, located}}.
"""
import json, os, re, collections

S = os.environ["JOB_SCRATCH"]


def syls(s):  # tengyur-ref/build-reference.py, verbatim
    return [x for x in re.split(r"[་།\s༄༅༔༑]+", re.sub(r"[#{}\[\]()0-9a-zA-Z,.]", " ", s)) if x]


def contain(a, b):  # tengyur-ref/build-reference.py, verbatim
    ca, cb = collections.Counter(a), collections.Counter(b)
    n = sum(ca.values())
    return sum(min(v, cb[k]) for k, v in ca.items()) / n if n else 0.0


strip = lambda t: re.sub(r"<[^>]+>", " ", t)
sample = {json.loads(l)["page_id"]: json.loads(l) for l in open(f"{S}/sample.jsonl")}
pages = {json.loads(l)["id"]: json.loads(l) for l in open(f"{S}/sample-pages.jsonl")}
q = {pid: syls(strip(pages[pid]["ocr"])) for pid, s in sample.items() if s["stratum"] == "CANON" and s["cell"] != "D_none"}
sh = lambda ss: {tuple(ss[i:i + 4]) for i in range(len(ss) - 3)}
qsh = {pid: sh(ss) for pid, ss in q.items()}
want = set().union(*qsh.values())
derge, hits = [], {pid: collections.Counter() for pid in q}
for i, l in enumerate(open(f"{S}/derge-kangyur.jsonl")):
    d = json.loads(l); d["syl"] = syls(d.pop("src")); derge.append(d)
    ds = sh(d["syl"]) & want
    if not ds: continue
    for pid in q:
        n = len(ds & qsh[pid])
        if n: hits[pid][i] = n
pos = {(d["book_id"], d["page_number"]): i for i, d in enumerate(derge)}
out = {}
for pid in q:
    if not hits[pid]:
        out[pid] = {"located": False, "why": "no 4-gram hit"}; continue
    (bi, bn), *rest = hits[pid].most_common(8) + [(None, 0)]
    b = derge[bi]
    win = [pos.get((b["book_id"], b["page_number"] + k)) for k in (-1, 0, 1)]
    win = [w for w in win if w is not None]
    wsyl = sum((derge[w]["syl"] for w in win), [])
    cov = contain(q[pid], wsyl)
    far = [(i, n) for i, n in rest if i is not None and (derge[i]["book_id"] != b["book_id"] or abs(derge[i]["page_number"] - b["page_number"]) > 2)]
    out[pid] = {"located": cov >= 0.7, "cover": round(cov, 3), "hits": bn, "q_shingles": len(qsh[pid]), "runner_up_far": far[0][1] if far else 0,
                "best": {k: b[k] for k in ("page_id", "vol", "folio", "texts", "texts_84000")},
                "window": [{k: derge[w][k] for k in ("page_id", "vol", "folio", "texts", "texts_84000")} for w in win]}
json.dump(out, open(f"{S}/located.json", "w"), ensure_ascii=False, indent=1)
for pid, o in out.items():
    print(pid, sample[pid]["title"][:32], o.get("located"), o.get("cover"), o.get("hits"), "/", o.get("q_shingles"), "far", o.get("runner_up_far"),
          (o.get("best") or {}).get("vol"), (o.get("best") or {}).get("folio"), (o.get("best") or {}).get("texts_84000"))
