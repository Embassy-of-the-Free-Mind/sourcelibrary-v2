#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-ref/score.py (PR #5704: controls, per-arm fidelity / omission / span /
# inversion counts for arms A and B). Same measures and control checks, for the stored-vs-B packet
# (build-packet-stored.py), plus a 95% interval on reversed pages per 100 and a page-by-page comparison
# with PR #5704's arm-B verdicts on the pages both runs judged.
"""
score-stored.py — stored English (S) vs arm B, Tengyur 84000 reference (#5797).

  python3 score-stored.py <judge-dir> <5704-scores.json> <out.json>
"""
import json, math, os, re, sys, collections, statistics as St

jdir, old_scores, outp = sys.argv[1:4]
key = json.load(open(os.path.join(jdir, "key.json")))
plants = {p["id"]: p for p in json.load(open(os.path.join(jdir, "plants.json")))}


def wilson(k, n, z=1.96):
    if not n:
        return [None, None]
    p = k / n; d = 1 + z * z / n; c = p + z * z / (2 * n); m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return [round((c - m) / d, 3), round((c + m) / d, 3)]


def load(j):
    v = {}
    for l in open(os.path.join(jdir, f"verdicts-{j}.jsonl")):
        if l.strip():
            r = json.loads(l); v[r["id"]] = r
    return v


J = {j: load(j) for j in ("J1", "J2")}


def rank_pos(r, label):
    for i, grp in enumerate(r.get("ranking", [])):
        if label in grp:
            return i
    return None


def tie(r):
    return any(len(g) == 2 for g in r.get("ranking", []))


res = {"judged": {j: len(v) for j, v in J.items()}, "items": len(key)}
ctl = collections.defaultdict(collections.Counter)
for j, v in J.items():
    for iid, k in key.items():
        if k["kind"] == "pair":
            continue
        r = v[iid]; lab = {k["T1"]: "T1", k["T2"]: "T2"}
        real, fake = r["scores"].get(lab["real"], {}), r["scores"].get(lab["ctl"], {})
        c = ctl[f"{k['kind']}-{j}"]; c["n"] += 1
        if k["kind"] == "NEG":
            c["fake_le2"] += int((fake.get("fidelity") or 9) <= 2)
        elif k["kind"] == "PLANT":
            inv = bool(fake.get("inversions")); below = (rank_pos(r, lab["ctl"]) or 0) > (rank_pos(r, lab["real"]) or 0)
            c["inversion_flagged"] += int(inv); c["ranked_below"] += int(below); c["caught"] += int(inv or below)
        else:
            c["tied"] += int(tie(r)); c["same_grade"] += int(real.get("fidelity") == fake.get("fidelity"))
res["controls"] = {k: dict(v) for k, v in sorted(ctl.items())}

strata = lambda toh: toh if toh in ("toh3808", "toh1183", "toh1189") else "small texts"
rows = []
for iid, k in key.items():
    if k["kind"] != "pair":
        continue
    row = {"id": iid, "toh": k["toh"], "stratum": strata(k["toh"]), "folio": k["folio"], "vol": k["vol"], "page_number": k["page_number"],
           "page_id": k["page_id"], "book_id": k["book_id"], "in_5704": k["in_5704"]}
    for arm in ("S", "B"):
        lab = "T1" if k["T1"] == arm else "T2"
        per = [J[j][iid]["scores"].get(lab, {}) for j in J]
        fids = [p.get("fidelity") for p in per if isinstance(p.get("fidelity"), (int, float))]
        row[arm] = {"fid": fids, "fid_mean": St.mean(fids) if fids else None,
                    "omit": [bool(p.get("omissions")) for p in per],
                    "inv_types": [[x.get("type") for x in p.get("inventions", []) or []] for p in per],
                    "inversions": [p.get("inversions", []) or [] for p in per],
                    "span": [p.get("span", "same") for p in per]}
    pref = []
    for j in J:
        r = J[j][iid]; ls = "T1" if k["T1"] == "S" else "T2"; lb = "T2" if ls == "T1" else "T1"
        ps, pb = rank_pos(r, ls), rank_pos(r, lb)
        pref.append("tie" if ps == pb else ("S" if ps < pb else "B"))
    row["pref"] = pref
    rows.append(row)


def span_bad(s):
    return s != "same" and s != ["same"]


def arm_stats(rs, arm):
    n = len(rs)
    if not n:
        return {}
    fm = [r[arm]["fid_mean"] for r in rs if r[arm]["fid_mean"] is not None]
    ge4 = sum(1 for x in fm if x >= 4)
    inv_any = sum(1 for r in rs if any(r[arm]["inversions"])); inv_both = sum(1 for r in rs if all(r[arm]["inversions"]))
    wrong_both = sum(1 for r in rs if all(span_bad(s) for s in r[arm]["span"])); wrong_either = sum(1 for r in rs if any(span_bad(s) for s in r[arm]["span"]))
    notpage = sum(1 for r in rs if r[arm]["fid"] and max(r[arm]["fid"]) <= 2)
    types = collections.Counter(t for r in rs for jt in r[arm]["inv_types"] for t in set(jt))
    dist = collections.Counter(str(x) for x in fm)
    pct = lambda k: [round(100 * x, 1) for x in wilson(k, n)]
    return {"n": n, "fidelity_median": St.median(fm), "fidelity_mean": round(St.mean(fm), 2), "fidelity_dist_two_judge_mean": dict(sorted(dist.items())),
            "ge4": ge4, "ge4_share": round(ge4 / n, 3), "ge4_ci": wilson(ge4, n),
            "reversed_pages_either": inv_any, "reversed_per_100_either": round(100 * inv_any / n, 1), "reversed_per_100_either_ci": pct(inv_any),
            "reversed_pages_both": inv_both, "reversed_per_100_both": round(100 * inv_both / n, 1), "reversed_per_100_both_ci": pct(inv_both),
            "omission_pages_both": sum(1 for r in rs if all(r[arm]["omit"])), "omission_page_judgements": sum(sum(r[arm]["omit"]) for r in rs),
            "span_wrong_both": wrong_both, "span_wrong_either": wrong_either, "span_wrong_both_ci": pct(wrong_both),
            "not_this_page_fid_le2": notpage, "invention_page_judgements_by_type": dict(types)}


res["arms"] = {a: arm_stats(rows, a) for a in ("S", "B")}
res["arms_5704_subset"] = {a: arm_stats([r for r in rows if r["in_5704"]], a) for a in ("S", "B")}
res["arms_extension"] = {a: arm_stats([r for r in rows if not r["in_5704"]], a) for a in ("S", "B")}
res["by_text"] = {}
for st in sorted({r["stratum"] for r in rows}):
    rs = [r for r in rows if r["stratum"] == st]
    res["by_text"][st] = {"S": arm_stats(rs, "S"), "B": arm_stats(rs, "B"), "pref": dict(collections.Counter(p for r in rs for p in r["pref"]))}
d = [r["S"]["fid_mean"] - r["B"]["fid_mean"] for r in rows]
pos, neg = sum(x > 0 for x in d), sum(x < 0 for x in d); nn = pos + neg
p_two = min(1.0, 2 * sum(math.comb(nn, i) for i in range(0, min(pos, neg) + 1)) / 2 ** nn) if nn else None
res["preference"] = {"judgements": dict(collections.Counter(p for r in rows for p in r["pref"])),
                     "both_judges": {"/".join(k): v for k, v in collections.Counter(tuple(r["pref"]) for r in rows).items()},
                     "fid_mean_diff_S_minus_B": round(St.mean(d), 3), "pages_S_higher": pos, "pages_B_higher": neg, "sign_test_p": round(p_two, 4) if p_two is not None else None}
res["judge_agreement"] = {a: {"exact": sum(1 for r in rows if len(set(r[a]["fid"])) == 1), "within1": sum(1 for r in rows if abs(r[a]["fid"][0] - r[a]["fid"][1]) <= 1), "n": len(rows)} for a in ("S", "B")}

# Same pages, PR #5704's arm-B verdicts (different judges, different session): does this run's B agree?
old = {r["page_id"]: r for r in json.load(open(old_scores))["rows"]}
cmp = [(r, old[r["page_id"]]) for r in rows if r["page_id"] in old]
res["vs_5704_armB_same_pages"] = {
    "n": len(cmp),
    "B_now_fid_mean": round(St.mean(r["B"]["fid_mean"] for r, _ in cmp), 2), "B_then_fid_mean": round(St.mean(o["B"]["fid_mean"] for _, o in cmp), 2),
    "S_now_fid_mean": round(St.mean(r["S"]["fid_mean"] for r, _ in cmp), 2),
    "B_then_reversed_either": sum(1 for _, o in cmp if any(o["B"]["inversions"])), "B_now_reversed_either": sum(1 for r, _ in cmp if any(r["B"]["inversions"])),
    "S_now_reversed_either": sum(1 for r, _ in cmp if any(r["S"]["inversions"])),
    "B_then_and_now_reversed_same_page": sum(1 for r, o in cmp if any(o["B"]["inversions"]) and any(r["B"]["inversions"])),
    "B_fid_then_vs_now_within_0_5": sum(1 for r, o in cmp if abs(r["B"]["fid_mean"] - o["B"]["fid_mean"]) <= 0.5),
}
res["inversion_list"] = [{"id": r["id"], "arm": a, "toh": r["toh"], "folio": r["folio"], "vol": r["vol"], "page_number": r["page_number"],
                          "judges": sum(1 for x in r[a]["inversions"] if x), "quotes": [q for x in r[a]["inversions"] for q in x][:3]}
                         for r in rows for a in ("S", "B") if any(r[a]["inversions"])]
res["rows"] = rows
json.dump(res, open(outp, "w"), ensure_ascii=False, indent=1)
print(json.dumps({k: res[k] for k in ("judged", "controls", "preference", "judge_agreement", "vs_5704_armB_same_pages")}, indent=1))
for name in ("arms", "arms_5704_subset", "arms_extension"):
    for a in ("S", "B"):
        x = res[name][a]
        print(name, a, {k: x[k] for k in ("n", "fidelity_mean", "ge4_share", "reversed_pages_either", "reversed_per_100_either_ci", "reversed_pages_both", "reversed_per_100_both_ci", "span_wrong_both", "span_wrong_either", "omission_pages_both", "not_this_page_fid_le2")})
print("dist S", res["arms"]["S"]["fidelity_dist_two_judge_mean"], "B", res["arms"]["B"]["fidelity_dist_two_judge_mean"])
for s, v in res["by_text"].items():
    print(s, "n", v["S"]["n"], "rev S/B", v["S"]["reversed_pages_either"], v["B"]["reversed_pages_either"], "fid S/B", v["S"]["fidelity_mean"], v["B"]["fidelity_mean"], "span S/B", v["S"]["span_wrong_both"], v["B"]["span_wrong_both"], "pref", v["pref"])
