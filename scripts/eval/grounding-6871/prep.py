#!/usr/bin/env python3
"""prep.py — turn the lane B adjudications into scored items with located bad spans (#6871 row A).

PRIOR ART: build-set.mjs (this folder; rebuilds the stored reads Opus judged). The span parse is new: nothing in
scripts/eval locates an adjudicator's quoted errors in the text it judged. scripts/batch/ocr-convergence/lib.mjs
`diffSpans` diffs two reads, which is a different label (disagreement, not error).

  prep.py <set.jsonl> <items.jsonl> [--plants plants.jsonl]

Each adjudicator error is split on ';' into parts. A part of the form  'X' — image 'Y'  is a substitution (X is in
the stored read; Y is what the leaf shows). Kinds, fixed before scoring (PREREGISTRATION.md):
  sub_char     substitution with char edit ratio <= 0.34 (a perceptual slip: ſ/f, one letter, an accent)
  sub_lexical  substitution with ratio  > 0.34 (a different word: the "fluent wrong word" this detector is for)
  invented     'invent', 'adds', 'inserts', 'not on the leaf/page/image', 'hallucinat' — quoted text located
  garbled      'garbl' — quoted text located
  omission     'drop', 'omit', 'missing', 'lacks' — the quotes are the LEAF's text; nothing to score in the read
  other        anything else — its located quotes are MASKED (neither positive nor negative)
Positives = units overlapping a located span of the first four kinds. Units overlapping an 'other' quote are masked.
The text scored is the stored read with its <detected-images> and <vocab> blocks cut (they are not page text), first
8,000 characters.
"""
import json, re, sys, unicodedata

MAXC = 8000
SUB = re.compile(r"'([^']+)'\s*(?:—|–|-{1,2}|→)\s*(?:the\s+)?(?:image|leaf|page)\s*(?:has|shows|reads)?\s*:?\s*'([^']*)'")
QUOTE = re.compile(r"'([^']+)'")
HAN = re.compile(r'[㐀-鿿豈-﫿\U00020000-\U0002ffff]')


def clean(t):
    t = unicodedata.normalize('NFC', t or '')
    t = re.sub(r'<detected-images>.*?(</detected-images>|$)', '', t, flags=re.S)
    t = re.sub(r'<vocab>.*?(</vocab>|$)', '', t, flags=re.S)
    return t.strip()[:MAXC]


def norm_map(t):
    """normalised string + index map back into t: ſ→s, markdown marks dropped, whitespace runs → one space"""
    out, idx, sp = [], [], False
    for i, ch in enumerate(t):
        if ch in '*_#`|':
            continue
        if ch.isspace():
            if not sp and out:
                out.append(' '); idx.append(i)
            sp = True; continue
        sp = False
        out.append('s' if ch == 'ſ' else ch); idx.append(i)
    return ''.join(out), idx


def nq(q):
    s, _ = norm_map(unicodedata.normalize('NFC', q).strip(' .,;:…'))
    return re.sub(r'\s*(\.\.\.|…)\s*', '…', s).strip()


def lev(a, b):
    if a == b: return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def kind_of(part):
    p = part.lower()
    if re.search(r'\b(drop|drops|dropped|omit|omits|omitted|missing|lacks|leaves out)\b', p): return 'omission'
    if re.search(r'invent|\badds?\b|\badded\b|insert|not on the (leaf|page|image)|hallucinat', p): return 'invented'
    if 'garbl' in p: return 'garbled'
    return 'other'


def locate(nt, idx, q):
    """all occurrences of normalised quote q in normalised text nt → char ranges in the cleaned text.
    'A … B' (an elided quote) is located as A, then B within 800 characters; 'a/b' as a, else b."""
    if '…' in q:
        bits = [b for b in q.split('…') if len(b) >= 3]
        if not bits: return []
        out = []
        for a0, a1 in locate(nt, idx, bits[0]):
            end = a1
            for b in bits[1:]:
                hit = [(x, y) for x, y in locate(nt, idx, b) if x >= a1 and x - end <= 800]
                if not hit: end = None; break
                end = hit[0][1]
            if end: out.append((a0, end))
        return out
    if '/' in q and not HAN.search(q):
        for alt in q.split('/'):
            got = locate(nt, idx, alt.strip())
            if got: return got
        return []
    out, k = [], 0
    if not q or (len(q) < 2 and not HAN.search(q)): return out
    while True:
        k = nt.find(q, k)
        if k < 0: return out
        out.append((idx[k], idx[k + len(q) - 1] + 1)); k += len(q)


def parse(errors, text):
    nt, idx = norm_map(text)
    spans, masks, st = [], [], {'parts': 0, 'located': 0, 'unlocated': 0, 'omission': 0, 'other': 0}
    for e in errors:
        for part in re.split(r';\s+', e):
            st['parts'] += 1
            subs = list(SUB.finditer(part))
            if subs:
                for m in subs:
                    x, y = nq(m.group(1)), nq(m.group(2))
                    r = lev(x, y) / max(1, len(x), len(y))
                    k = 'sub_char' if r <= 0.34 else 'sub_lexical'
                    loc = locate(nt, idx, x)
                    st['located' if loc else 'unlocated'] += 1
                    spans += [{'s': a, 'e': b, 'kind': k, 'quote': m.group(1)[:80]} for a, b in loc]
                continue
            k = kind_of(part)
            if k == 'omission':
                st['omission'] += 1; continue
            qs = [nq(q) for q in QUOTE.findall(part)]
            locs = [(q, locate(nt, idx, q)) for q in qs]
            if k == 'other':
                st['other'] += 1
                masks += [{'s': a, 'e': b} for _, loc in locs for a, b in loc]
                continue
            hit = [(q, loc) for q, loc in locs if loc]
            st['located' if hit else 'unlocated'] += 1
            spans += [{'s': a, 'e': b, 'kind': k, 'quote': q[:80]} for q, loc in hit for a, b in loc]
    return spans, masks, st


def main():
    src, dst = sys.argv[1], sys.argv[2]
    plants = sys.argv[sys.argv.index('--plants') + 1] if '--plants' in sys.argv else None
    tot = {}
    with open(dst, 'w') as fo:
        for line in open(src):
            r = json.loads(line)
            text = clean(r['text'])
            if len(text) < 40: continue
            spans, masks, st = parse(r['errors'], text)
            for k, v in st.items(): tot[k] = tot.get(k, 0) + v
            fo.write(json.dumps({'item': r['page_id'], 'page_id': r['page_id'], 'book_id': r['book_id'], 'group': r['group'],
                                 'language': r['language'], 'set': r['set'], 'image': r['image'], 'text': text,
                                 'spans': spans, 'masks': masks, 'n_errors': len(r['errors']),
                                 'all_located': st['unlocated'] == 0 and st['other'] == 0,
                                 'stored_serious': r['stored_serious'], 'plant': None}, ensure_ascii=False) + '\n')
        if plants:
            for line in open(plants):
                fo.write(line if line.endswith('\n') else line + '\n')
    print(json.dumps(tot))


if __name__ == '__main__':
    main()
