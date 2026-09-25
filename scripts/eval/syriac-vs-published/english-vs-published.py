#!/usr/bin/env python3
# PRIOR ART: scripts/eval/INDEX.md — the translation evals there judge fluency/faithfulness with a model or compare two
# Gemini arms; none asks whether our English page narrates the SAME EVENTS as a public-domain published translation
# of the same passage. This does, without a model judge: content-word overlap against the best window of the
# published text, calibrated against random windows, with a hand-read sample printed for a human.
#
# usage: english-vs-published.py --pages P.jsonl --published TXT --out OUT.jsonl [--syriac-only] [--show N]
import argparse, json, re, random, collections, statistics

STOP = set("""about above after again against almost along already also although always among another any anyone anything
around because become before began begin behind being below between beyond both bring brought called came cannot
certain child children come could daughter days death did does doing done down during each early either enough even ever
every everything father find first from give given goes going gone good great hand hands have having heard heart heaven
himself house however into itself just keep king kings know known land last later least leave left less life like little
long look lord made make making many might more most much must name never next nothing often once only other others
over people place placed power rather right said same saw says seen shall should since some something soon still such take
taken tell than that their them then there these they thing things think this those though thought three through thus
time toward under until unto upon very well went were what when where whether which while whole whom whose will with
within without woman women word words world would years young your yourself page text previous section chapter translation
syriac original manuscript continues concludes begins column verses verse marks numbered numbers language passage reads
follows following above below content appears likely seems written writing script letters letter note notes""".split())


def content_tokens(s):
    toks = re.findall(r"[A-Za-z][A-Za-z'\-]+", s or '')
    out = []
    for t in toks:
        tl = t.lower().strip("'-")
        if len(tl) < 5 or tl in STOP:
            continue
        out.append(tl)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pages', required=True); ap.add_argument('--published', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--syriac-only', action='store_true', help='only pages whose OCR has >=15 Syriac words')
    ap.add_argument('--syriac-majority', action='store_true', help='only pages with more Syriac than Latin-script words')
    ap.add_argument('--pn-min', type=int, default=0); ap.add_argument('--pn-max', type=int, default=10 ** 9)
    ap.add_argument('--window', type=int, default=700); ap.add_argument('--show', type=int, default=0)
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--control', default=None, help='a published translation of a DIFFERENT work: the same max-over-windows '
                    'statistic against it is the null (a best window always finds something)')
    a = ap.parse_args()
    random.seed(a.seed)

    class Pub:
        def __init__(self, path):
            self.raw = open(path, encoding='utf-8', errors='ignore').read()
            self.toks = content_tokens(self.raw)
            self.pos = collections.defaultdict(list)
            for i, t in enumerate(self.toks): self.pos[t].append(i)
            self.df = {t: len(v) for t, v in self.pos.items()}
            self.N = len(self.toks)

        def best_window(self, page_tokens, W):
            """max over windows of the number of DISTINCT page tokens present; tokens common in the published text are skipped"""
            cap = max(30, self.N // 400)
            types = [t for t in set(page_tokens) if t in self.pos and self.df[t] <= cap]
            hits = sorted((p, t) for t in types for p in self.pos[t])
            best, bstart, j, seen = 0, 0, 0, collections.Counter()
            for p, t in hits:
                seen[t] += 1
                while hits[j][0] < p - W:
                    seen[hits[j][1]] -= 1
                    if seen[hits[j][1]] == 0: del seen[hits[j][1]]
                    j += 1
                if len(seen) > best: best, bstart = len(seen), hits[j][0]
            return best, bstart, len(types)

    pub = Pub(a.published); ctl = Pub(a.control) if a.control else None
    pub_raw, N, W = pub.raw, pub.N, a.window
    print(f'published: {N} content tokens, {len(pub.df)} distinct' + (f' | control: {ctl.N} tokens' if ctl else ''))

    rows = []
    out = open(a.out, 'w')
    for l in open(a.pages, encoding='utf-8'):
        p = json.loads(l)
        if not p.get('tr') or not (a.pn_min <= p['pn'] <= a.pn_max): continue
        syr = len(re.findall(r'[ܐ-ܯ]+', p.get('ocr', '')))
        lat = len(re.findall(r'[A-Za-z]{3,}', p.get('ocr', '')))
        if a.syriac_only and syr < 15: continue
        if a.syriac_majority and syr <= lat: continue   # bilingual volumes: skip the printed English pages
        pt = content_tokens(p['tr'])
        distinct = len(set(pt))
        if distinct < 20: continue
        best, start, usable = pub.best_window(pt, W)
        bc, _, uc = ctl.best_window(pt, W) if ctl else (None, None, None)
        r = {'pn': p['pn'], 'syr_words': syr, 'distinct': distinct, 'usable': usable, 'best': best,
             'score': round(best / max(usable, 1), 3), 'pub_start': start, 'pub_frac': round(start / max(N, 1), 3),
             'ctl_best': bc, 'ctl_usable': uc, 'ctl_score': round(bc / max(uc, 1), 3) if ctl else None}
        rows.append((r, p))
        out.write(json.dumps(r) + '\n')
    out.close()
    # a printed book and our page order are both sequential: pages that read the right passage form a monotone chain
    import bisect
    seq = sorted(rows, key=lambda x: x[0]['pn'])
    tails, tailidx, prev = [], [], [None] * len(seq)
    for i, (r, _) in enumerate(seq):
        g = r['pub_start']; k = bisect.bisect_left(tails, g)
        if k == len(tails): tails.append(g); tailidx.append(i)
        else: tails[k] = g; tailidx[k] = i
        prev[i] = tailidx[k - 1] if k > 0 else None
    chain = set(); i = tailidx[-1] if tailidx else None
    while i is not None: chain.add(seq[i][0]['pn']); i = prev[i]
    n = len(rows); rnd = 2 * (n ** 0.5)
    for r, _ in rows:
        r['in_chain'] = r['pn'] in chain
        beats = (r['best'] - (r['ctl_best'] or 0)) >= 3 if ctl else r['score'] >= 0.35
        r['cls'] = 'recognisable' if (r['in_chain'] and beats) else ('partly' if (r['in_chain'] or beats) else 'unrelated')
    c = collections.Counter(r['cls'] for r, _ in rows)
    print(f'pages scored {n} | monotone chain {len(chain)} ({len(chain) / n:.0%}; random order would give ≈{rnd:.0f} = {rnd / n:.0%}) | '
          f'score median {statistics.median(r["score"] for r, _ in rows):.2f}'
          + (f' vs control median {statistics.median(r["ctl_score"] for r, _ in rows):.2f}' if ctl else ''))
    print(f'  recognisable {c["recognisable"]} ({c["recognisable"] / n:.0%}) | partly {c["partly"]} ({c["partly"] / n:.0%}) | unrelated {c["unrelated"]} ({c["unrelated"] / n:.0%})')
    with open(a.out, 'w') as o:
        for r, _ in rows: o.write(json.dumps(r) + '\n')
    for r, _ in rows: r['lift'] = r['score'] - (r['ctl_score'] or 0)
    if a.show:
        # spaced sample across the score range for hand reading
        rs = sorted(rows, key=lambda x: x[0]['lift'])
        picks = [rs[int(i * (len(rs) - 1) / (a.show - 1))] for i in range(a.show)] if a.show > 1 else rs[:1]
        for r, p in picks:
            print(f"\n#### pn {r['pn']} {r['cls']} score {r['score']} (best {r['best']}/{r['usable']}, control best {r['ctl_best']}) "
                  f"in_chain {r['in_chain']} pub_frac {r['pub_frac']} syr_words {r['syr_words']}")
            print('OURS:', re.sub(r'\s+', ' ', p['tr'])[:600])
            # locate the window in the raw text: find the raw offset of the start token by counting content tokens
            cnt = 0; off = 0
            for m in re.finditer(r"[A-Za-z][A-Za-z'\-]+", pub_raw):
                tl = m.group().lower().strip("'-")
                if len(tl) >= 5 and tl not in STOP:
                    if cnt == r['pub_start']: off = m.start(); break
                    cnt += 1
            print('PUBLISHED@best:', re.sub(r'\s+', ' ', pub_raw[off:off + 900]))


if __name__ == '__main__':
    main()
