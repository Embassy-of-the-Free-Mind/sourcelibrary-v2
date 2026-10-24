#!/usr/bin/env python3
"""skqs-real.py — real-error items for the Chinese SKQS cell of #6871 row A (job grounding-6871a).

PRIOR ART: prep.py (this folder; locates Opus's quoted errors in a stored read). #6420 has no Opus adjudication of a
Siku quanshu leaf: its Chinese pages are 三才圖會 / 武備志 / 道藏 prints. The #5568 sealed set does have, for 36 Wenyuange
leaves, two machine reads (P = PaddleOCR-VL-1.6, the production read; L = gemini-3.1-flash-lite) and the Kanripo WYG
transcription of the same leaf (K, aligned by Dice, align.json). Here a read's errors are its differences from K, after
the #5568 variant fold (zh-skqs-5568-kanripo.mjs VARIANTS: 徳/德 …, which are graphic variants, not errors).

  skqs-real.py <skqs-raw.jsonl> <items-skqs.jsonl>

Per read (P and L of each aligned page): Han characters of the read and of K, folded, aligned with difflib.
  zh_sub  a run of the read's characters that K replaces (a different character: the fluent-wrong-word case in Han)
  zh_ins  a run in the read that K does not have, inside the aligned body (text not on the leaf)
  omissions (K has it, the read does not) have no tokens to score.
Masked: everything before K's first and after its last matched character (#5568: 28 % of K pages are shifted at an
edge, and the fold-strip 版心 line is not in K), and any line holding 四庫全書. A read longer than twice K (a loop) is
dropped. Nothing here calls a model or reads a store.
"""
import difflib, json, re, sys, unicodedata

VARIANTS = dict(zip('徳増䘮録説衞庿蔵逺嵗圎曽黄爲𤣥摠盖却卽旣敎毎靑呉别兾竒着隂恊', '德增喪錄說衛廟藏遠歲圓曾黃為玄總蓋卻即既教每青吳別冀奇著陰協'))
HAN = re.compile(r'[㐀-鿿豈-﫿\U00020000-\U0002ffff]')
MAXC = 8000


def hseq(t):
    idx = [i for i, c in enumerate(t) if HAN.match(c)]
    return idx, ''.join(VARIANTS.get(t[i], t[i]) for i in idx)


def build(raw, reader):
    text = unicodedata.normalize('NFC', raw[reader] or '').replace('　', '')[:MAXC]
    ri, rs = hseq(text)
    _, ks = hseq(unicodedata.normalize('NFC', raw['K']).replace('　', ''))
    if not ks or not rs or len(rs) > 2 * len(ks): return None
    ops = difflib.SequenceMatcher(None, rs, ks, autojunk=False).get_opcodes()
    eq = [o for o in ops if o[0] == 'equal']
    if not eq: return None
    lo, hi = eq[0][1], eq[-1][2]
    spans, masks = [], []
    for tag, a, b, _, _ in ops:
        if tag in ('replace', 'delete') and a >= lo and b <= hi and b > a:
            spans.append({'s': ri[a], 'e': ri[b - 1] + 1, 'kind': 'zh_sub' if tag == 'replace' else 'zh_ins', 'quote': rs[a:b]})
    if lo > 0: masks.append({'s': 0, 'e': ri[lo]})
    if hi < len(ri): masks.append({'s': ri[hi - 1] + 1, 'e': len(text)})
    for m in re.finditer(r'[^\n]*四庫全書[^\n]*', text): masks.append({'s': m.start(), 'e': m.end()})
    n_err = len(spans)
    return {'item': f"{raw['page_id']}__skqs_{reader}", 'page_id': raw['page_id'], 'book_id': raw['book_id'], 'group': 'skqs',
            'language': 'Classical Chinese', 'set': 'skqs-5568', 'reader': {'P': 'paddleocr-vl-1.6', 'L': 'gemini-3.1-flash-lite'}[reader],
            'image': raw['image'], 'text': text, 'spans': spans, 'masks': masks, 'n_errors': n_err, 'all_located': True,
            'stored_serious': None, 'plant': None, 'han_chars': len(rs), 'k_han_chars': len(ks)}


if __name__ == '__main__':
    out, stat = [], {'P': 0, 'L': 0, 'dropped': 0, 'spans': 0}
    for raw in map(json.loads, open(sys.argv[1])):
        for reader in ('P', 'L'):
            it = build(raw, reader)
            if not it: stat['dropped'] += 1; continue
            out.append(it); stat[reader] += 1; stat['spans'] += len(it['spans'])
    with open(sys.argv[2], 'w') as f:
        for it in out: f.write(json.dumps(it, ensure_ascii=False) + '\n')
    print(json.dumps(stat))
