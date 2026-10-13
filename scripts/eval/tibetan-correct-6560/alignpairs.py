# PRIOR ART: kanjur_align.py nw_identity() (Hetzner /root/tibetan-eval/) and its JS port nwMatches() in
# scripts/eval/tibetan-proofread/score.mjs — both return only the match COUNT. This is the same Needleman–Wunsch
# (scores 2/−1/−1, same tie-breaking: diagonal, then up, then left) returning the aligned PAIRS, which the anchoring
# and recitation checks need. matches(a, b) equals nw_identity(a, b) * len(a) exactly (checked against kanjur_align.py on the served
# reads, 2026-10-12; prep.py reproduces the manifest's derge_identity on all 30 folios through the same functions).
import re, unicodedata
from functools import lru_cache

TSHEG = '་'
PUNCT_RE = re.compile(r"[༁-༊།-༗༚-༟༺-༽྾-࿏\s]+")  # kanjur_align.py PUNCT_RE
NW_MATCH, NW_MISMATCH, NW_GAP = 2, -1, -1


def syllables(text):
    text = unicodedata.normalize('NFC', text)
    text = PUNCT_RE.sub(TSHEG, text)
    return [s for s in text.split(TSHEG) if s]


def align(a, b):
    return list(_align(tuple(a), tuple(b)))


@lru_cache(maxsize=4096)
def _align(a, b):
    """Global alignment of syllable lists. Returns [(i, j)] with j None for an a-syllable aligned to a gap, and
    (None, j) for a b-syllable aligned to a gap, in order."""
    n, m = len(a), len(b)
    if not n or not m:
        return tuple([(i, None) for i in range(n)] + [(None, j) for j in range(m)])
    prev = [j * NW_GAP for j in range(m + 1)]
    back = [bytearray(m + 1) for _ in range(n + 1)]
    for j in range(1, m + 1):
        back[0][j] = 2
    for i in range(1, n + 1):
        cur = [i * NW_GAP] + [0] * m
        back[i][0] = 1
        ai = a[i - 1]; bi = back[i]
        for j in range(1, m + 1):
            d = prev[j - 1] + (NW_MATCH if ai == b[j - 1] else NW_MISMATCH)
            u = prev[j] + NW_GAP
            l = cur[j - 1] + NW_GAP
            best = d if (d >= u and d >= l) else (u if u >= l else l)
            cur[j] = best
            bi[j] = 0 if best == d else (1 if best == u else 2)
        prev = cur
    out, i, j = [], n, m
    while i > 0 and j > 0:
        t = back[i][j]
        if t == 0:
            out.append((i - 1, j - 1)); i -= 1; j -= 1
        elif t == 1:
            out.append((i - 1, None)); i -= 1
        else:
            out.append((None, j - 1)); j -= 1
    while i > 0:
        out.append((i - 1, None)); i -= 1
    while j > 0:
        out.append((None, j - 1)); j -= 1
    return tuple(out[::-1])


def matches(a, b, pairs=None):
    pairs = pairs if pairs is not None else align(a, b)
    return sum(1 for i, j in pairs if i is not None and j is not None and a[i] == b[j])
