#!/usr/bin/env python3
# score.py — P@10 / nDCG@10 per arm, paired bootstrap vs CLIP, judge agreement (#6871 image search; PREREGISTRATION.md).
# PRIOR ART: scripts/eval/orig-lang-recall/score.mjs (recall@10 with Wilson intervals, one gold page per query); here the
# relevance is pooled and graded, so P@10 and nDCG@10 with a paired bootstrap over queries.
#   python score.py --key sheets/key.json --out out --judge 'judge-[0-9].jsonl' --rejudge 'judge-r*.jsonl' --pool pool.jsonl
import argparse, glob, json, math, random

ap = argparse.ArgumentParser()
for k in ("key", "out", "judge", "rejudge", "pool"): ap.add_argument("--" + k, required=True)
a = ap.parse_args()
key = json.load(open(a.key))
stratum = {json.loads(l)["id"]: json.loads(l)["stratum"] for l in open(a.pool) if l.strip()}


def grades(pattern):
    g = {}
    for f in sorted(glob.glob(pattern)):
        for l in open(f):
            if not l.strip(): continue
            r = json.loads(l); imgs = key[r["qid"]]["images"]
            g[r["qid"]] = {imgs[int(n) - 1]: int(v) for n, v in r["grades"].items() if 0 < int(n) <= len(imgs)}
    return g


G, R = grades(a.judge), grades(a.rejudge)
arms = {f.split("/")[-1][:-9]: json.load(open(f)) for f in sorted(glob.glob(a.out + "/*-top.json"))}
qids = sorted(G)
missing = [(q, p) for q in qids for arm in arms.values() for p, _ in arm[q] if p not in G[q]]


def p10(arm, q): return sum(G[q].get(p, 0) >= 1 for p, _ in arms[arm][q][:10]) / 10


def ndcg(arm, q):
    dcg = sum((2 ** G[q].get(p, 0) - 1) / math.log2(i + 2) for i, (p, _) in enumerate(arms[arm][q][:10]))
    ideal = sorted(G[q].values(), reverse=True)[:10]
    idcg = sum((2 ** v - 1) / math.log2(i + 2) for i, v in enumerate(ideal))
    return dcg / idcg if idcg else 0.0


def boot(diffs, B=10000, seed=6871):
    rnd = random.Random(seed); n = len(diffs)
    ms = sorted(sum(diffs[rnd.randrange(n)] for _ in range(n)) / n for _ in range(B))
    return round(sum(diffs) / n, 3), [round(ms[int(0.025 * B)], 3), round(ms[int(0.975 * B)], 3)]


res = {"queries": len(qids), "unjudged_hits": len(missing), "arms": {}}
for arm in arms:
    P = [p10(arm, q) for q in qids]; N = [ndcg(arm, q) for q in qids]
    rel = [(p, G[q].get(p, 0)) for q in qids for p, _ in arms[arm][q][:10] if G[q].get(p, 0) >= 1]
    res["arms"][arm] = {"P@10": round(sum(P) / len(P), 3), "nDCG@10": round(sum(N) / len(N), 3),
                        "queries_with_any_hit": sum(x > 0 for x in P), "relevant_hits": len(rel),
                        "relevant_from_random_stratum": sum(stratum.get(p) == "random" for p, _ in rel)}
for arm in arms:
    if arm == "clip": continue
    res["arms"][arm]["dP@10_vs_clip"] = boot([p10(arm, q) - p10("clip", q) for q in qids])
    res["arms"][arm]["dnDCG_vs_clip"] = boot([ndcg(arm, q) - ndcg("clip", q) for q in qids])
if {"siglip2-so400m", "siglip2-base"} <= set(arms):
    res["so400m_minus_base_P@10"] = boot([p10("siglip2-so400m", q) - p10("siglip2-base", q) for q in qids])
# judge agreement on the re-judged queries, binary (0 vs >= 1) and exact grade
pairs = [(G[q][p], R[q][p]) for q in R for p in R[q] if p in G.get(q, {})]
res["rejudge"] = {"queries": len(R), "images": len(pairs), "binary_agree": round(sum((x >= 1) == (y >= 1) for x, y in pairs) / max(1, len(pairs)), 3),
                  "exact_agree": round(sum(x == y for x, y in pairs) / max(1, len(pairs)), 3),
                  "positives_first_judge": sum(x >= 1 for x, _ in pairs), "positives_rejudge": sum(y >= 1 for _, y in pairs)}
print(json.dumps(res, indent=1))
