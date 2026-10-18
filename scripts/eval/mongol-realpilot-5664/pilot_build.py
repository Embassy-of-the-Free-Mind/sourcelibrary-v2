#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/mongol-realgt-5664/build_train.py (PR #6960: mixes the kept real columns into the synthetic
pool and builds realeval; called unchanged here) and align.py there (norm(): the letters-and-word-breaks
normalisation behind the 55.5 % v23 baseline, copied so the score is comparable). Neither checks leakage by string
overlap, which the pilot's preregistration requires.

Builds the 07-mongol-real-pilot inputs on gex45 and refuses to train if anything leaks (#5664). Preregistered in
scripts/eval/experiments/2026-10-19-mongol-real-pilot-prereg-5664.md.

  1. Candidates: the kept real columns (keep.py final) outside the 30 frozen meaning volumes.
  2. Text-id guard: no title row whose rKTs id is Mng1.491's work (rKTs 670) or one of the 40 frozen-set texts; no
     body row on a leaf that a forbidden work's Mng1 span covers; no row from source A or volume 23.
  3. String guard: drop every real and synthetic training row that shares a word 5-gram or a 30-character
     normalised substring with any v23 evaluation label.
  4. build_train.py --real-share 0.4 --rows 14400 on the filtered rows.
  5. Re-scan the final traindata/labels.jsonl with both guards; exit 1 if a single row fails.
  Adds the real training columns to realeval as set=real-train (memorisation diagnostic) and flags each v23
  column `clean3` when it shares no word 3-gram with any final training label (the robustness subset).

  python3 pilot_build.py --realgt R --synth S --code C --out P   (R=/root/jobs/mongol-realgt-5664 ...)
Writes files only; labels never leave gex45. Nothing touches Mongo.
"""
import argparse, gzip, json, os, re, subprocess, sys

FROZEN_VOLS = {1, 3, 5, 6, 9, 11, 13, 15, 16, 18, 20, 23, 46, 47, 49, 51, 53, 60, 62, 64, 66, 71, 72, 74, 76, 78, 81, 82, 84, 88}
# The name set's volumes (10, 12, 21, 24, 48, 52, 63, 70, 75, 77) are NOT excluded: realgt counted v24 in its 516
# eligible columns and the name check is not scored here; its 10 works are blocked by the text-id guard instead.
V23_WORK = 670   # rKTs id of Mng1.491, Aparimitāyur-jñāna-hṛdaya (also Mng1.368, v15)
PUNCT = '᠂᠃᠄᠅'


def norm(s):   # = align.py norm()
    s = re.sub(r'[᠋-᠏ ]', ' ', s or '')
    s = re.sub('[' + PUNCT + r'᠀᠁‍]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def grams(s, n):
    w = norm(s).split()
    return {' '.join(w[i:i + n]) for i in range(len(w) - n + 1)}


def subs(s, k=30):
    t = norm(s)
    return {t[i:i + k] for i in range(len(t) - k + 1)}


def rows(p):
    op = gzip.open if p.endswith('.gz') else open
    return [json.loads(l) for l in op(p, 'rt', encoding='utf8') if l.strip()]


def leaf_pos(leaf):   # v091_364b -> (91, 364, 'b')
    m = re.match(r'v(\d+)_(\d+)([ab])', leaf)
    return int(m.group(1)), int(m.group(2)), m.group(3)


def covers(span, vol, folio, side):
    if span.get('vol') != vol or not span.get('start') or not span.get('end'):
        return False
    k = lambda f, s: f * 2 + (s == 'b')  # noqa: E731
    return k(*span['start']) <= k(folio, side) <= k(*span['end'])


def main():
    ap = argparse.ArgumentParser()
    for k in ('realgt', 'synth', 'code', 'out'):
        ap.add_argument('--' + k, required=True)
    ap.add_argument('--real-share', type=float, default=0.4)
    ap.add_argument('--rows', type=int, default=14400)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    pairs = rows(os.path.join(a.realgt, 'body-pairs.jsonl'))
    kept = rows(os.path.join(a.realgt, 'kept.jsonl'))
    kept_ids = {r['id'] for r in kept}
    v23 = [r for r in pairs if r['source'] == 'A']
    assert len(v23) == 157, len(v23)
    v23_ids = {r['id'] for r in v23}
    v23_g5 = set().union(*[grams(r['label'], 5) for r in v23])
    v23_s30 = set().union(*[subs(r['label']) for r in v23])

    def overlaps(text):
        return bool(grams(text, 5) & v23_g5) or bool(subs(text) & v23_s30)

    rkts = rows(os.path.join(a.code, 'rkts.jsonl.gz'))
    frozen_works = {m['rkts'] for m in json.load(open(os.path.join(a.code, 'meaning.json')))}
    names = json.load(open(os.path.join(a.code, 'names.json')))
    frozen_works |= {u['rkts'] for u in (names if isinstance(names, list) else names.values()) if isinstance(u, dict) and 'rkts' in u}
    forbidden = frozen_works | {V23_WORK}
    forbidden_spans = [s for r in rkts if r['rkts'] in forbidden for s in r['mng1']]

    log = {'forbidden_works': len(forbidden), 'frozen_works': len(frozen_works), 'dropped': []}
    cand = []
    for r in kept:
        why = None
        if r['vol'] in FROZEN_VOLS or r.get('source') == 'A' or r['id'] in v23_ids:
            continue   # evaluation-only; build_train would skip these too
        if r['kind'] == 'title' and r.get('rkts') in forbidden:
            why = 'text-id: title of a forbidden work'
        elif r['kind'] == 'body' and any(covers(s, *leaf_pos(r['leaf'])) for s in forbidden_spans):
            why = 'text-id: leaf inside a forbidden work'
        elif overlaps(r['label']):
            why = 'string: shares a 5-gram or 30-char run with v23'
        if why:
            log['dropped'].append({'id': r['id'], 'why': why})
        else:
            cand.append(r)
    held_titles = [r for r in cand if r['kind'] == 'title' and r['rkts'] % 10 == 0]
    log['real_candidates'] = len(cand) - len(held_titles)
    log['real_dropped'] = len(log['dropped'])
    for r in cand:
        p = os.path.join(a.realgt, 'readset', 'img', r['id'].replace('/', '_') + '.jpg')
        assert os.path.exists(p), p

    with open(os.path.join(a.out, 'kept-train.jsonl'), 'w', encoding='utf8') as fo:
        for r in cand:
            fo.write(json.dumps(r, ensure_ascii=False) + '\n')
    with open(os.path.join(a.out, 'prose-eval.jsonl'), 'w', encoding='utf8') as fo:
        for r in v23:
            fo.write(json.dumps({**r, 'confirmed': r['id'] in kept_ids}, ensure_ascii=False) + '\n')

    subprocess.run([sys.executable, os.path.join(a.code, 'build_train.py'), '--kept', os.path.join(a.out, 'kept-train.jsonl'),
                    '--prose', os.path.join(a.out, 'prose-eval.jsonl'), '--readset', os.path.join(a.realgt, 'readset'),
                    '--synth', os.path.join(a.synth, 'data'), '--frozen', os.path.join(a.synth, 'eval'), '--out', a.out,
                    '--real-share', str(a.real_share), '--rows', str(a.rows)], check=True)

    # synthetic rows: same string guard, applied after the draw (dropped, not replaced)
    lab = os.path.join(a.out, 'traindata', 'labels.jsonl')
    mix = rows(lab)
    keep_mix = [m for m in mix if not overlaps(m['text'])]
    log['synth_dropped'] = sum(1 for m in mix if m['src'] == 'synth' and overlaps(m['text']))
    with open(lab, 'w', encoding='utf8') as fo:
        for m in keep_mix:
            fo.write(json.dumps(m, ensure_ascii=False) + '\n')

    # final re-scan: the file the trainer reads
    bad = []
    for m in rows(lab):
        base = os.path.basename(m['image'])
        if m['src'] != 'synth':
            vol = int(re.match(r'v(\d+)_', base).group(1))
            if vol in FROZEN_VOLS:
                bad.append((base, 'frozen volume'))
        if base.startswith('v023_'):
            bad.append((base, 'v23 image'))
        if overlaps(m['text']):
            bad.append((base, 'string overlap'))
    train_real = [m for m in rows(lab) if m['src'] != 'synth']
    log.update({'final_rows': len(keep_mix), 'final_real_rows': len(train_real),
                'final_real_distinct': len({m['image'] for m in train_real}),
                'final_synth_rows': len(keep_mix) - len(train_real), 'violations': bad[:20], 'n_violations': len(bad)})

    # diagnostics in realeval: real-train columns, and the clean3 flag on v23
    all_g3 = set().union(*[grams(m['text'], 3) for m in train_real]) if train_real else set()
    refs_p = os.path.join(a.out, 'realeval', 'refs.jsonl')
    refs = rows(refs_p)
    conf = {r['id']: r['confirmed'] for r in rows(os.path.join(a.out, 'prose-eval.jsonl'))}
    for r in refs:
        if r['set'] == 'real-prose':
            r['confirmed'] = conf[r['id']]
            r['clean3'] = not (grams(r['ref'], 3) & all_g3)
    cols_p = os.path.join(a.out, 'realeval', 'columns.jsonl')
    with open(cols_p, 'a', encoding='utf8') as fc:
        for r in cand:
            if r['kind'] == 'body':
                fc.write(json.dumps({'id': r['id'], 'image': os.path.join(a.realgt, 'readset', 'img', r['id'].replace('/', '_') + '.jpg'), 'set': 'real-train'}) + '\n')
                refs.append({'id': r['id'], 'set': 'real-train', 'ref': r['label'], 'source': r['source']})
    with open(refs_p, 'w', encoding='utf8') as fo:
        for r in refs:
            fo.write(json.dumps(r, ensure_ascii=False) + '\n')
    log['v23_clean3'] = sum(1 for r in refs if r.get('clean3'))
    json.dump(log, open(os.path.join(a.out, 'leakage.json'), 'w'), indent=1, ensure_ascii=False)
    print(json.dumps({k: v for k, v in log.items() if k != 'dropped'}, ensure_ascii=False))
    if bad:
        print('LEAKAGE: refusing to train', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
