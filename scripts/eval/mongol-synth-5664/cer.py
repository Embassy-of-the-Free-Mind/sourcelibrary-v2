#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/zh-residue-refs-6871/compare.py (CER for Han text; its normalisation drops non-Han, so it
cannot score Mongolian). Diagnosis only (preregistration): CER of the reads on the synthetic held-out columns.

Normalisation: NFC; spaces, U+202F (suffix connector) and U+180E (vowel separator) are all treated as one word
break; free variation selectors U+180B-180D dropped. Both sides alike.

  python3 cer.py reads-lora.jsonl [reads-base.jsonl ...]   -> per file: n, median and mean CER, share of reads < 10 %
"""
import json, re, statistics, sys, unicodedata


def norm(s):
    s = unicodedata.normalize('NFC', s or '')
    s = re.sub('[᠋-᠍]', '', s)
    return re.sub('[  ᠎\n\t]+', ' ', s).strip()


def lev(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


for path in sys.argv[1:]:
    rows = [json.loads(l) for l in open(path, encoding='utf8') if l.strip()]
    rows = [r for r in rows if r.get('set') == 'synth-heldout' and r.get('ref')]
    cers = [lev(norm(r['text']), norm(r['ref'])) / max(1, len(norm(r['ref']))) for r in rows]
    if not cers:
        print(path, 'no synthetic held-out rows'); continue
    print(json.dumps({'file': path, 'n': len(cers), 'median_cer': round(statistics.median(cers), 4),
                      'mean_cer': round(statistics.mean(cers), 4), 'share_below_10pct': round(sum(c < 0.1 for c in cers) / len(cers), 3)}))
