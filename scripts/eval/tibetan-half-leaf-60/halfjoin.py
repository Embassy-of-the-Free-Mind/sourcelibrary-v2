#!/usr/bin/env python3
"""halfjoin.py — cut a leaf into k overlapping vertical pieces, and join the pieces' reads back line by line (#60).

PRIOR ART: none — looked in scripts/gpu/yigdzin-vllm/ (cuts leaves top to bottom, never left to right),
scripts/eval/split-leaf-5771/ (same), scripts/lib/ and scripts/eval/ for an overlap/dedup line joiner (none; the
paddle/print lanes read whole pages). Tests: test_halfjoin.py beside this file.

Join rule. Each piece's read is split into non-empty lines. If every piece has the same number of lines, line i of
the leaf is piece 0's line i joined to piece 1's line i (then to piece 2's ...). Two neighbouring lines are joined by
finding the longest run of identical syllables between the last TAIL syllables of the left line and the first TAIL
syllables of the right line (the overlap, which both pieces saw). The left line is kept up to the start of that run and
the right line from the start of it, so the run appears once and the half-cut syllables at the left's end and the
right's start are dropped. A run shorter than MIN_RUN syllables is not trusted: the two lines are then simply
concatenated and the join is counted as `no_overlap`.
If the pieces disagree on line count, nothing is joined: the leaf text is the pieces' texts one after another (both
kept), and the leaf is flagged `line_mismatch` so the page can be reported with and without it.
"""
import re
from difflib import SequenceMatcher

OVERLAP = 0.10   # of leaf width, between neighbouring pieces
TAIL = 20        # syllables searched at each side of a join
MIN_RUN = 2      # syllables of exact agreement needed to trust a join
SEP_RE = re.compile(r"([་༁-༊།-༗༚-༟༺-༽྾-࿏\s]+)")   # tsheg + the scorer's punctuation class, kept for rebuilding


def piece_spans(width, k, overlap=OVERLAP):
    """k (x0, x1) spans covering [0, width), neighbours sharing overlap*width pixels."""
    if k == 1:
        return [(0, width)]
    ov = overlap * width
    w = (width + (k - 1) * ov) / k
    spans = []
    for i in range(k):
        x0 = round(i * (w - ov)); x1 = width if i == k - 1 else round(i * (w - ov) + w)
        spans.append((x0, x1))
    return spans


def _tokens(line):
    """[(syllable, separator-after)] — ''.join(s + sep) gives the line back exactly."""
    parts = SEP_RE.split(line)
    out = []
    if parts and parts[0] == "":
        lead = parts[1] if len(parts) > 1 else ""
        out.append(("", lead)); parts = parts[2:]
    for i in range(0, len(parts), 2):
        tok = parts[i]; sep = parts[i + 1] if i + 1 < len(parts) else ""
        if tok == "" and sep == "":
            continue
        out.append((tok, sep))
    return out


def join_line(a, b):
    """Join two neighbouring pieces' reads of one line. Returns (text, matched_run_length)."""
    if not a.strip():
        return b, 0
    if not b.strip():
        return a, 0
    ta, tb = _tokens(a), _tokens(b)
    base = max(0, len(ta) - TAIL)
    tail = [s for s, _ in ta[base:]]; head = [s for s, _ in tb[:TAIL]]
    sm = SequenceMatcher(None, tail, head, autojunk=False)
    m = sm.find_longest_match(0, len(tail), 0, len(head))
    # an empty-string syllable (leading separator) never counts toward a run
    run = m.size if all(tail[m.a + i] for i in range(m.size)) else 0
    if run < MIN_RUN:
        sep = "" if a.endswith(("་", "།", " ")) else "་"
        return a + sep + b, 0
    left = ta[:base + m.a]; right = tb[m.b:]
    return "".join(s + p for s, p in left + right), run


def lines_of(text):
    return [l for l in text.split("\n") if l.strip()]


def join_leaf(pieces):
    """pieces: the k reads of one leaf, left to right. Returns (text, info)."""
    ls = [lines_of(t) for t in pieces]
    counts = [len(x) for x in ls]
    if len(set(counts)) != 1:
        return "\n".join(t.strip("\n") for t in pieces if t.strip()), {"line_mismatch": True, "counts": counts,
                                                                          "joins": 0, "no_overlap": 0}
    out, joins, miss = [], 0, 0
    for i in range(counts[0]):
        cur = ls[0][i]
        for p in ls[1:]:
            cur, run = join_line(cur, p[i]); joins += 1; miss += int(run == 0)
        out.append(cur)
    return "\n".join(out), {"line_mismatch": False, "counts": counts, "joins": joins, "no_overlap": miss}
