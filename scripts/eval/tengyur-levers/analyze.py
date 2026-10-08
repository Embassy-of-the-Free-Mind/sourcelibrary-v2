#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-characterize/analyze.py (#5829): the two-review merge (same_finding,
# union / both) and the per-100 counts are copied from it unchanged (it runs on import, so it cannot be
# imported). New here: the per-ARM paired comparison and the preregistered rule (PREREG.md), span errors,
# plant recall per reviewer, and cost per 1,000 pages per arm.
"""
analyze.py — #6121 round analysis. $0, offline.

  python3 scripts/eval/tengyur-levers/analyze.py [--round 1]

Reads results/tengyur-levers-6121/r<round>/{key.json, reviews/*.json}, arms/*.jsonl (cost) and
/root/tlev/r<round>/items.jsonl. Writes results/tengyur-levers-6121/r<round>/analysis.json.
"""
import collections, glob, itertools, json, math, os, random, re, sys

arg = lambda k, d: sys.argv[sys.argv.index(f"--{k}") + 1] if f"--{k}" in sys.argv else d
ROUND = int(arg("round", "1"))
BASE = "scripts/eval/results/tengyur-models-6121" if "--models" in sys.argv else "scripts/eval/results/tengyur-levers-6121"  # --models: #6121 round 2
OUT = f"{BASE}/r{ROUND}"
PARETO = "--pareto" in sys.argv  # #6182: the fresh 100-page sample; FP (production rerun) plays round 1's A
if PARETO:
    BASE = OUT = "scripts/eval/results/pareto-6182/tib-rev"
key = json.load(open(f"{OUT}/key.json"))
if PARETO:
    for k in key.values():
        if k.get("arm") == "FP": k["arm"] = "A"
rev = {"A": {}, "B": {}}
for f in sorted(glob.glob(f"{OUT}/reviews/*.json")):
    for x in json.load(open(f)):
        rev[os.path.basename(f)[0]][x["id"]] = x
missing = {r: [i for i in key if i not in rev[r]] for r in rev}
assert not any(missing.values()), missing
RA = {"reversal", "agent"}
ALL = {"reversal", "agent", "term", "omission", "addition", "structure", "gloss"}
SEED = 6182 if PARETO else 6121


def norm(s):
    return re.sub(r"[^a-z0-9ཀ-ྼ]+", " ", (s or "").lower()).strip()


def overlap(a, b, k=20):
    a, b = norm(a), norm(b)
    if not a or not b:
        return False
    if a in b or b in a:
        return True
    return any(a[i:i + k] in b for i in range(0, max(1, len(a) - k + 1), 3))


def same_finding(e, f):
    return overlap(e.get("tibetan"), f.get("tibetan"), 12) or overlap(e.get("english"), f.get("english"))


def wilson(k, n, z=1.96):
    if n == 0:
        return [None, None]
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(100 * (c - h), 1), round(100 * (c + h), 1)]


rows = {}
for iid in key:
    a, b = rev["A"][iid], rev["B"][iid]
    ea, eb = a.get("errors") or [], b.get("errors") or []
    mb, pairs = set(), []
    for i, e in enumerate(ea):
        for j, f in enumerate(eb):
            if j not in mb and same_finding(e, f):
                mb.add(j); pairs.append((e, f)); break
    union = ea + [f for j, f in enumerate(eb) if j not in mb]
    spans = [a.get("span", "ok"), b.get("span", "ok")]
    rows[iid] = {**key[iid], "union": union, "both": pairs, "A": ea, "B": eb, "score": [a["score"], b["score"]],
                 "verdict": [a["verdict"], b["verdict"]], "span": spans}

cnt = lambda es, ts: sum(1 for e in es if e["type"] in ts)
cnt_both = lambda ps, ts: sum(1 for e, f in ps if e["type"] in ts and f["type"] in ts)

# ---------- gate: plant recall ----------
plants = [r for r in rows.values() if r["arm"] == "PLANT"]


def found_plant(es, r):
    pl = r["plant"]
    if r["plant_kind"] == "span":
        return None
    ts = {"reversal", "agent"} if r["plant_kind"] in ("reversal", "agent") else {"term"}
    return any(e["type"] in ts and (overlap(e.get("english"), pl["new"]) or overlap(pl["new"], e.get("english"))) for e in es)


gate = {"by_reviewer": {}, "span": {}}
for rv in ("A", "B"):
    ra = [found_plant(r[rv], r) for r in plants if r["plant_kind"] in ("reversal", "agent")]
    tm = [found_plant(r[rv], r) for r in plants if r["plant_kind"] == "term"]
    gate["by_reviewer"][rv] = {"rev_agent_found": sum(ra), "rev_agent_of": len(ra), "term_found": sum(tm), "term_of": len(tm)}
sp = [r for r in plants if r["plant_kind"] == "span"]
gate["span"] = {"marked_either": sum(1 for r in sp if any(s != "ok" for s in r["span"]) or any(e["type"] == "addition" for e in r["union"])), "of": len(sp),
                "span_field_either": sum(1 for r in sp if any(s != "ok" for s in r["span"]))}
gate["pass"] = all(v["rev_agent_found"] >= 10 for v in gate["by_reviewer"].values()) and gate["span"]["marked_either"] >= 3

# ---------- per page × arm ----------
arms = sorted({r["arm"] for r in rows.values()} - {"PLANT"})
by = collections.defaultdict(dict)  # page_id -> arm -> row
for r in rows.values():
    if r["arm"] != "PLANT":
        by[r["page_id"]][r["arm"]] = r
pages = sorted(by)
section = {p: next(iter(by[p].values()))["section"] for p in pages}
R_ = lambda p, a: cnt(by[p][a]["union"], RA)
Rb = lambda p, a: cnt_both(by[p][a]["both"], RA)
SPAN = lambda p, a: int(any(s != "ok" for s in by[p][a]["span"]))


def perm_p(d, seed=SEED):
    """One-sided paired sign-flip p for mean(d) > 0 (d = S − X). Exact when ≤ 20 nonzero, else 10,000 draws."""
    nz = [x for x in d if x]
    obs = sum(d)
    if not nz:
        return 1.0
    if len(nz) <= 20:
        tot = ge = 0
        for signs in itertools.product((1, -1), repeat=len(nz)):
            tot += 1; ge += sum(s * abs(x) for s, x in zip(signs, nz)) >= obs
        return ge / tot
    rng = random.Random(seed)
    ge = sum(sum(abs(x) * rng.choice((1, -1)) for x in nz) >= obs for _ in range(10000))
    return (ge + 1) / 10001


def boot_ci(vals, seed=SEED, nb=2000):
    rng = random.Random(seed); n = len(vals)
    bs = sorted(100 * sum(vals[rng.randrange(n)] for _ in range(n)) / n for _ in range(nb))
    return [round(bs[int(.025 * nb)], 1), round(bs[int(.975 * nb) - 1], 1)]


def stats(ps, label):
    n = len(ps)
    o = {"label": label, "pages": n, "arms": {}}
    for a in arms:
        rs = [R_(p, a) for p in ps]
        o["arms"][a] = {
            "rev_agent_per100_either": round(100 * sum(rs) / n, 1), "ci": boot_ci(rs),
            "rev_agent_per100_both": round(100 * sum(Rb(p, a) for p in ps) / n, 1),
            "pages_with_rev_agent": sum(1 for x in rs if x),
            "reversal_per100": round(100 * sum(cnt(by[p][a]["union"], {"reversal"}) for p in ps) / n, 1),
            "agent_per100": round(100 * sum(cnt(by[p][a]["union"], {"agent"}) for p in ps) / n, 1),
            "all_per100": round(100 * sum(cnt(by[p][a]["union"], ALL) for p in ps) / n, 1),
            "term_per100": round(100 * sum(cnt(by[p][a]["union"], {"term"}) for p in ps) / n, 1),
            "omission_per100": round(100 * sum(cnt(by[p][a]["union"], {"omission"}) for p in ps) / n, 1),
            "span_error_pages": sum(SPAN(p, a) for p in ps),
            "span_kinds": dict(collections.Counter(s for p in ps for s in by[p][a]["span"] if s != "ok")),
            "score_mean": round(sum(sum(by[p][a]["score"]) for p in ps) / (2 * n), 2),
            "light_share": round(100 * sum(v == "light" for p in ps for v in by[p][a]["verdict"]) / (2 * n), 1),
        }
    S = o["arms"]["S"]
    if "A" in o["arms"]:
        floor = abs(o["arms"]["A"]["rev_agent_per100_either"] - S["rev_agent_per100_either"])
        span_floor = abs(o["arms"]["A"]["span_error_pages"] - S["span_error_pages"])
    else:
        floor, span_floor = None, None
    o["floor_per100"] = floor
    o["span_floor_pages"] = span_floor
    o["rule"] = {}
    for x in [a for a in arms if a not in ("S", "A")] + (["A"] if "A" in arms else []):
        d = [R_(p, "S") - R_(p, x) for p in ps]
        gain = round(100 * sum(d) / n, 1)
        p = perm_p(d)
        c1 = floor is not None and gain > floor
        c2 = p < 0.10
        c3 = span_floor is not None and o["arms"][x]["span_error_pages"] <= S["span_error_pages"] + span_floor
        o["rule"][x] = {"gain_per100_vs_S": gain, "gain_ci": boot_ci(d), "pages_better": sum(1 for v in d if v > 0), "pages_worse": sum(1 for v in d if v < 0),
                        "p_one_sided": round(p, 4), "beats_floor": c1, "p_lt_0.10": c2, "span_ok": c3,
                        "adopt": bool(c1 and c2 and c3) if x != "A" else None, "card_min_effect_8": gain >= 8}
    return o


res = {"round": ROUND, "gate": gate, "pool": stats(pages, "pool (all 60)"), "by_section": {}}
for s in sorted(set(section.values())):
    res["by_section"][s] = stats([p for p in pages if section[p] == s], s)
if PARETO:  # #6182 rule A: the preregistered pool of the two sections a re-translation would buy first
    res["by_section"]["Pramāṇa + Madhyamaka"] = stats([p for p in pages if section[p] in ("Pramāṇa", "Madhyamaka")], "Pramāṇa + Madhyamaka")
    res["gate_replant"] = json.load(open(f"{OUT}/calib-2/gate.json"))

# verse vs prose (descriptive)
vs = {p: next(iter(by[p].values())).get("verse_share") or 0 for p in pages}
res["verse_pages_ge_0.3"] = stats([p for p in pages if vs[p] >= 0.3], "verse share ≥ 0.3") if sum(vs[p] >= 0.3 for p in pages) >= 5 else None

# reviewer agreement on R (pages × arms)
pa = [(p, a) for p in pages for a in arms]
res["agreement"] = {
    "rev_agent_page_flag_A": sum(1 for p, a in pa if cnt(by[p][a]["A"], RA)), "rev_agent_page_flag_B": sum(1 for p, a in pa if cnt(by[p][a]["B"], RA)),
    "rev_agent_page_flag_both": sum(1 for p, a in pa if cnt(by[p][a]["A"], RA) and cnt(by[p][a]["B"], RA)),
    "verdict_agree": round(sum(by[p][a]["verdict"][0] == by[p][a]["verdict"][1] for p, a in pa) / len(pa), 3),
}

# cost per 1,000 pages per arm (sample pages + reference sides; billed tokens incl. thinking)
cost = {}
for f in sorted(glob.glob(f"{BASE}/arms/*.jsonl")):
    name = os.path.basename(f)[:-6]
    if name == "ledger":
        continue
    xs = [json.loads(l) for l in open(f) if l.strip()]
    usd = sum(x["gen"]["usd"] for x in xs)
    th = [x["gen"]["thinking"] or 0 for x in xs]
    cost[name] = {"pages": len(xs), "usd": round(usd, 4), "per_1000_realtime": round(1000 * usd / len(xs), 2), "per_1000_batch_equiv": round(500 * usd / len(xs), 2),
                  "thinking_tokens_mean": round(sum(th) / len(th)), "thinking_pages": sum(1 for t in th if t)}
res["cost"] = cost
led = [json.loads(l) for l in open("/root/pareto-6182/ledger.jsonl" if PARETO else f"{BASE}/arms/ledger.jsonl") if l.strip()]
res["spend_total_usd"] = round(sum(x["usd"] for x in led), 4)
json.dump(res, open(f"{OUT}/analysis.json", "w"), indent=1, ensure_ascii=False)

# ---------- print ----------
print("GATE", json.dumps(gate))
for blk in [res["pool"]] + list(res["by_section"].values()):
    print(f"\n== {blk['label']} (n={blk['pages']}) floor={blk['floor_per100']} span_floor={blk['span_floor_pages']}")
    for a, v in blk["arms"].items():
        print(f"  {a:3} R/100 {v['rev_agent_per100_either']:6} {v['ci']}  both {v['rev_agent_per100_both']:5}  rev {v['reversal_per100']:5} agent {v['agent_per100']:5}  all {v['all_per100']:6}  span {v['span_error_pages']} {v['span_kinds']}  score {v['score_mean']} light {v['light_share']}")
    for x, r in blk["rule"].items():
        print(f"  rule {x}: gain {r['gain_per100_vs_S']} {r['gain_ci']} better/worse {r['pages_better']}/{r['pages_worse']} p={r['p_one_sided']} floor:{r['beats_floor']} p:{r['p_lt_0.10']} span:{r['span_ok']} ADOPT={r['adopt']}")
print("\nagreement", res["agreement"])
print("cost", json.dumps(cost, indent=0))
print("spend", res["spend_total_usd"])
