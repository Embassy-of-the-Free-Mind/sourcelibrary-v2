"""On NT pages classified right-passage (A/B), what kind of word errors are they? An OCR engine makes letter-shape
errors (small edit distance within a word); a model reciting from memory substitutes whole words (synonyms, other
readings). Report the share of substitutions that are near-misses (<=2 chars) vs whole-word replacements."""
import json, re, difflib, collections
import importlib.util
spec = importlib.util.spec_from_file_location('al', '/Users/dereklomas/sourcelibrary/.claude/worktrees/syriac-vs-published/scripts/eval/syriac-vs-published/align.py')
al = importlib.util.module_from_spec(spec); spec.loader.exec_module(al)
from rapidfuzz.distance import Levenshtein
D = '/Users/dereklomas/sourcelibrary/scratchpad/syriac-vs-published'
verses = {}
order = []
for l in open(f'{D}/ref/peshitta-verses.jsonl'):
    d = json.loads(l); k = f"{d['b']} {d['ch']}:{d['v']}"; verses[k] = al.norm(d['t']); order.append(k)
oi = {k: i for i, k in enumerate(order)}
pages = {json.loads(l)['pn']: json.loads(l) for l in open(f'{D}/pages/69920b97e0a548a13d8840d5.jsonl')}
near = whole = eq = ins = dele = 0; examples = []
n_pages = 0
for l in open(f'{D}/out/nt-page-classes.tsv'):
    f = l.rstrip('\n').split('\t')
    if f[1] not in ('A-right-passage-cer<=10', 'B-right-passage-cer10-50'): continue
    pn = int(f[0]); a, b = f[2].split(' .. ')
    ref = ' '.join(verses[order[i]] for i in range(max(0, oi[a] - 1), min(len(order), oi[b] + 2)))
    page = al.norm(pages[pn]['ocr'])
    # restrict ref to the best-matching substring (same as align.py)
    from rapidfuzz import fuzz
    if len(page) < len(ref):
        x = fuzz.partial_ratio_alignment(page, ref); ref = ref[x.dest_start:x.dest_end]
    rw, pw = ref.split(), page.split()
    sm = difflib.SequenceMatcher(a=rw, b=pw, autojunk=False)
    n_pages += 1
    for t, i1, i2, j1, j2 in sm.get_opcodes():
        if t == 'equal': eq += i2 - i1
        elif t == 'insert': ins += j2 - j1
        elif t == 'delete': dele += i2 - i1
        else:
            for r, p in zip(rw[i1:i2], pw[j1:j2]):
                d = Levenshtein.distance(r, p)
                if d <= 2: near += 1
                else:
                    whole += 1
                    if len(examples) < 12 and len(r) >= 4 and len(p) >= 4: examples.append((pn, r, p))
            extra = abs((i2 - i1) - (j2 - j1))
            if (i2 - i1) > (j2 - j1): dele += extra
            else: ins += extra
tot = eq + near + whole + dele
print(f'pages {n_pages}; ref words {tot}: equal {eq / tot:.1%} near-miss subst(<=2 chars) {near / tot:.1%} whole-word subst {whole / tot:.1%} '
      f'deleted {dele / tot:.1%}; inserted {ins} words ({ins / tot:.1%} of ref)')
print(f'of substitutions: near-miss {near / (near + whole):.0%} vs whole-word {whole / (near + whole):.0%}')
print('whole-word examples (pn, ref -> ours):', examples)
