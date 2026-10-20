#!/usr/bin/env python3
# PRIOR ART: scripts/eval/replicate-6547/prep.py (request files for the #6547 replications: the anchoring planter,
# the resolver prompt and the stage-2 shape are imported from it, not copied) — it builds requests for two published
# sets with the papers' own prompts; #6544 needs one manuscript prompt for every arm, two sets (A: external, with a
# reference; B: our pages, no reference), and the cross-family correction arms in both directions.
"""
Request files for #6544 (manuscripts: thinking Gemini vs Flash-Lite vs Opus, correction and disagreement arms).
Data lives under $JOB_SCRATCH, never in the repo.

  python3 build-requests.py read    # setA + setB single-reader requests: req/read.jsonl (one prompt for every reader)
  python3 build-requests.py stage2  # after the pro and opus reads: corr-pro (Pro corrects Opus's draft), corr-opus (Opus
                          # corrects Pro's draft), resolve (3.8 high settles the Pro/Opus disagreements), and the
                          # anchoring pages corr-*-anchor (10 Set-A pages, 3 planted errors in each draft)

<set>/req/*.jsonl rows {uid, prompt, image}; <set>/plants.json the anchoring key (never shown to any model).
"""
import argparse, json, os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'replicate-6547'))
from textmetrics import unwrap, failed_kind  # noqa: E402
from disagree import load, disagreement_spans, render_marked  # noqa: E402
from prep import plant, norm, SENT, RESOLVE as RESOLVE3  # noqa: E402

# One transcription prompt for every reader (Gemini CLI arms and Opus). Flash-Lite keeps production's prompt: that
# arm is "Flash-Lite as production runs it". The sentinel line is added by run-cli-arm.py (--kind ocr) for Gemini and
# here for Claude, so both families get the same words.
READ = ('Transcribe all the handwritten text on this manuscript page exactly as written, in reading order, line by '
        'line. Keep the original spelling, abbreviations, punctuation and line breaks. Do not expand abbreviations, '
        'modernise, translate or comment. Include headings, marginal notes and page or folio numbers where they '
        'stand. Write [?] for a word you cannot read.')
# Derek, 2026-10-11: "a suggested transcription from another model family and the image". No count of errors is
# given or implied (Yang 2026: count anchoring), and nothing mentions planted controls.
CORR = (READ + '\n\nBelow is a draft transcription of this page made by another reader. Use it as a draft to check '
        'against the image: correct it wherever the image differs from it. The draft may contain errors. Your output '
        'is your own full transcription of the page.\n\n--- DRAFT ---\n{draft}\n--- END OF DRAFT ---')
# Two readers, not three: the #6547 resolver prompt with "Three" → "Two" and the third label dropped.
RESOLVE = RESOLVE3.replace('Three independent readers', 'Two independent readers').replace(' | C: …', '')


def sets(root):
    A = [json.loads(l) for l in open(os.path.join(root, 'setA', 'pages.jsonl'), encoding='utf-8') if l.strip()]
    B = json.load(open(os.path.join(root, 'setB', 'draw.json'), encoding='utf-8'))['picks']
    return {'setA': [(r['uid'], r['image']) for r in A], 'setB': [(r['uid'], r['image']) for r in B]}, A


def write(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(json.dumps(r, ensure_ascii=False) + '\n' for r in rows)


def read(root):
    S, _ = sets(root)
    for s, pages in S.items():
        # prompt carries no sentinel: run-cli-arm.py appends it for Gemini; run-claude-arm requests get req/read-claude
        write(os.path.join(root, s, 'req', 'read.jsonl'), [{'uid': u, 'image': i, 'prompt': READ} for u, i in pages])
        write(os.path.join(root, s, 'req', 'read-claude.jsonl'), [{'uid': u, 'image': i, 'prompt': f'{READ}\n\n{SENT}'} for u, i in pages])
        print(s, len(pages), 'pages')


def stage2(root):
    S, A = sets(root)
    gt = {r['uid']: r['gt'] for r in A}
    for s, pages in S.items():
        out = os.path.join(root, s, 'out')
        reads = {k: load(os.path.join(out, f'{k}.jsonl')) for k in ('pro', 'opus')}
        cp, co, res, ok = [], [], [], []
        for u, img in pages:
            r = {k: reads[k].get(u) for k in reads}
            t = {k: unwrap(v['text'])[0] for k, v in r.items() if not failed_kind(v)}
            if 'opus' in t:
                cp.append({'uid': u, 'image': img, 'prompt': CORR.format(draft=t['opus'])})
            if 'pro' in t:
                co.append({'uid': u, 'image': img, 'prompt': CORR.format(draft=t['pro']) + f'\n\n{SENT}'})
            if len(t) == 2:
                ok.append(u)
                spans = disagreement_spans(t['pro'], [t['opus']])
                if spans:
                    res.append({'uid': u, 'image': img, 'prompt': RESOLVE.format(text=render_marked(t['pro'], [t['opus']], spans))})
        write(os.path.join(root, s, 'req', 'corr-pro.jsonl'), cp)
        write(os.path.join(root, s, 'req', 'corr-opus.jsonl'), co)
        write(os.path.join(root, s, 'req', 'resolve.jsonl'), res)
        print(s, {'corr-pro': len(cp), 'corr-opus': len(co), 'resolve': len(res), 'both read': len(ok)})
        if s != 'setA':
            continue
        if os.path.exists(os.path.join(root, s, 'plants.json')):
            print('anchoring: plants.json exists, kept as drawn (a rebuild must not move the planted errors)')
            continue
        # Anchoring: 10 Set-A pages both readers read; 3 errors not on the page planted in each draft (a changed
        # number where the draft has one, else a changed word; a changed word; a dropped short line). The planted
        # site must be one the draft had right (its bigram is in the reference).
        rng = random.Random(6544)
        imgs = dict(pages)
        plants, ap, ao = {}, [], []
        for u in sorted(rng.sample(sorted(ok), min(10, len(ok)))):
            entry = {}
            for corrector, src in (('pro', 'opus'), ('opus', 'pro')):
                draft = unwrap(reads[src][u]['text'])[0]
                pd, pl = plant(draft, norm(gt[u]), rng, n=2)
                pd, dropped = drop_line(pd, rng)
                if dropped:
                    pl.append(dropped)
                entry[corrector] = pl
                row = {'uid': u, 'image': imgs[u], 'prompt': CORR.format(draft=pd) + ('' if corrector == 'pro' else f'\n\n{SENT}')}
                (ap if corrector == 'pro' else ao).append(row)
            plants[u] = entry
        write(os.path.join(root, s, 'req', 'corr-pro-anchor.jsonl'), ap)
        write(os.path.join(root, s, 'req', 'corr-opus-anchor.jsonl'), ao)
        json.dump({'plants': plants}, open(os.path.join(root, s, 'plants.json'), 'w'), ensure_ascii=False, indent=1)
        print('anchoring pages', len(plants), 'plants', sum(len(v) for e in plants.values() for v in e.values()))


def drop_line(draft, rng):
    """Drop one short line (2–6 words) from the middle of the draft. The verdict reads whether the corrector put it back."""
    lines = draft.split('\n')
    cands = [i for i, l in enumerate(lines) if 2 <= len(l.split()) <= 6 and 0 < i < len(lines) - 1]
    if not cands:
        return draft, None
    i = rng.choice(cands)
    return '\n'.join(lines[:i] + lines[i + 1:]), {'kind': 'dropped_line', 'line': i, 'orig': lines[i],
                                                  'left': lines[i - 1].split()[-3:], 'right': lines[i + 1].split()[:3]}


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('step'); ap.add_argument('--root', default=os.environ.get('JOB_SCRATCH'))
    a = ap.parse_args()
    {'read': lambda: read(a.root), 'stage2': lambda: stage2(a.root)}.get(a.step, lambda: sys.exit(f'unknown step {a.step}'))()
