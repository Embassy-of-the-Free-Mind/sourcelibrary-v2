#!/usr/bin/env python3
"""
build_pairs.py — build pairs.jsonl for the printed-edition hieroglyph OCR benchmark.

PRIOR ART: scripts/eval/build-reference-groundtruth.mjs and build-ctext-groundtruth.mjs
build page-level ground truth from Wikisource / ctext text for Latin-script and Han
corpora; neither knows Unicode Egyptian Hieroglyphs, ORAEC's token-level `hiero`
field, or plate/page citations, so a separate builder is needed. The metrics live in
score.py (see its PRIOR ART line).

Inputs
  --oraec-dir   a clone of https://github.com/oraec/corpus_raw_data (CC BY-SA 4.0)
  alignment.json (next to this script): one entry per ORAEC text, hand-verified —
                which edition, which reader page(s) / IA leaf(s), what the plate is
                labelled, and whether ORAEC cites the edition directly or as "vgl."

Ground truth. For each ORAEC text, sentences in order, tokens in order, each token's
`hiero` (Unicode). Only code points in the Egyptian Hieroglyphs block U+13000–1342F
are kept; format controls (U+13430–1345F) are dropped. A token with no `hiero`, with
the unreadable-sign placeholder ⯑, or with U+FFFD (a sign ORAEC could not encode)
breaks the ground truth into SEGMENTS: maximal runs of consecutive encodable tokens.
score.py scores each segment against the best-matching window of the model output,
so a gap in the encoding is not charged to the model.

Output: pairs.jsonl, one JSON object per pair (one ORAEC text ↔ its page image(s)).
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))

# Editions actually held by Source Library, with the identifiers a reader needs.
# Rights: all four editions are public domain (authors died before 1956; published
# 1911–1933). The ORAEC strings are CC BY-SA 4.0 (Thesaurus Linguae Aegyptiae data).
EDITIONS = {
    'urk1': {
        'title': 'Sethe, Urkunden des Alten Reichs (Urk. I), 2nd ed., Leipzig 1933',
        'book_id': '6a9afa09441bca6a13ac2510',
        'ia': 'urkunden-des-alten-reichs',
        'script_class': 'autograph',   # Sethe's hand copy, lithographed — NOT metal type
        'reader_page_of_printed': lambda p: p + 10,   # verified by eye on pp. 23, 59–68, 232–234
    },
    'htbm1': {
        'title': 'Hieroglyphic Texts from Egyptian Stelae &c. in the British Museum, Part I, London 1911',
        'book_id': '69e02e8b1dae13995358966e',   # catalogued as "Part X" — the title page says Part I (56 plates)
        'ia': 'hieroglyphicpt100brituoft',
        'script_class': 'line-drawing',   # hand-drawn facsimile plates
    },
    'htbm2': {
        'title': 'Hieroglyphic Texts from Egyptian Stelae &c. in the British Museum, Part II, London 1912',
        'book_id': '69e02e5d1dae139953589503',   # catalogued as "Part III" — the title page says Part II (50 plates)
        'ia': 'hieroglyphictext02brituoft',
        'script_class': 'line-drawing',
    },
    'htbm4': {
        'title': 'Hieroglyphic Texts from Egyptian Stelae &c. in the British Museum, Part IV, London 1913',
        'book_id': '69e013b193b116d24238b35c',
        'ia': 'hieroglyphictext04brit',
        'script_class': 'line-drawing',
    },
    'htbm5': {
        'title': 'Hieroglyphic Texts from Egyptian Stelae &c. in the British Museum, Part V, London 1914',
        'book_id': '69e02e621dae13995358957c',
        'ia': 'hieroglyphictext05brituoft',
        'script_class': 'line-drawing',
    },
}

def is_glyph(ch):
    return 0x13000 <= ord(ch) <= 0x1342F

def is_fmt(ch):
    return 0x13430 <= ord(ch) <= 0x1345F

def token_signs(h):
    """Signs of one token, or None if the token is unusable as ground truth."""
    if not h or '⯑' in h or '�' in h:
        return None
    s = ''.join(ch for ch in h if is_glyph(ch))
    if any(not (is_glyph(ch) or is_fmt(ch) or ch.isspace()) for ch in h):
        return None   # something outside the block we do not understand — refuse, do not guess
    return s or None

def segments_for(rec):
    """Maximal runs of encodable tokens, in reading order, as sign strings."""
    segs, cur = [], ''
    n_tok = n_ok = 0
    for sent in rec.get('sentences', []):
        for tok in sent.get('token', []):
            n_tok += 1
            s = token_signs(tok.get('hiero'))
            if s is None:
                if cur: segs.append(cur); cur = ''
                continue
            n_ok += 1
            cur += s
    if cur: segs.append(cur)
    return segs, n_tok, n_ok

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--oraec-dir', required=True)
    ap.add_argument('--alignment', default=os.path.join(HERE, 'alignment.json'))
    ap.add_argument('--out', default=os.path.join(HERE, 'pairs.jsonl'))
    ap.add_argument('--min-signs', type=int, default=20)
    a = ap.parse_args()

    align = json.load(open(a.alignment))['entries']
    out = open(a.out, 'w')
    kept = dropped = 0
    per_ed = {}
    for e in align:
        oid = e['oraec_id']
        rec = json.load(open(os.path.join(a.oraec_dir, oid + '.json')))[oid]
        ed = EDITIONS[e['edition']]
        segs, n_tok, n_ok = segments_for(rec)
        signs = sum(len(s) for s in segs)
        if signs < a.min_signs:
            dropped += 1
            continue
        pages = []
        for p in e['pages']:
            reader = p['reader']
            leaf = p.get('ia_leaf', reader - 1)   # Source Library page N is IA access leaf n(N-1) unless verified otherwise
            pages.append({
                'reader': reader,
                'reader_url': f"https://sourcelibrary.org/book/{ed['book_id']}?page={reader}",
                'image_url': f"https://archive.org/download/{ed['ia']}/page/n{leaf}/full/full/0/default.jpg",
                'fallback_image_url': f"https://images.sourcelibrary.org/pages/{ed['book_id']}/{reader:04d}.jpg",
                'label': p.get('label', ''),
            })
        pair = {
            'pair_id': f"{e['edition']}-{oid}",
            'edition': e['edition'],
            'edition_title': ed['title'],
            'book_id': ed['book_id'],
            'script_class': ed['script_class'],
            'edition_ref': e['edition_ref'],
            'citation_kind': e.get('citation_kind', 'direct'),
            'page_exclusive': bool(e.get('page_exclusive', False)),
            'focus': e.get('focus', ''),
            'pages': pages,
            'oraec_id': oid,
            'tla_title': rec.get('title', ''),
            'gt_segments': segs,
            'gt': ' '.join(segs),
            'sign_count': signs,
            'token_count': n_tok,
            'token_coverage': round(n_ok / n_tok, 3) if n_tok else 0,
            'notes': e.get('notes', ''),
            'gt_license': 'CC BY-SA 4.0 (ORAEC / Thesaurus Linguae Aegyptiae)',
        }
        out.write(json.dumps(pair, ensure_ascii=False) + '\n')
        kept += 1
        per_ed[e['edition']] = per_ed.get(e['edition'], 0) + 1
    out.close()
    print(f'pairs written: {kept}  dropped (< {a.min_signs} signs): {dropped}  by edition: {per_ed}')

if __name__ == '__main__':
    main()
