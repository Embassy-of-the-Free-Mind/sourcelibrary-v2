#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-ref/score-stored.py (#5797) scores two-candidate judge verdicts against a
# reference; scripts/eval/stats-cross-model.mjs has paired tests. #5829 has single-candidate typed reviews,
# three control kinds, a spot-check precision and corpus detectors, so the scoring is new. Pure Python.
"""
analyze.py — Step 6 of #5829. $0, offline.

  python3 scripts/eval/tengyur-characterize/analyze.py

Reads results/tengyur-characterize-5829/{key.json, reviews/*.json, spotcheck-findings.tsv, controls-log.json,
sample.json} and /root/tchar/{items.jsonl, detect.jsonl}. Writes analysis.json and proposed-fixes.jsonl there.
Intervals: Wilson for proportions of pages; percentile bootstrap over pages (2,000 draws, seed 5829) for
per-100-page error rates and for the precision-adjusted rates (precision drawn from Beta(c+½, n−c+½)).
"""
import collections, glob, json, math, os, random, re

OUT = "scripts/eval/results/tengyur-characterize-5829"
W = "/root/tchar"
key = json.load(open(f"{OUT}/key.json"))
items = {json.loads(l)["id"]: json.loads(l) for l in open(f"{W}/items.jsonl")}
rev = {"A": {}, "B": {}}
for f in sorted(glob.glob(f"{OUT}/reviews/*.json")):
    for x in json.load(open(f)):
        rev[os.path.basename(f)[0]][x["id"]] = x
assert all(len(rev[r]) == 210 for r in rev)
R = random.Random(5829)
NB = 2000
VERD = ["light", "work", "specialist"]
RA = {"reversal", "agent"}


def wilson(k, n, z=1.96):
    if n == 0:
        return [None, None]
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(100 * (c - h), 1), round(100 * (c + h), 1)]


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, max(0, int(q * len(xs))))]


def norm(s):
    return re.sub(r"[^a-z0-9ཀ-ྼ]+", " ", (s or "").lower()).strip()


def overlap(a, b, k=20):
    """Two quotes point at the same spot: one contains the other, or they share a k-char run (20 for English)."""
    a, b = norm(a), norm(b)
    if not a or not b:
        return False
    if a in b or b in a:
        return True
    return any(a[i:i + k] in b for i in range(0, max(1, len(a) - k + 1), 3))


def same_finding(e, f):
    return overlap(e.get("tibetan"), f.get("tibetan"), 12) or overlap(e.get("english"), f.get("english"))


# ---------- per-item merge of the two reviews ----------
rows = {}
for iid in key:
    a, b = rev["A"][iid], rev["B"][iid]
    ea, eb = a["errors"], b["errors"]
    matched_b = set()
    pairs = []
    for i, e in enumerate(ea):
        for j, f in enumerate(eb):
            if j not in matched_b and same_finding(e, f):
                matched_b.add(j); pairs.append((i, j)); break
    def types(es): return collections.Counter(e["type"] for e in es)
    # union = A's findings + B's unmatched; both = matched pairs (typed by A's label, either label counts for R/A)
    union = ea + [f for j, f in enumerate(eb) if j not in matched_b]
    both = [(ea[i], eb[j]) for i, j in pairs]
    rows[iid] = {
        "type": key[iid]["type"], "section": key[iid]["section"], "verdict": [a["verdict"], b["verdict"]], "score": [a["score"], b["score"]],
        "nA": len(ea), "nB": len(eb), "union": union, "both": both, "A": ea, "B": eb,
    }


def cnt(es, ts):
    return sum(1 for e in es if e["type"] in ts)


def cnt_both(pairs, ts):
    """A spot both reviewers flagged, and both typed within ts (reversal and agent count as one class)."""
    return sum(1 for e, f in pairs if e["type"] in ts and f["type"] in ts)


def page_stats(ids, label):
    n = len(ids)
    out = {"label": label, "pages": n}
    # verdict shares: each review counts half a page; also "worse of two"
    for v in VERD:
        k = sum((rows[i]["verdict"][0] == v) + (rows[i]["verdict"][1] == v) for i in ids)
        out[f"share_{v}"] = round(100 * k / (2 * n), 1) if n else None
        boots = []
        for _ in range(NB if n else 0):
            s = [ids[R.randrange(n)] for _ in range(n)]
            boots.append(100 * sum((rows[i]["verdict"][0] == v) + (rows[i]["verdict"][1] == v) for i in s) / (2 * n))
        out[f"share_{v}_ci"] = [round(pct(boots, .025), 1), round(pct(boots, .975), 1)] if n else None
    worse = collections.Counter(max(rows[i]["verdict"], key=VERD.index) for i in ids)
    out["worse_of_two"] = {v: worse.get(v, 0) for v in VERD}
    out["score_mean"] = round(sum(sum(rows[i]["score"]) for i in ids) / (2 * n), 2) if n else None
    for name, ts in [("reversal", {"reversal"}), ("agent", {"agent"}), ("term", {"term"}), ("rev_agent", RA), ("all", None)]:
        tsx = ts or {"reversal", "agent", "term", "omission", "addition", "structure", "gloss"}
        e_either = [cnt(rows[i]["union"], tsx) for i in ids]
        e_both = [cnt_both(rows[i]["both"], tsx) for i in ids]
        e_A = [cnt(rows[i]["A"], tsx) for i in ids]
        e_B = [cnt(rows[i]["B"], tsx) for i in ids]
        p_either = sum(1 for x in e_either if x)
        p_both = sum(1 for x in e_both if x)
        d = {
            "errors_per100_either": round(100 * sum(e_either) / n, 1), "errors_per100_both": round(100 * sum(e_both) / n, 1),
            "errors_per100_A": round(100 * sum(e_A) / n, 1), "errors_per100_B": round(100 * sum(e_B) / n, 1),
            "pages_with_either": p_either, "pages_with_either_pct": round(100 * p_either / n, 1), "pages_with_either_ci": wilson(p_either, n),
            "pages_with_both": p_both, "pages_with_both_pct": round(100 * p_both / n, 1), "pages_with_both_ci": wilson(p_both, n),
        }
        bo_e, bo_b = [], []
        for _ in range(NB):
            s = [R.randrange(n) for _ in range(n)]
            bo_e.append(100 * sum(e_either[k] for k in s) / n); bo_b.append(100 * sum(e_both[k] for k in s) / n)
        d["errors_per100_either_ci"] = [round(pct(bo_e, .025), 1), round(pct(bo_e, .975), 1)]
        d["errors_per100_both_ci"] = [round(pct(bo_b, .025), 1), round(pct(bo_b, .975), 1)]
        out[name] = d
    return out


by_type = collections.defaultdict(list)
for iid, r in rows.items():
    by_type[r["type"]].append(iid)
S = sorted(by_type["SAMPLE"])
res = {"n_items": len(rows), "by_item_type": {t: page_stats(sorted(v), t) for t, v in by_type.items()}}
secs = collections.defaultdict(list)
for i in S:
    secs[rows[i]["section"]].append(i)
res["sample_by_section"] = {s: page_stats(sorted(v), s) for s, v in sorted(secs.items(), key=lambda kv: -len(kv[1]))}

# covariates on the sample
sm = {p["page_id"]: p for p in json.load(open(f"{OUT}/sample.json"))["pages"]}
def bucket(i):
    v = key[i]["verse_share"]
    return "verse ≥ 50%" if v >= .5 else ("verse 10–50%" if v >= .1 else "prose (< 10% verse)")
cov = collections.defaultdict(list)
for i in S:
    cov[bucket(i)].append(i)
    if key[i]["opens_text"]:
        cov["opens a text"].append(i)
    if key[i]["colophon"]:
        cov["colophon"].append(i)
res["sample_by_covariate"] = {k: {"pages": len(v), "rev_agent_pages_either": sum(1 for i in v if cnt(rows[i]["union"], RA)),
                                  "rev_agent_per100_either": round(100 * sum(cnt(rows[i]["union"], RA) for i in v) / len(v), 1),
                                  "light_share": round(100 * sum(x == "light" for i in v for x in rows[i]["verdict"]) / (2 * len(v)), 1)} for k, v in cov.items()}

# ---------- agreement ----------
def kappa(ids):
    n = len(ids)
    po = sum(rows[i]["verdict"][0] == rows[i]["verdict"][1] for i in ids) / n
    pa = collections.Counter(rows[i]["verdict"][0] for i in ids); pb = collections.Counter(rows[i]["verdict"][1] for i in ids)
    pe = sum(pa[v] * pb[v] for v in VERD) / (n * n)
    return {"n": n, "observed": round(po, 3), "kappa": round((po - pe) / (1 - pe), 3) if pe < 1 else None,
            "table": {f"{x}/{y}": sum(1 for i in ids if rows[i]["verdict"] == [x, y]) for x in VERD for y in VERD}}
def overlap_stats(ids):
    a = sum(rows[i]["nA"] for i in ids); b = sum(rows[i]["nB"] for i in ids); m = sum(len(rows[i]["both"]) for i in ids)
    ra_a = sum(cnt(rows[i]["A"], RA) for i in ids); ra_b = sum(cnt(rows[i]["B"], RA) for i in ids); ra_m = sum(cnt_both(rows[i]["both"], RA) for i in ids)
    pa = sum(1 for i in ids if cnt(rows[i]["A"], RA)); pb = sum(1 for i in ids if cnt(rows[i]["B"], RA)); pab = sum(1 for i in ids if cnt(rows[i]["A"], RA) and cnt(rows[i]["B"], RA))
    return {"findings_A": a, "findings_B": b, "matched": m, "share_of_A_matched": round(m / a, 3) if a else None, "share_of_B_matched": round(m / b, 3) if b else None,
            "jaccard": round(m / (a + b - m), 3) if a + b - m else None,
            "rev_agent_A": ra_a, "rev_agent_B": ra_b, "rev_agent_matched": ra_m,
            "rev_agent_pages_A": pa, "rev_agent_pages_B": pb, "rev_agent_pages_both": pab}
res["agreement"] = {"sample": {"verdict": kappa(S), "findings": overlap_stats(S)}, "all_210": {"verdict": kappa(sorted(rows)), "findings": overlap_stats(sorted(rows))}}

# ---------- controls ----------
H = sorted(by_type["HUMAN"])
res["controls"] = {"HUMAN_false_alarm": {
    "note": "84000's published English, run through the same rendering. Every finding is counted as a false alarm, although some may be real (84000 is not error-free) and some are side-boundary effects of the alignment.",
    "errors_per100_either": res["by_item_type"]["HUMAN"]["all"]["errors_per100_either"], "errors_per100_A": res["by_item_type"]["HUMAN"]["all"]["errors_per100_A"], "errors_per100_B": res["by_item_type"]["HUMAN"]["all"]["errors_per100_B"],
    "rev_agent_per100_either": res["by_item_type"]["HUMAN"]["rev_agent"]["errors_per100_either"], "rev_agent_pages_either": res["by_item_type"]["HUMAN"]["rev_agent"]["pages_with_either"],
    "rev_agent_pages_both": res["by_item_type"]["HUMAN"]["rev_agent"]["pages_with_both"],
    "by_type_per100_either": {t: round(100 * sum(cnt(rows[i]["union"], {t}) for i in H) / len(H), 1) for t in ["reversal", "agent", "term", "omission", "addition", "structure", "gloss"]},
    "verdicts": {v: sum(x == v for i in H for x in rows[i]["verdict"]) for v in VERD}, "score_mean": res["by_item_type"]["HUMAN"]["score_mean"],
}}
P = sorted(by_type["PLANT"])
pl = []
for i in P:
    pk, plant = key[i]["plant_kind"], key[i]["plant"]
    def hits(es):
        hs = [e for e in es if overlap(e.get("english"), plant["new"]) or overlap((e.get("fix") or {}).get("find"), plant["new"])]
        return {"found": bool(hs), "typed_right": any(e["type"] == pk for e in hs), "types": [e["type"] for e in hs]}
    a, b = hits(rows[i]["A"]), hits(rows[i]["B"])
    pl.append({"id": i, "kind": pk, "how": plant["how"], "A": a, "B": b})
rec = {}
for k in ["reversal", "agent", "term", "all"]:
    xs = [p for p in pl if k == "all" or p["kind"] == k]
    rec[k] = {"n": len(xs), "A": sum(p["A"]["found"] for p in xs), "B": sum(p["B"]["found"] for p in xs),
              "either": sum(p["A"]["found"] or p["B"]["found"] for p in xs), "both": sum(p["A"]["found"] and p["B"]["found"] for p in xs),
              "either_typed_right": sum(p["A"]["typed_right"] or p["B"]["typed_right"] for p in xs)}
    rec[k]["per_review_recall_pct"] = round(100 * (rec[k]["A"] + rec[k]["B"]) / (2 * len(xs)), 1)
    rec[k]["per_review_recall_ci"] = wilson(rec[k]["A"] + rec[k]["B"], 2 * len(xs))
res["controls"]["PLANT_recall"] = {"by_kind": rec, "items": pl}
J = sorted(by_type["J5797"])
jr = []
for i in J:
    j = key[i]["j5797"]
    jq = [q for qs in j["inversions"] for q in qs]
    def jhit(es): return any(any(overlap(e.get("english"), q.get("candidate")) or overlap(e.get("tibetan"), q.get("tibetan"), 12) for q in jq) for e in es if e["type"] in RA)
    jr.append({"id": i, "judges_reversed_either": j["reversed_either"], "judges_reversed_both": j["reversed_both"],
               "rev_A": cnt(rows[i]["A"], RA) > 0, "rev_B": cnt(rows[i]["B"], RA) > 0, "same_spot_A": jhit(rows[i]["A"]), "same_spot_B": jhit(rows[i]["B"]),
               "verdict": rows[i]["verdict"]})
def agree(field):
    t = collections.Counter((x["judges_reversed_either"], x[field]) for x in jr)
    return {"judge_yes_rev_yes": t[(True, True)], "judge_yes_rev_no": t[(True, False)], "judge_no_rev_yes": t[(False, True)], "judge_no_rev_no": t[(False, False)]}
res["controls"]["J5797_agreement"] = {"design": "10 sides either #5797 judge marked reversed (vs 84000) + 10 neither marked; reviewer flag = any reversal or agent finding",
                                     "reviewer_A": agree("rev_A"), "reviewer_B": agree("rev_B"),
                                     "same_spot_on_judged_reversals": {"A": sum(x["same_spot_A"] for x in jr if x["judges_reversed_either"]), "B": sum(x["same_spot_B"] for x in jr if x["judges_reversed_either"]),
                                                                       "either": sum((x["same_spot_A"] or x["same_spot_B"]) for x in jr if x["judges_reversed_either"]), "of": sum(x["judges_reversed_either"] for x in jr)},
                                     "items": jr}

# ---------- spot-check precision and adjusted headline ----------
spot = [l.rstrip("\n").split("\t") for l in open(f"{OUT}/spotcheck-findings.tsv") if l.strip()]
draw = json.load(open(f"{OUT}/spotcheck-draw.json"))["findings"]
lab = {int(s[0]): s[1] for s in spot}
def prec(filter_types=None):
    xs = [(k + 1, f) for k, f in enumerate(draw) if filter_types is None or f["type"] in filter_types]
    c = sum(1 for k, f in xs if lab[k] == "confirmed"); d = sum(1 for k, f in xs if lab[k] == "debatable"); n = len(xs)
    return {"n": n, "confirmed": c, "debatable": d, "rejected": n - c - d, "precision_strict": round(c / n, 3), "precision_half_debatable": round((c + d / 2) / n, 3),
            "strict_ci": wilson(c, n)}
res["spotcheck"] = {"all": prec(), "rev_agent": prec(RA), "by_type": {t: prec({t}) for t in sorted({f["type"] for f in draw})},
                    "clean_pages": [l.rstrip("\n").split("\t")[:2] for l in open(f"{OUT}/spotcheck-clean.tsv") if l.strip()]}
# adjusted reversal+agent errors per 100 pages: raw union count × precision (drawn jointly in the bootstrap)
pr = res["spotcheck"]["rev_agent"]
e_either = [cnt(rows[i]["union"], RA) for i in S]
e_both = [cnt_both(rows[i]["both"], RA) for i in S]
adj = {}
for nm, es, pc, pn in [("either_strict", e_either, pr["confirmed"], pr["n"]), ("either_half_debatable", e_either, pr["confirmed"] + pr["debatable"] / 2, pr["n"])]:
    bo = []
    for _ in range(NB):
        s = [R.randrange(len(S)) for _ in range(len(S))]
        p = R.betavariate(pc + .5, pn - pc + .5)
        bo.append(100 * sum(es[k] for k in s) / len(S) * p)
    adj[nm] = {"point": round(100 * sum(es) / len(S) * pc / pn, 1), "ci": [round(pct(bo, .025), 1), round(pct(bo, .975), 1)], "precision": round(pc / pn, 3)}
adj["both_unadjusted"] = {"point": round(100 * sum(e_both) / len(S), 1), "ci": res["by_item_type"]["SAMPLE"]["rev_agent"]["errors_per100_both_ci"]}
res["headline_rev_agent_per100"] = adj

# ---------- detectors ----------
det = {}
for l in open(f"{W}/detect.jsonl"):
    d = json.loads(l); det[d["page_id"]] = d
secrate = collections.defaultdict(lambda: collections.Counter())
for d in det.values():
    c = secrate[d["section"]]; c["pages"] += 1
    c["a_flag"] += d["a"]["flag"]; c["a_flag_noq"] += d["a"]["flag_noq"]; c["a_has_objection"] += d["a"]["bo"] > 0
    c["b_hand"] += bool(d["b"]["hand"]); c["b_mvy"] += bool(d["b"]["mvy"]); c["b_any"] += d["b"]["flag"]; c["c_pali"] += d["c"]["flag"]
tot = collections.Counter()
for c in secrate.values():
    tot.update(c)
secrate["ALL"] = tot
res["detectors_corpus"] = {s: {**dict(c), **{f"{k}_pct": round(100 * c[k] / c["pages"], 2) for k in ["a_flag", "a_flag_noq", "a_has_objection", "b_hand", "b_mvy", "b_any", "c_pali"]}} for s, c in secrate.items()}
pali_forms = collections.Counter(f for d in det.values() for f in d["c"]["forms"])
res["detectors_pali_forms"] = pali_forms.most_common(30)
res["detectors_hand_terms"] = collections.Counter(t for d in det.values() for t in d["b"]["hand"]).most_common(30)
# precision / recall against reviewer findings on the sample (either reviewer)
def pr_rc(flag, target):
    tp = sum(1 for i in S if flag(i) and target(i)); fp = sum(1 for i in S if flag(i) and not target(i)); fn = sum(1 for i in S if not flag(i) and target(i))
    return {"flagged": tp + fp, "targets": tp + fn, "tp": tp, "precision": round(tp / (tp + fp), 3) if tp + fp else None, "recall": round(tp / (tp + fn), 3) if tp + fn else None}
pid = lambda i: key[i]["page_id"]
VOICE = re.compile(r"objection|opponent|objector|interlocutor|questioner|author's (own )?view|the reply|qualm|purvapaksa|pūrvapakṣa|ཞེ་ན|ཟེར", re.I)
voice_t = lambda i: any(e["type"] == "agent" and VOICE.search((e.get("why") or "") + " " + (e.get("tibetan") or "")) for e in rows[i]["union"])
PALI_T = lambda i: any(re.search(r"\bpali\b|pāli", (e.get("why") or ""), re.I) for e in rows[i]["union"])
res["detectors_vs_reviewers"] = {
    "a_flag_vs_agent": pr_rc(lambda i: det[pid(i)]["a"]["flag"], lambda i: cnt(rows[i]["union"], {"agent"}) > 0),
    "a_flag_noq_vs_agent": pr_rc(lambda i: det[pid(i)]["a"]["flag_noq"], lambda i: cnt(rows[i]["union"], {"agent"}) > 0),
    "a_flag_noq_vs_voice_agent": pr_rc(lambda i: det[pid(i)]["a"]["flag_noq"], voice_t),
    "a_flag_noq_vs_rev_agent": pr_rc(lambda i: det[pid(i)]["a"]["flag_noq"], lambda i: cnt(rows[i]["union"], RA) > 0),
    "b_hand_vs_term": pr_rc(lambda i: bool(det[pid(i)]["b"]["hand"]), lambda i: cnt(rows[i]["union"], {"term"}) > 0),
    "b_mvy_vs_term": pr_rc(lambda i: bool(det[pid(i)]["b"]["mvy"]), lambda i: cnt(rows[i]["union"], {"term"}) > 0),
    "b_any_vs_term": pr_rc(lambda i: det[pid(i)]["b"]["flag"], lambda i: cnt(rows[i]["union"], {"term"}) > 0),
    "c_pali_vs_pali_finding": pr_rc(lambda i: det[pid(i)]["c"]["flag"], PALI_T),
    "voice_agent_targets": sum(1 for i in S if voice_t(i)),
}
json.dump(res, open(f"{OUT}/analysis.json", "w"), ensure_ascii=False, indent=1, default=list)

# ---------- proposed fixes (not applied) ----------
with open(f"{OUT}/proposed-fixes.jsonl", "w") as fh:
    n = 0
    spot_by = {f["fid"]: lab[k + 1] for k, f in enumerate(draw)}
    for iid, r in sorted(rows.items()):
        if r["type"] not in ("SAMPLE", "J5797", "PLANT"):
            continue
        for rv in ("A", "B"):
            for k, e in enumerate(r[rv]):
                if e.get("confidence") != "high" or not e.get("fix"):
                    continue
                if r["type"] == "PLANT" and overlap(e.get("english"), key[iid]["plant"]["new"]):
                    continue  # the planted error, not the stored text
                other = r["B" if rv == "A" else "A"]
                fh.write(json.dumps({"page_id": key[iid]["page_id"], "book_id": key[iid]["book_id"], "vol": key[iid]["vol"], "page_number": key[iid]["page_number"],
                                     "folio": key[iid]["folio"], "item": iid, "item_type": r["type"], "reviewer": rv, "type": e["type"], "tibetan": e.get("tibetan"),
                                     "why": e.get("why"), "find": e["fix"]["find"], "replace": e["fix"]["replace"],
                                     "other_reviewer_same_spot": any(same_finding(e, f) for f in other), "spotcheck": spot_by.get(f"{rv}:{iid}:{k}"),
                                     "note": "find/replace is against the RENDERED English the reviewer saw (<note>→[note: …], <term>→(…)); map back before applying"},
                                    ensure_ascii=False) + "\n")
                n += 1
print(f"wrote analysis.json; {n} proposed high-confidence fixes (not applied)")
hs = res["by_item_type"]["SAMPLE"]
print(json.dumps({k: hs[k] for k in ["share_light", "share_light_ci", "share_work", "share_work_ci", "share_specialist", "share_specialist_ci", "worse_of_two", "score_mean"]}))
print("rev_agent", json.dumps(hs["rev_agent"])); print("headline adj", json.dumps(adj)); print("spot", json.dumps(res["spotcheck"]["all"]), json.dumps(res["spotcheck"]["rev_agent"]))
print("agree", json.dumps(res["agreement"]["sample"]["verdict"]), json.dumps(res["agreement"]["sample"]["findings"]))
print("human", json.dumps(res["controls"]["HUMAN_false_alarm"]))
print("plant", json.dumps(rec)); print("j5797", json.dumps({k: v for k, v in res["controls"]["J5797_agreement"].items() if k != "items"}))
print("det", json.dumps(res["detectors_vs_reviewers"])); print("detALL", json.dumps(res["detectors_corpus"]["ALL"]))
