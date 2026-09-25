#!/usr/bin/env python3
# PRIOR ART: scripts/eval/INDEX.md, scripts/eval/lib/ — the OCR evals there score Gemini arms against each other
# or against IA djvu text; none scores a page against an independent published electronic edition of the same
# text, which is what #4883 needs (a recited page agrees with itself and with a second Gemini arm).
#
# Score our per-page Syriac OCR against a published electronic text of the same work.
#   mode "verses": reference is a JSONL of {c,b,ch,v,t} (ETCBC Peshitta plain text) — page is aligned to a verse span.
#   mode "flat":   reference is a plain text file (Digital Syriac Corpus TEI body) — page is aligned to a token window.
# Both modes: locate the span by word-trigram votes, then compute a character error rate (CER) of the page's Syriac
# against the best-matching substring of the reference (rapidfuzz partial alignment), and a word error rate (WER).
# Everything non-Syriac (Latin apparatus, digits, verse markers, punctuation, vowels/diacritics) is stripped first,
# so the CER is over consonantal Syriac only. Output: JSONL, one row per OCR'd page.
#
# usage: align.py --pages P.jsonl --ref REF --mode verses|flat --out OUT.jsonl [--book-filter NT|OT]
# needs: pip install rapidfuzz
import argparse, json, re, collections, statistics
from rapidfuzz import fuzz
from rapidfuzz.distance import Levenshtein

STRIP = re.compile(r'[ܰ-ܑ݊̀-ͯـ]')
NONSYR = re.compile(r'[^ܐ-ܯ ]+')


def norm(s):
    s = STRIP.sub('', s or '')
    s = s.replace('ܤ', 'ܣ')          # Semkath variant form → Semkath
    s = NONSYR.sub(' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def trigrams(toks):
    return [toks[i] + ' ' + toks[i + 1] + ' ' + toks[i + 2] for i in range(len(toks) - 2)]


def loop_score(toks):
    if len(toks) < 30:
        return None
    c = collections.Counter(trigrams(toks))
    return (max(c.values()) * 3) / len(toks)


def cer_wer(page, ref):
    """page, ref: normalised strings. Free leading/trailing slack in ref (a page is one slice of a longer text)."""
    if not page or not ref:
        return None, None, 0
    if len(page) < len(ref):
        a = fuzz.partial_ratio_alignment(page, ref)
        sub = ref[a.dest_start:a.dest_end] if a else ref
    else:
        sub = ref
    d = Levenshtein.distance(page, sub)
    cer = d / max(len(sub), 1)
    pw, sw = page.split(), sub.split()
    wer = Levenshtein.distance(pw, sw) / max(len(sw), 1)
    return cer, wer, len(sub)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pages', required=True)
    ap.add_argument('--ref', required=True)
    ap.add_argument('--mode', choices=['verses', 'flat'], required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--book-filter', default=None, help='verses mode: restrict to corpus c=NT|OT')
    ap.add_argument('--min-votes', type=int, default=6)
    a = ap.parse_args()

    units = []   # (label, normtext)
    if a.mode == 'verses':
        for l in open(a.ref, encoding='utf-8'):
            d = json.loads(l)
            if a.book_filter and d['c'] != a.book_filter:
                continue
            units.append((f"{d['b']} {d['ch']}:{d['v']}", norm(d['t'])))
    else:
        toks = norm(open(a.ref, encoding='utf-8').read()).split()
        W = 40
        for i in range(0, len(toks), W):
            units.append((f"tok{i}", ' '.join(toks[i:i + W])))
    index = collections.defaultdict(list)
    for ui, (_, t) in enumerate(units):
        for g in set(trigrams(t.split())):
            index[g].append(ui)
    common = {g for g, v in index.items() if len(v) > 40}
    unit_book = [lab.split(' ')[0] for lab, _ in units]

    out = open(a.out, 'w')
    rows = []
    for l in open(a.pages, encoding='utf-8'):
        p = json.loads(l)
        page = norm(p.get('ocr', ''))
        toks = page.split()
        row = {'pn': p['pn'], 'model': p.get('model'), 'syr_words': len(toks), 'loop': loop_score(toks),
               'has_tr': bool(p.get('tr')), 'aligned': False}
        if len(toks) < 15:
            row['why'] = 'too-few-syriac-words'
            out.write(json.dumps(row, ensure_ascii=False) + '\n'); rows.append(row)
            continue
        votes = collections.Counter()
        for g in set(trigrams(toks)):
            if g in common:
                continue
            for ui in index.get(g, ()):
                votes[ui] += 1
        if not votes or votes.most_common(1)[0][1] < 2 or sum(votes.values()) < a.min_votes:
            row['why'] = 'no-anchor'; row['votes'] = sum(votes.values())
            out.write(json.dumps(row, ensure_ascii=False) + '\n'); rows.append(row)
            continue
        top, _ = votes.most_common(1)[0]
        near = sorted(u for u in votes if abs(u - top) <= 60 and unit_book[u] == unit_book[top])
        lo, hi = min(near), max(near)
        ref = ' '.join(t for _, t in units[max(0, lo - 1):hi + 2])
        cer, wer, reflen = cer_wer(page, ref)
        row.update({'aligned': True, 'span': f"{units[lo][0]} .. {units[hi][0]}", 'votes': sum(votes.values()),
                    'page_chars': len(page), 'ref_chars': reflen, 'cer': round(cer, 4), 'wer': round(wer, 4)})
        out.write(json.dumps(row, ensure_ascii=False) + '\n'); rows.append(row)
    out.close()

    al = [r for r in rows if r['aligned']]
    print(f"pages {len(rows)} | with >=15 Syriac words {sum(1 for r in rows if r.get('why') != 'too-few-syriac-words')} | aligned {len(al)}")

    def summ(rs, label):
        if not rs:
            print(f"  {label}: none"); return
        c = sorted(r['cer'] for r in rs)
        print(f"  {label}: n={len(rs)} CER median {statistics.median(c):.3f} mean {statistics.mean(c):.3f} | "
              f"<=5% {sum(x <= .05 for x in c) / len(c):.0%} <=10% {sum(x <= .10 for x in c) / len(c):.0%} "
              f"<=20% {sum(x <= .20 for x in c) / len(c):.0%} >50% {sum(x > .5 for x in c) / len(c):.0%} | "
              f"WER median {statistics.median(r['wer'] for r in rs):.3f}")
    summ(al, 'all aligned')
    summ([r for r in al if (r['loop'] or 0) < 0.5], 'loop<0.5 (clean by loop scan)')
    summ([r for r in al if (r['loop'] or 0) >= 0.5], 'loop>=0.5')
    for m in sorted({r['model'] for r in al}, key=str):
        summ([r for r in al if r['model'] == m], f'model {m}')


if __name__ == '__main__':
    main()
