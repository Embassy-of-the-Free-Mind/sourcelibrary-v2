"""Build one planted edition excerpt per located leaf for the multi-leaf collation test (#5935).

PRIOR ART: ../collation-edition-with-4-plants.txt — the one-leaf pilot, planted by hand; this
generalises it to ten leaves with random positions and four error kinds.

Inputs : sk.json (GRETIL Sāṃkhyakārikā, verse -> text; data entry Ferenc Ruzsa, GRETIL, CC BY-NC-SA 4.0,
         sa_IzvarakRSNa-sAMkhyakArikA), locate/<leaf>.txt (Opus locate pass:
         per manuscript line, the first and last edition word visible on the left half).
Outputs: editions/<leaf>.txt (what the models see), plants.json (what was planted; never shown
         to the models), spans.json (which edition tokens the locate pass put on the half-leaf).

Plants go only on tokens inside a located line span, never on a span's first or last token
(those are often cut at the crop edge), never on a token carrying a GRETIL note digit.
Run: python3 plant.py   (seeded; re-running reproduces the same plants)
"""
import json, random, re, unicodedata
from pathlib import Path

HERE = Path(__file__).parent
SK = {int(k): v for k, v in json.loads((HERE / 'sk.json').read_text()).items()}
# Skipped: 7b, 9b, 10t (the locate pass placed them out of sequence or not at all), 10b (two
# located lines, room for one plant), 11t/11b (commentary that follows the verses).
LEAVES = ['4b', '5t', '5b', '6t', '6b', '7t', '8t', '8b', '9t']
KINDS = ['near_homograph', 'substitution', 'wrong_plausible', 'omission']
rng = random.Random(5935)


def norm(s):
    s = unicodedata.normalize('NFC', s.lower())
    s = re.sub(r"[\-'`’‘.\^\d\s()?*…,;:\"]", '', s)
    return s.replace('ṃ', 'm').replace('ḥ', '')


def tokens():
    out = []  # (verse, line_no_in_verse, token)
    for v in sorted(SK):
        lines = re.sub(r'\s*SK_\d+\s*$', '', SK[v]).split('\n')
        for li, line in enumerate(lines):
            for t in line.split():
                out.append((v, li, t))
    return out


TOK = tokens()


def find(word, verses, start):
    w = norm(word.split('(')[0])
    if len(w) < 2:
        return None
    for i in range(start, len(TOK)):
        v, _, t = TOK[i]
        if v not in verses:
            continue
        nt = norm(t)
        if nt and (nt.startswith(w) or w.startswith(nt) or w in nt):
            return i
    return None


def spans_for(leaf):
    txt = (HERE / 'locate' / f'{leaf}.txt').read_text()
    spans = []
    cursor = 0
    for m in re.finditer(r'^LINE\s+(\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|', txt, re.M):
        vs = [int(x) for x in re.findall(r'SK_(\d+)', m.group(2))]
        if not vs:
            continue
        verses = set(range(min(vs), max(vs) + 1))
        a = find(m.group(3).strip(), verses, max(0, cursor - 40))
        if a is None:
            continue
        b = find(m.group(4).strip(), verses, a)
        if b is None or b - a > 14:
            continue
        spans.append((int(m.group(1)), a, b))
        cursor = b
    return spans


def plant_token(kind, tok, verse):
    if kind == 'omission':
        return ''
    if kind == 'near_homograph':
        pairs = {'n': 'v', 'v': 'n', 'p': 'ṣ', 'ṣ': 'p', 'bh': 'dh', 'dh': 'bh', 't': 'n', 'm': 'y', 'y': 'm', 'k': 'g', 'g': 'k'}
        opts = [(i, a) for a in pairs for i in range(len(tok)) if tok.startswith(a, i) and tok[i - 1:i] not in ('h',)]
        i, a = rng.choice(opts)
        return tok[:i] + pairs[a] + tok[i + len(a):]
    if kind == 'substitution':
        pool = [t for v, _, t in TOK if abs(v - verse) > 6 and not re.search(r'\d', t) and abs(len(norm(t)) - len(norm(tok))) <= 2 and norm(t) != norm(tok)]
        return rng.choice(pool)
    if kind == 'wrong_plausible':
        endings = [('ena', 'āt'), ('āt', 'ena'), ('aḥ', 'am'), ('am', 'aḥ'), ('aṃ', 'aḥ'), ('āḥ', 'ā'), ('as', 'am'), ('ān', 'āt'), ('i', 'a'), ('iḥ', 'im'), ('ḥ', 'ṃ')]
        opts = [(a, b) for a, b in endings if tok.rstrip(".'").endswith(a)]
        core = tok.rstrip(".'")
        tail = tok[len(core):]
        if opts and rng.random() < 0.6:
            a, b = rng.choice(opts)
            return core[:-len(a)] + b + tail
        return tok[2:] if tok.startswith('a-') else 'a-' + tok  # negation flip
    raise ValueError(kind)


def main():
    (HERE / 'editions').mkdir(exist_ok=True)
    plants, spans_out = {}, {}
    for leaf in LEAVES:
        sp = spans_for(leaf)
        spans_out[leaf] = [{'line': ln, 'from': TOK[a][2], 'to': TOK[b][2], 'verses': sorted({TOK[i][0] for i in range(a, b + 1)})} for ln, a, b in sp]
        cand = {}
        for ln, a, b in sp:
            for i in range(a + 1, b):
                t = TOK[i][2]
                if not re.search(r'\d', t) and len(norm(t)) >= 4:
                    cand.setdefault(ln, []).append(i)
        n = 4
        lines = list(cand)
        rng.shuffle(lines)
        chosen = []
        for ln in lines:
            if len(chosen) == n:
                break
            chosen.append(rng.choice(cand[ln]))
        kinds = KINDS[:]
        rng.shuffle(kinds)
        edits = {}
        rec = []
        for i, kind in zip(sorted(chosen), kinds):
            v, _, t = TOK[i]
            if kind == 'near_homograph' and not any(c in t for c in 'nvpṣtmykgd'):
                kind = 'wrong_plausible'
            new = plant_token(kind, t, v)
            edits[i] = new
            rec.append({'verse': v, 'kind': kind, 'original': t, 'planted': new or '(omitted)'})
        verses = sorted({v for s in spans_out[leaf] for v in s['verses']})
        lo, hi = max(1, verses[0] - 2), min(73, verses[-1] + 2)
        # rebuild the excerpt verse by verse, applying the edits
        out = []
        for v in range(lo, hi + 1):
            lines_v = re.sub(r'\s*SK_\d+\s*$', '', SK[v]).split('\n')
            rebuilt = []
            for line in lines_v:
                rebuilt.append(line.split())
            # apply edits by global index
            for i, new in edits.items():
                tv, tli, tt = TOK[i]
                if tv != v:
                    continue
                pos = [k for k in range(len(TOK)) if TOK[k][0] == v and TOK[k][1] == tli].index(i)
                rebuilt[tli][pos] = new
            text = '\n'.join(' '.join(x for x in toks if x) for toks in rebuilt)
            out.append(f'{text} SK_{v}')
        (HERE / 'editions' / f'{leaf}.txt').write_text('\n\n'.join(out) + '\n')
        plants[leaf] = {'excerpt': [lo, hi], 'plants': rec}
    (HERE / 'plants.json').write_text(json.dumps(plants, ensure_ascii=False, indent=1))
    (HERE / 'spans.json').write_text(json.dumps(spans_out, ensure_ascii=False, indent=1))
    for leaf, p in plants.items():
        print(leaf, p['excerpt'], len(spans_out[leaf]), 'lines', [(x['verse'], x['kind'], x['original'], x['planted']) for x in p['plants']])


if __name__ == '__main__':
    main()
