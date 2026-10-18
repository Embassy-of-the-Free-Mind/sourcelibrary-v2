#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/mongol-synth-5664/{select_eval.py,freeze_eval.py} (map a catalogued text to its leaves by
proportion, for a meaning window; no column-level text); cer.py there (CER only). Nothing aligns known Mongolian text
to the cut columns of a Kanjur leaf.

Aligns KNOWN text to the real columns of Kanjur leaves (#5664), using the synthetic-trained reader's output only as a
locator. Two sources of known text:

  body    a published transliteration with page markers (etext/*.txt, format in the job's PR): every word of a side
          goes to one of that side's columns. Dynamic programme over word boundaries: each column takes a contiguous
          run of words; a column's cost is the normalised edit distance between its read and those words in Unicode;
          leading/trailing columns may belong to the neighbouring text; the editor's '|' line ends are rewarded as
          column breaks where the edition has them.
  title   the catalogue title of a text (rKTs, from Ligeti / the Glass databank): a column whose whole read aligns
          inside "mongγol-un keleber: <title>::" (on the side where the text starts) or "<title> tegüsbe::" (where it
          ends) gets that window of words as its label. Columns only partly covered are not labelled.

Every proposed pair carries the checks that later decide whether it is kept (keep.py): the word count of the read
against the label, its edit distance, and the edit distance to the neighbouring columns' labels (a discriminative
check: the read must be closer to its own label than to its neighbours', however badly it reads).

  python3 align.py body  --etext DIR --reads reads-realgt.jsonl --out body-pairs.jsonl
  python3 align.py title --texts texts.json --reads reads-realgt.jsonl --out title-pairs.jsonl
"""
import argparse, glob, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from translit import to_mong  # noqa: E402

PUNCT = '᠂᠃᠄᠅'


try:
    from rapidfuzz.distance import Levenshtein as _L
except ImportError:  # pure-python fallback (slow)
    _L = None


def lev(a, b):
    if _L is not None:
        return _L.distance(a, b)
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def norm(s):
    """Compare letters and word breaks only: punctuation, variation selectors and the FVS/NNBSP/MVS joiners vary
    between the reader and the editions without changing the text."""
    s = re.sub(r'[᠋-᠏ ]', ' ', s)
    s = re.sub('[' + PUNCT + r'᠀᠁‍]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def ned(a, b):
    a, b = norm(a), norm(b)
    if not a and not b:
        return 0.0
    return lev(a, b) / max(len(a), len(b), 1)


def nwords(s):
    return len(norm(s).split())


def load_reads(path):
    R = {}
    for l in open(path, encoding='utf8'):
        if l.strip():
            r = json.loads(l)
            R[r['id']] = r['text']
    return R


def side_columns(R, leaf):
    cols = sorted([k for k in R if k.split('/')[0] == leaf], key=lambda k: int(k.split('/c')[1]))
    return cols


# ---------------------------------------------------------------- body texts

def chandra_to_leaf(vol, marker):
    """Chandra / Ligeti page numbers count sides: p = 2*folio - 1 for a, 2*folio for b (rKTs: 392b = page 784)."""
    if re.fullmatch(r'\d+[ab]', marker):
        return f'v{vol:03d}_{marker}'
    p = int(marker)
    return f'v{vol:03d}_{(p + 1) // 2}{"a" if p % 2 else "b"}'


def parse_etext(path):
    vol, src, text, segs, cur = None, None, None, [], None
    for line in open(path, encoding='utf8'):
        line = line.rstrip('\n')
        if line.startswith('#vol'):
            vol = int(line.split()[1])
        elif line.startswith('#source'):
            src = line[8:].strip()
        elif line.startswith('#text'):
            text = line[6:].strip()
            if cur is not None:
                cur['ends_text'] = True
        elif line.startswith('@'):
            cur = {'vol': vol, 'source': src, 'text': text, 'marker': line[1:].strip(), 'raw': ''}
            segs.append(cur)
        elif cur is not None:
            cur['raw'] += ' ' + line
    # the same page can carry the end of one text and the start of the next: merge segments by leaf, in order
    by_leaf = {}
    for s in segs:
        leaf = chandra_to_leaf(s['vol'], s['marker'])
        by_leaf.setdefault(leaf, {'leaf': leaf, 'vol': s['vol'], 'source': s['source'], 'texts': [], 'raw': ''})
        by_leaf[leaf]['texts'].append(s['text'])
        by_leaf[leaf]['raw'] += ' ' + s['raw']
    return list(by_leaf.values())


def words_of(raw):
    """-> list of (latin word with its trailing punctuation, unicode), and the set of word indices that the editor
    marked as starting a new printed line ('|')."""
    raw = raw.replace('⟨?⟩', '')
    toks = re.findall(r'\||::|:|[^\s|:]+', raw)
    words, breaks = [], set()
    for t in toks:
        if t == '|':
            breaks.add(len(words))
        elif t in (':', '::'):
            if words:
                words[-1] = (words[-1][0] + t, words[-1][1] + to_mong(t))
        else:
            u = to_mong(t)
            if u:
                words.append((t, u))
    return words, breaks


def align_side(reads, words, breaks, has_marks, lead_free, trail_free, max_w=16):
    """DP: columns in reading order, each takes words[i:j] or is skipped. Costs are ABSOLUTE edit distances (in
    characters), so packing many words into one column is as costly as it is wrong. A skipped column costs its read's
    length: 0.5 per character where it may hold the neighbouring text (before the first word / after the last), 1.0
    elsewhere. Returns [(col_index, i, j, cost)] with cost normalised per column for reporting."""
    M, N = len(reads), len(words)
    INF = float('inf')
    U = [norm(w[1]) for w in words]
    R = [norm(r) for r in reads]
    dp = [[INF] * (N + 1) for _ in range(M + 1)]
    bk = [[None] * (N + 1) for _ in range(M + 1)]
    dp[0][0] = 0.0
    for m in range(M):
        r = R[m]
        for i in range(N + 1):
            c0 = dp[m][i]
            if c0 == INF:
                continue
            free = (i == 0 and lead_free) or (i == N and trail_free)
            sk = len(r) * (0.5 if free else 1.0)
            if c0 + sk < dp[m + 1][i]:
                dp[m + 1][i] = c0 + sk; bk[m + 1][i] = (i, None)
            lab = ''
            for j in range(i + 1, min(N, i + max_w) + 1):
                lab = (lab + ' ' + U[j - 1]).strip()
                if len(lab) > 2 * len(r) + 12:
                    break
                cost = lev(r, lab)
                if has_marks:
                    if i > 0 and i not in breaks:
                        cost += 4
                    cost += 4 * sum(1 for k in range(i + 1, j) if k in breaks)
                if c0 + cost < dp[m + 1][j]:
                    dp[m + 1][j] = c0 + cost; bk[m + 1][j] = (i, cost / max(len(r), len(lab), 1))
    if dp[M][N] == INF:
        return None
    out, j = [], N
    for m in range(M, 0, -1):
        i, cost = bk[m][j]
        if cost is not None:
            out.append((m - 1, i, j, cost))
        j = i
    return list(reversed(out))


def body(args):
    R = load_reads(args.reads)
    rows = []
    for path in sorted(glob.glob(os.path.join(args.etext, '[A-Z]_v*.txt'))):
        src_key = os.path.basename(path).split('_')[0]
        leaves = parse_etext(path)
        for k, lf in enumerate(leaves):
            cols = side_columns(R, lf['leaf'])
            if not cols:
                print(f'{lf["leaf"]}: no reads', file=sys.stderr); continue
            words, breaks = words_of(lf['raw'])
            has_marks = len(breaks) >= 3
            res = align_side([R[c] for c in cols], words, breaks, has_marks, lead_free=True, trail_free=True)
            if res is None:
                print(f'{lf["leaf"]}: no alignment', file=sys.stderr); continue
            labels = {m: ' '.join(w[1] for w in words[i:j]) for m, i, j, _ in res}
            latin = {m: ' '.join(w[0] for w in words[i:j]) for m, i, j, _ in res}
            order = [m for m, *_ in res]
            for n, (m, i, j, cost) in enumerate(res):
                read = R[cols[m]]
                own = ned(read, labels[m])
                nb = [ned(read, labels[o]) for o in (order[n - 1] if n > 0 else None, order[n + 1] if n + 1 < len(order) else None) if o is not None]
                rows.append({'id': cols[m], 'kind': 'body', 'source': src_key, 'vol': lf['vol'], 'leaf': lf['leaf'],
                             'label': labels[m], 'latin': latin[m], 'read': read, 'ned': round(own, 3),
                             'ned_neighbours': [round(x, 3) for x in nb], 'words_label': j - i, 'words_read': nwords(read),
                             'edition_breaks': has_marks, 'break_agrees': (i in breaks or i == 0) and (j in breaks or j == len(words)) if has_marks else None,
                             'col': m + 1, 'n_cols': len(cols)})
            print(f'{lf["leaf"]} {src_key}: {len(words)} words -> {len(res)}/{len(cols)} columns, mean ned {sum(x[3] for x in res) / max(1, len(res)):.2f}', file=sys.stderr)
    with open(args.out, 'w', encoding='utf8') as fo:
        for r in rows:
            fo.write(json.dumps(r, ensure_ascii=False) + '\n')
    print(f'{len(rows)} body pairs -> {args.out}', file=sys.stderr)


# ---------------------------------------------------------------- titles

def glass_title(t):
    """The Glass databank's transliterated Mongolian title, from the rKTs page text parsed into titles.skt_in_mong."""
    m = re.search(r'Title Mong (.+?) Title Skt', t.get('skt_in_mong') or '')
    return m.group(1).strip() if m else None


def window_match(read, cand_words, min_w=2):
    """Best contiguous window of cand_words (unicode) for the whole read. -> (ned, i, j) or None."""
    nr = nwords(read)
    if nr < min_w:
        return None
    best = None
    for k in (nr - 1, nr, nr + 1):
        if k < 1:
            continue
        for i in range(0, len(cand_words) - k + 1):
            d = ned(read, ' '.join(cand_words[i:i + k]))
            if best is None or d < best[0]:
                best = (d, i, i + k)
    return best


def title(args):
    R = load_reads(args.reads)
    texts = json.load(open(args.texts, encoding='utf8'))
    rows = []
    for t in texts:
        gt = glass_title(t['titles']) or t['titles'].get('mong')
        if not gt:
            continue
        variants = {'glass': gt}
        if t['titles'].get('mong') and t['titles']['mong'] != gt:
            variants['rkts'] = t['titles']['mong']
        for where, (fol, sd) in (('open', t['start']), ('close', t['end'])):
            leaf = f'v{t["vol"]:03d}_{fol}{sd}'
            cols = side_columns(R, leaf)
            for vname, tt in variants.items():
                lat = (f'mongγol-un keleber: {tt}::' if where == 'open' else f'{tt} tegüsbe::').split()
                uw = [to_mong(w) for w in lat]
                for c in cols:
                    read = R[c]
                    bm = window_match(read, uw)
                    if bm is None or bm[0] > args.max_ned:
                        continue
                    d, i, j = bm
                    rows.append({'id': c, 'kind': 'title', 'where': where, 'variant': vname, 'rkts': t['rkts'], 'mng1': t['mng1'],
                                 'vol': t['vol'], 'leaf': leaf, 'label': ' '.join(uw[i:j]), 'latin': ' '.join(lat[i:j]),
                                 'read': read, 'ned': round(d, 3), 'words_label': j - i, 'words_read': nwords(read),
                                 'title_latin': tt, 'covers_title': (j - i) / len(lat)})
    # one label per column: the lowest edit distance across variants/places
    best = {}
    for r in rows:
        if r['id'] not in best or r['ned'] < best[r['id']]['ned']:
            best[r['id']] = r
    with open(args.out, 'w', encoding='utf8') as fo:
        for r in best.values():
            fo.write(json.dumps(r, ensure_ascii=False) + '\n')
    print(f'{len(best)} title pairs (ned <= {args.max_ned}) from {len(texts)} texts -> {args.out}', file=sys.stderr)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('mode', choices=['body', 'title'])
    ap.add_argument('--etext'); ap.add_argument('--texts'); ap.add_argument('--reads', required=True)
    ap.add_argument('--out', required=True); ap.add_argument('--max-ned', type=float, default=0.45)
    a = ap.parse_args()
    body(a) if a.mode == 'body' else title(a)
