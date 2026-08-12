# Align Bekker OCR paragraphs to SOL/Adler entries — v2. Issue #3884.
# v2 changes: (1) SOL sequence sorted strictly alphabetically (Bekker alphabetized;
# Adler kept antistoichic -iota groups, which zeroed alphaiota/epsiloniota/omicroniota
# in v1); (2) interior-split pass — unmatched SOL headwords found mid-paragraph split
# the paragraph (OCR runs short glosses together).
# Outputs: aligned.jsonl (one row per SOL entry) + align-report.json
import json, unicodedata, bisect
from pathlib import Path
import os

D = Path(os.environ.get("SOL_DATA_DIR", "scripts/output/sol-harvest"))

def norm(s):
    s = s.replace("*", "")
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return s.lower().replace("ς", "σ").strip(" .,·:;'\"?!()[]<>“”‘’")

def lev_le(a, b, k):
    if abs(len(a) - len(b)) > k: return False
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        if min(cur) > k: return False
        prev = cur
    return prev[-1] <= k

def fuzzy(a, b):
    return (len(a) > 3 and a[0] == b[0]
            and lev_le(a, b, 1 if len(a) < 8 else 2))

sol = [json.loads(l) for l in open(D / "sol.jsonl")]
for r in sol:
    r["_hw"] = norm(r["headword_unicode"].split()[0]) if r["headword_unicode"] else ""
    letter, num = r["adler_id"].split(",")
    r["_num"] = int(num)
# strict alphabetical; homonym groups keep Adler order
sol.sort(key=lambda r: (r["_hw"], r["_num"]))
sol_hw = [r["_hw"] for r in sol]
sol_pos = {}
for i, h in enumerate(sol_hw):
    if h: sol_pos.setdefault(h, []).append(i)

raw = [json.loads(l) for l in open(D / "bekker-entries.jsonl")]
units = []
for r in raw:
    words = r["text"].split()
    units.append({"orig_seq": r["seq"], "words": words,
                  "toks": [norm(w) for w in words],
                  "scan_page": r["scan_page"], "printed_page": r["printed_page"],
                  "margin_letter": r["margin_letter"], "match": None})

# --- Phase A: LIS skeleton over exact first-token pairs ---
pairs, parent, tails = [], {}, []
for ui, u in enumerate(units):
    h = u["toks"][0] if u["toks"] else ""
    cands = sol_pos.get(h, [])
    if not cands or len(cands) > 40: continue
    for si in sorted(cands, reverse=True):
        pid = len(pairs); pairs.append((ui, si))
        j = bisect.bisect_left([t[0] for t in tails], si)
        parent[pid] = tails[j - 1][1] if j > 0 else None
        if j == len(tails): tails.append((si, pid))
        else: tails[j] = (si, pid)
skel, pid = [], (tails[-1][1] if tails else None)
while pid is not None:
    skel.append(pairs[pid]); pid = parent[pid]
skel.reverse()
anchors = []
for ui, si in skel:
    if not anchors or (ui > anchors[-1][0] and si > anchors[-1][1]):
        anchors.append((ui, si))
for ui, si in anchors: units[ui]["match"] = (si, "anchor")

# --- Phase B: per gap (reverse order so splits don't shift earlier indices):
# first-token exact/fuzzy, then interior-split ---
stats = {"gap-exact": 0, "gap-fuzzy": 0, "interior-split": 0}
bounds = [(-1, -1)] + anchors + [(len(units), len(sol))]
for (u0, s0), (u1, s1) in reversed(list(zip(bounds, bounds[1:]))):
    targets = [s for s in range(s0 + 1, s1)]
    if not targets: continue
    tj = 0
    ui = u0 + 1
    while ui < u1 and tj < len(targets):
        u = units[ui]
        if u["match"] is None and u["toks"]:
            h = u["toks"][0]
            hit = None
            for k in range(tj, min(tj + 25, len(targets))):
                sh = sol_hw[targets[k]]
                if h == sh: hit = (k, "gap-exact"); break
                if hit is None and fuzzy(h, sh): hit = (k, "gap-fuzzy")
            if hit:
                u["match"] = (targets[hit[0]], hit[1])
                stats[hit[1]] += 1
                tj = hit[0] + 1
                ui += 1
                continue
        # interior scan for next unmatched target headword
        found = None
        for t in range(1, len(u["toks"])):
            tok = u["toks"][t]
            for k in range(tj, min(tj + 8, len(targets))):
                sh = sol_hw[targets[k]]
                if tok == sh and len(sh) > 3:
                    found = (t, k); break
            if found: break
        if found:
            t, k = found
            right = {"orig_seq": u["orig_seq"], "words": u["words"][t:],
                     "toks": u["toks"][t:], "scan_page": u["scan_page"],
                     "printed_page": u["printed_page"], "margin_letter": None,
                     "match": (targets[k], "interior-split")}
            u["words"], u["toks"] = u["words"][:t], u["toks"][:t]
            units.insert(ui + 1, right)
            stats["interior-split"] += 1
            tj = k + 1
            u1 += 1  # region grew by one unit
            ui += 1  # continue inside the right part
            continue
        ui += 1

# --- Phase C: assembly (unmatched units continue previous matched entry) ---
by_sol, cur = {}, None
for u in units:
    if u["match"]:
        cur = u["match"][0]
        by_sol.setdefault(cur, {"units": [], "basis": u["match"][1]})
        by_sol[cur]["units"].append(u)
    elif cur is not None:
        by_sol[cur]["units"].append(u)

# --- Phase D: homonym disambiguation. Adler numbers same-headword entries in an
# order that need not follow Bekker's print order, so order-based matching
# scrambles homonym groups. Reassign within each group by trigram similarity
# between the Bekker text and Adler's Greek (carried by SOL). ---
def tri(s):
    s = norm(s).replace(" ", "")
    return {s[i:i + 3] for i in range(len(s) - 2)} if len(s) > 2 else set()

def sim(a, b):
    A, B = tri(a), tri(b)
    return len(A & B) / max(1, min(len(A), len(B)))

reassigned = 0
i = 0
while i < len(sol_hw):
    j = i
    while j < len(sol_hw) and sol_hw[j] == sol_hw[i]: j += 1
    group = list(range(i, j))
    i = j
    if len(group) < 2: continue
    texts = [(si, by_sol.pop(si)) for si in group if si in by_sol]
    if not texts: continue
    scored = []
    for si in group:
        ref = sol[si].get("greek_unicode") or sol[si].get("translation") or ""
        for ti, (osi, m) in enumerate(texts):
            scored.append((sim(" ".join(w for u in m["units"] for w in u["words"]), ref), si, ti))
    scored.sort(reverse=True)
    used_s, used_t = set(), set()
    for s, si, ti in scored:
        if si in used_s or ti in used_t: continue
        used_s.add(si); used_t.add(ti)
        if texts[ti][0] != si: reassigned += 1
        by_sol[si] = texts[ti][1]
    for ti, (osi, m) in enumerate(texts):  # safety: never drop a text
        if ti not in used_t: by_sol[osi] = m

rows = []
for si, r in enumerate(sol):
    m = by_sol.get(si)
    us = m["units"] if m else []
    rows.append({
        "adler_id": r["adler_id"],
        "sol_headword": r["headword_unicode"],
        "matched": bool(m),
        "basis": m["basis"] if m else None,
        "bekker_lemma": " ".join(us[0]["words"][:3]) if us else None,
        "scan_pages": sorted({u["scan_page"] for u in us}),
        "bekker_text": " ".join(" ".join(u["words"]) for u in us) if us else None,
    })
rows.sort(key=lambda r: (r["adler_id"].split(",")[0], int(r["adler_id"].split(",")[1])))
with open(D / "aligned.jsonl", "w") as f:
    for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")

matched = sum(1 for r in rows if r["matched"])
report = {"sol_entries": len(sol), "sol_matched": matched,
          "coverage": round(matched / len(sol), 4),
          "anchors": len(anchors), **stats,
          "final_units": len(units)}
open(D / "align-report.json", "w").write(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
