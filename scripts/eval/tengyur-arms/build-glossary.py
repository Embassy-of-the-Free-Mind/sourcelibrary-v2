#!/usr/bin/env python3
# PRIOR ART: scripts/maintenance/build-tib-skt-table.mjs (#5647) builds a 53K-pair Tibetan↔Sanskrit
# LOOKUP for checking note facts, mostly from 84000 glossaries — unusable here (84000 is this test's
# reference: its vocabulary would contaminate the score, and it is CC BY-NC-ND). This reads only the
# Mahāvyutpatti file that builder fetched, and emits a per-page term list for a prompt (lever D).
"""
build-glossary.py — lever D of the Tengyur quality arms (#5497): an open-source term list per page.

  /root/tref/venv/bin/python scripts/eval/tengyur-arms/build-glossary.py \
      --tref /root/tref --mvy /root/factcheck-lane/refs/21-Mahavyutpatti-Skt --out /root/tarms/levers

Source: the Mahāvyutpatti (9th c., public domain text; DILA digital edition via
christiansteinert/tibetan-dictionary `21-Mahavyutpatti-Skt`, Wylie|Sanskrit). Wylie → Unicode with
pyewts (venv on the box). An entry is used when its Tibetan, as whole syllables, occurs in the page's
e-text. Two or more syllables only (a one-syllable entry matches inside unrelated words), longest match
first, at most MAX_PER_PAGE per page. The per-TEXT list is the union over the text's pages; each page's
prompt carries the entries that occur on it, so the prompt grows with the page's terms, not the book's.

Not used, and why: 84000 glossaries (the reference's own vocabulary; NC-ND); Rangjung Yeshe (©, no open
licence); our stored note pairs (note_claims): their `match` status was settled against a table that is
mostly 84000, and the unsettled ones are model guesses. Output stays on the box (the DILA mirror states no
licence for its digital edition): <out>/gloss.jsonl {page_id, terms:[[tib, skt], …]} and gloss-stats.json.
"""
import json, os, re, sys
import pyewts

arg = lambda k, d: sys.argv[sys.argv.index(f"--{k}") + 1] if f"--{k}" in sys.argv else d
TREF, MVY, OUT = arg("tref", "/root/tref"), arg("mvy", "/root/factcheck-lane/refs/21-Mahavyutpatti-Skt"), arg("out", "/root/tarms/levers")
MAX_PER_PAGE = 40
os.makedirs(OUT, exist_ok=True)
conv = pyewts.pyewts()

def sylls(s):
    s = re.sub(r"[{}\[\]()#༄༅།༎༑༔\s]+", "་", s)
    return [x for x in s.split("་") if x]

# Tibetan syllables → list of (skt) ; keyed by tuple of syllables
table = {}
for line in open(MVY, encoding="utf8"):
    if "|" not in line: continue
    w, skt = line.rstrip("\n").split("|", 1)
    skt = skt.strip()
    if not skt or not w.strip(): continue
    try:
        u = conv.toUnicode(w.strip())
    except Exception:
        continue
    key = tuple(sylls(u))
    if len(key) < 2 or any(not re.fullmatch(r"[ༀ-࿿]+", x) for x in key): continue
    table.setdefault(key, [])
    if skt not in table[key]: table[key].append(skt)
maxlen = max(len(k) for k in table)
print(f"Mahāvyutpatti entries usable (≥2 syllables): {len(table)}", file=sys.stderr)

ref = [json.loads(l) for l in open(os.path.join(TREF, "ref", "reference.jsonl"))]


def matches(sy):
    found, i = [], 0
    while i < len(sy):
        hit = None
        for L in range(min(maxlen, len(sy) - i), 1, -1):
            k = tuple(sy[i:i + L])
            if k in table: hit = k; break
        if hit:
            found.append(hit); i += len(hit)
        else:
            i += 1
    return found


# A two-syllable entry on more than GENERIC of the pages is a function word or a stock phrase
# (བྱ་བ, རབ་ཏུ, འདི་ལྟར, སོགས་པ…) whose Mahāvyutpatti sense is usually not the page's: dropped.
GENERIC = 0.15
pf = {}
for r in ref:
    for k in set(matches(sylls(r["src"]))): pf[k] = pf.get(k, 0) + 1
generic = {k for k, n in pf.items() if len(k) == 2 and n > GENERIC * len(ref)}
out, per_text, n_terms = [], {}, []
for r in ref:
    sy = sylls(r["src"])
    found = [k for k in matches(sy) if k not in generic]
    seen, terms = set(), []
    for k in sorted(set(found), key=lambda k: (-len(k), found.index(k))):
        if k in seen: continue
        seen.add(k); terms.append(["་".join(k), " / ".join(table[k][:2])])
    terms = terms[:MAX_PER_PAGE]
    n_terms.append(len(terms))
    per_text.setdefault(r["toh"], set()).update(t[0] for t in terms)
    out.append({"page_id": r["page_id"], "toh": r["toh"], "terms": terms})
with open(os.path.join(OUT, "gloss.jsonl"), "w") as f:
    for o in out: f.write(json.dumps(o, ensure_ascii=False) + "\n")
n_terms.sort()
stats = {"pages": len(out), "pages_with_terms": sum(1 for n in n_terms if n), "median_terms": n_terms[len(n_terms) // 2],
         "max_terms": n_terms[-1], "per_text_list_size": {k: len(v) for k, v in per_text.items()}, "mvy_entries": len(table), "generic_dropped": len(generic)}
json.dump(stats, open(os.path.join(OUT, "gloss-stats.json"), "w"), indent=1)
print(json.dumps(stats))
