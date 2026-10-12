# PRIOR ART: scripts/eval/second-reader/second-reader.mjs (cross-family READ comparison with an adjudicator, by
# page verdict, not word spans) and the #6544 disagreement arm (designed, not yet built). Humphries & Leddy's "When
# models disagree" publishes no code; this is a word-level reading of their method: flag the primary's words where
# another reader differs, then ask how many of the primary's errors fall inside a flag (#6547).
"""Word-level disagreement spans, GT-anchored alignment and the oracle / resolver analysis for #6547 (c)."""
import difflib, json, os, re
from textmetrics import humphries_modified, failed_kind, unwrap


def load(path):
    rows = {}
    if os.path.exists(path):
        for l in open(path, encoding='utf-8'):
            if l.strip():
                r = json.loads(l); rows[r['uid']] = r
    return rows


def toks(text):
    """[(raw token with its trailing whitespace)]"""
    return [m.group(0) for m in re.finditer(r'\S+\s*', text)]


def key(t):
    return humphries_modified(t) or t.strip()


def _opcodes(a, b):
    return difflib.SequenceMatcher(None, [key(x) for x in a], [key(x) for x in b], autojunk=False).get_opcodes()


def disagreement_spans(primary, others):
    """Primary-token ranges [(i1, i2)] where any other reader differs (case and punctuation ignored). A pure insertion
    by another reader flags the primary words on either side of the gap."""
    P = toks(primary)
    flag = [False] * len(P)
    for o in others:
        for tag, i1, i2, j1, j2 in _opcodes(P, toks(o)):
            if tag == 'equal':
                continue
            if i1 == i2:
                for k in (i1 - 1, i1):
                    if 0 <= k < len(P):
                        flag[k] = True
            else:
                for k in range(i1, i2):
                    flag[k] = True
    spans, k = [], 0
    while k < len(P):
        if flag[k]:
            s = k
            while k < len(P) and flag[k]:
                k += 1
            spans.append((s, k))
        else:
            k += 1
    return spans


def _map_boundary(ops, p):
    """Primary token boundary p -> the other reader's boundary."""
    for tag, i1, i2, j1, j2 in ops:
        if i1 <= p <= i2:
            if tag == 'equal':
                return j1 + (p - i1)
            return j1 if p == i1 else j2 if p == i2 else j1 + round((p - i1) * (j2 - j1) / max(1, i2 - i1))
    return ops[-1][4] if ops else 0


def render_marked(primary, others, spans):
    P = toks(primary)
    O = [toks(o) for o in others]
    ops = [_opcodes(P, o) for o in O]
    out, k = [], 0
    for s, e in spans:
        out.append(''.join(P[k:s]))
        vers = [''.join(P[s:e]).strip()] + [''.join(o[_map_boundary(op, s):_map_boundary(op, e)]).strip() for o, op in zip(O, ops)]
        trail = re.search(r'\s*$', P[e - 1]).group(0)
        out.append('[[' + ' | '.join(f'{lab}: {v}' for lab, v in zip('ABC', vers)) + ']]' + (trail or ' '))
        k = e
    out.append(''.join(P[k:]))
    return ''.join(out)


def _sellers(line, hyp):
    """Best approximate occurrence of the word list `line` inside `hyp` (free start and end). -> (cost, j1, j2)"""
    m, n = len(line), len(hyp)
    prev = [0] * (n + 1); start_prev = list(range(n + 1))
    for i in range(1, m + 1):
        cur = [i] + [0] * n; start = [0] * (n + 1)
        for j in range(1, n + 1):
            c_sub = prev[j - 1] + (line[i - 1] != hyp[j - 1])
            c_del = prev[j] + 1
            c_ins = cur[j - 1] + 1
            best = min(c_sub, c_del, c_ins)
            cur[j] = best
            start[j] = start_prev[j - 1] if best == c_sub else start_prev[j] if best == c_del else start[j - 1]
        start[0] = 0
        prev, start_prev = cur, start
    j2 = min(range(n + 1), key=lambda j: (prev[j], -j))
    return prev[j2], start_prev[j2], j2


def anchored_indices(gt, hyp_tokens):
    """For each GT line, the window of hypothesis tokens it matches best. Returns hypothesis token indices in GT line
    order: the part of the reading the reference covers. Text the reference never transcribed (marginal archive
    notes, folio numbers) falls outside every window and is not scored by the anchored measure."""
    H = [key(t) for t in hyp_tokens]
    idx, used = [], set()
    for line in gt.split('\n'):
        L = [key(t) for t in line.split() if key(t)]
        if not L:
            continue
        cost, j1, j2 = _sellers(L, H)
        if cost >= len(L):  # nothing of this line was found: an omission, scored as a deletion
            continue
        for j in range(j1, j2):
            if j not in used:
                used.add(j); idx.append(j)
    return idx


def word_ops(hyp, ref):
    """Minimal word-level edit script between two key lists: [(op, hi, ri)] with op in eq/sub/ins/del."""
    m, n = len(hyp), len(ref)
    D = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        D[i][0] = i
    for j in range(n + 1):
        D[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            D[i][j] = min(D[i - 1][j - 1] + (hyp[i - 1] != ref[j - 1]), D[i - 1][j] + 1, D[i][j - 1] + 1)
    i, j, ops = m, n, []
    while i or j:
        if i and j and D[i][j] == D[i - 1][j - 1] + (hyp[i - 1] != ref[j - 1]):
            ops.append(('eq' if hyp[i - 1] == ref[j - 1] else 'sub', i - 1, j - 1)); i -= 1; j -= 1
        elif i and D[i][j] == D[i - 1][j] + 1:
            ops.append(('ins', i - 1, None)); i -= 1
        else:
            ops.append(('del', None, j - 1)); j -= 1
    return ops[::-1]
