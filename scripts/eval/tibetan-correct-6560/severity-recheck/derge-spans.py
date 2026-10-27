#!/usr/bin/env python3
# PRIOR ART: scripts/eval/route-judge-6740/tib-derge.py (PR #7465) places a folio in Derge and scores a whole read's
# identity; score.py's recitation check (#6560, 2026-10-12) asks a judge which reading the leaf shows for spans that
# moved TOWARD Derge. Neither says, for ONE span, which of two readings Derge carries. This reuses tib-derge.py's
# locate + window and alignpairs' tokeniser, and adds a local alignment of each reading in its context.
"""Which reading of a span does the Derge Kangyur carry? (#6560 severity re-check, step 2)

  python3 derge-spans.py locate --p1 P1 --texts DRAFTS.json hunks-7505.jsonl.gz LOC.jsonl   place each page's DRAFT
  python3 derge-spans.py spans  --p1 P1 hunks-7505.jsonl.gz LOC.jsonl OUT.jsonl

For each draft-win span (the span judge saw the draft on the leaf) of class severe, the two readings are put in their
context (up to 4 syllables before and after, from the corrected text) and aligned locally (Smith-Waterman, +1/-1/-1)
to the page's Derge window (imgnum +- 2). delta = score(arm) - score(draft).
  arm=Derge     delta >= 2 and the arm's context aligns at >= 60% of its length: Derge has the corrector's text
                while the judge saw the draft on the leaf -> supplied from memory / recitation
  draft=Derge   delta <= -2 and the draft's context aligns at >= 60%: the corrector broke text Derge agrees with
  neither       otherwise (Derge has a third reading, or the passage is not in the window)
  not placed    the page's draft does not place in Derge (fewer than 3 votes or identity < 0.5)
"""
import gzip, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '../../route-judge-6740'))
sys.path.insert(0, HERE)
import importlib.util
spec = importlib.util.spec_from_file_location('tibderge', os.path.join(HERE, '../../route-judge-6740/tib-derge.py'))
td = importlib.util.module_from_spec(spec); spec.loader.exec_module(td)
from classify import classify, load_hand

syl = td.syllables


def local(q, w):
    """Best local alignment score of q in w (+1 match, -1 mismatch, -1 gap)."""
    if not q:
        return 0
    prev = [0] * (len(w) + 1); best = 0
    for i in range(1, len(q) + 1):
        cur = [0] * (len(w) + 1)
        for j in range(1, len(w) + 1):
            cur[j] = max(0, prev[j - 1] + (1 if q[i - 1] == w[j - 1] else -1), prev[j] - 1, cur[j - 1] - 1)
            if cur[j] > best: best = cur[j]
        prev = cur
    return best


def main():
    cmd, p1 = sys.argv[1], td.arg('--p1')
    flagvals = {sys.argv[i + 1] for i, a in enumerate(sys.argv[:-1]) if a.startswith('--')}
    pos = [a for a in sys.argv[2:] if not a.startswith('--') and a not in flagvals]
    rows = [json.loads(l) for l in gzip.open(pos[0], 'rt', encoding='utf-8')]
    if cmd == 'locate':
        # --texts: {uid: Yigdzin draft} (#7505's req/drafts.jsonl); the draft, not a correction, places the page
        texts = json.load(open(td.arg('--texts')))
        want = sorted({r['uid'] for r in rows if r['variant'] == 'A'})
        out = td.locate(p1, [{'key': u, 'text': texts[u]} for u in want if u in texts])
        with open(pos[1], 'w', encoding='utf-8') as f:
            for x in out: f.write(json.dumps(x, ensure_ascii=False) + '\n')
        return
    loc = {x['key']: x for x in map(json.loads, open(pos[1], encoding='utf-8'))}
    hand = load_hand()
    seen, out = set(), []
    for r in rows:
        if r['variant'] not in ('A', 'B', 'C'):
            continue
        for h in r.get('all_hunks') or []:
            if h['side'] != 'base':
                continue
            c = classify(h['base'] or '', h['arm'] or '', hand)
            if c['class'] != 'severe':
                continue
            k = (r['uid'], h['id'])
            if k in seen:
                continue
            seen.add(k)
            L = loc.get(r['uid']) or {}
            row = {'uid': r['uid'], 'variant': r['variant'], 'group': r['group'], 'page_number': r['page_number'], 'book_id': r['book_id'],
                   'id': h['id'], 'base': h['base'], 'arm': h['arm'], 'sub': c['sub'], 'confirm': h.get('confirm'), 'seen': h.get('seen'),
                   'vol': L.get('vol'), 'imgnum': L.get('imgnum'), 'page_identity': L.get('identity')}
            if not L.get('vol') or (L.get('votes') or 0) < 3 or (L.get('identity') or 0) < 0.5:
                row['derge'] = 'not placed'; out.append(row); continue
            w = td.window(p1, L['vol'], L['imgnum'])
            bef, aft = syl(h['before'] or '')[-4:], syl(h['after'] or '')[:4]
            qa, qb = bef + syl(h['arm'] or '') + aft, bef + syl(h['base'] or '') + aft
            sa, sb = local(qa, w), local(qb, w)
            d = sa - sb
            row.update({'score_arm': sa, 'score_draft': sb, 'len_arm': len(qa), 'len_draft': len(qb)})
            row['derge'] = ('arm=Derge' if d >= 2 and sa >= 0.6 * len(qa) else
                            'draft=Derge' if d <= -2 and sb >= 0.6 * len(qb) else 'neither')
            out.append(row)
    with open(pos[2], 'w', encoding='utf-8') as f:
        for x in out: f.write(json.dumps(x, ensure_ascii=False) + '\n')
    from collections import Counter
    print(Counter((x['sub'], x['derge']) for x in out))


if __name__ == '__main__':
    main()
