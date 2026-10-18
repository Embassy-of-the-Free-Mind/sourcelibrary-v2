#!/usr/bin/env python3
"""
PRIOR ART: none in the repo (no Mongolian-script text corpus exists here). Sources were found for this job and are
recorded, with licences, in scripts/eval/experiments/2026-10-18-mongol-synth-prereg-5664.md.

Builds the line pool the synthetic renderer draws from (#5664). Only Mongolian-script runs are kept (no Latin,
Cyrillic, CJK, digits outside the Mongolian block); Private-Use characters (Menksoft residue) are dropped; NNBSP
(U+202F) and MVS (U+180E) are kept; lines are deduplicated. The texts behind the frozen evaluation are excluded by
rKTs id, so no catalogue title or colophon of an evaluated text is in the training text.

Buddhist register (oversampled to ~half the characters): rKTs Mongolian titles/colophons (CC BY-SA 4.0) and the
Buddhist-keyword slice of CMLI (CC BY 4.0). General register: FLORES-mvf (Apache-2.0 card; FLORES-200 CC BY-SA
4.0), CMLI pretrain sample (CC BY 4.0), GlotCC und-Mong (CommonCrawl-derived; card licence unstated), Wikimedia
Incubator Wp/mvf (CC BY-SA 4.0), PKU culture cloze (Apache-2.0). Excluded: HMJLT (CC BY-NC 4.0), IMU-MnOCR
(terms), and every OCR'd Internet Archive book (copyright).

  python3 corpus.py --rkts rkts.jsonl --text TEXTDIR --exclude-rkts 16,500,... --out DIR
  -> DIR/train-lines.txt, DIR/heldout-lines.txt, DIR/corpus-stats.json
"""
import argparse, glob, json, os, random, re, unicodedata

RUN = re.compile(r'[\u1800-\u18AF\u202F\u180E][\u1800-\u18AF\u202F\u180E \u3000]*[\u1800-\u18AF]')
PUA = re.compile(r'[\uE000-\uF8FF]')
LETTER = re.compile(r'[\u1820-\u18AA]')


def runs_of(text):
    text = PUA.sub('', unicodedata.normalize('NFC', text))
    for r in RUN.findall(text):
        r = re.sub(r'[ \u3000]+', ' ', r).strip()   # never str.split(): it eats U+202F
        r = re.sub(r' ?\u202F ?', '\u202F', r)        # a connector next to a space is one connector
        r = re.sub(r'^[\u1800-\u180F\u202F ]+', '', r)  # no leading punctuation / connectors
        if len(LETTER.findall(r)) >= 12:
            yield r


def from_files(pattern):
    for f in sorted(glob.glob(pattern, recursive=True)):
        if os.path.isdir(f):
            continue
        raw = open(f, encoding='utf8', errors='ignore').read()
        if f.endswith('.jsonl') or f.endswith('.json'):  # JSON may hold \uXXXX escapes: decode, keep the strings
            docs = []
            for chunk in ([raw] if f.endswith('.json') else raw.splitlines()):
                try:
                    docs.append(json.loads(chunk))
                except ValueError:
                    pass
            raw = '\n'.join(strings(docs))
        elif f.endswith('.html') or f.endswith('.htm'):
            raw = re.sub(r'<[^>]+>', '\n', raw)
        yield from runs_of(raw)


def strings(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for v in o.values():
            yield from strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from strings(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rkts', required=True)
    ap.add_argument('--text', required=True)
    ap.add_argument('--exclude-rkts', default='')
    ap.add_argument('--out', required=True)
    ap.add_argument('--buddhist-share', type=float, default=0.5)
    ap.add_argument('--heldout', type=float, default=0.02)
    a = ap.parse_args()
    excl = {int(x) for x in a.exclude_rkts.split(',') if x}
    budd, gen = [], []
    for l in open(a.rkts, encoding='utf8'):
        r = json.loads(l)
        if r['rkts'] in excl:
            continue
        for s in r['mongolian']:
            budd.extend(runs_of(s))
    budd.extend(from_files(os.path.join(a.text, 'uni-cmli-buddhist', '**', '*')))
    for d in ['uni-flores-mvf', 'uni-cmli-pretrain', 'uni-glotcc-und-mong', 'uni-incubator-wp-mvf', 'uni-pku-culture-cloze']:
        gen.extend(from_files(os.path.join(a.text, d, '**', '*')))
    stats = {}
    rnd = random.Random(5664)
    pools = {}
    for name, pool in (('buddhist', budd), ('general', gen)):
        u = sorted(set(pool)); rnd.shuffle(u)
        k = max(1, int(len(u) * a.heldout))
        pools[name] = (u[k:], u[:k])
        stats[name] = {'lines': len(u), 'chars': sum(len(x) for x in u), 'heldout_lines': k}
    os.makedirs(a.out, exist_ok=True)
    bt, gt = pools['buddhist'][0], pools['general'][0]
    bc, gc = sum(map(len, bt)), sum(map(len, gt))
    # oversample the Buddhist pool so it carries ~buddhist_share of the characters the renderer sees
    rep = max(1, round(a.buddhist_share / (1 - a.buddhist_share) * gc / max(1, bc)))
    stats['buddhist_repeat'] = rep
    train = bt * rep + gt; rnd.shuffle(train)
    with open(os.path.join(a.out, 'train-lines.txt'), 'w', encoding='utf8') as f:
        f.write('\n'.join(train) + '\n')
    with open(os.path.join(a.out, 'heldout-lines.txt'), 'w', encoding='utf8') as f:
        f.write('\n'.join(pools['buddhist'][1] + pools['general'][1]) + '\n')
    stats['excluded_rkts'] = sorted(excl)
    json.dump(stats, open(os.path.join(a.out, 'corpus-stats.json'), 'w'), indent=1)
    print(json.dumps(stats))


if __name__ == '__main__':
    main()
