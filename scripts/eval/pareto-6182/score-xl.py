#!/usr/bin/env python3
# PRIOR ART: scripts/eval/pareto-6182/score-tib.py (the Tengyur half: strata, clustered bootstrap, agreement,
# rule B) and scripts/eval/translation-vs-reference/score.mjs (#5695: decodes this judge prompt's schema —
# boolean omission, one quoted reversal, invention by kind, ranking tiers). score-tib.py reads the R3 schema
# (inversion lists) and pools sides by Tengyur text; score.mjs reads #5695's per-judge keys and has no
# rule B. score-ref.py --round 6182xl loads and checks the judge files and calls this. NUMBERS ONLY: no
# judge quotes, no reference text are written.
"""
score-xl.py — $0. Not run directly:
  python3 scripts/eval/tengyur-levers/score-ref.py --round 6182xl
writes scripts/eval/results/pareto-6182/xljudge/scores.json.

PREREG.md (rule B) on the 365 xl pages, with the 2026-10-07 amendment: J1 judged every item; J2 judged
every control plus a seeded quarter of the pages (/root/pareto-6182/xljudge/J2-subset.json, sha256 of the
comma-joined ids e3413c8bb1ed6b57, fixed before any score was read). A page's fidelity is the mean of the
judges that scored it; a reversal is either judge listing one. J1 alone is reported as a sensitivity check.
"""
import json, random

GEMINI = ["L31", "L35", "FP", "G35", "G36", "G37", "G38", "PRO"]
STRATA = {"Latin": ["Latin"], "Greek": ["Greek"], "T3 pool": ["German", "French", "Italian", "Dutch", "Spanish"],
          "T4 pool": ["Hebrew", "Aramaic", "Arabic", "Persian"], "T5 pool": ["Sanskrit", "Pali", "Chinese"]}
POOLS = {k for k, v in STRATA.items() if len(v) > 1}
B = 2000
W = "/root/pareto-6182"


def norm(s, tier):
    inv = s.get("invention") or []
    rev = s.get("reversal")
    return {"fid": s["fidelity"], "rev": int(bool(rev and (rev.get("candidate") or rev.get("source_or_reference")))),
            "om": int(bool(s.get("omission"))), "inven": int(any(x.get("kind") != "added_fact" for x in inv)),
            "fill": int(any(x.get("kind") == "unreadable_fill" for x in inv)), "span_off": int(s.get("span") not in ("same", None)), "tier": tier}


def decode(o, labels):
    tier = {}
    for t, grp in enumerate(o.get("ranking") or []):
        for l in (grp if isinstance(grp, list) else [grp]):
            tier[l] = t
    return {labels[l]: norm(s, tier.get(l)) for l, s in o["scores"].items() if l in labels}


def run(key, J, OUT, subset):
    items = key["items"]
    dec = {j: {i: decode(o, items[i]["labels"]) for i, o in J[j].items()} for j in J}
    # ── gate (PREREG: plant caught = reversal listed or lower fidelity than its twin, ≥ 6/8; duplicates tie ≥ 3/4)
    gate, controls = {}, []
    for j in J:
        g = {"plants": 0, "plant_caught_prereg": 0, "plant_caught_strict": 0, "dups": 0, "dup_tie": 0}
        for i, k in items.items():
            if k["kind"] == "PLANT":
                p, t = dec[j][i]["P_PLANT"], dec[j][i]["P"]
                listed = p["rev"] and not t["rev"]; lower = p["fid"] < t["fid"]
                g["plants"] += 1; g["plant_caught_prereg"] += bool(listed or lower); g["plant_caught_strict"] += bool(listed and lower)
                controls.append({"judge": j, "item": i, "kind": "PLANT", "how": k["plant"]["how"], "reversal_listed": bool(listed), "lower_fid": lower,
                                 "fid": [p["fid"], t["fid"]]})
            elif k["kind"] == "DUP":
                a, b = dec[j][i]["P"], dec[j][i]["P_DUP"]
                tie = a["fid"] == b["fid"] and a["tier"] == b["tier"]
                g["dups"] += 1; g["dup_tie"] += tie
                controls.append({"judge": j, "item": i, "kind": "DUP", "tie": tie, "fid": [a["fid"], b["fid"]]})
        g["pass"] = g["plant_caught_prereg"] >= 6 and g["dup_tie"] >= 3
        gate[j] = g
    gate["controls"] = controls
    JP = [j for j in J if gate[j]["pass"]]   # PREREG: score only with the judge(s) that pass
    assert JP, "instrument failed: no judge passed the gate"

    # ── per-page rows; PROD = the page's production engine today (getTranslateModelForBook), A-vs-A = AA
    cost = {}
    for a in GEMINI + ["AA"]:
        for l in open(f"{W}/arms/{a}.jsonl"):
            r = json.loads(l)
            if r.get("usd_batch") is not None:
                cost[(a, r["uid"])] = r["usd_batch"]
    rows = []
    for i, k in items.items():
        if k["kind"] != "ARMS":
            continue
        per = {j: dec[j][i] for j in JP if i in dec[j]}
        arms = set(next(iter(per.values())))
        for j in per:
            if k["prod"] in per[j]:
                per[j]["PROD"] = per[j][k["prod"]]
        if k["prod"] in arms:
            arms.add("PROD")
        c = {a: cost.get((a, k["page_id"])) for a in GEMINI + ["AA"]}
        c["PROD"] = c.get(k["prod"])
        rows.append({"id": i, "page_id": k["page_id"], "book": k["page_id"].split("_")[0], "lang": k["lang"], "track": k["track"], "prod": k["prod"],
                     "judges": sorted(per), "arms": sorted(arms), "J": per, "usd": c})

    def fid(r, a, js=None):
        js = [j for j in (js or r["J"]) if j in r["J"]]
        return sum(r["J"][j][a]["fid"] for j in js) / len(js)

    def either(r, a, f):
        return int(any(r["J"][j][a][f] for j in r["J"]))

    def boot(rs, stat, seed=6182):
        """Clustered bootstrap: books with replacement, then pages within each drawn book (one page per book here)."""
        by = {}
        for r in rs:
            by.setdefault(r["book"], []).append(r)
        bks, rng, out = sorted(by), random.Random(seed), []
        for _ in range(B):
            d = []
            for b in (rng.choice(bks) for _ in bks):
                g = by[b]; d += [g[rng.randrange(len(g))] for _ in g]
            out.append(stat(d))
        out.sort()
        return [round(out[int(0.025 * B)], 3), round(out[int(0.975 * B) - 1], 3)]

    def arm_stats(rs, a, js=None):
        n = len(rs)
        if not n:
            return None
        return {"pages": n, "fidelity": round(sum(fid(r, a, js) for r in rs) / n, 3), "fidelity_ci_by_book": boot(rs, lambda d: sum(fid(r, a, js) for r in d) / len(d)),
                "reversal_pages_per100": round(100 * sum(either(r, a, "rev") for r in rs) / n, 1),
                "omission_pages_per100": round(100 * sum(either(r, a, "om") for r in rs) / n, 1),
                "invention_pages_per100": round(100 * sum(either(r, a, "inven") for r in rs) / n, 1),
                "unreadable_fill_pages_per100": round(100 * sum(either(r, a, "fill") for r in rs) / n, 1),
                "span_off_pages_per100": round(100 * sum(either(r, a, "span_off") for r in rs) / n, 1),
                "usd_per_1k_batch": round(1000 * sum(r["usd"][a] for r in rs) / n, 2) if a != "O" and all(r["usd"].get(a) is not None for r in rs) else None}

    def delta(rs, a, b, js=None):
        rs = [r for r in rs if a in r["arms"] and b in r["arms"]]
        d = lambda r: fid(r, a, js) - fid(r, b, js)
        return {"pages": len(rs), "mean": round(sum(d(r) for r in rs) / len(rs), 3), "ci_by_book": boot(rs, lambda x: sum(d(r) for r in x) / len(x)),
                "pages_higher": sum(d(r) > 0 for r in rs), "pages_lower": sum(d(r) < 0 for r in rs)}

    LANES = GEMINI + ["PROD", "AA"]

    def stratum(rs_all, js=None):
        rs = [r for r in rs_all if all(a in r["arms"] for a in LANES)]   # arms compared on shared pages
        o = {"pages": len(rs_all), "pages_shared": len(rs), "books": len({r["book"] for r in rs}),
             "dropped_refusal_pages": sorted(r["page_id"] for r in rs_all if r not in rs),
             "production": {p: sum(r["prod"] == p for r in rs) for p in ("L31", "FP")},
             "arms": {a: arm_stats(rs, a, js) for a in LANES}}
        o["vs_PROD"] = {a: delta(rs, a, "PROD", js) for a in GEMINI + ["AA"]}
        ro = [r for r in rs_all if "O" in r["arms"] and "PROD" in r["arms"]]
        if ro:   # the track's own Opus arm (a context request): a ceiling beside, off the frontier
            o["O_ceiling"] = {"O": arm_stats(ro, "O", js), "PROD_same_pages": arm_stats(ro, "PROD", js), "G38_same_pages": arm_stats([r for r in ro if "G38" in r["arms"]], "G38", js),
                              "O_vs_PROD": delta(ro, "O", "PROD", js)}
        return o, rs

    def rule_b(o, rs):
        A = o["arms"]
        fidB = {a: A[a]["fidelity"] for a in GEMINI}
        revB = {a: A[a]["reversal_pages_per100"] for a in GEMINI}
        cost = {a: A[a]["usd_per_1k_batch"] for a in GEMINI}
        frontier, dominated = [], {}
        for a in GEMINI:
            by = [b for b in GEMINI if b != a and cost[b] <= cost[a] and fidB[b] >= fidB[a] and (cost[b] < cost[a] or fidB[b] > fidB[a])]
            if by: dominated[a] = sorted(by, key=lambda b: (-fidB[b], cost[b]))[0]
            else: frontier.append(a)
        best = max(GEMINI, key=lambda a: fidB[a])
        inside = [a for a in GEMINI if fidB[a] >= fidB[best] - 0.25 and revB[a] <= revB[best] + 8]
        rec = sorted(inside, key=lambda a: (cost[a], -fidB[a]))[0]
        prod_major = max(o["production"], key=o["production"].get)
        floor = o["vs_PROD"]["AA"]

        def effect(a):
            d = o["vs_PROD"][a]
            if cost[a] > A["PROD"]["usd_per_1k_batch"]:
                ch = {"ci_excludes_0": d["ci_by_book"][0] > 0, "outside_AA_floor_ci": d["mean"] > floor["ci_by_book"][1], "delta_ge_0.25": d["mean"] >= 0.25}
            else:
                ch = {"non_inferior_lower_bound_gt_-0.25": d["ci_by_book"][0] > -0.25}
            return {"arm": a, "costlier_than_production": cost[a] > A["PROD"]["usd_per_1k_batch"], "delta_vs_PROD": d, "checks": ch, "routing_proposal": all(ch.values())}

        books = o["books"]
        return {"fidelity": fidB, "reversal_pages_per100": revB, "usd_per_1k_batch": cost, "production_usd_per_1k": A["PROD"]["usd_per_1k_batch"],
                "production_engine": o["production"], "frontier": sorted(frontier, key=lambda a: cost[a]), "dominated_by": dominated, "best_gemini": best,
                "inside_margin": sorted(inside, key=lambda a: cost[a]), "recommended": rec, "AA_floor_vs_PROD": floor,
                "proposal": None if rec == prod_major else effect(rec), "best_vs_PROD": effect(best),
                "grade": f"{books} referenced books: " + ("exploratory" if books < 30 else "directional" if books < 50 else "decision")}

    def hetero(rs, langs, arm):
        """PREREG: every language with ≥ 10 books has the pool's sign, and the pooled Δ lies inside each one's 95 % CI."""
        pooled = delta(rs, arm, "PROD")
        out = {"arm": arm, "pooled": pooled, "languages": {}}
        ok = True
        for l in langs:
            lr = [r for r in rs if r["lang"] == l]
            if len({r["book"] for r in lr}) < 10:
                out["languages"][l] = {"books": len(lr), "checked": False}; continue
            d = delta(lr, arm, "PROD")
            same = (d["mean"] > 0) == (pooled["mean"] > 0) or d["mean"] == 0 == pooled["mean"]
            inside = d["ci_by_book"][0] <= pooled["mean"] <= d["ci_by_book"][1]
            out["languages"][l] = {"books": len(lr), "delta": d, "same_sign": same, "pooled_inside_ci": inside}
            ok = ok and same and inside
        out["pass"] = ok
        return out

    res = {"date": "2026-10-07", "judges_scored": JP, "J2_scope": f"{len(subset)} items: every control + a seeded quarter of pages (sha256 prefix e3413c8bb1ed6b57)",
           "gate": gate, "refused_after_retry": key.get("refused_after_retry"), "strata": {}, "rule_B": {}, "languages": {}, "heterogeneity": {},
           "sensitivity_J1_only": {}, "agreement": None}
    for name, langs in STRATA.items():
        rs_all = [r for r in rows if r["lang"] in langs]
        o, rs = stratum(rs_all)
        res["strata"][name] = o
        rb = rule_b(o, rs)
        res["rule_B"][name] = rb
        if name in POOLS:   # the recommended arm's effect decides; the best arm's is reported beside it
            res["heterogeneity"][name] = {a: hetero(rs, langs, a) for a in dict.fromkeys([rb["recommended"], rb["best_gemini"]]) if a != "PROD"}
        o1, rs1 = stratum(rs_all, ["J1"])
        r1 = rule_b(o1, rs1)
        res["sensitivity_J1_only"][name] = {k: r1[k] for k in ("fidelity", "best_gemini", "inside_margin", "recommended", "proposal", "best_vs_PROD")}
    for l in sorted({r["lang"] for r in rows}):
        o, rs = stratum([r for r in rows if r["lang"] == l])
        res["languages"][l] = {"stratum": o, "rule_B": rule_b(o, rs)}

    # ── inter-judge agreement on the items both judged
    if len(JP) == 2:
        both = [r for r in rows if len(r["judges"]) == 2]
        pairs = [(r["J"]["J1"][a], r["J"]["J2"][a]) for r in both for a in r["arms"] if a != "PROD"]
        x, y = [p[0]["fid"] for p in pairs], [p[1]["fid"] for p in pairs]
        mx, my = sum(x) / len(x), sum(y) / len(y)
        rr = sum((u - mx) * (v - my) for u, v in zip(x, y)) / (sum((u - mx) ** 2 for u in x) * sum((v - my) ** 2 for v in y)) ** 0.5
        f1, f2 = [p[0]["rev"] for p in pairs], [p[1]["rev"] for p in pairs]
        po = sum(a == b for a, b in zip(f1, f2)) / len(f1); p1, p2 = sum(f1) / len(f1), sum(f2) / len(f2)
        pe = p1 * p2 + (1 - p1) * (1 - p2)
        means = {j: {a: round(sum(r["J"][j][a]["fid"] for r in both if a in r["arms"]) / sum(a in r["arms"] for r in both), 3) for a in GEMINI + ["AA", "PROD"]} for j in JP}
        res["agreement"] = {"pages": len(both), "pairs": len(pairs), "fid_exact": round(sum(u == v for u, v in zip(x, y)) / len(x), 3),
                            "fid_within_1": round(sum(abs(u - v) <= 1 for u, v in zip(x, y)) / len(x), 3), "fid_pearson": round(rr, 3),
                            "reversal_flag_agree": round(po, 3), "reversal_flag_kappa": round((po - pe) / (1 - pe), 3) if pe < 1 else None,
                            "reversal_flags": {"J1": sum(f1), "J2": sum(f2), "both": sum(a and b for a, b in zip(f1, f2))},
                            "arm_means_by_judge_on_shared_pages": means, "arm_order_by_judge": {j: sorted(means[j], key=lambda a: -means[j][a]) for j in JP}}
    res["rows"] = [{k: v for k, v in r.items()} for r in rows]
    json.dump(res, open(f"{OUT}/scores.json", "w"), indent=1, ensure_ascii=False)

    print("gate", {j: g for j, g in gate.items() if j != "controls"})
    print("agreement", json.dumps({k: v for k, v in (res["agreement"] or {}).items() if k != "arm_means_by_judge_on_shared_pages"}))
    for name in STRATA:
        o, rb = res["strata"][name], res["rule_B"][name]
        print(f"\n== {name}: {o['pages_shared']}/{o['pages']} pages, production {o['production']}, {rb['grade']}")
        for a in LANES:
            s = o["arms"][a]; d = o["vs_PROD"].get(a)
            print(f"  {a:4} ${s['usd_per_1k_batch']:5}  fid {s['fidelity']:.2f} {s['fidelity_ci_by_book']}  rev {s['reversal_pages_per100']:5} om {s['omission_pages_per100']:5} inv {s['invention_pages_per100']:5}"
                  + (f"  Δ {d['mean']:+.2f} {d['ci_by_book']}" if d else ""))
        if "O_ceiling" in o:
            c = o["O_ceiling"]; print(f"  O (n={c['O']['pages']}) fid {c['O']['fidelity']:.2f} vs PROD same pages {c['PROD_same_pages']['fidelity']:.2f}  Δ {c['O_vs_PROD']['mean']:+.2f} {c['O_vs_PROD']['ci_by_book']}")
        print("  frontier", rb["frontier"], "dominated", rb["dominated_by"], "best", rb["best_gemini"], "inside", rb["inside_margin"], "rec", rb["recommended"])
        print("  proposal", json.dumps(rb["proposal"]), "\n  best_vs_PROD", json.dumps(rb["best_vs_PROD"]))
        if name in res["heterogeneity"]:
            for h in res["heterogeneity"][name].values():
                print("  hetero", h["arm"], h["pass"], {l: (v.get("delta", {}).get("mean"), v.get("delta", {}).get("ci_by_book"), v.get("same_sign"), v.get("pooled_inside_ci")) for l, v in h["languages"].items()})
        s1 = res["sensitivity_J1_only"][name]; print("  J1-only: best", s1["best_gemini"], "inside", s1["inside_margin"], "rec", s1["recommended"], "prop", (s1["proposal"] or {}).get("routing_proposal"))
    print("\n== languages")
    for l, v in res["languages"].items():
        rb = v["rule_B"]; A = v["stratum"]["arms"]
        print(f"  {l:9} n={v['stratum']['pages_shared']:3} prod {v['stratum']['production']} PROD {A['PROD']['fidelity']:.2f} best {rb['best_gemini']} {A[rb['best_gemini']]['fidelity']:.2f} Δ {rb['best_vs_PROD']['delta_vs_PROD']['mean']:+.2f} {rb['best_vs_PROD']['delta_vs_PROD']['ci_by_book']} rec {rb['recommended']} inside {rb['inside_margin']}")
