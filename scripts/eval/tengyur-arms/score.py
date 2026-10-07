#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-ref/score.py (PR #5704) — the same measures (fidelity median/mean,
# share ≥ 4 with Wilson CI, inversion pages either/both judges, omission and span shares, typed
# inventions, controls, sign test), for exactly two arms per item. This computes them for any arm
# present in a multi-candidate item, always against B graded in the same item.
"""
score.py — Tengyur quality arms (#5497): controls, per-arm quality vs the base B, noise floor.

  python3 score.py --family F1 [--tarms /root/tarms] [--out results.json]

Judge files: <tarms>/judge/<family>/out-J{1,2}-*.jsonl. An E side the second pass did not change is
B's English: E takes B's grade there and the preference is a tie. Prints counts only.
"""
import json, math, os, re, sys, glob, collections, statistics as S

arg = lambda k, d: sys.argv[sys.argv.index(f"--{k}") + 1] if f"--{k}" in sys.argv else d
FAM, TARMS = arg("family", "F1"), arg("tarms", "/root/tarms")
jdir = os.path.join(TARMS, "judge", FAM)
OUTP = arg("out", os.path.join(jdir, "scores.json"))
key = json.load(open(os.path.join(jdir, "key.json")))
plants = {p["id"]: p for p in json.load(open(os.path.join(jdir, "plants.json")))}


def wilson(k, n, z=1.96):
    if not n: return [None, None]
    p = k / n; d = 1 + z * z / n; c = p + z * z / (2 * n); m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return [round((c - m) / d, 3), round((c + m) / d, 3)]


def sign_p(pos, neg):
    nn = pos + neg
    return round(min(1.0, 2 * sum(math.comb(nn, i) for i in range(0, min(pos, neg) + 1)) / 2 ** nn), 4) if nn else None


def load(j):
    v = {}
    for f in sorted(glob.glob(os.path.join(jdir, f"out-{j}-*.jsonl"))):
        for l in open(f):
            l = l.strip()
            if not l: continue
            try:
                r = json.loads(l); v[r["id"]] = r
            except Exception:
                pass
    return v


J = {j: load(j) for j in ("J1", "J2")}
res = {"family": FAM, "judged": {j: len(v) for j, v in J.items()}, "items": len(key)}


def rank_pos(r, label):
    for i, grp in enumerate(r.get("ranking", [])):
        if label in grp: return i
    return None


# ── controls (same checks as tengyur-ref)
ctl = collections.defaultdict(collections.Counter)
for j, v in J.items():
    for iid, k in key.items():
        if k["kind"] == "multi" or iid not in v: continue
        r = v[iid]; lab = {k["T1"]: "T1", k["T2"]: "T2"}
        real, fake = r["scores"].get(lab["real"], {}), r["scores"].get(lab["ctl"], {})
        c = ctl[f"{k['kind']}-{j}"]; c["n"] += 1
        if k["kind"] == "NEG":
            c["fake_le2"] += int((fake.get("fidelity") or 9) <= 2)
        elif k["kind"] == "PLANT":
            caught = bool(fake.get("inversions")); below = (rank_pos(r, lab["ctl"]) or 0) > (rank_pos(r, lab["real"]) or 0)
            c["inversion_flagged"] += int(caught); c["ranked_below"] += int(below); c["caught"] += int(caught or below)
        else:
            c["tied"] += int(rank_pos(r, "T1") == rank_pos(r, "T2")); c["same_grade"] += int(real.get("fidelity") == fake.get("fidelity"))
res["controls"] = {k: dict(v) for k, v in sorted(ctl.items())}

strata = lambda toh: toh if toh in ("toh3808", "toh1183", "toh1189") else "small texts"
arms_all = sorted({a for k in key.values() if k["kind"] == "multi" for a in k["labels"].values()} | ({"E"} if FAM == "F2" else set()))
rows = []
for iid, k in key.items():
    if k["kind"] != "multi" or not all(iid in v for v in J.values()): continue
    inv = {a: l for l, a in k["labels"].items()}
    row = {"id": iid, "toh": k["toh"], "stratum": strata(k["toh"]), "folio": k["folio"], "page_id": k["page_id"], "vol": k["vol"], "page_number": k["page_number"], "book_id": k["book_id"], "arms": {}}
    for a, lab in inv.items():
        per = [J[j][iid]["scores"].get(lab, {}) for j in J]
        fids = [p.get("fidelity") for p in per if isinstance(p.get("fidelity"), (int, float))]
        row["arms"][a] = {"fid": fids, "fid_mean": S.mean(fids) if fids else None, "omit": [bool(p.get("omissions")) for p in per],
                          "inv_types": [[x.get("type") for x in p.get("inventions", []) or []] for p in per],
                          "inversions": [p.get("inversions", []) or [] for p in per], "span": [p.get("span", "same") for p in per],
                          "pos": [rank_pos(J[j][iid], lab) for j in J]}
    rows.append(row)


def get(r, a):
    """Arm a's grade on row r; an E side absent from the item is B's English (unchanged by the pass)."""
    if a in r["arms"]: return r["arms"][a], False
    if a == "E" and "B" in r["arms"]: return r["arms"]["B"], True
    return None, False


def span_bad(s):
    return s != "same" and s != ["same"]


def stats(rs, a):
    xs = [get(r, a)[0] for r in rs]; xs = [x for x in xs if x]
    n = len(xs)
    if not n: return {"n": 0}
    fm = [x["fid_mean"] for x in xs if x["fid_mean"] is not None]
    ge4 = sum(1 for f in fm if f >= 4)
    types = collections.Counter(t for x in xs for jt in x["inv_types"] for t in set(jt))
    spans = collections.Counter(t for x in xs for s in x["span"] for t in ([s] if isinstance(s, str) else s) if t != "same")
    inv_any = sum(1 for x in xs if any(x["inversions"])); inv_both = sum(1 for x in xs if all(x["inversions"]))
    return {"n": n, "fidelity_median": S.median(fm), "fidelity_mean": round(S.mean(fm), 3), "ge4": ge4, "ge4_share": round(ge4 / n, 3), "ge4_ci": wilson(ge4, n),
            "inversion_pages_either": inv_any, "inversion_pages_both": inv_both, "inversions_per_100_either": round(100 * inv_any / n, 1), "inversions_per_100_both": round(100 * inv_both / n, 1),
            "omission_judgements": sum(sum(x["omit"]) for x in xs), "omission_share": round(sum(sum(x["omit"]) for x in xs) / (2 * n), 3),
            "inventions_by_type": dict(types), "span_bad_judgements": sum(1 for x in xs for s in x["span"] if span_bad(s)),
            "span_share": round(sum(1 for x in xs for s in x["span"] if span_bad(s)) / (2 * n), 3), "span_by_type": dict(spans)}


def versus(rs, a, b="B"):
    pref, d = collections.Counter(), []
    both = collections.Counter()
    for r in rs:
        xa, inh = get(r, a); xb, _ = get(r, b)
        if not xa or not xb: continue
        ps = []
        for j in range(2):
            p = "tie" if inh or xa["pos"][j] == xb["pos"][j] else (a if (xa["pos"][j] or 0) < (xb["pos"][j] or 0) else b)
            pref[p] += 1; ps.append(p)
        both["/".join(ps)] += 1
        if xa["fid_mean"] is not None and xb["fid_mean"] is not None: d.append(xa["fid_mean"] - xb["fid_mean"])
    pos, neg = sum(x > 0 for x in d), sum(x < 0 for x in d)
    tot = sum(pref.values())
    return {"pages": len(d), "judgements": dict(pref), "net_pref": round((pref[a] - pref[b]) / tot, 3) if tot else None, "both_judges": dict(both),
            "fid_diff_mean": round(S.mean(d), 3) if d else None, "pages_higher": pos, "pages_lower": neg, "sign_test_p": sign_p(pos, neg)}


res["arms"] = {}
for a in arms_all:
    rs = [r for r in rows if get(r, a)[0]]
    res["arms"][a] = {"stats": stats(rs, a), "B_same_pages": stats(rs, "B") if a != "B" else None, "vs_B": versus(rs, a) if a != "B" else None,
                      "by_text": {st: {"arm": stats([r for r in rs if r["stratum"] == st], a), "B": stats([r for r in rs if r["stratum"] == st], "B"),
                                       "vs_B": versus([r for r in rs if r["stratum"] == st], a) if a != "B" else None} for st in sorted({r["stratum"] for r in rs})}}
res["judge_agreement"] = {a: {"exact": sum(1 for r in rows if a in r["arms"] and len(set(r["arms"][a]["fid"])) == 1),
                              "within1": sum(1 for r in rows if a in r["arms"] and len(r["arms"][a]["fid"]) == 2 and abs(r["arms"][a]["fid"][0] - r["arms"][a]["fid"][1]) <= 1),
                              "n": sum(1 for r in rows if a in r["arms"])} for a in arms_all}
res["inversion_list"] = [{"id": r["id"], "toh": r["toh"], "folio": r["folio"], "vol": r["vol"], "page_number": r["page_number"], "book_id": r["book_id"], "arm": a,
                          "judges": sum(1 for x in v["inversions"] if x), "quotes": [q for x in v["inversions"] for q in x][:3]}
                         for r in rows for a, v in r["arms"].items() if any(v["inversions"])]
res["rows"] = rows
json.dump(res, open(OUTP, "w"), ensure_ascii=False, indent=1)
print(json.dumps({k: res[k] for k in ("family", "judged", "controls", "judge_agreement")}))
for a, v in res["arms"].items():
    s = v["stats"]
    print(a, {k: s.get(k) for k in ("n", "fidelity_median", "fidelity_mean", "ge4_share", "ge4_ci", "inversion_pages_either", "inversion_pages_both", "omission_share", "span_share", "inventions_by_type")})
    if v["vs_B"]: print("   vs B:", v["vs_B"], "| B same pages:", {k: v["B_same_pages"].get(k) for k in ("fidelity_mean", "ge4_share", "inversion_pages_either", "omission_share", "span_share")})
