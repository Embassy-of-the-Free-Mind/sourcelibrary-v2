#!/usr/bin/env python3
"""persian_align.py — OCR accuracy of served Persian poetry pages against the Ganjoor database (#5525).

PRIOR ART: scripts/eval/nalanda-readiness/indic_align.py — the retrieval (12-char windows over a whole
e-text corpus, densest hit cluster), the reference-span rule (gap-bounded hit run ∩ full-query alignment)
and the edlib infix score are IMPORTED from it unchanged. What does not fit is its alphabet: it compares
in IAST, and a Persian page cannot be transliterated into it. This file supplies the Persian/Arabic
normaliser, the Ganjoor loader, an order-free line metric, and the #5525 controls.

Design
  * Corpus: Ganjoor's open SQLite dump (ganjoor-db-*.zip from github.com/ganjoor/desktop releases), one
    unit per poet: every verse row in poem-id, vorder, position order (hemistichs right → left).
  * Normaliser (both sides): NFC; ي ى ئ → ی, ك → ک, ۀ ة → ه, أ إ آ ٱ → ا, ؤ → و; hamza, harakat,
    superscript alef, tatweel, ZWNJ/ZWJ, spaces, punctuation and digits dropped. The FOLDED score (primary)
    also folds گ → ک, پ → ب, چ → ج, ژ → ز: early-modern hands and presses do not distinguish them, and a
    page that writes کر for گر, transcribed as written, is not an OCR error. STRICT (no fold) is reported too.
  * OCR side: wrapper blocks stripped as indic_align does; <image-desc> and -> heading <- lines dropped
    (Ganjoor keeps section titles as poem titles, not verse); <margin> blocks moved to the END of the page.
  * Metric 1, sequence accuracy `acc` (indic_align): 1 − edit distance / len(reference span), reference
    infix-aligned into the OCR, retrieval over ALL of Ganjoor. Reading order counts: a page read column by
    column instead of verse by verse scores low even when every line is right.
  * Metric 2, line accuracy `line_local` (order-free): every OCR line/hemistich (≥ 10 letters) is matched to
    its best Ganjoor hemistich or couplet in the neighbourhood of the located passage (±3 page-lengths), score
    1 − ed / max(len); the page value is the length-weighted mean, plus the share of lines ≥ 0.80.
    `line_global` does the same over the expected poet's whole works (no location needed, so it also
    covers pages the sequence retrieval could not place). Global matching can reward a memorised verse
    from elsewhere in the work, so it is an upper bound; local is the headline.
  * Both are LOWER bounds on transcription accuracy where the scribe's recension differs from Ganjoor's.
  * Controls (printed first; no page score is meaningful unless they separate):
      exact       — each located Ganjoor span (or 24 consecutive hemistichs) through the full path
      noise-0.05  — the same with 5% synthetic char edits
      wrong-page  — each page's OCR against the span located for a DIFFERENT sampled page (cyclic), and
                    against a same-length span from a random place in the SAME poet; for the line metric,
                    the page's lines against a far-away neighbourhood of the same poet, and against a
                    different poet's whole works (wrong-poet, the floor for line_global).
"""
import argparse, json, random, re, sys, os, sqlite3, types, unicodedata, collections, statistics, bisect

import edlib

# indic_align imports indic_transliteration at module load for its Brahmi table; nothing on the Persian
# path transliterates, so a stub module is enough to import the script-agnostic functions.
try:
    import indic_transliteration  # noqa: F401
except ImportError:
    pkg = types.ModuleType("indic_transliteration"); sub = types.ModuleType("indic_transliteration.sanscript")
    sub.__getattr__ = lambda name: name.lower()
    pkg.sanscript = sub; sys.modules["indic_transliteration"] = pkg; sys.modules["indic_transliteration.sanscript"] = sub
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "nalanda-readiness"))
import indic_align  # noqa: E402
from indic_align import retrieve, best_span, pick_file, score, noisy, strip_wrappers  # noqa: E402

LETTERS = "ابتثجحخدذرزسشصضطظعغفقکگلمنوهیپچژ"
MAP = str.maketrans({"ي": "ی", "ى": "ی", "ئ": "ی", "ك": "ک", "ڪ": "ک", "ۀ": "ه", "ة": "ه", "ھ": "ه", "ہ": "ه",
                     "ۃ": "ه", "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ؤ": "و"})
FOLD = str.maketrans({"گ": "ک", "پ": "ب", "چ": "ج", "ژ": "ز"})
DROP = re.compile(f"[^{LETTERS}]")
MARGIN = re.compile(r"<margin[^>]*>([\s\S]*?)</margin>", re.I)
MIN_LINE = 10


def norm_fa(s, fold):
    s = unicodedata.normalize("NFC", s or "").translate(MAP)
    if fold: s = s.translate(FOLD)
    return DROP.sub("", s)


def page_text(raw):
    raw = re.sub(r"<image-desc[^>]*>[\s\S]*?</image-desc>", " ", raw or "", flags=re.I)
    margins = MARGIN.findall(raw)
    raw = MARGIN.sub(" ", raw)
    raw = re.sub(r"^\s*->.*<-\s*$", " ", raw, flags=re.M)
    return strip_wrappers(raw) + "\n" + "\n".join(margins)


def page_lines(raw, fold):
    out = []
    for ln in re.split(r"[\n|]", page_text(raw)):
        n = norm_fa(ln, fold)
        if len(n) >= MIN_LINE: out.append(n)
    return out


def score_page(files, fi, n, lo, hi, ocr, poss):
    """indic_align.score_page, plus the reference span it chose (it reports only the span's length).
    The span is captured from its own call to score(ref, ocr), so the span rule stays the imported one."""
    seen = {}

    def spy(ref, o):
        seen["ref"] = ref
        return score(ref, o)
    indic_align.score = spy
    try:
        res = indic_align.score_page(files, fi, n, lo, hi, ocr, poss)
    finally:
        indic_align.score = score
    res["_ref"] = seen["ref"]; res["ref_start"] = files[fi][1].find(seen["ref"])
    return res


class Poet:
    """One poet's works: the concatenated normalised text (for retrieval) and its hemistichs with offsets."""
    def __init__(self, pid, name, hems):
        self.pid, self.name = pid, name
        self.hems = [h for h in hems if h]
        self.off = []; o = 0
        for h in self.hems: self.off.append(o); o += len(h)
        self.text = "".join(self.hems)
        self._idx = None

    def idx(self):  # 4-gram → hemistich ids, built lazily for the global line metric
        if self._idx is None:
            d = collections.defaultdict(list)
            for i, h in enumerate(self.hems):
                for g in {h[j:j + 4] for j in range(len(h) - 3)}: d[g].append(i)
            self._idx = d
        return self._idx

    def window(self, start, end):
        a = max(0, bisect.bisect_right(self.off, start) - 1); b = bisect.bisect_right(self.off, end)
        return range(a, b)


def load_ganjoor(db, fold):
    c = sqlite3.connect(db)
    names = {pid: name for pid, name in c.execute("select id, name from poet")}
    buf = collections.defaultdict(list)
    q = ("select ct.poet_id, v.text from verse v join poem pm on pm.id = v.poem_id join cat ct on ct.id = pm.cat_id "
         "order by ct.poet_id, pm.id, v.vorder, v.position")
    for pid, t in c.execute(q): buf[pid].append(norm_fa(t, fold))
    return {pid: Poet(pid, names.get(pid, "?"), hems) for pid, hems in buf.items() if sum(map(len, hems)) > 500}


def sim(a, b):
    return 1 - edlib.align(a, b, mode="NW", task="distance")["editDistance"] / max(len(a), len(b))


def line_score(lines, poet, cand_ids=None, top=40):
    """Length-weighted mean best-match similarity, and the share of lines ≥ 0.80."""
    if not lines: return None
    tot = w = good = 0
    for ln in lines:
        if cand_ids is not None:
            cands = cand_ids
        else:
            cnt = collections.Counter()
            idx = poet.idx()
            for g in {ln[j:j + 4] for j in range(len(ln) - 3)}:
                for i in idx.get(g, ()): cnt[i] += 1
            cands = [i for i, _ in cnt.most_common(top)]
        # an OCR line may hold one hemistich or a whole couplet (no "|" between them): try both
        H = poet.hems
        opts = (c for i in cands for c in (H[i], H[i] + H[i + 1] if i + 1 < len(H) else "", H[i - 1] + H[i] if i else ""))
        best = max((sim(ln, c) for c in opts if c and abs(len(c) - len(ln)) <= len(ln)), default=0.0)
        tot += best * len(ln); w += len(ln); good += best >= 0.8
    return {"line_acc": round(tot / w, 4), "lines_ok": round(good / len(lines), 4), "n_lines": len(lines)}


def q(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs: return None
    if len(xs) < 4: return {"n": len(xs), "median": round(statistics.median(xs), 4), "min": xs[0], "max": xs[-1]}
    qs = statistics.quantiles(xs, n=4, method="inclusive")
    return {"n": len(xs), "median": round(qs[1], 4), "q1": round(qs[0], 4), "q3": round(qs[2], 4), "min": xs[0], "max": xs[-1]}


def run_variant(poets, rows, args, fold):
    rng = random.Random(20261001)
    pids = list(poets)
    files = [(f"ganjoor:{p}:{poets[p].name}", poets[p].text) for p in pids]
    texts = [norm_fa(page_text(r.get("text", "")), fold) for r in rows]
    lines = [page_lines(r.get("text", ""), fold) for r in rows]
    hits = retrieve(files, texts)
    res = []
    for pi, r in enumerate(rows):
        ocr = texts[pi]; exp = r.get("ganjoor_poets") or []
        o = {"id": r["id"], "stratum": r.get("stratum"), "arm": r.get("arm"), "expected_poets": exp, "ocr_len": len(ocr), "n_lines": len(lines[pi])}
        h = hits.get(pi)
        loc = None
        if len(ocr) >= 150 and h:
            fi, poss = pick_file(h, len(ocr)); n, lo, hi = best_span(poss, len(ocr))
            if n >= args.min_hits: loc = (fi, n, lo, hi, poss)
        if len(ocr) < 150: o["status"] = "too_short"
        elif not loc: o["status"] = "no_reference"
        else:
            fi, n, lo, hi, poss = loc
            o.update(score_page(files, fi, n, lo, hi, ocr, poss)); o["status"] = "scored"
            o["located_poet"] = pids[fi]; o["_fi"] = fi
            o["located_expected"] = (pids[fi] in exp) if exp else None
            P = poets[pids[fi]]; L = len(ocr)
            loc_line = line_score(lines[pi], P, list(P.window(o["ref_start"] - 3 * L, o["ref_start"] + len(o["_ref"]) + 3 * L)))
            if loc_line: o["line_local"], o["lines_ok_local"] = loc_line["line_acc"], loc_line["lines_ok"]
            # wrong-place neighbourhood, same poet, far from the located span
            for _ in range(50):
                st = rng.randrange(0, max(1, len(P.text) - 7 * L))
                if abs(st - o["ref_start"]) > 10 * L: break
            wl = line_score(lines[pi], P, list(P.window(st, st + 7 * L + len(o["_ref"]))))
            if wl: o["wrong_place_line"] = wl["line_acc"]
        if exp:
            g = [line_score(lines[pi], poets[p]) for p in exp if p in poets]
            g = [x for x in g if x]
            if g:
                b = max(g, key=lambda x: x["line_acc"]); o["line_global"], o["lines_ok_global"] = b["line_acc"], b["lines_ok"]
            # wrong-poet floor for the global metric: Ferdowsi for every page, Saadi for the Shahnama
            wp = 4 if 4 not in exp else 7
            w = line_score(lines[pi], poets[wp])
            if w: o["wrong_poet_line"] = w["line_acc"]
        res.append(o)
    scored = [r for r in res if r["status"] == "scored"]
    # ---- sequence controls: exact and noised located spans, back through retrieval + scoring ----
    ctrl_in = []
    for r in scored:
        ctrl_in.append(("exact", r["_ref"])); ctrl_in.append(("noise-0.05", noisy(r["_ref"], 0.05, rng, alpha=LETTERS)))
    chits = retrieve(files, [t for _, t in ctrl_in])
    C = collections.defaultdict(list)
    for ci, (kind, t) in enumerate(ctrl_in):
        h = chits.get(ci)
        if not h: C[kind].append(0.0); continue
        fi, poss = pick_file(h, len(t)); n, lo, hi = best_span(poss, len(t))
        C[kind].append(score_page(files, fi, n, lo, hi, t, poss)["acc"] if n >= args.min_hits else 0.0)
    for k, r in enumerate(scored):
        other = scored[(k + 1) % len(scored)]
        pi = next(i for i, x in enumerate(res) if x is r)
        r["wrong_page_acc"] = round(max(score(other["_ref"], texts[pi])[0], 0), 4)
        t = files[r["_fi"]][1]; L = len(r["_ref"])
        for _ in range(50):
            st = rng.randrange(0, max(1, len(t) - L))
            if abs(st - r["ref_start"]) > 3 * L: break
        r["wrong_place_acc"] = round(max(score(t[st:st + L], texts[pi])[0], 0), 4)
        C["wrong-page"].append(r["wrong_page_acc"]); C["wrong-place-same-poet"].append(r["wrong_place_acc"])
    # ---- line controls: 24 consecutive hemistichs of each expected poet, exact and noised ----
    L = collections.defaultdict(list)
    for r in res:
        for p in r["expected_poets"][:1]:
            P = poets.get(p)
            if not P: continue
            s = rng.randrange(0, len(P.hems) - 30); ls = [h for h in P.hems[s:s + 24] if len(h) >= MIN_LINE]
            L["exact"].append(line_score(ls, P)["line_acc"])
            L["noise-0.05"].append(line_score([noisy(h, 0.05, rng, alpha=LETTERS) for h in ls], P)["line_acc"])
    for r in res:
        if "wrong_place_line" in r: L["wrong-place-same-poet"].append(r["wrong_place_line"])
        if "wrong_poet_line" in r: L["wrong-poet-global"].append(r["wrong_poet_line"])
    cs = {k: q(v) for k, v in C.items()}; ls = {k: q(v) for k, v in L.items()}
    sep_seq = bool(cs.get("exact") and cs["exact"]["min"] >= 0.97 and cs["noise-0.05"]["min"] >
                   max(cs["wrong-page"]["max"], cs["wrong-place-same-poet"]["max"]))
    sep_line = bool(ls.get("exact") and ls["exact"]["min"] >= 0.97 and ls["noise-0.05"]["min"] >
                    max(ls["wrong-place-same-poet"]["max"], ls["wrong-poet-global"]["max"]))
    summ = {"controls_sequence": cs, "controls_line": ls, "separate_sequence": sep_seq, "separate_line": sep_line,
            "status": dict(collections.Counter(r["status"] for r in res))}
    for metric in ("acc", "precision", "line_local", "lines_ok_local", "line_global", "lines_ok_global"):
        by = collections.defaultdict(list)
        for r in res:
            if metric in r:
                by["all"].append(r[metric]); by[r.get("stratum") or "unclassified"].append(r[metric])
        summ[metric] = {k: q(v) for k, v in by.items()}
    return res, summ


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--pages", required=True)
    ap.add_argument("--strata", help="json {page_id: {stratum, ...}} from the by-eye / header classification")
    ap.add_argument("--out", required=True, help="prefix; writes <out>-folded.jsonl, <out>-strict.jsonl, <out>-summary.json")
    ap.add_argument("--min-hits", type=int, default=5)
    args = ap.parse_args()
    rows = [json.loads(l) for l in open(args.pages)]
    strata = json.load(open(args.strata)) if args.strata else {}
    for r in rows: r["stratum"] = (strata.get(r["id"]) or {}).get("stratum")
    summary = {}
    for fold in (True, False):
        tag = "folded" if fold else "strict"
        poets = load_ganjoor(args.db, fold)
        print(f"[{tag}] ganjoor poets {len(poets)}", file=sys.stderr)
        res, summ = run_variant(poets, rows, args, fold)
        summary[tag] = summ
        with open(f"{args.out}-{tag}.jsonl", "w") as f:
            for r in res: f.write(json.dumps({k: v for k, v in r.items() if not k.startswith("_")}, ensure_ascii=False) + "\n")
    json.dump(summary, open(f"{args.out}-summary.json", "w"), ensure_ascii=False, indent=1)
    print(json.dumps(summary["folded"], ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
