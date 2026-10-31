#!/usr/bin/env python3
"""#6740 read-surface, Amendment 6: the paper figures from analysis6.json, as SVG + PNG, no titles baked in (captions in
figures/CAPTIONS.md). F6 (page crops) is figure_f6.py.

PRIOR ART: figures.mjs (this directory: the first figures, hand-built SVG from surface6.json's run-level fit, before the
  screen; kept for the Box-Behnken cube); SurfaceCharts.tsx (the admin page's interactive charts). This draws the
  page-level analysis (pages a call x thinking, every language) with matplotlib (versions recorded in analysis6.json).

    py/bin/python scripts/eval/read-surface-6740/figures6.py --analysis=analysis6.json --backlog=backlog.json --out=figures/
"""
import argparse, json, math, os
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap, LogNorm, TwoSlopeNorm

ap = argparse.ArgumentParser()
ap.add_argument('--analysis'); ap.add_argument('--backlog'); ap.add_argument('--out'); ap.add_argument('--alloc', default='')
a = ap.parse_args()
A = json.load(open(a.analysis)); os.makedirs(a.out, exist_ok=True)
INK, SEC, MUTED, GRID = '#0b0b0b', '#52514e', '#898781', '#e4e3df'
OPT, LIVE = '#2a78d6', '#eb6834'
BLUES = LinearSegmentedColormap.from_list('sl', ['#e9f1fc', '#9ec5f4', '#3987e5', '#1c5cab', '#0d366b'])
DIV = LinearSegmentedColormap.from_list('sld', ['#1c5cab', '#86b6ef', '#f0efec', '#f1a07c', '#c4471c'])
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 9, 'axes.edgecolor': MUTED, 'axes.labelcolor': SEC, 'xtick.color': SEC, 'ytick.color': SEC,
                     'axes.spines.top': False, 'axes.spines.right': False, 'svg.fonttype': 'none'})
LANG = {'de': 'German', 'la': 'Latin', 'en': 'English'}
langs = [l for l in ('de', 'la', 'en') if l in A['langs']]
PPC_T = ([-1, 0, 1], ['1', '4', '8']); TH_T = ([-1, 0, 1], ['low', 'medium', 'high'])
# The decision is the post-stratified (weighted) fit where a language has weights (Amendment 6.8(b)); --unweighted draws the other.
UNW = False
def pick(l, unweighted=None):
    R = A['langs'][l]; u = UNW if unweighted is None else unweighted
    return R['unweighted'] if u or not R.get('weighted') else R['weighted']

def save(fig, name):
    fig.savefig(os.path.join(a.out, f'{name}.svg'), bbox_inches='tight'); fig.savefig(os.path.join(a.out, f'{name}.png'), dpi=220, bbox_inches='tight'); plt.close(fig); print(name)

def axes_grid(ax):
    ax.set_xticks(*PPC_T); ax.set_yticks(*TH_T); ax.set_xlabel('pages a call'); ax.set_ylabel('thinking')

def mark(ax, S):
    ax.plot(0, -1, marker='D', ms=9, color=LIVE, mec='white', mew=1.5, zorder=5)
    opt = next((c for c in S['cells'] if c['name'] == S['optimum']), None)
    if opt and not opt['live']: ax.plot(opt['x1'], opt['x3'], marker='*', ms=16, color=OPT, mec='white', mew=1.2, zorder=6)

# ── F1: the design: the Box-Behnken cube as run, and the screen's 3 x 3 grid with books a cell ──
def f1():
    fig = plt.figure(figsize=(11, 4.4)); fig.subplots_adjust(wspace=0.35)
    ax = fig.add_subplot(1, 2, 1, projection='3d')
    bbd = [(-1, -1, 0), (1, -1, 0), (-1, 1, 0), (1, 1, 0), (-1, 0, -1), (1, 0, -1), (-1, 0, 1), (1, 0, 1), (0, -1, -1), (0, 1, -1), (0, -1, 1), (0, 1, 1)]
    made = set(A.get('bbd_made', {}).get('de', []))
    for (x, y, z), rid in zip(bbd, ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B12']):
        ax.scatter(x, y, z, s=60, c=INK if rid in made else 'white', edgecolors=INK, linewidths=1.5, depthshade=False)
        ax.text(x, y, z + 0.12, rid, fontsize=7, color=SEC)
    ax.scatter(0, 0, 0, s=90, c=INK, edgecolors=INK, depthshade=False); ax.text(0, 0, 0.15, 'C1–C3', fontsize=7, color=SEC)
    for x, y, rid in ((1, -1, 'X01'), (1, 1, 'X02')):
        ax.scatter(x, y, -1, s=45, c='white', edgecolors=SEC, linewidths=1.2, linestyle='--', depthshade=False); ax.text(x, y, -0.85, rid, fontsize=7, color=SEC)
    ax.scatter(0, 0.94, -1, s=80, marker='D', c=LIVE, edgecolors='white', depthshade=False)
    for s1 in (-1, 1):
        for s2 in (-1, 1):
            ax.plot([-1, 1], [s1, s1], [s2, s2], color=GRID, lw=0.8); ax.plot([s1, s1], [-1, 1], [s2, s2], color=GRID, lw=0.8); ax.plot([s1, s1], [s2, s2], [-1, 1], color=GRID, lw=0.8)
    ax.set_xticks([-1, 0, 1], ['1', '4', '8']); ax.set_yticks([-1, 0, 1], ['1,024', '1,600', '2,400']); ax.set_zticks([-1, 0, 1], ['low', 'med', 'high'])
    ax.set_xlabel('pages a call'); ax.set_ylabel('long edge (px)'); ax.set_zlabel(''); ax.view_init(18, -58)
    ax.text2D(0.0, 1.0, 'a', transform=ax.transAxes, fontsize=11, weight='bold')
    ax2 = fig.add_subplot(1, 2, 2)
    for x1 in (-1, 0, 1):
        for x3 in (-1, 0, 1):
            live = (x1, x3) == (0, -1)
            ax2.add_patch(plt.Rectangle((x1 - 0.46, x3 - 0.46), 0.92, 0.92, fc='#fdf0ea' if live else '#f3f6fb', ec=LIVE if live else MUTED, lw=1.5 if live else 0.8))
            lines = []
            for l in langs:
                c = next(c for c in A['langs'][l]['unweighted']['cells'] if c['x1'] == x1 and c['x3'] == x3)
                n = A['langs'][l].get('ib_books', {}).get(c['name'])
                if n is not None: lines.append(f"{l} {n} books")
            ax2.text(x1, x3, ('live\n' if live else '') + '\n'.join(lines), ha='center', va='center', fontsize=8, color=INK)
    ax2.set_xlim(-1.6, 1.6); ax2.set_ylim(-1.6, 1.6); axes_grid(ax2); ax2.set_aspect('equal')
    ax2.text(-0.08, 1.02, 'b', transform=ax2.transAxes, fontsize=11, weight='bold')
    save(fig, 'f1-design')

def contour_panels(name, key, label, cmap, norm=None, ni=False, levels=None, fmt='%.1f', weighted=True):
    n = len(langs); fig, axs = plt.subplots(1, n, figsize=(3.6 * n, 3.4), squeeze=False)
    for ax, l in zip(axs[0], langs):
        S = pick(l, unweighted=not weighted); s = S['surface']; x = np.array(s['axis'])
        Z = np.array(s[key])
        cs = ax.contourf(x, x, Z, levels=levels if levels is not None else 12, cmap=cmap, norm=norm)
        ax.contour(x, x, Z, levels=cs.levels, colors='white', linewidths=0.4)
        if ni:
            H = np.array(s['delta_hi'])
            ax.contourf(x, x, H, levels=[A['margin_pp'], 1e9], colors='none', hatches=['////'], zorder=3)
            ax.contour(x, x, H, levels=[A['margin_pp']], colors=INK, linewidths=1.5, linestyles='--', zorder=4)
        for c in S['cells']: ax.plot(c['x1'], c['x3'], 'o', ms=4, color=INK, zorder=4)
        mark(ax, S); axes_grid(ax); ax.set_xlim(-1.05, 1.05); ax.set_ylim(-1.05, 1.05)
        ax.text(0.0, 1.03, f"{LANG[l]} ({S['books']} books)", transform=ax.transAxes, fontsize=9, color=INK, weight='bold')
        cb = fig.colorbar(cs, ax=ax, shrink=0.85, format=fmt); cb.set_label(label, color=SEC); cb.outline.set_edgecolor(MUTED)
    fig.tight_layout(); save(fig, name)

def f2(): contour_panels('f2-cer-contours', 'delta', 'δ CER against live (pp)', DIV, norm=TwoSlopeNorm(0, -1.5, 1.5), ni=True, levels=np.linspace(-1.5, 1.5, 13), fmt='%+.1f')
def f3():
    vals = [v for l in langs for row in pick(l)['surface']['usd_acc'] for v in row]
    lv = np.geomspace(max(1, min(vals)), max(vals), 12)
    contour_panels('f3-cost-contours', 'usd_acc', 'quota cost, $ a 1,000 accepted pages', BLUES, norm=LogNorm(lv[0], lv[-1]), levels=lv, fmt='%.0f')
def f4():
    vals = [v for l in langs for row in pick(l)['surface']['usd_acc'] for v in row]
    lv = np.geomspace(max(1, min(vals)), max(vals), 12)
    contour_panels('f4-feasible-cost', 'usd_acc', 'quota cost, $ a 1,000 accepted pages', BLUES, norm=LogNorm(lv[0], lv[-1]), levels=lv, fmt='%.0f', ni=True)
    if any(A['langs'][l].get('weighted') for l in langs):
        contour_panels('f4u-feasible-cost-unweighted', 'usd_acc', 'quota cost, $ a 1,000 accepted pages', BLUES, norm=LogNorm(lv[0], lv[-1]), levels=lv, fmt='%.0f', ni=True, weighted=False)

def f4c():
    """Small multiples: which cells are non-inferior, by language (rows) and century (columns), cost per accepted page."""
    rows = []
    for l in langs:
        for c, v in sorted(A['langs'][l]['by_century'].items()):
            if not v.get('too_few'): rows.append((l, c, v))
    if not rows: return
    n = len(rows); cols = min(4, n); r = math.ceil(n / cols)
    fig, axs = plt.subplots(r, cols, figsize=(2.6 * cols, 2.6 * r), squeeze=False)
    for ax in axs.flat: ax.axis('off')
    for ax, (l, cent, v) in zip(axs.flat, rows):
        ax.axis('on'); S = pick(l)
        for c in S['cells']:
            ok = c['name'] in v['non_inferior']
            ax.add_patch(plt.Rectangle((c['x1'] - 0.46, c['x3'] - 0.46), 0.92, 0.92, fc='#dbe9fb' if ok else 'white', ec=MUTED, lw=0.8, hatch=None if ok else '////'))
            ax.text(c['x1'], c['x3'], f"${c['usd_per_1k_accepted']:.0f}", ha='center', va='center', fontsize=7, color=INK)
        ax.plot(0, -1, marker='D', ms=6, color=LIVE, mec='white', zorder=5, alpha=0.9)
        if v.get('optimum'):
            o = next(c for c in S['cells'] if c['name'] == v['optimum'])
            if not o['live']: ax.plot(o['x1'], o['x3'] + 0.3, marker='*', ms=10, color=OPT, mec='white')
        ax.set_xlim(-1.5, 1.5); ax.set_ylim(-1.5, 1.5); ax.set_aspect('equal'); axes_grid(ax)
        ax.text(0, 1.04, f"{LANG[l]} {cent} ({v['books']} books)", transform=ax.transAxes, fontsize=8, color=INK, weight='bold')
    fig.tight_layout(); save(fig, 'f4c-by-century')

def f5():
    n = len(langs); fig, axs = plt.subplots(1, n, figsize=(3.8 * n, 3.4), squeeze=False)
    for ax, l in zip(axs[0], langs):
        R = A['langs'][l]; S = pick(l)
        band = max([v['mde_cer_pp'] for k, v in R['a_vs_a'].items()] or [0])
        ax.axhspan(-band, band, color=MUTED, alpha=0.15, lw=0); ax.axhline(A['margin_pp'], color=INK, ls='--', lw=1)
        fr = sorted([c for c in S['cells'] if c['name'] in S['frontier']], key=lambda c: c['usd_per_1k_accepted'])
        ax.plot([c['usd_per_1k_accepted'] for c in fr], [c['delta_cer_pp'] for c in fr], color=OPT, lw=2, alpha=0.6)
        for c in S['cells']:
            x, y = c['usd_per_1k_accepted'], c['delta_cer_pp']
            ax.plot([c['cpa_lo'], c['cpa_hi']], [y, y], color=MUTED, lw=0.8); ax.plot([x, x], [c['delta_lo'], c['delta_hi']], color=MUTED, lw=0.8)
            if c['live']: ax.plot(x, y, 'D', ms=8, color=LIVE, mec='white')
            else: ax.plot(x, y, 'o', ms=6 if c['name'] != S['optimum'] else 9, color=OPT if c['name'] == S['optimum'] else INK, mec='white')
            k = sorted(S['cells'], key=lambda q: q['usd_per_1k_accepted']).index(c)
            ax.annotate(c['name'].replace(' a call', '').replace(', ', '/'), (x, y), xytext=(4, [6, -12, 16, -22][k % 4]), textcoords='offset points', fontsize=6.5, color=SEC)
        ax.set_xscale('log'); ax.set_xlabel('quota cost, $ a 1,000 accepted pages'); ax.set_ylabel('δ CER against live (pp)')
        ax.text(0.0, 1.03, f"{LANG[l]} ({S['books']} books)", transform=ax.transAxes, fontsize=9, color=INK, weight='bold')
    fig.tight_layout(); save(fig, 'f5-cost-vs-accuracy')

def f7():
    """The efficiency frontier: absolute CER against cost per accepted page; live's distance to the frontier."""
    n = len(langs); fig, axs = plt.subplots(1, n, figsize=(3.8 * n, 3.5), squeeze=False)
    for ax, l in zip(axs[0], langs):
        S = pick(l); cells = S['cells']; live = next(c for c in cells if c['live'])
        fr = sorted([c for c in cells if c['name'] in S['frontier']], key=lambda c: c['usd_per_1k_accepted'])
        ax.step([c['usd_per_1k_accepted'] for c in fr], [c['cer_pp'] for c in fr], where='post', color=OPT, lw=2)
        for c in cells:
            on = c['name'] in S['frontier']
            ax.plot(c['usd_per_1k_accepted'], c['cer_pp'], 'D' if c['live'] else 'o', ms=8 if c['live'] else 6, color=LIVE if c['live'] else (OPT if on else 'white'), mec=INK if not c['live'] else 'white', mew=1.2)
            k = sorted(cells, key=lambda x: x['usd_per_1k_accepted']).index(c)
            ax.annotate(c['name'].replace(' a call', '').replace(', ', '/'), (c['usd_per_1k_accepted'], c['cer_pp']), xytext=(0, [10, -14, 22, -26][k % 4]), textcoords='offset points', fontsize=6.5, color=SEC, ha='center')
        opt = next((c for c in cells if c['name'] == S['optimum']), None)
        if opt and not opt['live']:
            ax.annotate('', xy=(opt['usd_per_1k_accepted'], live['cer_pp']), xytext=(live['usd_per_1k_accepted'], live['cer_pp']), arrowprops=dict(arrowstyle='->', color=LIVE, lw=1.2))
            ax.text(math.sqrt(opt['usd_per_1k_accepted'] * live['usd_per_1k_accepted']), live['cer_pp'], f"−{100 * opt['saving_vs_live']:.0f} % per accepted page", color=LIVE, fontsize=8, va='bottom', ha='left', transform=ax.transData) if False else ax.annotate(f"−{100 * opt['saving_vs_live']:.0f} % per accepted page", (opt['usd_per_1k_accepted'], live['cer_pp']), xytext=(0, 18), textcoords='offset points', color=LIVE, fontsize=8)
        ax.set_xscale('log'); ax.set_xlabel('quota cost, $ a 1,000 accepted pages'); ax.set_ylabel('CER (%)')
        # From zero: the CER differences between cells are a few hundredths of a point, inside the A-vs-A floor.
        ax.set_ylim(0, max(c['cer_pp'] for c in cells) * 1.6)
        ax.text(0.0, 1.03, f"{LANG[l]} ({S['books']} books)", transform=ax.transAxes, fontsize=9, color=INK, weight='bold')
    fig.tight_layout(); save(fig, 'f7-efficiency-frontier')

def f8():
    if not a.backlog or not os.path.exists(a.backlog): return
    B = json.load(open(a.backlog)); rows = [r for r in B['rows'] if r['lang'] in langs]
    fig, ax = plt.subplots(figsize=(6.4, 0.9 + 0.8 * len(rows)))
    y = np.arange(len(rows))
    key = 'weeks' if all(r.get('weeks_live') is not None for r in rows) else 'usd'
    lv = [r[f'{key}_live'] for r in rows]; bs = [r[f'{key}_best'] for r in rows]
    ax.barh(y + 0.18, lv, 0.34, color=LIVE, label='live setting'); ax.barh(y - 0.18, bs, 0.34, color=OPT, label='best setting')
    for i, r in enumerate(rows):
        ax.text(lv[i], y[i] + 0.18, f"  {lv[i]:,.0f}", va='center', fontsize=7.5, color=SEC); ax.text(bs[i], y[i] - 0.18, f"  {bs[i]:,.0f}  ({r['best']})", va='center', fontsize=7.5, color=SEC)
    ax.set_yticks(y, [f"{LANG[r['lang']]}\n{r['pages']:,} pages, {r['books']:,} books" for r in rows])
    ax.set_xlabel('weeks of the whole agy pool, at most (one lane)' if key == 'weeks' else 'list-price equivalent, US $'); ax.legend(frameon=False, fontsize=8, loc='upper left', bbox_to_anchor=(1.0, 1.0))
    ax.invert_yaxis(); fig.tight_layout(); save(fig, 'f8-backlog')

def f9():
    """Half-normal plot of the screen's effects (|t| of the mixed-model terms), CER and log cost, every language."""
    fig, axs = plt.subplots(1, 2, figsize=(7.4, 3.3))
    for ax, (mk, lab) in zip(axs, (('cer_logit', 'CER (logit)'), ('log_cost', 'log quota cost'))):
        for l, m in zip(langs, ['o', 's', '^']):
            M = A['langs'][l]['models'][mk]
            if 'coef' not in M: continue
            terms = [k for k in M['coef'] if k in ('x1', 'x3', 'x1sq', 'x3sq', 'x1x3')]
            t = sorted([(abs(M['coef'][k] / M['se'][k]), k) for k in terms])
            n = len(t); q = [__import__('scipy').stats.norm.ppf(0.5 + 0.5 * (i + 0.5) / n) for i in range(n)]
            ax.plot(q, [v for v, _ in t], m, color=INK, mfc='white' if l != 'de' else INK, ms=6, label=LANG[l])
            for qq, (v, k) in zip(q, t): ax.annotate({'x1': 'pages', 'x3': 'think', 'x1sq': 'pages²', 'x3sq': 'think²', 'x1x3': 'pages×think'}[k], (qq, v), xytext=(4, 0), textcoords='offset points', fontsize=6.5, color=SEC)
        ax.axhline(1.96, color=MUTED, ls=':', lw=1); ax.set_xlabel('half-normal quantile'); ax.set_ylabel(f'|t|, {lab}'); ax.legend(frameon=False, fontsize=7)
    fig.tight_layout(); save(fig, 'f9-half-normal')

for f in (f1, f2, f3, f4, f4c, f5, f7, f8, f9):
    try: f()
    except Exception as e: print(f.__name__, 'failed:', e)
