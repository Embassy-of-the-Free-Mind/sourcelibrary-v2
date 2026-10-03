#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tibetan-mt-ab/extract-84000-refs.py — cuts 84000 TEI English by its <ref
# cRef="F.n.x"/> milestones, three sides at a time for a manuscript whose pagination differs from
# Derge. Here our page IS a Derge side (the Esukhia e-text is aligned folio by folio), and the 84000
# reader data carries, per passage, both the English (with folio mentions) and the aligned Derge
# Tibetan (with [F.n.x] markers) — so each side is cut on both, and the Tibetan cut is CHECKED against
# our page's e-text before the side is kept.
"""
build-reference.py — the 84000 reference set for the Tengyur draft-English test (#5497).

  python3 build-reference.py <84000-dir> <pages-dir> <published.json> <out-dir>

For each published 84000 Tengyur text: walk its translation passages in order, split the English at
the text's own folio mentions (items with toh == this text; parallels like the Kangyur toh472 are
ignored) and split 84000's aligned Tibetan at its [F.n.x] markers. Each side is matched to our page
of the same Derge volume + folio (ocr.text_edition.folio). A side is KEPT when:
  - our page exists and has e-text;
  - its English cut is non-empty (>= 40 chars) and its folio markers run in order (no skipped side);
  - 84000's Tibetan cut for the side covers >= 70% of our page's syllables (bag-of-syllables
    containment) — this catches misaligned pages and sides shared with a text 84000 did not publish;
  - our page's syllables cover >= 70% of 84000's Tibetan cut (the side is not missing a chunk).
Everything dropped is recorded with its reason. Output:
  <out>/reference.jsonl  one kept side per line (English + Tibetan cut, neighbour tails, our page ids)
  <out>/drops.json       every dropped side + reason
  <out>/summary.json     counts per text

The 84000 English is CC BY-NC-ND: evaluation input only. This writes under /root/tref, never to the
repo, never to pages.
"""
import json, os, re, sys, collections

src84, pages_dir, published, out = sys.argv[1:5]
os.makedirs(out, exist_ok=True)
texts = json.load(open(published))

FOL = re.compile(r"\[F\.(\d+)\.([ab])\]")


def side_key(n, s):
    return int(n) * 2 + (0 if s == "a" else 1)


def walk_english(node, toh, acc):
    """Collect English text; insert ⟦F.n.s⟧ where a folio mention for THIS text sits."""
    t = node.get("type")
    if t == "text":
        acc.append(node.get("text", ""))
        return
    if t == "mention":
        for it in node.get("attrs", {}).get("items", []):
            if it.get("linkType") == "folio" and (it.get("toh") or it.get("linkToh")) == toh:
                m = FOL.search(it.get("displayText", ""))
                if m:
                    acc.append(f" ⟦F.{m.group(1)}.{m.group(2)}⟧ ")
        return
    for ch in node.get("content", []) or []:
        walk_english(ch, toh, acc)
    if t in ("paragraph", "heading", "line", "listItem", "blockquote"):
        acc.append("\n")


VERSE_REF = re.compile(r"\[\d+\.\d+\.\d+[a-z]?\]\s*$")


def strip_root_verses(e):
    """84000's Hevajra commentaries (Toh 1183, 1189) interleave the FULL root-tantra verse, tagged
    [1.2.1], where the Tengyur Tibetan cites only its opening words. Those blocks are not on our page:
    drop every paragraph run that opens a quotation and closes on a verse tag within 6 paragraphs.
    Returns (text, n_dropped)."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", e) if p.strip()]
    out, i, n = [], 0, 0
    while i < len(paras):
        if VERSE_REF.search(paras[i]):
            n += 1; i += 1; continue
        if paras[i].startswith("“"):
            j = next((j for j in range(i, min(i + 6, len(paras))) if VERSE_REF.search(paras[j])), None)
            if j is not None and not any("”" in paras[k] and k < j and paras[k].rstrip().endswith("”") for k in range(i, j)):
                n += 1; i = j + 1; continue
        out.append(paras[i]); i += 1
    return "\n\n".join(out), n


def syls(s):
    return [x for x in re.split(r"[་།\s༄༅༔༑]+", re.sub(r"[#{}\[\]()0-9a-zA-Z,.]", " ", s)) if x]


def contain(a, b):
    """share of bag a found in bag b"""
    ca, cb = collections.Counter(a), collections.Counter(b)
    n = sum(ca.values())
    return sum(min(v, cb[k]) for k, v in ca.items()) / n if n else 0.0


pages = {}
for fn in os.listdir(pages_dir):
    if fn.endswith(".jsonl"):
        for line in open(os.path.join(pages_dir, fn)):
            if line.strip():
                p = json.loads(line)
                if p.get("folio"):
                    pages.setdefault((p["vol"], p["folio"]), p)

kept, drops, summary = [], [], {}
for t in texts:
    toh = t["toh"]
    ns = json.load(open(os.path.join(src84, f"{toh}.json")))
    ns = sorted([n for n in ns if n["type"] in ("translation", "translationHeader")], key=lambda n: n["sort"])
    en_stream, bo_stream, vol = [], [], None
    for n in ns:
        a = n["json"]["attrs"].get("alignments", {}).get(toh)
        if a:
            vol = a["volumeNumber"]
            bo_stream.append(a["tibetan"])
        acc = []
        walk_english(n["json"], toh, acc)
        en_stream.append("".join(acc))
    vol = vol or t["vol"]
    en = "\n".join(en_stream)
    bo = " ".join(bo_stream)

    def cut(s, marker_re):
        parts = marker_re.split(s)
        # parts: [pre, n, s, text, n, s, text, ...]
        sides = collections.OrderedDict()
        order = []
        pre = parts[0]
        for i in range(1, len(parts), 3):
            k = f"{int(parts[i])}{parts[i+1]}"
            if k not in sides:
                sides[k] = ""
                order.append(k)
            sides[k] += parts[i + 2]
        if order:
            sides[order[0]] = pre + sides[order[0]]
        return sides, order

    en_sides, en_order = cut(en, re.compile(r"⟦F\.(\d+)\.([ab])⟧"))
    bo_sides, bo_order = cut(bo, FOL)
    st = {"sides_84000": len(bo_order), "kept": 0, "dropped": collections.Counter(), "num_pages_lobby": t.get("num_pages")}
    keys = [side_key(k[:-1], k[-1]) for k in en_order]
    for idx, k in enumerate(bo_order):
        rec = {"toh": toh, "vol": vol, "folio": k}
        reason = None
        p = pages.get((vol, k))
        e = re.sub(r"[ \t]+", " ", en_sides.get(k, "")).strip()
        b = bo_sides.get(k, "")
        if p is None:
            reason = "no page of ours at this volume+folio"
        elif not p["src"].strip():
            reason = "our page has no e-text"
        elif k not in en_sides:
            reason = "no English folio mention for this side"
        elif len(e) < 40:
            reason = "English cut < 40 chars"
        else:
            j = en_order.index(k)
            if j > 0 and keys[j] != keys[j - 1] + 1:
                reason = "English folio mentions skip a side before this one"
        if reason is None:
            ours, theirs = syls(p["src"]), syls(b)
            c_ours = contain(ours, theirs)   # how much of our page the 84000 Tibetan cut covers
            c_theirs = contain(theirs, ours)
            rec.update(cover_ours=round(c_ours, 3), cover_theirs=round(c_theirs, 3), syl_ours=len(ours), syl_theirs=len(theirs))
            if c_ours < 0.7:
                reason = f"84000 Tibetan covers only {c_ours:.0%} of our page (shared side or misalignment)"
            elif c_theirs < 0.7:
                reason = f"our page covers only {c_theirs:.0%} of 84000's Tibetan for this side"
            else:
                e, nv = strip_root_verses(e)
                rec["root_verses_stripped"] = nv
                ratio = len(e.split()) / max(1, len(ours))
                rec["en_words_per_syl"] = round(ratio, 2)
                if not 0.4 <= ratio <= 1.6:
                    reason = f"English cut length off (words/syllable {ratio:.2f}, outside 0.4–1.6: folio mention misplaced or interpolation)"
        if reason:
            rec["reason"] = reason
            drops.append(rec)
            st["dropped"][reason.split(" (")[0] if "covers only" not in reason else ("84000 Tibetan covers <70% of our page" if reason.startswith("84000") else "our page covers <70% of 84000 Tibetan")] += 1
            continue
        i = bo_order.index(k)
        prev_k = bo_order[i - 1] if i > 0 else None
        next_k = bo_order[i + 1] if i + 1 < len(bo_order) else None
        tail = lambda s, n: s[-n:] if len(s) > n else s
        rec.update({
            "id": f"{toh}_{k}", "title": t["title"], "book_id": p["book_id"], "page_id": p["page_id"], "page_number": p["page_number"],
            "image": p["image"], "src": p["src"], "ref_en": e, "ref_bo": b.strip(),
            "ref_prev_tail": tail(re.sub(r"\s+", " ", strip_root_verses(en_sides.get(prev_k, ""))[0]).strip(), 400) if prev_k else "",
            "ref_next_head": re.sub(r"\s+", " ", strip_root_verses(en_sides.get(next_k, ""))[0]).strip()[:400] if next_k else "",
            "prod_en": p.get("prod_en"),
        })
        kept.append(rec)
        st["kept"] += 1
    st["dropped"] = dict(st["dropped"])
    summary[toh] = st

with open(os.path.join(out, "reference.jsonl"), "w") as f:
    for r in kept:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
json.dump(drops, open(os.path.join(out, "drops.json"), "w"), ensure_ascii=False, indent=1)
json.dump(summary, open(os.path.join(out, "summary.json"), "w"), indent=1)
tot = collections.Counter()
for s in summary.values():
    for k, v in s["dropped"].items():
        tot[k] += v
print(f"kept {len(kept)} of {sum(s['sides_84000'] for s in summary.values())} sides; drops {dict(tot)}")
for k, s in summary.items():
    print(k, s["sides_84000"], "lobby", s["num_pages_lobby"], "kept", s["kept"], s["dropped"])
