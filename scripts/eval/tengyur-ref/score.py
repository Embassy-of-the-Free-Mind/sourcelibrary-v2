#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tibetan-mt-ab/score.mjs (rankings + fidelity per arm vs 84000, one judge
# file per judge) and scripts/eval/tengyur-pilot-qa/score.py (PR #5676: control checks, Wilson CI,
# typed inventions). Neither scores two paired arms with span verdicts, nor a mechanical length
# screen over every referenced side; this does both and reuses their measures and thresholds.
"""
score.py — Tengyur 84000-reference test (#5497): controls, per-arm quality, A-vs-B preference,
and a mechanical span screen over every referenced side.

  python3 score.py <tref-dir> <judge-dir> <out.json>

Judge files: <judge-dir>/verdicts-J1.jsonl, verdicts-J2.jsonl (the parts concatenated).
Prints counts only.
"""
import json, math, os, re, sys, collections, statistics as S

tref, jdir, outp = sys.argv[1:4]
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
        l = l.strip()
        if l:
            try:
                r = json.loads(l); v[r["id"]] = r
            except Exception:
                pass
    return v


J = {j: load(j) for j in ("J1", "J2")}
res = {"judged": {j: len(v) for j, v in J.items()}, "items": len(key)}


def rank_pos(r, label):
    for i, grp in enumerate(r.get("ranking", [])):
        if label in grp:
            return i
    return None


def tie(r):
    return any(len(g) == 2 for g in r.get("ranking", []))


# ── controls
ctl = collections.defaultdict(lambda: collections.Counter())
for j, v in J.items():
    for iid, k in key.items():
        if k["kind"] == "pair" or iid not in v:
            continue
        r = v[iid]; lab = {k["T1"]: "T1", k["T2"]: "T2"}
        real, fake = r["scores"].get(lab["real"], {}), r["scores"].get(lab["ctl"], {})
        c = ctl[f"{k['kind']}-{j}"]; c["n"] += 1
        if k["kind"] == "NEG":
            c["fake_le2"] += int((fake.get("fidelity") or 9) <= 2)
        elif k["kind"] == "PLANT":
            caught_inv = bool(fake.get("inversions"))
            below = (rank_pos(r, lab["ctl"]) or 0) > (rank_pos(r, lab["real"]) or 0)
            new = plants[iid]["new"]
            quoted = any(any(w in json.dumps(x, ensure_ascii=False) for w in re.findall(r"\b(not|is|are|does|can|will|exist)\b", new)) for x in fake.get("inversions", []))
            c["inversion_flagged"] += int(caught_inv); c["ranked_below"] += int(below); c["caught"] += int(caught_inv or below)
        else:
            c["tied"] += int(tie(r)); c["same_grade"] += int(real.get("fidelity") == fake.get("fidelity"))
res["controls"] = {k: dict(v) for k, v in sorted(ctl.items())}

# ── per arm
pairs = {iid: k for iid, k in key.items() if k["kind"] == "pair"}
strata = lambda toh: toh if toh in ("toh3808", "toh1183", "toh1189") else "small texts"
rows = []
for iid, k in pairs.items():
    if not all(iid in v for v in J.values()):
        continue
    row = {"id": iid, "toh": k["toh"], "stratum": strata(k["toh"]), "folio": k["folio"], "page_id": k["page_id"], "book_id": k.get("book_id"), "page_number": k.get("page_number"), "vol": k.get("vol")}
    for arm in ("A", "B"):
        lab = "T1" if k["T1"] == arm else "T2"
        per = [J[j][iid]["scores"].get(lab, {}) for j in J]
        fids = [p.get("fidelity") for p in per if isinstance(p.get("fidelity"), (int, float))]
        row[arm] = {
            "fid": fids, "fid_mean": S.mean(fids) if fids else None,
            "omit": [bool(p.get("omissions")) for p in per],
            "inv_types": [[x.get("type") for x in p.get("inventions", []) or []] for p in per],
            "inversions": [p.get("inversions", []) or [] for p in per],
            "span": [p.get("span", "same") for p in per],
        }
    pref = []
    for j in J:
        r = J[j][iid]; la = "T1" if k["T1"] == "A" else "T2"; lb = "T2" if la == "T1" else "T1"
        pa, pb = rank_pos(r, la), rank_pos(r, lb)
        pref.append("tie" if pa == pb else ("A" if pa < pb else "B"))
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
    inv_any = [r for r in rs if any(r[arm]["inversions"])]
    inv_both = [r for r in rs if all(r[arm]["inversions"])]
    types = collections.Counter()
    for r in rs:
        for j_types in r[arm]["inv_types"]:
            for t in set(j_types):
                types[t] += 1
    span = collections.Counter()
    for r in rs:
        for s in r[arm]["span"]:
            for t in ([s] if isinstance(s, str) else s):
                if t != "same":
                    span[t] += 1
    return {
        "n": n, "fidelity_median": S.median(fm), "fidelity_mean": round(S.mean(fm), 2),
        "ge4": ge4, "ge4_share": round(ge4 / n, 3), "ge4_ci": wilson(ge4, n),
        "inversion_pages_either_judge": len(inv_any), "inversion_pages_both": len(inv_both),
        "inversions_per_100_either": round(100 * len(inv_any) / n, 1),
        "omission_page_judgements": sum(sum(r[arm]["omit"]) for r in rs), "omission_share": round(sum(sum(r[arm]["omit"]) for r in rs) / (2 * n), 3),
        "invention_page_judgements_by_type": dict(types),
        "span_not_same_judgements": sum(1 for r in rs for s in r[arm]["span"] if span_bad(s)), "span_share": round(sum(1 for r in rs for s in r[arm]["span"] if span_bad(s)) / (2 * n), 3),
        "span_by_type": dict(span),
    }


res["arms"] = {arm: arm_stats(rows, arm) for arm in ("A", "B")}
res["by_text"] = {}
for st in sorted({r["stratum"] for r in rows}):
    rs = [r for r in rows if r["stratum"] == st]
    pc = collections.Counter(p for r in rs for p in r["pref"])
    res["by_text"][st] = {"A": arm_stats(rs, "A"), "B": arm_stats(rs, "B"), "pref_judgements": dict(pc)}
pc = collections.Counter(p for r in rows for p in r["pref"])
agree = collections.Counter(tuple(r["pref"]) for r in rows)
# sign test on the paired mean fidelity difference
d = [r["A"]["fid_mean"] - r["B"]["fid_mean"] for r in rows if r["A"]["fid_mean"] is not None and r["B"]["fid_mean"] is not None]
pos, neg = sum(x > 0 for x in d), sum(x < 0 for x in d)
nn = pos + neg
p_two = min(1.0, 2 * sum(math.comb(nn, i) for i in range(0, min(pos, neg) + 1)) / 2 ** nn) if nn else None
res["preference"] = {"judgements": dict(pc), "both_judges": {"/".join(k): v for k, v in agree.items()}, "fid_mean_diff_A_minus_B": round(S.mean(d), 3) if d else None, "pages_A_higher": pos, "pages_B_higher": neg, "pages_equal": len(d) - nn, "sign_test_p": round(p_two, 4) if p_two is not None else None}
res["judge_agreement"] = {arm: {"exact": sum(1 for r in rows if len(set(r[arm]["fid"])) == 1), "within1": sum(1 for r in rows if len(r[arm]["fid"]) == 2 and abs(r[arm]["fid"][0] - r[arm]["fid"][1]) <= 1), "n": len(rows)} for arm in ("A", "B")}
res["inversion_list"] = [{"id": r["id"], "toh": r["toh"], "folio": r["folio"], "arm": arm, "judges": sum(1 for x in r[arm]["inversions"] if x), "quotes": [q for x in r[arm]["inversions"] for q in x][:3], "book_id": r["book_id"], "page_number": r["page_number"]} for r in rows for arm in ("A", "B") if any(r[arm]["inversions"])]
res["rows"] = rows

# ── mechanical span screen over EVERY referenced side (no judge): candidate words / reference words
ref = [json.loads(l) for l in open(os.path.join(tref, "ref", "reference.jsonl"))]
st = json.load(open(os.path.join(tref, "arms", "state.json")))
strip = lambda t: re.sub(r"<(note|gloss|summary|keywords|meta|vocab|warning)\b[^>]*>[\s\S]*?</\1>|<[^>]+>", " ", t or "")
mech = {}
for arm, store in (("A", st["a"]), ("B", st["b"])):
    ratios = []
    for r in ref:
        t = store.get(r["page_id"], {}).get("text")
        if t is None:
            continue
        ratios.append((r, len(strip(t).split()) / max(1, len(r["ref_en"].split()))))
    rs = sorted(x for _, x in ratios)
    by = collections.defaultdict(list)
    for r, x in ratios:
        by[strata(r["toh"])].append(x)
    # adjacent shift: this side short (< 0.6) next to a long neighbour (> 1.3), same text
    idx = {(r["vol"], r["page_number"]): x for r, x in ratios}
    shifts = [r["id"] for r, x in ratios if x < 0.6 and (idx.get((r["vol"], r["page_number"] - 1), 0) > 1.3 or idx.get((r["vol"], r["page_number"] + 1), 0) > 1.3)]
    mech[arm] = {"n": len(rs), "median": round(S.median(rs), 3), "p5": round(rs[len(rs) // 20], 3), "p95": round(rs[19 * len(rs) // 20], 3),
                 "lt_0_6": sum(x < 0.6 for x in rs), "gt_1_5": sum(x > 1.5 for x in rs), "adjacent_shift_pages": len(shifts), "adjacent_shift_ids": shifts[:40],
                 "by_text": {k: {"n": len(v), "median": round(S.median(v), 3), "lt_0_6": sum(x < 0.6 for x in v), "gt_1_5": sum(x > 1.5 for x in v)} for k, v in sorted(by.items())}}
res["mechanical_all_sides"] = mech
json.dump(res, open(outp, "w"), ensure_ascii=False, indent=1)
print(json.dumps({k: res[k] for k in ("judged", "controls", "preference", "judge_agreement")}, indent=1))
for arm in ("A", "B"):
    a = res["arms"][arm]
    print(arm, {k: a[k] for k in ("n", "fidelity_median", "fidelity_mean", "ge4_share", "ge4_ci", "inversion_pages_either_judge", "inversion_pages_both", "omission_share", "span_share", "invention_page_judgements_by_type", "span_by_type")})
for s, v in res["by_text"].items():
    print(s, "A", v["A"].get("ge4_share"), v["A"].get("fidelity_median"), "B", v["B"].get("ge4_share"), v["B"].get("fidelity_median"), "inv A/B", v["A"].get("inversion_pages_either_judge"), v["B"].get("inversion_pages_either_judge"), "span A/B", v["A"].get("span_share"), v["B"].get("span_share"), "pref", v["pref_judgements"])
print("mech", json.dumps({a: {k: m[k] for k in ("n", "median", "lt_0_6", "gt_1_5", "adjacent_shift_pages")} for a, m in mech.items()}))
