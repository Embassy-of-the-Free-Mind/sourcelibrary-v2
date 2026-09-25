#!/usr/bin/env python3
# PRIOR ART: scripts/eval/syriac-vs-published/align.py (same job, but locates the reference span by trigram votes;
# a fabricated page has no votes and silently drops out of the denominator). This one uses the Digital Syriac
# Corpus <pb n="…"/> page breaks, which give the PRINTED page of the very edition we scanned, so every page of the
# scan gets a reference — including the pages our OCR invented — and the page mapping is a single constant offset
# that the script solves for and reports (the positive control: if the offset is wrong, nothing aligns).
#
# usage: align-by-printed-page.py --tei-dir DIR --files 392-449 --pages P.jsonl --out OUT.jsonl [--offset N]
import argparse, json, re, os, collections, statistics
from rapidfuzz.distance import Levenshtein
from rapidfuzz import fuzz

STRIP = re.compile(r'[ܰ-ܑ݊̀-ͯـ]')
NONSYR = re.compile(r'[^ܐ-ܯ ]+')


def norm(s):
    s = STRIP.sub('', s or '').replace('ܤ', 'ܣ')
    return re.sub(r'\s+', ' ', NONSYR.sub(' ', s)).strip()


def tei_pages(path):
    """yield (printed_page_number, normalised text) from one TEI file, split on <pb n=.../>"""
    s = open(path, encoding='utf-8').read()
    b = re.search(r'<body>(.*?)</body>', s, re.S)
    s = b.group(1) if b else s
    s = re.sub(r'<note\b.*?</note>', ' ', s, flags=re.S)
    parts = re.split(r'<pb\b[^>]*\bn="([^"]+)"[^>]*/>', s)
    # parts = [pre, n1, text1, n2, text2, ...]
    for i in range(1, len(parts) - 1, 2):
        n = parts[i]
        if not n.isdigit():
            continue
        t = norm(re.sub(r'<[^>]+>', ' ', parts[i + 1]))
        if t:
            yield int(n), t


def loop_score(toks):
    if len(toks) < 30:
        return None
    c = collections.Counter(toks[i] + ' ' + toks[i + 1] + ' ' + toks[i + 2] for i in range(len(toks) - 2))
    return (max(c.values()) * 3) / len(toks)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tei-dir', required=True)
    ap.add_argument('--files', required=True, help='e.g. 392-449 or 1,2,3')
    ap.add_argument('--pages', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--offset', type=int, default=None, help='our page_number = printed page + offset (solved if omitted)')
    a = ap.parse_args()
    ids = []
    for part in a.files.split(','):
        if '-' in part:
            lo, hi = part.split('-'); ids += list(range(int(lo), int(hi) + 1))
        else:
            ids.append(int(part))
    ref = {}  # printed page -> text (concatenate if a page is split across files)
    for i in ids:
        p = os.path.join(a.tei_dir, f'{i}.xml')
        if not os.path.exists(p):
            continue
        for n, t in tei_pages(p):
            ref[n] = (ref.get(n, '') + ' ' + t).strip()
    print(f'reference: {len(ref)} printed pages, {min(ref)}..{max(ref)}, {sum(len(t.split()) for t in ref.values())} words')
    ours = {}
    for l in open(a.pages, encoding='utf-8'):
        d = json.loads(l)
        ours[d['pn']] = (norm(d.get('ocr', '')), d.get('model'), bool(d.get('tr')))

    # solve the offset: for each reference page, the our-page with the most shared rare trigrams; mode of (pn - n)
    if a.offset is None:
        index = collections.defaultdict(set)
        for pn, (t, _, _) in ours.items():
            w = t.split()
            for j in range(len(w) - 2):
                index[w[j] + ' ' + w[j + 1] + ' ' + w[j + 2]].add(pn)
        deltas = collections.Counter()
        for n, t in ref.items():
            w = t.split(); votes = collections.Counter()
            for j in range(len(w) - 2):
                g = w[j] + ' ' + w[j + 1] + ' ' + w[j + 2]
                s = index.get(g)
                if s and len(s) <= 3:
                    for pn in s: votes[pn] += 1
            if votes:
                pn, v = votes.most_common(1)[0]
                if v >= 5: deltas[pn - n] += 1
        print('offset candidates (pn - printed):', deltas.most_common(5))
        a.offset = deltas.most_common(1)[0][0] if deltas else 0
    print('using offset', a.offset)

    out = open(a.out, 'w'); rows = []
    for n in sorted(ref):
        pn = n + a.offset
        if pn not in ours:
            continue
        page, model, has_tr = ours[pn]
        toks = page.split()
        r = {'printed': n, 'pn': pn, 'model': model, 'has_tr': has_tr, 'syr_words': len(toks), 'ref_words': len(ref[n].split()),
             'loop': loop_score(toks)}
        if len(toks) < 15:
            r['why'] = 'too-few-syriac-words'
        else:
            d = Levenshtein.distance(page, ref[n])
            r['cer'] = round(d / max(len(ref[n]), 1), 4)
            r['wer'] = round(Levenshtein.distance(toks, ref[n].split()) / max(len(ref[n].split()), 1), 4)
            r['ratio'] = round(fuzz.ratio(page, ref[n]) / 100, 4)
        out.write(json.dumps(r, ensure_ascii=False) + '\n'); rows.append(r)
    out.close()
    sc = [r for r in rows if 'cer' in r]
    print(f'pages compared {len(sc)} (too few Syriac words: {len(rows) - len(sc)})')

    def summ(rs, label):
        if not rs:
            print(f'  {label}: none'); return
        c = sorted(r['cer'] for r in rs)
        print(f"  {label}: n={len(rs)} CER median {statistics.median(c):.3f} | <=10% {sum(x <= .1 for x in c) / len(c):.0%} "
              f"<=20% {sum(x <= .2 for x in c) / len(c):.0%} <=30% {sum(x <= .3 for x in c) / len(c):.0%} >50% {sum(x > .5 for x in c) / len(c):.0%} "
              f"| WER median {statistics.median(r['wer'] for r in rs):.3f} | ratio median {statistics.median(r['ratio'] for r in rs):.3f}")
    summ(sc, 'all')
    summ([r for r in sc if (r['loop'] or 0) < 0.5], 'loop<0.5')
    summ([r for r in sc if (r['loop'] or 0) >= 0.5], 'loop>=0.5')
    for m in sorted({r['model'] for r in sc}, key=str):
        summ([r for r in sc if r['model'] == m], f'model {m}')


if __name__ == '__main__':
    main()
