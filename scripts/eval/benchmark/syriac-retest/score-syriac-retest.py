# PRIOR ART: benchmark-score.mjs — scores the sealed strata against CBETA/Kanripo windows and the two house tiers; it has no PAGE-XML reader, no order-free line-level CER and no RTL normalisation, which this Syriac retest needs (#4746, #4883).
#!/usr/bin/env python3
"""Score the Syriac retest.
  syriac-gt      : every engine vs the PUBLISHED transcription (PAGE XML) — CER under two normalisations
                   (N1: NFC + whitespace + punctuation stripped; N2: N1 + Syriac vowel/diacritic points stripped,
                   U+0730–U+074A and combining dots), bag-of-words Dice, loop flag, paired sign test vs lite.
  syriac / print-loop : no reference — Dice between engines and vs the served text, loop score, excerpts.
Direction: Kraken arms were run with -d horizontal-rl / --base-dir R (logical order); nothing is reversed here.
"""
import os, glob, json, unicodedata, re, math, statistics as st, sys
ROOT = '/root/ocr-bench/images'; R = '/root/ocr-bench/syriac-retest'
GT = f'{R}/gt-text'
SETS = {'syriac-gt': f'{ROOT}/syriac-gt', 'syriac': f'{ROOT}/syriac', 'print-loop': f'{R}/print-loop'}
PUNCT = re.compile(r'[܀-܍\.\,\:\;\!\?\(\)\[\]«»"\'\-–—…·•]+')
POINTS = re.compile(r'[ܰ-݊̀-ͯ݀-݊]')
def n1(s):
    s = unicodedata.normalize('NFC', s or ''); s = re.sub(r'<[^>]+>', ' ', s); s = PUNCT.sub(' ', s)
    return re.sub(r'\s+', ' ', s).strip()
def n2(s): return re.sub(r'\s+', ' ', POINTS.sub('', n1(s))).strip()
def lev(a, b):
    if not a: return len(b)
    if not b: return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]
def cer(h, r): return lev(h, r) / max(1, len(r))
def line_cer(hyp_text, ref_text, norm):
    """Order-free: for each reference LINE the best-matching hypothesis line (min CER), length-weighted mean.
    Pages with two text streams (main + marginal notes) permute line order between engines; this asks only
    whether each reference line exists somewhere in the output. Unmatched lines count as CER 1."""
    R = [norm(l) for l in ref_text.split('\n') if norm(l)]; H = [norm(l) for l in hyp_text.split('\n') if norm(l)]
    if not R: return None
    tot = 0; n = 0
    for r in R:
        if len(r) < 4: continue
        best = 1.0
        for h in H:
            if abs(len(h) - len(r)) > max(6, len(r)): continue
            c = cer(h, r)
            if c < best: best = c
            if best == 0: break
        tot += best * len(r); n += len(r)
    return round(tot / max(1, n), 4)
def dice(a, b):
    A, B = set(a.split()), set(b.split()); return 2 * len(A & B) / max(1, len(A) + len(B))
def loop_score(s):
    w = s.split()
    if len(w) < 12: return 0.0
    g = {};
    for i in range(len(w) - 2): k = ' '.join(w[i:i + 3]); g[k] = g.get(k, 0) + 1
    return max(g.values()) * 3 / len(w)
def binom_two_sided(k, n):
    if n == 0: return None
    p = sum(math.comb(n, i) for i in range(k, n + 1)) / 2 ** n
    return round(min(1.0, 2 * p), 4)
def engines_of(d): return sorted(e for e in os.listdir(os.path.join(d, 'out')) if os.path.isdir(os.path.join(d, 'out', e)) and any(f.endswith('.txt') and not f.startswith('_') for f in os.listdir(os.path.join(d, 'out', e))))
def read(d, e, slug):
    f = os.path.join(d, 'out', e, slug + '.txt'); return open(f, encoding='utf-8', errors='replace').read() if os.path.exists(f) else None
report = {}; out = []
for setname, d in SETS.items():
    if not os.path.isdir(d): continue
    slugs = sorted(os.path.basename(p)[:-4] for p in glob.glob(f'{d}/*.jpg'))
    engs = engines_of(d)
    rows = {}
    for s in slugs:
        rows[s] = {}
        gt = open(f'{GT}/{s}.txt', encoding='utf-8').read() if setname == 'syriac-gt' and os.path.exists(f'{GT}/{s}.txt') else None
        served = read(d, 'served-gemini', s) if setname == 'print-loop' else None
        for e in engs:
            t = read(d, e, s)
            if t is None: rows[s][e] = {'missing': True}; continue
            a1, a2 = n1(t), n2(t)
            m = {'chars': len(a1), 'empty': len(a1) < 30, 'loop': round(loop_score(a1), 3)}
            if gt is not None:
                g1, g2 = n1(gt), n2(gt)
                # a loop 4× the page is catastrophic whatever its tail says; cap so edit distance stays tractable
                a1, a2 = a1[:3 * len(g1) + 200], a2[:3 * len(g2) + 200]
                m['cer_n1'] = round(cer(a1, g1), 4); m['cer_n2'] = round(cer(a2, g2), 4); m['dice_n2'] = round(dice(a2, g2), 3)
                m['line_cer'] = line_cer(t[:6 * len(gt) + 400], gt, n2)
            if served is not None: m['dice_vs_served'] = round(dice(a2, n2(served)), 3)
            rows[s][e] = m
    # roll-up
    summ = {}
    for e in engs:
        ms = [rows[s][e] for s in slugs if not rows[s][e].get('missing')]
        summ[e] = {'run': len(ms), 'empty': sum(m['empty'] for m in ms), 'loops': sum(m['loop'] >= 0.5 for m in ms)}
        if setname == 'syriac-gt':
            c2 = [m['cer_n2'] for m in ms if 'cer_n2' in m and not m['empty']]
            summ[e].update({'aligned': len(c2), 'median_cer_n1': round(st.median([m['cer_n1'] for m in ms if 'cer_n1' in m and not m['empty']]), 3) if c2 else None,
                            'median_cer_n2': round(st.median(c2), 3) if c2 else None, 'catastrophic': sum(v > 0.5 for v in c2), 'le_20pct': sum(v <= 0.2 for v in c2), 'median_dice': round(st.median([m['dice_n2'] for m in ms if 'dice_n2' in m]), 3) if c2 else None, 'median_line_cer': round(st.median([m['line_cer'] for m in ms if m.get('line_cer') is not None]), 3) if c2 else None})
            L = 'gemini-3.1-flash-lite'
            if e != L and L in engs:
                pair = [(rows[s][e].get('line_cer'), rows[s][L].get('line_cer')) for s in slugs if rows[s][e].get('cer_n2') is not None and rows[s][L].get('cer_n2') is not None]
                w = sum(a < b for a, b in pair); l = sum(a > b for a, b in pair)
                summ[e]['vs_lite'] = f'{w}/{l}/{len(pair) - w - l} (p={binom_two_sided(max(w, l), w + l)})'  # on line-level CER
        else:
            summ[e]['median_loop'] = round(st.median([m['loop'] for m in ms]), 3) if ms else None
            if setname == 'print-loop': summ[e]['median_dice_vs_served'] = round(st.median([m['dice_vs_served'] for m in ms if 'dice_vs_served' in m]), 3) if ms else None
    report[setname] = {'n': len(slugs), 'engines': summ, 'pages': rows}
    out.append(f'\n## {setname} (n={len(slugs)})')
    if setname == 'syriac-gt':
        out.append('| engine | run | empty | loops | aligned | median page CER (N1 / N2) | median LINE CER (order-free) | ≤0.20 | >0.5 | median Dice | vs lite W/L/T (p, line CER) |'); out.append('|---|---|---|---|---|---|---|---|---|---|---|')
        for e, v in summ.items(): out.append(f"| {e} | {v['run']} | {v['empty']} | {v['loops']} | {v.get('aligned')} | {v.get('median_cer_n1')} / {v.get('median_cer_n2')} | {v.get('median_line_cer')} | {v.get('le_20pct')} | {v.get('catastrophic')} | {v.get('median_dice')} | {v.get('vs_lite', '—')} |")
        # per-set split
        for sub in ('jerusalem36', 'onb-syr1'):
            out.append(f'  {sub} (line CER): ' + '; '.join(f"{e} {round(st.median([rows[s][e]['line_cer'] for s in slugs if s.startswith(sub) and rows[s][e].get('line_cer') is not None] or [float('nan')]), 3)}" for e in engs))
    else:
        out.append('| engine | run | empty | loops | median loop score | median Dice vs served |'); out.append('|---|---|---|---|---|---|')
        for e, v in summ.items(): out.append(f"| {e} | {v['run']} | {v['empty']} | {v['loops']} | {v.get('median_loop')} | {v.get('median_dice_vs_served', '—')} |")
        for s in slugs:
            out.append(f'\n  {s}: ' + ' | '.join(f"{e[:14]} loop={rows[s][e].get('loop')} chars={rows[s][e].get('chars')}" for e in engs if not rows[s][e].get('missing')))
json.dump(report, open(f'{R}/score.json', 'w'), ensure_ascii=False, indent=1)
print('\n'.join(out))
