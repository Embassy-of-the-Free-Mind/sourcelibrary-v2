#!/usr/bin/env python3
# PRIOR ART: scripts/eval/nalanda-readiness/indic_align.py — locates a Pali/Sanskrit page in GRETIL by
# 12-char window retrieval and scores OCR accuracy; it returns a GRETIL FILE and a char span, not the
# SuttaCentral segment ids that carry a CC0 English. This is the same retrieval idea over SuttaCentral's
# bilara-data (Mahāsaṅgīti root, CC0) so the located span maps segment-for-segment onto Sujato's
# (sutta) / Brahmali's (vinaya) English, both CC0 (bilara-data LICENSE.md).
"""align-pali.py --bilara <bilara-data checkout> --cands <candidates.jsonl> --out <refs.jsonl> [--per-book 1]

For each candidate page: normalise (NFC, lower, ṁ→ṃ, letters only, no spaces), 10-char shingles of the
page vs 10-char shingles of every root segment (stride 3), densest run of hit segments → segment span,
coverage = located root chars / page body chars. Keeps the first candidate per book with coverage ≥ 0.6
and hit density ≥ 0.2 (on the body above the apparatus rule), and writes the reference = the English segments of the span plus 3 segments of
context either side (marked), with segment ids, source file paths and licence.
"""
import json, os, re, sys, glob, unicodedata, argparse, collections
ap = argparse.ArgumentParser()
ap.add_argument('--bilara'); ap.add_argument('--cands'); ap.add_argument('--out'); ap.add_argument('--per-book', type=int, default=1)
# --scope book=prefix,...: restrict a book to segment ids with that prefix, where the book's own title says which
# text it is and a commentary or a parallel sutta that quotes the same formulas would otherwise win (Snp verses
# quoted in the Mahāniddesa; the satipaṭṭhāna formulas shared by DN 22 / MN 10 / MN 118)
ap.add_argument('--scope', default='')
a = ap.parse_args()
K = 10
# Sinhala-script Pali (BJT print, Sri Lankan ola-leaf MSS) → diacritic-free Latin, for retrieval only
SI_V = dict(zip('අආඇඈඉඊඋඌඍඑඒඔඕ', ['a','a','a','a','i','i','u','u','r','e','e','o','o'])); SI_V.update({'ඓ': 'ai', 'ඖ': 'au'})
SI_C = dict(zip('කඛගඝඞඟචඡජඣඤඥටඨඩඪණඬතථදධනඳපඵබභමඹයරලවශෂසහළෆ',
    ['k','kh','g','gh','n','ng','c','ch','j','jh','n','jn','t','th','d','dh','n','nd','t','th','d','dh','n','nd','p','ph','b','bh','m','mb','y','r','l','v','s','s','s','h','l','f']))
SI_S = {'ා': 'a', 'ැ': 'a', 'ෑ': 'a', 'ි': 'i', 'ී': 'i', 'ු': 'u', 'ූ': 'u', 'ෘ': 'r', 'ෙ': 'e', 'ේ': 'e', 'ෛ': 'ai', 'ො': 'o', 'ෝ': 'o', 'ෞ': 'au'}
def sinhala_to_latin(s):
    s = unicodedata.normalize('NFC', s).replace('\u200d', '')
    out = []
    for ch in s:
        if ch in SI_C: out.append(SI_C[ch] + 'a')
        elif ch in SI_S and out and out[-1].endswith('a'): out[-1] = out[-1][:-1] + SI_S[ch]
        elif ch == '්' and out and out[-1].endswith('a'): out[-1] = out[-1][:-1]
        elif ch in SI_V: out.append(SI_V[ch])
        elif ch == 'ං': out.append('m')
        elif ch == 'ඃ': out.append('h')
        else: out.append(ch)
    return ''.join(out)
def norm(s):
    if re.search('[\u0d80-\u0dff]', s): s = sinhala_to_latin(s)
    # retrieval key: diacritics folded away (old PTS â/î/û, ṃ/ṁ/ŋ/m, ṅ/n all collapse), letters only
    s = unicodedata.normalize('NFD', s.lower().replace('ŋ', 'm'))
    s = ''.join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r'[^a-z]', '', s)
def strip_tags(s):
    s = re.sub(r'<(header|page-num|footnote|footnotes|meta|warning|scan-quality|language|script|page-type|vocab|image-desc)[^>]*>.*?</\1>', ' ', s, flags=re.S)
    return re.sub(r'<[^>]+>', ' ', s)
segs = []  # (sid, norm_text, root_file)
for f in sorted(glob.glob(os.path.join(a.bilara, 'root/pli/ms/**/*_root-pli-ms.json'), recursive=True)):
    for sid, txt in json.load(open(f)).items():
        segs.append((sid, norm(txt), os.path.relpath(f, a.bilara)))
print('segments', len(segs), file=sys.stderr)
index = collections.defaultdict(list)
for i, (sid, t, _) in enumerate(segs):
    for j in range(0, max(1, len(t) - K + 1), 3):
        index[t[j:j + K]].append(i)
print('shingles', len(index), file=sys.stderr)
# English: translation file next to the root file
def en_file(root_file):
    rel = root_file.replace('root/pli/ms/', '').replace('_root-pli-ms.json', '')
    for tr in ('translation/en/sujato/', 'translation/en/brahmali/'):
        cand = glob.glob(os.path.join(a.bilara, tr + rel + '_translation-en-*.json'))
        if cand: return cand[0]
    return None
en_cache = {}
def english(sid, root_file):
    f = en_file(root_file)
    if not f: return None, None
    if f not in en_cache: en_cache[f] = json.load(open(f))
    return en_cache[f].get(sid), os.path.relpath(f, a.bilara)

cands = [json.loads(l) for l in open(a.cands)]
SCOPE = dict(kv.split('=') for kv in a.scope.split(',') if kv)
kept = collections.Counter(); out = open(a.out, 'w'); report = []
for c in cands:
    if kept[c['book_id']] >= a.per_book: continue
    # the apparatus (below the first '---' rule) is not in the root text: locate on the body only
    body = norm(strip_tags(re.split(r'\n-{3,}\s*\n', c['ocr'])[0]))
    if len(body) < 400: report.append((c['book_id'], c['page_number'], f'body {len(body)} chars, skipped')); continue
    hits = collections.Counter()
    for j in range(0, len(body) - K + 1):
        post = index.get(body[j:j + K], ())
        # idf weight: a stock formula found in 300 suttas says little about which one this page is
        for i in post[:400]: hits[i] += 1 / len(post)
    if c['book_id'] in SCOPE:
        hits = collections.Counter({i: v for i, v in hits.items() if segs[i][0].startswith(SCOPE[c['book_id']])})
    if not hits: report.append((c['book_id'], c['page_number'], 'no hits')); continue
    # densest run: contiguous segment indices with hits, gaps ≤ 4 segments
    top = sorted(hits)
    runs, cur = [], [top[0]]
    for i in top[1:]:
        if i - cur[-1] <= 4 and segs[i][2] == segs[cur[-1]][2] or (i - cur[-1] <= 2): cur.append(i)
        else: runs.append(cur); cur = [i]
    runs.append(cur)
    best = max(runs, key=lambda r: sum(hits[i] for i in r))
    # trim the run's tails to the segments that carry 95% of its hits (stock formulas recur in
    # neighbouring suttas and stretch a run far beyond the page)
    tot = sum(hits[i] for i in best); acc = 0; lo = best[0]
    for i in best:
        acc += hits[i]
        if acc >= 0.025 * tot: lo = i; break
    acc = 0; hi = best[-1]
    for i in reversed(best):
        acc += hits[i]
        if acc >= 0.025 * tot: hi = i; break
    span_chars = sum(len(segs[i][1]) for i in range(lo, hi + 1))
    score = sum(hits[i] for i in best)
    raw = sum(1 for j in range(0, len(body) - K + 1) if body[j:j + K] in index)
    coverage = span_chars / len(body); density = raw / max(1, len(body) - K + 1)  # share of page shingles found anywhere in the root text
    ok = coverage >= 0.6 and density >= 0.2
    report.append((c['book_id'], c['page_number'], f'{segs[lo][0]}..{segs[hi][0]} cov {coverage:.2f} dens {density:.2f} {"OK" if ok else "-"}'))
    if not ok: continue
    ctx_lo, ctx_hi = max(0, lo - 3), min(len(segs) - 1, hi + 3)
    lines, files, missing = [], set(), 0
    for i in range(ctx_lo, ctx_hi + 1):
        sid, _, rf = segs[i]
        en, ef = english(sid, rf)
        if ef: files.add(ef)
        if en is None: missing += 1; continue
        if not en.strip(): continue
        mark = '' if lo <= i <= hi else '[context] '
        lines.append(f'{mark}{en.strip()}')
    if missing > (ctx_hi - ctx_lo + 1) * 0.3: report[-1] = report[-1][:2] + (report[-1][2] + ' NO-ENGLISH',); continue
    kept[c['book_id']] += 1
    out.write(json.dumps({'id': f"{c['book_id']}_{str(c['page_number']).zfill(5)}", 'lang': 'Pali', 'book_id': c['book_id'], 'page_number': c['page_number'], 'title': c['title'],
        'segments': [segs[lo][0], segs[hi][0]], 'root_files': sorted({segs[i][2] for i in range(lo, hi + 1)}), 'en_files': sorted(files),
        'coverage': round(coverage, 3), 'density': round(density, 3),
        'reference': '\n'.join(lines), 'reference_source': 'SuttaCentral bilara-data (published branch): Mahāsaṅgīti root; English by Bhikkhu Sujato (suttas) / Bhikkhu Brahmali (Vinaya)',
        'reference_licence': 'CC0 1.0 (bilara-data LICENSE.md: "All translations created in Bilara … dedicated to the Public Domain by means of CC0")'}, ensure_ascii=False) + '\n')
for r in report: print(*r)
print('kept', sum(kept.values()), 'books', len(kept))
