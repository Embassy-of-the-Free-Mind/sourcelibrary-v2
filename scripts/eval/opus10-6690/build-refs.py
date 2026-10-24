#!/usr/bin/env python3
# PRIOR ART: the #6545 references (/root/pareto-6182/xl/records.jsonl reference_text, hand-located per page by
# scripts/eval/pareto-6182/load-xl.mjs's tracks) cover ONE page per book. #6690 needs the 9 pages after each, and
# no committed tool aligns a published translation to a run of pages, so this does it: the anchor keeps its #6545
# reference; every other page gets a slice of the same published text.
"""
build-refs.py — $0, no model call. Writes $W/refs.json {uid: {text, how}} (PRIVATE: published text; never commit).

- Anchor page: the #6545 reference_text, unchanged.
- Hebrew (Sefer ha-Yirah): the 1627 print orders sections differently from Kerber's Vilna-based translation, so
  each page gets the Kerber sections it holds, listed by hand below from reading the page against the translation.
- Persian, Sanskrit, Chinese, Greek: the published text from the anchor to past the run's last page is the
  window. Each page's slice is found by word overlap with BOTH arms' English for that page (pooled, so neither arm
  is favoured), the expected length from the run's reference/translation word ratio, then widened by 40% of that
  length at each end. The judge is told the excerpt may run into the neighbouring pages.
"""
import json, os, re, html, sys
from collections import Counter

W = os.environ.get('W6690', os.path.join(os.environ.get('JOB_SCRATCH', '/tmp'), 'w'))
read = lambda p: [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]
norm = lambda s: re.sub(r'\s+', ' ', s)
# window [start, end) in the whitespace-normalised source, chosen by reading where the run begins and ends
WINDOWS = {'fa': ('gulistan.txt', 211000, 234000), 'sa': ('artha.txt', 166900, 190400),
           'zh': ('sanguo.txt', 95900, 113700), 'grc': ('republic.txt', 1080400, 1096300)}
HE = {38: [236, 237, 238, 239, 256, 254, 234, 235], 39: [243, 244, 246, 239, 240, 242], 40: [247, 248, 249, 250],
      41: [250, 251, 252, 253], 42: [253, 257, 258, 259, 260, 261, 262], 43: [263, 264, 265, 266, 267],
      44: [268, 269, 270, 271, 272, 273], 45: [276, 277, 278, 279, 280, 281, 282, 274, 275], 46: [282, 283, 284, 285, 286]}
STOP = set('the and that this with from have which they their them then there were what when will would shall should '
           'into upon your yours unto been also more than such some only very said says thou thee thine hath doth '
           'other these those whom whose where while about after before because being does each every here himself '
           'itself like most much must never nothing over same since through under until well whether'.split())
MARGIN = 0.4


def words(t):
    t = re.sub(r'<(summary|keywords|note|meta|image-desc|vocab)[^>]*>[\s\S]*?</\1>', ' ', t)
    t = re.sub(r'<[^>]+>', ' ', t)
    return [w for w in re.findall(r"[a-zA-Z]+", t.lower()) if len(w) > 3 and w not in STOP]


def yirah():
    v = json.load(open(f'{W}/refsrc/yirah.json'))['versions'][0]['text']
    def clean(s):
        s = re.sub(r'<sup class="footnote-marker">[^<]*</sup>', '', s)
        # footnotes may nest <i>; drop the whole <i class="footnote">…</i> balanced
        while True:
            m = re.search(r'<i class="footnote">', s)
            if not m: break
            depth, i = 0, m.start()
            for t in re.finditer(r'<i\b[^>]*>|</i>', s[m.start():]):
                depth += 1 if not t.group(0).startswith('</') else -1
                if depth == 0: s = s[:m.start()] + s[m.start() + t.end():]; break
            else: s = s[:m.start()]; break
        return norm(html.unescape(re.sub(r'<[^>]+>', '', s.replace('<br>', ' ')))).strip()
    return {225 + i: clean(s) for i, s in enumerate(v)}


def main():
    pages = read(f'{W}/pages.jsonl')
    recs = {r['id']: r for r in read('/root/pareto-6182/xl/records.jsonl')}
    o1 = {r['uid']: r['text'] for r in read(f'{W}/arms/O1.jsonl') if r.get('text')}
    for r in read('/mnt/HC_Volume_105839809/jobs/pro-translate-6545/w/arms/OPUS.jsonl'):
        if r.get('text'): o1.setdefault(r['uid'], r['text'])
    o10 = {}
    for r in read(f'{W}/arms/O10.jsonl'):
        if r.get('pages_text'): o10.update(r['pages_text'])
    refs = {}
    Y = yirah()
    for run in ['fa', 'sa', 'zh', 'grc', 'he']:
        P = [p for p in pages if p['run'] == run]
        for p in P:
            if p['anchor']:
                refs[p['uid']] = {'text': recs[p['uid']]['reference_text'], 'how': '#6545 reference, unchanged'}
        if run == 'he':
            for p in P:
                if p['anchor']: continue
                secs = HE[p['page_number']]
                refs[p['uid']] = {'text': '\n'.join(f'§{n}. {Y[n]}' for n in secs),
                                  'how': f'Kerber sections {secs}, by hand (recension order differs)'}
            continue
        f, a, b = WINDOWS[run]
        T = norm(open(f'{W}/refsrc/{f}', encoding='utf-8', errors='replace').read())[a:b]
        toks = [(m.start(), m.group(0).lower()) for m in re.finditer(r"[a-zA-Z]+", T)]
        content = [(i, w) for i, w in toks if len(w) > 3 and w not in STOP]
        tw = {p['uid']: words(o1.get(p['uid'], '')) + words(o10.get(p['uid'], '')) for p in P}
        ratio = len(content) / max(1, sum(len(v) for v in tw.values()) / 2)
        for p in P:
            if p['anchor']: continue
            bag = Counter(tw[p['uid']]); L = max(20, int(len(tw[p['uid']]) / 2 * ratio))
            best, bi = -1, 0
            for s in range(0, max(1, len(content) - L), 5):
                win = Counter(w for _, w in content[s:s + L])
                sc = sum(min(c, bag[w]) for w, c in win.items())
                if sc > best: best, bi = sc, s
            lo = max(0, bi - int(MARGIN * L)); hi = min(len(content) - 1, bi + L + int(MARGIN * L))
            refs[p['uid']] = {'text': T[content[lo][0]:content[hi][0] + 20].strip(),
                              'how': f'slice of {f} [{a + content[lo][0]}, {a + content[hi][0] + 20}) by pooled-arm word overlap ({best} matches, L={L}), ±{int(MARGIN * 100)}%'}
    json.dump(refs, open(f'{W}/refs.json', 'w'), ensure_ascii=False, indent=1)
    for u, r in refs.items(): print(u[-5:], len(r['text']), r['how'][:110])


if __name__ == '__main__':
    main()
