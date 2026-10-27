#!/usr/bin/env python3
"""
The words for life, placed in time: for each chosen concept in ontology.json, the century where it is most
OVER-REPRESENTED against the library, and its 90% span. Feeds "The words over time" on /articles/aliveness (#7458).

PRIOR ART: build.py — it already shows each node's raw peak_century and span_90, but the raw peak lands in the 1600s
for almost everything because the library does; this divides by the baseline instead, so it is a separate derivation
from the same counts, not a change to the atlas.

Rule: share of the concept's dated pages in a century, divided by the library's share of dated pages in that century
(baseline.by_century). Only centuries where the baseline has more than 2,000 pages and the concept at least 20 count.
Concepts flagged `broad` are refused, and so is a concept whose phrase is too often only the translator's apparatus
(apparatus-share.mjs: a sampled page where the phrase appears only inside <gloss>/<note>/<term> or [brackets], so the
page is dated to an old work that never said it): more than MAX_APPARATUS of the classed sample, or fewer than
MIN_CLASSED pages classed. The CHOSEN list is hand-picked for the essay's line of argument; each peak was
checked against the concept's era (vital force and vigour peak in BCE centuries from broad phrases, so they are out).

  python3 words-over-time.py            → src/app/articles/aliveness/words-over-time.json
  python3 words-over-time.py --all      → prints every node's top three centuries, for checking
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
OUT = os.path.join(ROOT, 'src', 'app', 'articles', 'aliveness', 'words-over-time.json')
MIN_BASE, MIN_PAGES = 2000, 20
MAX_APPARATUS, MIN_CLASSED = 0.25, 75
SOURCED_FLOOR = 0.5  # below this share of sourced work dates the page draws the row lighter

# (node id, kind shown on the page)
CHOSEN = [
    ('psyche', 'soul'),
    ('pneuma', 'breath and spirit'),
    ('anima-mundi', 'soul'),
    ('innate-heat', 'heat and moisture'),
    ('regimen', 'practice'),
    ('radical-moisture', 'heat and moisture'),
    ('archeus', 'breath and spirit'),
    ('growth-of-metals', 'living matter'),
    ('plastic-nature', 'living matter'),
    ('mechanism', 'machine'),
    ('animal-machine', 'machine'),
    ('bildungstrieb', 'force'),
    ('naturphilosophie', 'force'),
    ('animal-magnetism', 'force'),
    ('vital-principle', 'force'),
    ('makrobiotik', 'practice'),
    ('animism', 'soul'),
    ('elan-vital', 'force'),
]


def century_label(c):
    n = -c // 100 if c < 0 else c // 100 + 1
    suf = 'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')
    return f"{n}{suf} century{' BCE' if c < 0 else ''}"


def over_rep(node, base, base_total):
    bc = {int(k): v for k, v in node['counts']['by_century'].items()}
    total = sum(bc.values())
    r = {c: (n / total) / (base[c] / base_total)
         for c, n in bc.items() if base.get(c, 0) > MIN_BASE and n >= MIN_PAGES}
    return bc, total, r


def main():
    d = json.load(open(os.path.join(HERE, 'ontology.json')))
    base = {int(k): v for k, v in d['baseline']['by_century'].items()}
    base_total = sum(base.values())
    nodes = {n['id']: n for n in d['nodes']}

    if '--all' in sys.argv:
        for n in d['nodes']:
            bc, total, r = over_rep(n, base, base_total)
            top = sorted(r, key=r.get, reverse=True)[:3]
            print(f"{n['id']:24}{'broad ' if n['broad'] else '      '}{total:7} "
                  + ' | '.join(f'{century_label(c)} {r[c]:.1f}x ({bc[c]})' for c in top))
        return

    app = json.load(open(os.path.join(HERE, 'apparatus-share.json')))['nodes']
    rows, refused = [], []
    for nid, kind in CHOSEN:
        n = nodes[nid]
        assert not n['broad'], f'{nid} is flagged broad'
        a = app[nid]
        classed = a['source'] + a['body'] + a['apparatus_only']
        if classed < MIN_CLASSED or a['apparatus_only_share'] > MAX_APPARATUS:
            refused.append((nid, a['apparatus_only_share'], classed))
            continue
        bc, total, r = over_rep(n, base, base_total)
        peak = max(r, key=r.get)
        span = n['counts']['span_90']
        rows.append({
            'id': nid, 'label': n['label'], 'kind': kind,
            'peak_century': peak, 'peak_label': century_label(peak),
            'ratio': round(r[peak], 1), 'peak_pages': bc[peak], 'dated_pages': total,
            'span_from': span['from'], 'span_to': span['to'],
            'sourced_share': round(n['counts']['sourced_pages'] / total, 2),
            'sourced_low': n['counts']['sourced_pages'] / total < SOURCED_FLOOR,
            'apparatus_only_share': a['apparatus_only_share'],
        })
    rows.sort(key=lambda x: (x['peak_century'], -x['ratio']))
    out = {
        'about': 'Per concept, the century where its share of dated pages most exceeds the library\'s share '
                 f'(centuries with > {MIN_BASE} library pages and >= {MIN_PAGES} concept pages), and the span holding '
                 '90% of its dated pages. Pages dated by when the work was written. Built by '
                 'scripts/analysis/experience-map/ontology/words-over-time.py from ontology.json '
                 f"(built {d['about']['built']}).",
        'library_dated_pages': base_total,
        'refused_for_apparatus': [{'id': i, 'apparatus_only_share': s, 'classed': c} for i, s, c in refused],
        'rows': rows,
    }
    with open(OUT, 'w') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write('\n')
    for i, s, c in refused:
        print(f'refused {i}: apparatus-only {s} of {c} classed pages')
    for x in rows:
        print(f"{x['label']:22} {x['kind']:18} {x['peak_label']:20} {x['ratio']:5}x  span {x['span_from']}–{x['span_to']}  sourced {x['sourced_share']}  apparatus {x['apparatus_only_share']}")


if __name__ == '__main__':
    main()
