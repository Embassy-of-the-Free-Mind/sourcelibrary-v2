#!/usr/bin/env python3
"""indic_align.py — OCR accuracy of served Sanskrit / Pali page text against the GRETIL e-text corpus.

PRIOR ART: ops eval-tibetan/kanjur_align.py (retrieval over a whole canon e-text + alignment, same
design, syllable-level and Tibetan-only); scripts/eval/lib/metrics.mjs scoreAgainstReference /
windowedErrorRate (same fitting-alignment metric, but it needs the reference passage handed to it and
its `devanagari` fold cannot compare a Devanagari page with a romanised e-text). Nothing in the repo
locates a Sanskrit page inside GRETIL.

Design
  * Common alphabet: everything is compared in IAST. Devanagari (and other Brahmi-script) OCR is
    transliterated with indic_transliteration; GRETIL is already IAST. Spaces are dropped (sandhi
    spacing differs between a printed edition and an e-text), punctuation/digits dropped, ṁ→ṃ,
    avagraha dropped. Combining marks are kept INSIDE the letters (NFC first) — the July tokenizer
    that stripped them shredded Devanagari (non-latin-text-operations.md).
  * Retrieval: every 12-char window of the page vs 12-char windows of GRETIL at stride 4. The file
    with most hits wins; the passage span is the densest cluster of hit positions (+ margin).
  * Score: edlib infix alignment of the REFERENCE span into the OCR (free skips outside the span,
    interior junk charged) → passage char accuracy = 1 − ed/len(ref) (the metrics.mjs windowed
    lower-bound analogue). Also OCR-side precision: OCR into the reference neighbourhood →
    1 − ed/len(ocr) (charges apparatus, headers and commentary the e-text lacks).
  * Controls: --control noise: real GRETIL spans + synthetic char noise through the full path;
    chance: each page scored against a same-length span of a random OTHER file.
"""
import argparse, json, random, re, sys, unicodedata, glob, html, os, collections
import edlib
from indic_transliteration import sanscript

K = 12; STRIDE = 4; GAP = 200
KEEP = re.compile(r"[^a-zāīūṛṝḷḹṃḥṅñṭḍṇśṣēō]")


REFMARK = re.compile(r"\S*[\d_]\S*")        # GRETIL line ids: ys_1.12, mbh_01,001.001a, 01001001a
RGEM = re.compile(r"r(kh|gh|ch|jh|ṭh|ḍh|th|dh|ph|bh|[kgcjṭḍtdṇnpbmyvlśṣs])\1")
RGEM_ASP = re.compile(r"r([kgcjṭḍtdpb])\1h")
NASAL = re.compile(r"[ṅñṇnm](?=[kgcjṭḍtdpb])")  # anusvāra vs class nasal varies by edition


def norm_iast(s, is_ref=False):
    s = unicodedata.normalize("NFC", s.lower())
    if is_ref: s = REFMARK.sub(" ", s)
    s = s.replace("ṁ", "ṃ").replace("m̐", "ṃ").replace("r̥", "ṛ").replace("l̥", "ḷ").replace("ṝ", "ṝ")
    s = unicodedata.normalize("NFC", s)
    s = KEEP.sub("", s)
    s = RGEM.sub(r"r\1", s)       # Calcutta/Bombay-print gemination after r: pūrvva → pūrva
    s = RGEM_ASP.sub(r"r\1h", s)  # arddha → ardha
    return NASAL.sub("ṃ", s)


SCRIPTS = [  # (unicode range, sanscript scheme)
    ((0x0900, 0x097F), sanscript.DEVANAGARI), ((0x0980, 0x09FF), sanscript.BENGALI),
    ((0x0A80, 0x0AFF), sanscript.GUJARATI), ((0x0B80, 0x0BFF), sanscript.TAMIL),
    ((0x0C00, 0x0C7F), sanscript.TELUGU), ((0x0C80, 0x0CFF), sanscript.KANNADA),
    ((0x0D00, 0x0D7F), sanscript.MALAYALAM), ((0x0D80, 0x0DFF), getattr(sanscript, "SINHALA", None)),
    ((0x1000, 0x109F), getattr(sanscript, "BURMESE", None)), ((0x0E00, 0x0E7F), getattr(sanscript, "THAI", None)),
    ((0x11000, 0x1107F), getattr(sanscript, "BRAHMI", None)),
]


def detect_script(text):
    c = collections.Counter()
    for ch in text:
        o = ord(ch)
        if ch.isalpha() and o < 0x250: c["latin"] += 1; continue
        for (a, b), sch in SCRIPTS:
            if a <= o <= b: c[sch or f"unsupported-{a:04x}"] += 1; break
    tot = sum(c.values()) or 1
    top, n = c.most_common(1)[0] if c else ("none", 0)
    return top, n / tot


# Same wrapper list as scripts/eval/lib/metrics.mjs stripWrappers (OCR_WRAPPER_BLOCKS); running heads,
# page numbers, signatures and catchwords are dropped WITH their content (no e-text carries them).
WRAP_BLOCKS = ['meta', 'summary', 'keywords', 'vocab', 'language', 'scan-quality', 'script', 'page-type', 'columns',
               'warning', 'header', 'page-num', 'sig', 'catchword']
WRAP_TAGS = re.compile(r"</?(note|term|margin|gloss|unclear|insert|header|catchword|sig|page-num)[^>]*>", re.I)


def strip_wrappers(s):
    for w in WRAP_BLOCKS: s = re.sub(rf"<{w}[^>]*>[\s\S]*?</{w}>", " ", s, flags=re.I)
    return WRAP_TAGS.sub(" ", s)


def page_to_iast(text):
    text = strip_wrappers(text or "")
    sch, share = detect_script(text)
    if sch == "latin": return norm_iast(text), "latin", share
    if isinstance(sch, str) and sch.startswith(("unsupported", "none")): return "", sch, share
    return norm_iast(sanscript.transliterate(text, sch, sanscript.IAST)), sch, share


def load_corpus(paths):
    files = []
    for p in paths:
        raw = open(p, encoding="utf-8", errors="ignore").read()
        if p.endswith((".htm", ".html", ".HTM", ".xml")):
            raw = re.sub(r"<[^>]+>", " ", raw); raw = html.unescape(raw)
        else:
            i = raw.find("# Text");  raw = raw[i:] if i >= 0 else raw
        t = norm_iast(raw, is_ref=True)
        if len(t) > 500: files.append((os.path.relpath(p), t))
    return files


def retrieve(files, pages):
    qd = collections.defaultdict(set)
    for pi, t in enumerate(pages):
        for j in range(0, len(t) - K + 1): qd[t[j:j + K]].add(pi)
    hits = collections.defaultdict(lambda: collections.defaultdict(list))  # page -> file -> [pos]
    for fi, (_, t) in enumerate(files):
        get = qd.get
        for pos in range(0, len(t) - K + 1, STRIDE):
            s = get(t[pos:pos + K])
            if s:
                for pi in s: hits[pi][fi].append(pos)
    return hits


def best_span(poss, plen):
    poss = sorted(poss); best = (0, 0, 0); j = 0
    w = int(plen * 1.3) + 50
    for i in range(len(poss)):
        while poss[i] - poss[j] > w: j += 1
        if i - j + 1 > best[0]: best = (i - j + 1, poss[j], poss[i])
    return best


def pick_file(h, plen):
    """File whose DENSEST hit cluster is largest — not most total hits: repetitive texts
    (Śatasāhasrikā formulae, a commentary quoting every verse) out-hit the true source overall
    (render control 2026-09-30: the MMK and Aṣṭasāhasrikā SOURCE text scored 0.46 / 0.33)."""
    best = None
    for fi, poss in h.items():
        if len(poss) < 3 or (best and len(poss) <= best[0]): continue
        n = best_span(poss, plen)[0]
        if not best or n > best[0]: best = (n, fi, poss)
    return (best[1], best[2]) if best else max(h.items(), key=lambda kv: len(kv[1]))


def score(ref, ocr):
    if not ref or not ocr: return None, None
    a = edlib.align(ref, ocr, mode="HW", task="distance")
    return 1 - a["editDistance"] / len(ref), a


def score_page(files, fi, n, lo, hi, ocr, poss_all):
    t = files[fi][1]
    # Neighbourhood around the densest hit cluster; the reference SPAN is where the OCR aligns inside
    # it (edlib infix locations), not the hit cluster itself — formulaic text repeats nearby and a
    # hit-cluster span swallowed it (exact-copy control scored 0.74 before this, 2026-09-30).
    n0 = max(0, lo - len(ocr)); nb = t[n0:min(len(t), hi + K + len(ocr))]
    a = edlib.align(ocr, nb, mode="HW", task="locations")
    pr = 1 - a["editDistance"] / len(ocr)
    # Reference span = the largest run of hits with no gap > GAP chars. Forcing the whole OCR into the
    # e-text (a full-query alignment) dragged unrelated e-text into the span whenever the page carried
    # apparatus or commentary the e-text lacks; a gap-bounded hit run does not.
    ps = sorted(p for p in poss_all if lo - len(ocr) <= p <= hi + len(ocr))
    runs, cur = [], [ps[0]]
    for p in ps[1:]:
        if p - cur[-1] > GAP: runs.append(cur); cur = [p]
        else: cur.append(p)
    runs.append(cur)
    run = max(runs, key=len)
    # ...intersected with the full-query alignment span: a run alone overshoots into repeated text
    # that continues past the page (exact-copy control 0.90), the alignment alone overshoots into
    # unrelated e-text when the page has apparatus. The intersection passes both controls.
    a0, a1 = a["locations"][0][0] + n0, a["locations"][0][1] + n0 + 1
    s0, s1 = max(a0, run[0] - 30), min(a1, run[-1] + K + 30)
    if s1 - s0 < 50: s0, s1 = a0, a1
    ref = t[s0:s1]
    acc, _ = score(ref, ocr)
    return {"file": files[fi][0], "hits": n, "ref_len": len(ref), "ocr_len": len(ocr),
            "coverage": round(len(ref) / len(ocr), 3), "acc": round(max(acc, 0), 4), "precision": round(max(pr, 0), 4)}


def noisy(s, p, rng, alpha="aāiīuūṛeokgcjṭḍtdnpbmyrlvśṣsh"):
    out = []
    for ch in s:
        r = rng.random()
        if r < p / 3: continue
        elif r < 2 * p / 3: out.append(rng.choice(alpha))
        else:
            out.append(ch)
            if rng.random() < p / 3: out.append(rng.choice(alpha))
    return "".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", nargs="+", required=True, help="glob patterns")
    ap.add_argument("--pages", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--control-n", type=int, default=40)
    ap.add_argument("--min-hits", type=int, default=5)
    args = ap.parse_args()
    paths = sorted({p for g in args.corpus for p in glob.glob(g, recursive=True)})
    files = load_corpus(paths)
    print(f"corpus files {len(files)} chars {sum(len(t) for _, t in files):,}", file=sys.stderr)
    rows = [json.loads(l) for l in open(args.pages)]
    texts = []
    for r in rows:
        t, sch, share = page_to_iast(r.get("text", ""))
        r["_script"], r["_share"] = str(sch), round(share, 3); texts.append(t)
    rng = random.Random(7)
    # positive control: GRETIL spans with synthetic noise, through retrieval + scoring
    ctrl = []
    for noise in (0.0, 0.05, 0.15):
        for _ in range(args.control_n // 2 if noise else 10):
            fi = rng.randrange(len(files)); t = files[fi][1]
            if len(t) < 3000: continue
            st = rng.randrange(0, len(t) - 1500)
            ctrl.append((noise, fi, st, noisy(t[st:st + 1500], noise, rng)))
    alltexts = texts + [c[3] for c in ctrl]
    hits = retrieve(files, alltexts)
    with open(args.out, "w") as fout:
        for pi, r in enumerate(rows):
            ocr = texts[pi]
            res = {"id": r["id"], "stratum": r.get("stratum"), "arm": r.get("arm"), "script": r["_script"], "script_share": r["_share"], "ocr_len": len(ocr)}
            h = hits.get(pi)
            if len(ocr) < 200: res["status"] = "too_short_or_unsupported"
            elif not h: res["status"] = "no_reference"
            else:
                fi, poss = pick_file(h, len(ocr))
                n, lo, hi = best_span(poss, len(ocr))
                if n < args.min_hits: res.update(status="no_reference", hits=n, file=files[fi][0])
                else:
                    res.update(score_page(files, fi, n, lo, hi, ocr, poss)); res["status"] = "scored"
                    # chance: same-length span of a random other file
                    ofi = rng.randrange(len(files))
                    while ofi == fi or len(files[ofi][1]) < res["ref_len"] + 10: ofi = rng.randrange(len(files))
                    o = files[ofi][1]; st = rng.randrange(0, len(o) - res["ref_len"])
                    res["chance_acc"] = round(max(score(o[st:st + res["ref_len"]], ocr)[0], 0), 4)
            fout.write(json.dumps(res, ensure_ascii=False) + "\n")
        for ci, (noise, fi, st, t) in enumerate(ctrl):
            pi = len(rows) + ci; h = hits.get(pi) or {}
            res = {"id": f"control:{noise}:{ci}", "stratum": f"control-noise-{noise}", "true_file": files[fi][0]}
            if h:
                bfi, poss = pick_file(h, len(t))
                n, lo, hi = best_span(poss, len(t))
                res.update(score_page(files, bfi, n, lo, hi, t, poss)); res["hit"] = bfi == fi
                res["status"] = "scored"
            else: res["status"] = "no_reference"
            fout.write(json.dumps(res, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
