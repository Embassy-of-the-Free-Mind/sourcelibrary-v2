#!/usr/bin/env python3
# PRIOR ART: scripts/eval/canon-ref-6331/score-set.py — same gate rule, `either()` page flags and by-text bootstrap,
# and pareto-6182/score-xl.py's `norm`. Changed: merged-label decoding (one label → several arms), the #6182 agentic
# prereg (2026-10-09-agentic-qa-arms-6182.md): anchor check, sign tests, earns-its-cost rule, check precision and the
# capacity table. NUMBERS ONLY: no judge quotes, no reference text, no model text are written.
"""
score.py — $0.  python3 scripts/eval/agentic-qa-6182/score.py
Reads scripts/eval/results/agentic-qa-6182/judge/key.json, the judge out files and the arm files; writes
scripts/eval/results/agentic-qa-6182/judge/scores.json.
"""
import json, glob, random, importlib.util, os, re, sys
from math import comb

spec = importlib.util.spec_from_file_location("sx", os.path.join(os.path.dirname(__file__), "../pareto-6182/score-xl.py"))
sx = importlib.util.module_from_spec(spec); spec.loader.exec_module(sx)
AQ = "/mnt/HC_Volume_105839809/jobs/agentic-qa-6182"
OUT = "scripts/eval/results/agentic-qa-6182/judge"
STORED = "scripts/eval/results/canon-ref-6331/judge/scores.json"
B, SEED, POINT_USD = 2000, 6182, 24.8
ARMS = ("C38", "SAd", "SA", "GQ")
LANGS = ("Chinese", "Sanskrit", "Pali")
read = lambda p: [json.loads(l) for l in open(p) if l.strip()]
key = json.load(open(f"{OUT}/key.json"))["items"]
J = {}
for j in ("J1", "J2"):
    J[j] = {}
    for f in sorted(glob.glob(f"{AQ}/judge/out-{j}-*.jsonl")):
        for l in open(f):
            if l.strip():
                o = json.loads(l); J[j][o["id"]] = o
    missing = sorted(set(key) - set(J[j]))
    if missing: sys.exit(f"{j} has no verdict for {len(missing)} items, e.g. {missing[:5]}")


def decode(o, labels):
    """label → [arms]; returns arm → norm(score) and arm → raw score dict."""
    tier = {}
    for t, grp in enumerate(o.get("ranking") or []):
        for l in (grp if isinstance(grp, list) else [grp]):
            tier[l] = t
    d, raw = {}, {}
    for l, s in o["scores"].items():
        names = labels.get(l)
        if names is None: continue
        for n in (names if isinstance(names, list) else [names]):
            d[n] = sx.norm(s, tier.get(l)); raw[n] = s
    return d, raw


dec, raw = {}, {}
for j in J:
    dec[j], raw[j] = {}, {}
    for i, o in J[j].items():
        dec[j][i], raw[j][i] = decode(o, key[i]["labels"])

# ── gate (PREREG: plants caught ≥ 6/8, duplicates tie ≥ 3/4)
gate = {}
for j in J:
    g = {"plants": 0, "plant_caught": 0, "plant_caught_strict": 0, "dups": 0, "dup_tie": 0}
    for i, k in key.items():
        if k["kind"] == "PLANT":
            p, t = dec[j][i]["P_PLANT"], dec[j][i]["P"]
            listed = bool(p["rev"] and not t["rev"]); lower = (p["fid"] or 0) < (t["fid"] or 0)
            g["plants"] += 1; g["plant_caught"] += bool(listed or lower); g["plant_caught_strict"] += bool(listed and lower)
        elif k["kind"] == "DUP":
            a, b = dec[j][i]["P"], dec[j][i]["P_DUP"]
            g["dups"] += 1; g["dup_tie"] += a["fid"] == b["fid"] and a["tier"] == b["tier"]
    g["pass"] = g["plant_caught"] >= 6 and g["dup_tie"] >= 3
    gate[j] = g
JP = [j for j in J if gate[j]["pass"]]
if not JP:
    json.dump({"gate": gate, "verdict": "instrument failed: no judge passed the gate"}, open(f"{OUT}/scores.json", "w"), indent=1)
    sys.exit(f"instrument failed {gate}")

rows, nulls = [], 0
for i, k in key.items():
    if k["kind"] != "ARMS": continue
    per = {}
    for j in JP:
        d = {a: v for a, v in dec[j][i].items() if v["fid"] is not None}
        nulls += len(dec[j][i]) - len(d); per[j] = d
    arms = sorted(set.intersection(*[set(per[j]) for j in JP]))
    rows.append({"id": i, "uid": k["uid"], "work": k["work"], "lang": k["lang"], "stratum": k["stratum"], "famous": k["famous"], "arms": arms, "J": per})

fid = lambda r, a: sum(r["J"][j][a]["fid"] for j in r["J"]) / len(r["J"])
either = lambda r, a, f: int(any(r["J"][j][a][f] for j in r["J"]))
revom = lambda r, a: int(either(r, a, "rev") or either(r, a, "om"))


def boot(rs, stat, seed=SEED):
    by = {}
    for r in rs: by.setdefault(r["work"], []).append(r)
    ws, rng, out = sorted(by), random.Random(seed), []
    for _ in range(B):
        d = []
        for w in (rng.choice(ws) for _ in ws):
            g = by[w]; d += [g[rng.randrange(len(g))] for _ in g]
        out.append(stat(d))
    out.sort()
    return [round(out[int(0.025 * B)], 3), round(out[int(0.975 * B) - 1], 3)]


def binom_tail(k, n):  # P(X ≤ k), X ~ Bin(n, 1/2)
    return sum(comb(n, x) for x in range(k + 1)) / 2 ** n if n else 1.0


def sign(rs, a, b, f):
    """Pages flagged on a but not b (worse) vs b but not a (better)."""
    worse = sum(f(r, a) and not f(r, b) for r in rs); better = sum(f(r, b) and not f(r, a) for r in rs)
    n = worse + better
    return {"a_only": worse, "b_only": better, "p_two_sided": round(min(1.0, 2 * binom_tail(min(worse, better), n)), 4),
            "p_rise_one_sided": round(binom_tail(better, n), 4)}


def arm_stats(rs, a):
    rs = [r for r in rs if a in r["arms"]]; n = len(rs)
    if not n: return None
    return {"pages": n, "works": len({r["work"] for r in rs}), "fidelity": round(sum(fid(r, a) for r in rs) / n, 3),
            "fidelity_ci_by_text": boot(rs, lambda d: sum(fid(r, a) for r in d) / len(d)), "share_ge4": round(sum(fid(r, a) >= 4 for r in rs) / n, 3),
            **{f"{f}_pages_per100": round(100 * sum(either(r, a, f) for r in rs) / n, 1) for f in ("rev", "om", "inven", "fill")},
            "revom_pages_per100": round(100 * sum(revom(r, a) for r in rs) / n, 1)}


def delta(rs, a, b):
    rs = [r for r in rs if a in r["arms"] and b in r["arms"]]
    if not rs: return None
    d = lambda r: fid(r, a) - fid(r, b)
    return {"pages": len(rs), "mean": round(sum(map(d, rs)) / len(rs), 3), "ci_by_text": boot(rs, lambda x: sum(map(d, x)) / len(x)),
            "pages_higher": sum(d(r) > 0 for r in rs), "pages_lower": sum(d(r) < 0 for r in rs),
            "revom_sign": sign(rs, a, b, revom), "fill_sign": sign(rs, a, b, lambda r, x: either(r, x, "fill"))}


def verdict(o, a):
    d = o["deltas"][f"{a}-C38"]
    fid_ok = d["mean"] >= 0.15 and d["ci_by_text"][0] > 0
    s = d["revom_sign"]; ro_ok = s["a_only"] < s["b_only"] and s["p_two_sided"] < 0.05
    fill_ok = d["fill_sign"]["p_rise_one_sided"] >= 0.05
    return {"fidelity_rule": fid_ok, "revom_rule": ro_ok, "fill_not_up": fill_ok, "earns_its_cost": (fid_ok or ro_ok) and fill_ok,
            "descriptive_only": o["pages"] < 10}


def group(rs):
    o = {"pages": len(rs), "works": len({r["work"] for r in rs}), "arms": {a: arm_stats(rs, a) for a in ARMS}}
    o["deltas"] = {f"{a}-{b}": delta(rs, a, b) for a, b in (("SA", "C38"), ("GQ", "C38"), ("SAd", "C38"), ("SA", "SAd"), ("GQ", "SA"))}
    o["verdict"] = {a: verdict(o, a) for a in ("SA", "GQ")}
    return o


G = {"pooled": rows, **{l: [r for r in rows if r["lang"] == l] for l in LANGS}}
zh = G["Chinese"]
G["Chinese not famous"] = [r for r in zh if not r["famous"]]; G["Chinese famous"] = [r for r in zh if r["famous"]]
for s in sorted({r["stratum"] for r in zh}): G[f"Chinese {s}"] = [r for r in zh if r["stratum"] == s]
stored = json.load(open(STORED))["groups"]
anchor = {l: {"stored": stored[l]["arms"]["C38"]["fidelity"], "rejudged": None} for l in LANGS}
res = {"date": "2026-10-09", "judges_scored": JP, "gate": gate, "null_fidelity_scores_dropped": nulls}
groups = {g: group(rs) for g, rs in G.items()}
for l in LANGS:
    a = anchor[l]; a["rejudged"] = groups[l]["arms"]["C38"]["fidelity"]; a["diff"] = round(a["rejudged"] - a["stored"], 3); a["within_0.10"] = abs(a["diff"]) <= 0.10
res["anchor"] = anchor; res["comparable"] = all(a["within_0.10"] for a in anchor.values())
res["groups"] = groups

# ── agreement
if len(JP) == 2:
    pairs = [(r["J"]["J1"][a]["fid"], r["J"]["J2"][a]["fid"]) for r in rows for a in r["arms"]]
    res["agreement"] = {"pairs": len(pairs), "fid_exact": round(sum(x == y for x, y in pairs) / len(pairs), 3),
                        "fid_within_1": round(sum(abs(x - y) <= 1 for x, y in pairs) / len(pairs), 3)}

# ── check precision (PREREG): findings on a judged draft (SAd for SA, C38 for GQ) against the judges' flags on that draft
arms_rows = {a: {r["uid"]: r for r in read(f"{AQ}/arms/{a}.jsonl")} for a in ("SA", "GQ")}
by_uid = {r["uid"]: r for r in rows}
nz = lambda s: re.sub(r"[^0-9a-zÀ-ɏḀ-ỿ]+", "", (s or "").lower())
grams = lambda s, n=6: {s[i:i + n] for i in range(max(1, len(s) - n + 1))} if s else set()


def judge_quotes(s):
    q = []
    if s.get("reversal"): q.append(s["reversal"].get("candidate") or "")
    q += [d.get("detail") or "" for d in s.get("defects") or []]
    q += [x.get("quote") or "" for x in s.get("invention") or [] if x.get("kind") in ("unreadable_fill", "added_fact")]
    return q


prec = {}
for a, draft_arm in (("SA", "SAd"), ("GQ", "C38")):
    P = {}
    for uid, ar in arms_rows[a].items():
        r = by_uid.get(uid)
        if not r or draft_arm not in r["arms"]: continue
        i = r["id"]
        for f in ar.get("findings") or []:
            t = f["type"]; g = grams(nz(f.get("draft_span")))
            ok = False
            for j in JP:
                s = raw[j][i][draft_arm]; dj = dec[j][i][draft_arm]
                if t == "reversal" and dj["rev"]: ok = True
                if t == "omission" and dj["om"]: ok = True
                if t in ("mistranslation", "addition", "reversal") and g and any(g & grams(nz(q)) for q in judge_quotes(s)): ok = True
            p = P.setdefault(t, [0, 0]); p[0] += 1; p[1] += ok
    tot = [sum(v[0] for v in P.values()), sum(v[1] for v in P.values())]
    prec[a] = {"by_type": {t: {"findings": n, "confirmed": c, "precision": round(c / n, 3) if n else None} for t, (n, c) in sorted(P.items())},
               "all": {"findings": tot[0], "confirmed": tot[1], "precision": round(tot[1] / tot[0], 3) if tot[0] else None},
               "units_with_findings": sum(bool(x.get("findings")) for x in arms_rows[a].values()), "units": len(arms_rows[a]),
               "flags": {k: sum(x.get("flag") == k for x in arms_rows[a].values()) for k in ("check_unparsable", "revise_short")}}
res["check_precision"] = prec

# ── capacity (per page = per unit)
cap = {}
for a in ("SA", "GQ"):
    rs = list(arms_rows[a].values()); n = len(rs)
    calls = [c for r in rs for c in r["calls"]]
    m = lambda f, cs=calls: round(sum(c[f] for c in cs) / n, 1)
    cost = sum(c["cost_list_usd"] for c in calls) / n
    o = {"pages": n, "calls_per_page": round(len(calls) / n, 3), "input": m("input"), "output_incl_thinking": m("output"), "thinking": m("thinking"),
         "cache_read": m("cache_read"), "cache_write": m("cache_write"), "usd_list_per_1000_pages": round(1000 * cost, 2),
         "points_per_1000_pages": round(1000 * cost / POINT_USD, 3), "pages_per_point": round(POINT_USD / cost) if cost else None,
         "steps": {}}
    for st in ("draft", "check", "revise"):
        cs = [c for c in calls if c["step"] == st]
        if cs: o["steps"][st] = {"calls_per_page": round(len(cs) / n, 3), "usd_list_per_1000_pages": round(1000 * sum(c["cost_list_usd"] for c in cs) / n, 2),
                                 "output_per_page": m("output", cs), "median_secs": sorted(c["secs"] for c in cs)[len(cs) // 2]}
    secs = sorted(sum(c["secs"] for c in r["calls"]) for r in rs)
    o["median_secs_per_page_serial"] = secs[n // 2]
    cap[a] = o
res["capacity"] = {"usd_per_point": POINT_USD, "note": "points: claude-limits calibration on a mostly-Opus mix; the Sonnet meter rate is unmeasured. "
                   "GQ's Gemini draft uses the Google subscription, 0 Claude points.", "arms": cap}
res["rows"] = [{"uid": r["uid"], "lang": r["lang"], "stratum": r["stratum"], "work": r["work"], "fid": {a: round(fid(r, a), 2) for a in r["arms"]},
                "revom": {a: revom(r, a) for a in r["arms"]}, "fill": {a: either(r, a, "fill") for a in r["arms"]}} for r in rows]
json.dump(res, open(f"{OUT}/scores.json", "w"), indent=1, ensure_ascii=False)

print("gate", gate, "nulls", nulls, "\nanchor", anchor, "comparable", res["comparable"], "\nagreement", res.get("agreement"))
for g, o in groups.items():
    print(f"\n== {g}: {o['pages']} units, {o['works']} works  verdict {o['verdict']}")
    for a, s in o["arms"].items():
        if s: print(f"  {a:4} fid {s['fidelity']:.2f} {s['fidelity_ci_by_text']} ≥4 {s['share_ge4']:.0%}  rev {s['rev_pages_per100']} om {s['om_pages_per100']} "
                    f"revom {s['revom_pages_per100']} inv {s['inven_pages_per100']} fill {s['fill_pages_per100']}")
    for k, d in o["deltas"].items():
        if d: print(f"  {k}: {d['mean']:+.2f} {d['ci_by_text']} hi/lo {d['pages_higher']}/{d['pages_lower']} revom {d['revom_sign']} fill {d['fill_sign']}")
print("\nprecision", json.dumps(prec), "\ncapacity", json.dumps(cap, indent=1))
