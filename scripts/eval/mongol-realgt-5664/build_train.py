#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/mongol-synth-5664/render.py (writes the synthetic labels.jsonl this mixes in) and
freeze_eval.py (writes the frozen eval columns.jsonl this re-lists). Nothing mixes real Kanjur columns into training.

Builds the 10-mongol-real-train inputs on gex45 (#5664), from the kept real pairs (keep.py final):

  traindata/labels.jsonl   real training columns, oversampled to --real-share of the rows, plus a random draw of the
                           synthetic training columns ({image: absolute path, text})
  realeval/columns.jsonl   what the task reads at the end: the frozen meaning + name sets (unchanged, from the
                           synthetic run's eval dir) + the real held-out columns (set=real-prose / real-title)
  realeval/refs.jsonl      the known text of each real held-out column, for CER

Held out from training, by construction:
  - the 30 frozen meaning volumes and the 40 evaluated texts: align.py never proposes them for training (texts.json
    excludes them; the vol-23 dhāraṇī transliteration is in a frozen volume, so it is evaluation only, real-prose);
  - every 10th catalogued text (by rKTs id) among the kept title pairs (real-title).

  python3 build_train.py --kept kept.jsonl --prose prose-eval.jsonl --readset R/readset --synth S/data \
      --frozen S/eval --out R [--real-share 0.3 --rows 40000]
"""
import argparse, json, os, random

FROZEN_VOLS = {1, 3, 5, 6, 9, 11, 13, 15, 16, 18, 20, 23, 46, 47, 49, 51, 53, 60, 62, 64, 66, 71, 72, 74, 76, 78, 81, 82, 84, 88}


def rows(p):
    return [json.loads(l) for l in open(p, encoding='utf8') if l.strip()]


def main():
    ap = argparse.ArgumentParser()
    for k in ('kept', 'prose', 'readset', 'synth', 'frozen', 'out'):
        ap.add_argument('--' + k, required=True)
    ap.add_argument('--real-share', type=float, default=0.3)
    ap.add_argument('--rows', type=int, default=40000)
    a = ap.parse_args()
    rnd = random.Random(5664)
    img = lambda cid: os.path.join(a.readset, 'img', cid.replace('/', '_') + '.jpg')  # noqa: E731

    kept = rows(a.kept)
    train, held = [], []
    for r in kept:
        if r['vol'] in FROZEN_VOLS:
            continue  # never trains on a frozen volume (belt and braces: align.py does not propose them)
        if r['kind'] == 'title' and r['rkts'] % 10 == 0:
            held.append({**r, 'set': 'real-title'})
        else:
            train.append(r)
    prose = [{**r, 'set': 'real-prose'} for r in rows(a.prose)]

    n_real = int(a.rows * a.real_share)
    real_rows = [{'image': img(r['id']), 'text': r['label'], 'src': r['kind']} for r in train]
    rep = [real_rows[i % len(real_rows)] for i in range(max(n_real, len(real_rows)))] if real_rows else []
    synth = rows(os.path.join(a.synth, 'labels.jsonl'))
    rnd.shuffle(synth)
    syn_rows = [{'image': os.path.join(a.synth, s['image']), 'text': s['text'], 'src': 'synth'} for s in synth[:a.rows - len(rep)]]
    mix = rep + syn_rows
    rnd.shuffle(mix)
    os.makedirs(os.path.join(a.out, 'traindata'), exist_ok=True)
    with open(os.path.join(a.out, 'traindata', 'labels.jsonl'), 'w', encoding='utf8') as fo:
        for r in mix:
            fo.write(json.dumps(r, ensure_ascii=False) + '\n')

    os.makedirs(os.path.join(a.out, 'realeval'), exist_ok=True)
    cols = []
    for c in rows(os.path.join(a.frozen, 'columns.jsonl')):
        cols.append({**c, 'image': os.path.join(a.frozen, c['image'])})
    refs = []
    for r in prose + held:
        cols.append({'id': r['id'], 'image': img(r['id']), 'set': r['set']})
        refs.append({'id': r['id'], 'set': r['set'], 'ref': r['label'], 'latin': r.get('latin')})
    with open(os.path.join(a.out, 'realeval', 'columns.jsonl'), 'w', encoding='utf8') as fo:
        for c in cols:
            fo.write(json.dumps(c, ensure_ascii=False) + '\n')
    with open(os.path.join(a.out, 'realeval', 'refs.jsonl'), 'w', encoding='utf8') as fo:
        for r in refs:
            fo.write(json.dumps(r, ensure_ascii=False) + '\n')
    stat = {'real_train_columns': len(train), 'real_rows_after_oversampling': len(rep), 'synthetic_rows': len(syn_rows),
            'real_title_heldout': len(held), 'real_prose_eval': len(prose), 'frozen_columns': len(cols) - len(refs)}
    json.dump(stat, open(os.path.join(a.out, 'build-stats.json'), 'w'), indent=1)
    print(stat)


if __name__ == '__main__':
    main()
