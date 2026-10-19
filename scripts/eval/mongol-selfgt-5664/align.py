# PRIOR ART: none for Mongolian words; mongol-realgt-5664 aligns label words to columns (one level up), not to word segments.
# Align a column's LoRA read (its words, in order) to the column's word segments (#5664, mongol-selfgt).
# DP partitions the m segments into the n read words, in order, each word taking >= 1 contiguous segments.
# Cost per word = |log(group width / expected width)| + 0.6 * (internal gaps / px-per-char); expected width =
# letters x px-per-char of the column. A word whose cost exceeds MAXC is left unaligned. Columns with m < n are
# skipped (the segmenter merged words; no safe split).
import json, math, re
def mwords(t):
    t = re.sub('[᠋-᠏‌‍]', '', t).replace(' ', ' ')
    return [w for w in re.split(r'[\s᠀-᠅᠈᠉]+', t) if w and all('ᠠ' <= c <= 'ᡂ' for c in w)]
def align(segs, words, maxc=0.45):
    m, n = len(segs), len(words)
    if n == 0 or m < n: return []
    tot_w = sum(b - a for a, b in segs); tot_c = sum(len(w) for w in words); ppc = tot_w / max(1, tot_c)
    def cost(i, j, k):   # segments i..j-1 -> word k
        a, b = segs[i][0], segs[j - 1][1]
        gaps = sum(segs[t + 1][0] - segs[t][1] for t in range(i, j - 1))
        return abs(math.log(max(4, b - a) / max(4, len(words[k]) * ppc))) + 0.6 * gaps / max(1, ppc) / 3
    INF = 1e9; F = [[INF] * (n + 1) for _ in range(m + 1)]; P = [[None] * (n + 1) for _ in range(m + 1)]; F[0][0] = 0
    for k in range(1, n + 1):
        for j in range(k, m - (n - k) + 1):
            for i in range(max(k - 1, j - 6), j):
                if F[i][k - 1] >= INF: continue
                c = F[i][k - 1] + cost(i, j, k - 1)
                if c < F[j][k]: F[j][k] = c; P[j][k] = i
    if F[m][n] >= INF: return []
    out = []; j = m
    for k in range(n, 0, -1):
        i = P[j][k]; c = cost(i, j, k - 1)
        out.append((k - 1, i, j, c)); j = i
    out.reverse()
    return [(k, i, j, c) for k, i, j, c in out if c <= maxc]
