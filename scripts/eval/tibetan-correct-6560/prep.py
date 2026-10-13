#!/usr/bin/env python3
# PRIOR ART: scripts/eval/replicate-6547/prep.py (branch job-replicate-6547: Greif requests + planted-error anchoring
# on a German print set; its plant() works on words and digits, not Tibetan syllables) and
# scripts/eval/tibetan-proofread/ (the 30-folio Kangyur set + ported kanjur_align scorer; it scores against a human
# correction, not Derge, and builds no model requests). This builds the #6560 requests on that set.
"""
Build the #6560 Tibetan correction test: 30 Kangyur folios (tibetan-proofread-2026-10 manifest, stratum kangyur).

  python3 scripts/eval/tibetan-correct-6560/prep.py --root $JOB_SCRATCH [--index /root/tibetan-eval/etext-index-full.pkl]

Writes
  scripts/eval/results/tibetan-correct-6560/derge-windows.json.gz  per folio: the Derge e-text syllables of
      (derge_vol, derge_imgnum ± 2), the same window kanjur_align.py scored the served read against (the manifest's
      derge_identity is reproduced from it and checked here);
  scripts/eval/results/tibetan-correct-6560/plants.json  the anchoring key: 10 folios × 3 syllables planted in the draft;
  <root>/img/<id>.jpg  the page image (archived BL master, else the display copy);
  <root>/req/{redo,corr,corr-anchor}.jsonl  {uid, image, prompt}; the same prompt goes to Opus and to Pro.
"""
import argparse, gzip, json, os, pickle, random, sys, unicodedata, urllib.request, re

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
MANIFEST = os.path.join(REPO, 'scripts/eval/results/tibetan-proofread-2026-10/manifest.jsonl')
OUT = os.path.join(REPO, 'scripts/eval/results/tibetan-correct-6560')
sys.path.insert(0, '/root/tibetan-eval')

# cli-chatter.mjs OCR_SENTINEL_INSTRUCTION (#6523), as in replicate-6547/prep.py
SENT = ('Write the transcription between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the '
        'markers: no preamble, no plan, no summary, no offers, no questions.')

COMMON = ('The image is one frame of a Tibetan Kangyur manuscript held by the British Library. A frame may show two '
          'leaves, one above the other; transcribe the upper leaf first, then the lower one. Write the Tibetan in '
          'Unicode (Uchen script), one output line for each line of the manuscript, keeping the folio\'s line breaks. '
          'Transcribe exactly what the manuscript shows, syllable by syllable, including its own spellings and '
          'variant readings. Do not normalise to any printed edition and do not supply text that is not on the '
          'leaf; where a syllable cannot be read, give your best reading of what is visible. Leave out page '
          'numbers and marginal labels.')

REDO = 'Transcribe the Tibetan text in this manuscript image.\n\n' + COMMON + '\n\n' + SENT

CORR = ('Below is a draft transcription of this manuscript image, made by an OCR system. The draft may contain errors. '
        'Compare the draft with the image line by line and correct it only where the image differs from the draft; '
        'where they agree, keep the draft exactly as it is. If the draft has a line <leaf-break/> between the two '
        'leaves, keep it.\n\n' + COMMON + '\n\n' + SENT + '\n\nDraft:\n{draft}')

TSHEG = '་'
# visually close Uchen letters; a planted error swaps one root letter for its neighbour (absent from the image)
SWAP = {'བ': 'པ', 'པ': 'བ', 'ད': 'ང', 'ང': 'ད', 'མ': 'ས', 'ས': 'མ', 'ཏ': 'ད', 'ག': 'ཀ', 'ཀ': 'ག', 'ན': 'ཏ',
        'ཙ': 'ཚ', 'ཚ': 'ཙ', 'ཞ': 'ཟ', 'ཟ': 'ཞ', 'ལ': 'ཡ', 'ཡ': 'ལ', 'ཆ': 'ཇ', 'ཇ': 'ཆ'}  # never ར→ཪ: it renders the same, so it is not a visible error
VOWEL = {'ི': 'ེ', 'ེ': 'ི', 'ུ': 'ོ', 'ོ': 'ུ'}


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 10000:
        return
    req = urllib.request.Request(url, headers={'User-Agent': 'sourcelibrary-eval/6560'})
    with urllib.request.urlopen(req, timeout=120) as r, open(path, 'wb') as f:
        f.write(r.read())


def plant(m, wsyls, rng, n=3):
    """Plant n errors into syllables the draft has RIGHT (the served syllable is aligned to an identical Derge
    syllable), one per line, on different lines: kinds letter (a root letter swapped for a look-alike), vowel (i/e,
    u/o) and swap (the syllable replaced by another syllable from the same folio). Each planted syllable must differ
    from the original and must not equal its Derge counterpart."""
    from kanjur_align import syllables
    import alignpairs
    lines = m['served_text'].split('\n')
    cand = []  # (line, char offset, syllable)
    for li, line in enumerate(lines):
        if not re.search('[ཀ-ྼ]', line) or line.strip().startswith('<'):
            continue
        for mt in re.finditer('[ཀ-ྼ]+', line):
            cand.append((li, mt.start(), mt.group()))
    served = [c[2] for c in cand]
    # the served tokens here are the same as kanjur_align syllables() of the served text, line by line
    pairs = alignpairs.align(served, wsyls)
    right = [i for i, j in pairs if i is not None and j is not None and served[i] == wsyls[j]]
    kinds = ['letter', 'vowel', 'swap']
    rng.shuffle(kinds)
    plants, used = [], set()
    from collections import Counter
    pool = sorted(x for x, c in Counter(served).items() if c >= 3)  # common syllables of this folio, so a swap reads as a plausible misread
    for k in kinds:
        for _ in range(500):
            i = rng.choice(right)
            li, off, syl = cand[i]
            if li in used or i < 3 or i > len(cand) - 4:
                continue
            if k == 'letter':
                pos = [p for p, ch in enumerate(syl) if ch in SWAP]
                if not pos:
                    continue
                p = rng.choice(pos); new = syl[:p] + SWAP[syl[p]] + syl[p + 1:]
            elif k == 'vowel':
                pos = [p for p, ch in enumerate(syl) if ch in VOWEL]
                if not pos:
                    continue
                p = rng.choice(pos); new = syl[:p] + VOWEL[syl[p]] + syl[p + 1:]
            else:
                new = rng.choice(pool)
            if new == syl or len(syllables(new)) != 1:
                continue
            used.add(li)
            plants.append({'kind': k, 'line': li, 'offset': off, 'token_index': i, 'orig': syl, 'planted': new,
                           'prev': served[i - 3:i], 'next': served[i + 1:i + 4]})
            break
    if len(plants) != n:
        raise SystemExit(f"{m['id']}: planted {len(plants)} of {n}")
    out = [list(l) for l in lines]
    for p in sorted(plants, key=lambda p: (p['line'], -p['offset'])):
        l = ''.join(out[p['line']])
        assert l[p['offset']:p['offset'] + len(p['orig'])] == p['orig']
        out[p['line']] = list(l[:p['offset']] + p['planted'] + l[p['offset'] + len(p['orig']):])
    return '\n'.join(''.join(l) for l in out), plants


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=os.environ.get('JOB_SCRATCH'))
    ap.add_argument('--index', default='/root/tibetan-eval/etext-index-full.pkl')
    ap.add_argument('--seed', type=int, default=6560)
    a = ap.parse_args()
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from kanjur_align import syllables, nw_identity, window_syllables

    rows = [json.loads(l) for l in open(MANIFEST, encoding='utf-8')]
    rows = [r for r in rows if r['stratum'] == 'kangyur']
    assert len(rows) == 30
    os.makedirs(OUT, exist_ok=True)
    for d in ('img', 'req'):
        os.makedirs(os.path.join(a.root, d), exist_ok=True)

    wpath = os.path.join(OUT, 'derge-windows.json.gz')
    if os.path.exists(wpath):
        windows = json.load(gzip.open(wpath, 'rt', encoding='utf-8'))['windows']
    else:
        print('loading index …', file=sys.stderr)
        index = pickle.load(open(a.index, 'rb'))
        windows = {}
        for r in rows:
            w = window_syllables(index, r['derge_vol'], r['derge_imgnum'])
            served = '\n'.join(l for l in r['served_text'].split('\n') if not l.strip().startswith('<'))
            ident = round(nw_identity(syllables(served), w), 4)
            windows[r['id']] = {'derge_vol': r['derge_vol'], 'derge_imgnum': r['derge_imgnum'], 'window': 2,
                                'manifest_identity': r['derge_identity'], 'reproduced_identity': ident, 'syllables': w}
            print(r['seq'], r['id'], r['derge_identity'], ident, len(w), file=sys.stderr)
        del index
        json.dump({'source': 'OpenPecha P000001 (Esukhia Derge Kangyur e-text), Pagination layer; kanjur_align.py window_syllables(vol, imgnum, 2)',
                   'windows': windows}, gzip.open(wpath, 'wt', encoding='utf-8'), ensure_ascii=False)
    # kanjur_align counted a <leaf-break/> tag as one unmatched syllable; this drops it (as score.mjs does), so the 10
    # marked-seam folios reproduce up to about +0.002 higher
    bad = [k for k, v in windows.items() if abs(v['reproduced_identity'] - v['manifest_identity']) > 0.0025]
    print(f'derge windows: {len(windows)}; identity reproduced on {len(windows) - len(bad)}; off: {bad}', file=sys.stderr)

    rng = random.Random(a.seed)
    anchor_ids = sorted(rng.sample([r['id'] for r in rows], 10))
    reqs = {'redo': [], 'corr': [], 'corr-anchor': []}
    plants = {}
    for r in rows:
        img = os.path.join(a.root, 'img', r['id'] + '.jpg')
        fetch(r['archived_photo'] or r['display_photo'], img)
        reqs['redo'].append({'uid': r['id'], 'image': img, 'prompt': REDO})
        reqs['corr'].append({'uid': r['id'], 'image': img, 'prompt': CORR.format(draft=r['served_text'])})
        if r['id'] in anchor_ids:
            d, pl = plant(r, windows[r['id']]['syllables'], rng)
            plants[r['id']] = {'seq': r['seq'], 'plants': pl}
            reqs['corr-anchor'].append({'uid': r['id'], 'image': img, 'prompt': CORR.format(draft=d)})
    for k, v in reqs.items():
        with open(os.path.join(a.root, 'req', k + '.jsonl'), 'w', encoding='utf-8') as f:
            for x in v:
                f.write(json.dumps(x, ensure_ascii=False) + '\n')
    json.dump({'seed': a.seed, 'anchor_ids': anchor_ids, 'plants': plants,
               'note': 'planted in the DRAFT only; never mentioned in any prompt (no count, no hint)'},
              open(os.path.join(OUT, 'plants.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print({k: len(v) for k, v in reqs.items()}, 'plants', sum(len(v['plants']) for v in plants.values()), file=sys.stderr)


if __name__ == '__main__':
    main()
