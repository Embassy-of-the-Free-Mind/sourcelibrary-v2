#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-ref/fetch-84000.py (the reader-API passage query, reused verbatim) and
# tengyur-ref/build-reference.py (walk_english, strip_root_verses, syls, contain — copied below unchanged). That script
# keys a side by folio alone and takes one volume per text, which is right for the single-volume Tengyur texts it cut;
# the Kangyur Prajñāpāramitā (Toh 8 over twelve volumes, Toh 9 over three) restarts folio numbering per volume, so this
# keys sides by (volume, folio), taking the volume from each passage's own alignment. Looking a text up by Toh
# (`lookup(toh:)`) is new: #5497 had its uuids from the 84000 lobby.
"""
ref84000.py — $0. The 84000 English for #6948's CANON pages: the Derge pages themselves, and the manuscript pages
located in the Derge text by locate.py. Reads $JOB_SCRATCH/{sample.jsonl,sample-pages.jsonl,located.json}; caches
84000 passages in $JOB_SCRATCH/84000/; writes $JOB_SCRATCH/refs.json {page_id: {...}} and refs-summary.json.
84000's English is CC BY-NC-ND: judge input only, never committed, never written to pages.
"""
import json, os, re, time, collections, urllib.request

S = os.environ["JOB_SCRATCH"]
os.makedirs(f"{S}/84000", exist_ok=True)
Q = '''query($uuid: ID!,$cursor:String,$limit:Int){work(uuid:$uuid){uuid passages(cursor:$cursor,limit:$limit){nodes{uuid label sort type json} pageInfo{nextCursor hasMoreAfter}}}}'''


def post(q, v):
    r = urllib.request.Request("https://graphql.84000.co/api/graphql", data=json.dumps({"query": q, "variables": v}).encode(),
                               headers={"Content-Type": "application/json", "apollo-require-preflight": "true"})
    return json.load(urllib.request.urlopen(r, timeout=180))


FOL = re.compile(r"\[F\.(\d+)\.([ab])\]")


def walk_english(node, toh, acc):  # build-reference.py, verbatim
    t = node.get("type")
    if t == "text":
        acc.append(node.get("text", ""))
        return
    if t == "mention":
        for it in node.get("attrs", {}).get("items", []):
            if it.get("linkType") == "folio" and (it.get("toh") or it.get("linkToh")) == toh:
                m = FOL.search(it.get("displayText", ""))
                if m:
                    acc.append(f" ⟦F.{m.group(1)}.{m.group(2)}⟧ ")
        return
    for ch in node.get("content", []) or []:
        walk_english(ch, toh, acc)
    if t in ("paragraph", "heading", "line", "listItem", "blockquote"):
        acc.append("\n")


def syls(s):  # build-reference.py, verbatim
    return [x for x in re.split(r"[་།\s༄༅༔༑]+", re.sub(r"[#{}\[\]()0-9a-zA-Z,.]", " ", s)) if x]


def contain(a, b):  # build-reference.py, verbatim
    ca, cb = collections.Counter(a), collections.Counter(b)
    n = sum(ca.values())
    return sum(min(v, cb[k]) for k, v in ca.items()) / n if n else 0.0


def toh_id(t):  # "D381" / "D1-1" (the import's labels) → "toh381" / "toh1-1" (84000's)
    return "toh" + t[1:].lower() if t.startswith("D") else t


def work(toh):
    fn = f"{S}/84000/{toh}.json"
    if os.path.exists(fn): return json.load(open(fn))
    lk = post('query($t:String){lookup(toh:$t){uuid type}}', {"t": toh})["data"]["lookup"]
    if not lk: o = {"toh": toh, "status": "not in 84000"}
    else:
        w = post('query($u:ID){work(uuid:$u){title publicationStatus}}', {"u": lk["uuid"]})["data"]["work"]
        if not w: w = {"title": None, "publicationStatus": "no work record (not published)"}
        o = {"toh": toh, "uuid": lk["uuid"], "title": w["title"], "status": w["publicationStatus"], "nodes": []}
        if str(w["publicationStatus"]).startswith("1"):  # "1" and "1.a" are both published (84000 statuses)
            cur = None
            while True:
                p = post(Q, {"uuid": lk["uuid"], "limit": 200, "cursor": cur})["data"]["work"]["passages"]
                o["nodes"] += p["nodes"]
                if not p["pageInfo"]["hasMoreAfter"]: break
                cur = p["pageInfo"]["nextCursor"]; time.sleep(0.5)
    json.dump(o, open(fn + ".tmp", "w"), ensure_ascii=False); os.replace(fn + ".tmp", fn)  # a killed run leaves no half file
    return o


def sides(o):
    """(vol, 'Na'/'Nb') → {'en', 'bo'}: build-reference.py's cut, keyed by the passage's own volume."""
    toh = o["toh"]
    ns = sorted([n for n in o.get("nodes", []) if n["type"] in ("translation", "translationHeader")], key=lambda n: n["sort"])
    out, cur_en, cur_bo, vol = collections.OrderedDict(), None, None, None
    for n in ns:
        a = n["json"]["attrs"].get("alignments", {}).get(toh)
        if a: vol = a["volumeNumber"]
        acc = []; walk_english(n["json"], toh, acc); en = "".join(acc)
        # Amendment 1: a passage's English also goes to every side its aligned Tibetan touches ("en_p"), for texts
        # whose English carries no folio mentions (Toh 8). A passage that crosses a side break goes to both sides.
        if a:
            touched = ([cur_bo] if cur_bo else []) + [(vol, f"{int(m.group(1))}{m.group(2)}") for m in FOL.finditer(a["tibetan"])]
            if not FOL.split(a["tibetan"])[0].strip() and len(touched) > 1: touched = touched[1:]
            for k in dict.fromkeys(touched): out.setdefault(k, {"en": "", "bo": "", "en_p": []})["en_p"].append(re.sub(r"⟦F\.\d+\.[ab]⟧", " ", en).strip())
        for i, part in enumerate(re.split(r"⟦F\.(\d+\.[ab])⟧", en)):
            if i % 2: cur_en = (vol, part.replace(".", "")); out.setdefault(cur_en, {"en": "", "bo": "", "en_p": []})
            elif cur_en: out[cur_en]["en"] += part
        if a:
            parts = FOL.split(a["tibetan"])
            if cur_bo: out.setdefault(cur_bo, {"en": "", "bo": "", "en_p": []})["bo"] += parts[0]
            for j in range(1, len(parts), 3):
                cur_bo = (vol, f"{int(parts[j])}{parts[j + 1]}")
                out.setdefault(cur_bo, {"en": "", "bo": "", "en_p": []})["bo"] += parts[j + 2]
    mentions = any(v["en"].strip() for v in out.values())
    for v in out.values():
        v["en"] = re.sub(r"[ \t]+", " ", v["en"]).strip()
        if not mentions: v["en"] = re.sub(r"[ \t]+", " ", "\n\n".join(v["en_p"])).strip(); v["cut"] = "passage overlap"
        else: v["cut"] = "folio mention"
    return out


strip = lambda t: re.sub(r"<[^>]+>", " ", t)
sample = {json.loads(l)["page_id"]: json.loads(l) for l in open(f"{S}/sample.jsonl")}
pages = {json.loads(l)["id"]: json.loads(l) for l in open(f"{S}/sample-pages.jsonl")}
loc = json.load(open(f"{S}/located.json"))
vol_of, seq = {}, []
for l in open(f"{S}/derge-kangyur.jsonl"):
    d = json.loads(l); vol_of[d["page_id"]] = d["vol"]; seq.append((d["vol"], d["page_number"], d["page_id"], d["texts"]))
# A Derge page inside a long text can carry an empty `texts` list: it belongs to the last text named before it.
seq.sort(); texts_of, last = {}, []
for v, n, pid_, t in seq:
    last = t or last; texts_of[pid_] = last
refs, summ = {}, {}
for pid, s in sample.items():
    if s["stratum"] != "CANON": continue
    p = pages[pid]
    if s["cell"] == "D_none":
        te = p["text_edition"]; win = [{"vol": vol_of[pid], "folio": te["folio"], "texts": te["texts"]}]; kind = "derge"
    else:
        L = loc.get(pid) or {}
        if not L.get("located"): summ[pid] = "not located in the Derge Kangyur"; continue
        win = [dict(w, texts=w["texts"] or texts_of[w["page_id"]]) for w in L["window"]]; kind = "manuscript"
    ours = syls(strip(p["ocr"]))
    got, why = [], []
    for w in win:
        for t in w["texts"]:
            o = work(toh_id(t))
            if not str(o["status"]).startswith("1"): why.append(f"{t}: {o['status']}"); continue
            sd = sides(o).get((w["vol"], w["folio"]))
            if not sd or len(sd["en"]) < 40: why.append(f"{t} {w['vol']}:{w['folio']}: no English cut"); continue
            got.append({"toh": t, "title": o["title"], "vol": w["vol"], "folio": w["folio"], "en": sd["en"], "bo": sd["bo"], "cut": sd["cut"]})
    if not got: summ[pid] = "; ".join(why) or "no published text"; continue
    bo_all = sum((syls(g["bo"]) for g in got), [])
    cov_ours, cov_theirs = contain(ours, bo_all), contain(bo_all, ours)
    rule = cov_ours >= 0.7 and (kind == "manuscript" or cov_theirs >= 0.7)
    rec = {"kind": kind, "sides": [{k: g[k] for k in ("toh", "title", "vol", "folio", "cut")} for g in got], "cover_ours": round(cov_ours, 3),
           "cover_theirs": round(cov_theirs, 3), "kept": rule, "partial": bool(why)}
    if rule:
        rec["reference_title"] = "; ".join(sorted({f"{g['title']} (Toh {g['toh'][1:]})" for g in got}))
        rec["reference"] = "\n\n".join(f"[Derge vol. {g['vol']}, F.{g['folio'][:-1]}.{g['folio'][-1]}]\n{g['en']}" for g in got)
        refs[pid] = rec
    summ[pid] = {k: v for k, v in rec.items() if k not in ("reference",)} | ({"why_partial": why} if why else {})
json.dump(refs, open(f"{S}/refs.json", "w"), ensure_ascii=False, indent=1)
json.dump(summ, open(f"{S}/refs-summary.json", "w"), ensure_ascii=False, indent=1)
for pid, v in summ.items():
    print(pid, sample[pid]["title"][:30], v if isinstance(v, str) else (v["kept"], v["cover_ours"], v["cover_theirs"], [x["toh"] + "@" + x["folio"] for x in v["sides"]], v.get("why_partial")))
print("kept", len(refs), "of", sum(1 for s in sample.values() if s["stratum"] == "CANON"))
