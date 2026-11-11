#!/usr/bin/env python3
# PRIOR ART: score.py (this dir) for the normalisations; scripts/eval/benchmark/refs/ (typed-edition references, #5935)
# hold whole pages of an edition of the SAME witness. Here the reference is another witness's edition (Kraus 1935,
# eclectic from two copies, with emendations) of the passage on one manuscript page, so it is a non-model anchor with
# an edition-variance floor, not a diplomatic reference. It also scores the two model keys against it.
"""
External anchor (#7341): Ikhrāj mā fī al-quwwa ilā al-fiʿl, Berlin hand copy (HU Hsr.or.VI.18, 1928; book
6ade4d149fdb4f8d7479923b) page 34 = Kraus, Mukhtār rasāʾil (Cairo 1935; book 6ade30b13326a0839b2d1c42) printed
p. 20 l. 8 ("فى الكمية والكيفية") to p. 22 l. 7 ("فينقدح بعضها ببعض"), images 30–32. Kraus's main text was read by Opus (the print
cell's routes agree to <1% skeleton CER) and cut to the passage; the apparatus, line numbers, folio marks [١٦] and
Kraus's editorial additions <…> (words not in his copies) are dropped.

  python3 scripts/eval/arabic-mss-gate-7341/anchor.py
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', 'replicate-6547'))
from score import letters, page_cer, ARMS, s6544  # noqa: E402
from textmetrics import unwrap  # noqa: E402
from disagree import load  # noqa: E402

UID = '6ade4d149fdb4f8d7479923b_34'
S = os.path.join(os.environ['JOB_SCRATCH'], 'g', 'setB')
A = load(os.path.join(os.environ['JOB_SCRATCH'], 'anchor', 'opus.jsonl'))


def main_text(t):
    # Kraus's page: header "— ٢٠ —", the main text with line numbers, then the apparatus, which opens with "(١)"
    t = unwrap(t)[0]
    t = re.split(r'\n\s*\((?:[١-٩]|\d)', t, maxsplit=1)[0]
    return re.sub(r'^[–—-]\s*[٠-٩]+\s*[–—-]\s*$', '', t, flags=re.M)


k20, k21, k22 = (main_text(A[f'kraus-img{i}']['text']) for i in (30, 31, 32))
start = k20.index('فى الكمّيّة') if 'فى الكمّيّة' in k20 else k20.index('الكم')
end = k22.index('فينقدح بعضها ببعض') + len('فينقدح بعضها ببعض')
ref = k20[start:] + '\n' + k21 + '\n' + k22[:end]
ref = re.sub(r'<[^<>]*>', ' ', ref)
ref = re.sub(r'\[[٠-٩0-9]+\]|\(\*\)', ' ', ref)
out = {'passage': 'Kraus 1935 p.20 l.8 – p.22 l.7', 'ref_letters_skel': len(letters(ref, 'skel')), 'cer': {}}
for arm, stem in ARMS.items():
    texts, fails, _ = s6544.reads('lite' if arm == 'lite' else arm, load(os.path.join(S, 'out', f'{stem}.jsonl')), [UID])
    if UID not in texts:
        out['cer'][arm] = {'failed': fails}; continue
    t = texts[UID]
    out['cer'][arm] = {m: round(100 * (lambda c: c['cd'] / c['cl'])(page_cer(t, ref, m)), 1) for m in ('marks', 'skel')}
for k in ('o', 'g'):
    key = json.load(open(os.path.join(S, 'keys', f'key-{k}.json')))[UID]
    out['cer'][f'KEY-{k.upper()}'] = {m: round(100 * (lambda c: c['cd'] / c['cl'])(page_cer(key, ref, m)), 1) for m in ('marks', 'skel')}
json.dump(out, open(os.path.join(os.environ['JOB_SCRATCH'], 'anchor', 'anchor-score.json'), 'w'), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False, indent=1))
