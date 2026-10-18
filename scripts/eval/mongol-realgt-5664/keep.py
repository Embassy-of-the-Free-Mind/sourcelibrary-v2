#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/mongol-synth-5664/judge.mjs (sealed `claude -p --model opus`, prompt on stdin, shuffled
controls under neutral ids; that judge compares a read with the Derge Tibetan, by meaning). This one asks a narrower,
text-side question: which of several known Mongolian strings is this column's read a reading of?

Decides which proposed (column, known text) pairs from align.py become real ground truth (#5664). A pair is kept only
if it passes BOTH:

  1. screen (deterministic). Word level: the read has the label's number of words (+-1, or +-20 % for long columns).
     body pairs: the read is closer (edit distance) to its own label than to either neighbouring column's label;
     title pairs: whole-read edit distance <= 0.35 (titles are what the reader already half-knows).
  2. opus (text side, never the image). Opus sees the read and 4 candidate strings (Latin + Unicode), shuffled: the
     proposed label and 3 distractors (body: the neighbouring columns' labels and one from another side; title: other
     texts' title windows of similar length). It names the candidate the read is a reading of, or "none". Kept if it
     names the proposed label. 1 item in 10 is a control whose true label was removed (right answer: none), which
     measures how often Opus accepts a wrong string.

  python3 keep.py screen --pairs body-pairs.jsonl title-pairs.jsonl --out screened.jsonl
  python3 keep.py opus   --screened screened.jsonl --out opus/ [--per-call 20 --parallel 3]
  python3 keep.py final  --screened screened.jsonl --opus opus/ --out kept.jsonl   (+ coverage report on stderr)

Writes files only; Opus via the Claude subscription ($0). No Mongo, no Gemini.
"""
import argparse, collections, concurrent.futures as cf, glob, json, os, random, re, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from align import ned, norm, nwords  # noqa: E402


def rows(path):
    return [json.loads(l) for l in open(path, encoding='utf8') if l.strip()]


def screen(args):
    out = []
    for p in args.pairs:
        for r in rows(p):
            wl, wr = r['words_label'], r['words_read']
            words_ok = abs(wl - wr) <= max(1, round(0.2 * wl))
            if r['kind'] == 'body':
                nb = r.get('ned_neighbours') or []
                ok = words_ok and all(r['ned'] < x - 0.03 for x in nb) and r['ned'] <= 0.8
            else:
                ok = words_ok and r['ned'] <= 0.35
            r['screen'] = bool(ok)
            out.append(r)
    with open(args.out, 'w', encoding='utf8') as fo:
        for r in out:
            fo.write(json.dumps(r, ensure_ascii=False) + '\n')
    c = collections.Counter((r['kind'], r['screen']) for r in out)
    print(dict(c), file=sys.stderr)


RUBRIC = """You are checking text alignments for a Classical Mongolian woodblock print (the Beijing Mongolian Kanjur,
1718-20). A weak OCR model read ONE printed column and produced the string READ, in Unicode Mongolian script. Its
word breaks are usually right but many letters are wrong: the script writes several letters with one shape (o/u,
ö/ü, t/d, q/γ, k/g, and the medial a/e/n "teeth"), and the model often resolves them wrongly or uses loanword
letters (f, w, ē, k-variants) where the print has ordinary ones. Each candidate (1-4) is a known text string, given in
scholarly Latin transliteration and in Unicode. At most one candidate is the text of that column; possibly none is.

For each item, decide which candidate READ is a reading of: compare word by word - number of words, word lengths,
the order of distinctive words, endings and suffixes, punctuation. Do not reward a candidate for sharing only one
common word (e.g. "ilaǰu tegüs nögčigsen", "kemebesü", "bolai"). If two candidates fit equally, or none fits clearly,
answer none.

Answer with ONLY a JSON array, one object per item, in order: [{"id": "...", "pick": 1|2|3|4|"none", "why": "<=12 words"}]"""


def build_items(scr, seed=7):
    rnd = random.Random(seed)
    keep = [r for r in scr if r['screen']]
    by_leaf = collections.defaultdict(list)
    for r in scr:
        by_leaf[(r['kind'], r['leaf'])].append(r)
    titles = [r for r in scr if r['kind'] == 'title']
    body = [r for r in scr if r['kind'] == 'body']
    items = []
    for n, r in enumerate(keep):
        if r['kind'] == 'body':
            side = sorted(by_leaf[('body', r['leaf'])], key=lambda x: x['col'])
            k = [x['id'] for x in side].index(r['id'])
            pool = [side[j] for j in (k - 1, k + 1, k - 2, k + 2) if 0 <= j < len(side)][:2]
            other = [x for x in body if x['leaf'] != r['leaf'] and abs(x['words_label'] - r['words_label']) <= 2]
            pool += rnd.sample(other, min(len(other), 3 - len(pool)))
        else:
            other = [x for x in titles if x['rkts'] != r['rkts'] and abs(x['words_label'] - r['words_label']) <= 1 and x['label'] != r['label']]
            pool = rnd.sample(other, min(3, len(other)))
        cands = [(x['latin'], x['label']) for x in pool[:3]]
        control = (n % 10 == 9)
        if control:   # the true label is replaced by a 4th distractor: the right answer is none
            extra = [x for x in (body if r['kind'] == 'body' else titles) if x['label'] not in {c[1] for c in cands} and x['label'] != r['label']]
            cands.append((lambda x: (x['latin'], x['label']))(rnd.choice(extra)))
            true_pos = None
        else:
            cands.append((r['latin'], r['label']))
        rnd.shuffle(cands)
        if not control:
            true_pos = [c[1] for c in cands].index(r['label']) + 1
        items.append({'qid': f'q{n:05d}', 'id': r['id'], 'read': r['read'], 'cands': cands, 'true': true_pos, 'control': control})
    return items


def claude(prompt):
    env = {k: v for k, v in os.environ.items() if k not in ('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN')}
    p = subprocess.run(['/usr/bin/claude', '-p', '--model', 'opus', '--tools', '', '--strict-mcp-config',
                        '--no-session-persistence', '--output-format', 'json'], input=prompt, capture_output=True,
                       text=True, env=env, timeout=900)
    try:
        return json.loads(p.stdout).get('result', '')
    except Exception:
        return p.stdout + p.stderr[-300:]


def opus(args):
    os.makedirs(args.out, exist_ok=True)
    items = build_items(rows(args.screened))
    json.dump(items, open(os.path.join(args.out, 'items.json'), 'w', encoding='utf8'), ensure_ascii=False)
    batches = [items[i:i + args.per_call] for i in range(0, len(items), args.per_call)]

    def run(bi):
        path = os.path.join(args.out, f'b{bi:04d}.json')
        if os.path.exists(path):
            return
        b = batches[bi]
        body = '\n\n'.join(f'### id {it["qid"]}\nREAD: {it["read"]}\n' + '\n'.join(
            f'{k + 1}. {c[0]}   |   {c[1]}' for k, c in enumerate(it['cands'])) for it in b)
        for attempt in range(3):
            txt = claude(RUBRIC + '\n\n' + body)
            m = re.search(r'\[.*\]', txt, re.S)
            try:
                ans = json.loads(m.group(0))
                if len(ans) == len(b):
                    json.dump({'items': [it['qid'] for it in b], 'answers': ans}, open(path, 'w'), ensure_ascii=False)
                    print(f'b{bi:04d} ok', file=sys.stderr, flush=True)
                    return
            except Exception:
                pass
        print(f'b{bi:04d} FAILED: {txt[:200]!r}', file=sys.stderr, flush=True)

    with cf.ThreadPoolExecutor(args.parallel) as ex:
        list(ex.map(run, range(len(batches))))


def final(args):
    scr = rows(args.screened)
    items = {it['qid']: it for it in json.load(open(os.path.join(args.opus, 'items.json'), encoding='utf8'))}
    verdict = {}
    for f in sorted(glob.glob(os.path.join(args.opus, 'b*.json'))):
        d = json.load(open(f, encoding='utf8'))
        for q, a in zip(d['items'], d['answers']):
            verdict[q] = a.get('pick')
    ctl = collections.Counter(); real = collections.Counter(); kept_ids = set()
    for q, it in items.items():
        if q not in verdict:
            continue
        pick = verdict[q]
        pick = None if pick in ('none', None) else int(pick)
        if it['control']:
            ctl['accepted_wrong' if pick is not None else 'none'] += 1
        else:
            ok = pick == it['true']
            real['confirmed' if ok else ('none' if pick is None else 'other')] += 1
            if ok:
                kept_ids.add(it['id'])
    kept = [r for r in scr if r['screen'] and r['id'] in kept_ids]
    with open(args.out, 'w', encoding='utf8') as fo:
        for r in kept:
            fo.write(json.dumps(r, ensure_ascii=False) + '\n')
    letters = collections.Counter(ch for r in kept for ch in norm(r['label']) if ch != ' ')
    rep = {'opus_real': dict(real), 'opus_controls': dict(ctl), 'kept': dict(collections.Counter(r['kind'] for r in kept)),
           'kept_by_source': dict(collections.Counter(r.get('source', 'title') for r in kept)),
           'words': sum(nwords(r['label']) for r in kept), 'chars': sum(letters.values()),
           'letters': {f'U+{ord(k):04X} {k}': v for k, v in letters.most_common()}}
    json.dump(rep, open(args.out.replace('.jsonl', '-report.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in rep.items() if k != 'letters'}, ensure_ascii=False), file=sys.stderr)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('stage', choices=['screen', 'opus', 'final'])
    ap.add_argument('--pairs', nargs='*'); ap.add_argument('--screened'); ap.add_argument('--opus')
    ap.add_argument('--out', required=True)
    ap.add_argument('--per-call', type=int, default=20); ap.add_argument('--parallel', type=int, default=3)
    a = ap.parse_args()
    {'screen': screen, 'opus': opus, 'final': final}[a.stage](a)
