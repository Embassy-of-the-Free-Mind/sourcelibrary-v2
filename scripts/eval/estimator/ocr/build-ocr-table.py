#!/usr/bin/env python3
# PRIOR ART: scripts/eval/build-ocr-pareto.mjs — builds the per-script Pareto charts and already exposes its page x
# engine rows (--dump-rows); it keeps no work, period, page kind or reference length per row, which a hierarchical
# model needs. scripts/eval/estimator/build-table.py is the translation table (judge scores, not CER). This joins the
# chart rows to that metadata; it re-scores nothing (#6740).
"""Long table of OCR accuracy for the OCR estimator v0 (#6740): one row per (page, engine) in the Pareto charts.

  node scripts/eval/build-ocr-pareto.mjs --dump-rows=$S/ocr-chart-rows.json
  python3 scripts/eval/estimator/ocr/build-ocr-table.py --rows $S/ocr-chart-rows.json --out $S/ocr-table.jsonl \
      --manifest scripts/eval/estimator/ocr/manifest.json

Every row keeps build-ocr-pareto.mjs's own CER (each page capped at 100% error) and its failure rule: a failed read
has cer=null and scored=false (counted, never scored, #6523). Added per row:
  chart         the script chart (the routing unit the charts already use)
  panel         the stratum, i.e. the reference set the page was scored against (a round effect in the model)
  work          the same work key build-ocr-pareto.mjs uses (pages of one work are not independent)
  kind          manuscript | print, from the chart and the stratum's script_class
  period        the catalogue year in centuries (the same buckets as benchmark-rows.mjs), else 'unknown'
  n_ref         characters in the reference where the reference text is committed; else the median length of the
                engines' reads of that page; else the chart median. Only the binomial noise depends on it.
  engine_family gemini-lite / gemini-flash / gemini-cli / gemini-4 / claude / open-vlm / specialist / classic
"""
import argparse, collections, glob, json, os, statistics

E = 'scripts/eval'
FAMILY = [
    ('gemini-3.1-flash-lite', 'gemini-lite'), ('gemini-3-flash-preview', 'gemini-flash'),
    ('gemini-4-argon', 'gemini-4'), ('+antigravity-cli', 'gemini-cli'), ('claude-', 'claude'),
    ('paddleocr', 'open-vlm'), ('qwen3-vl', 'open-vlm'), ('chandra', 'open-vlm'), ('deepseek-ocr', 'open-vlm'),
    ('mistral-ocr', 'open-vlm'), ('olmocr', 'open-vlm'), ('dots-mocr', 'open-vlm'), ('mineru', 'open-vlm'),
    ('cllg-qwen3vl', 'open-vlm'), ('kraken', 'specialist'), ('omnisyr', 'specialist'), ('qoruyo', 'specialist'),
    ('sophro', 'specialist'), ('ndlkotenocr', 'specialist'), ('surya', 'classic'), ('tesseract', 'classic'),
]
MANUSCRIPT_CHARTS = {'chinese-manuscript', 'syriac'}


def family(engine):
    return next((f for k, f in FAMILY if k in engine), 'other')


def period(y):
    if not isinstance(y, (int, float)):
        return 'unknown'
    return ('before 1500' if y < 1500 else '1500-1599' if y < 1600 else '1600-1699' if y < 1700 else
            '1700-1799' if y < 1800 else '1800-1899' if y < 1900 else '1900 on')


def page_meta():
    """slug -> {year, script_class, chars[]} from every scored result file and sealed registry."""
    meta = collections.defaultdict(lambda: {'year': None, 'script_class': None, 'chars': [], 'book_id': None})
    files = glob.glob(f'{E}/benchmark/*.json') + glob.glob(f'{E}/results/benchmark/*.json')
    for d in ['open-engine-print-5660/scored', 'open-engine-print-5660/scored-olmocr', 'engine-wave1-6011/scored',
              'engine-wave2-6011/scored', 'ocr-pareto-6293/scored', 'g4-hard-6707']:
        files += glob.glob(f'{E}/results/{d}/*.json')
    for f in files:
        try:
            pages = json.load(open(f)).get('pages')
        except Exception:
            continue
        if not isinstance(pages, list):
            continue
        for p in pages:
            if not isinstance(p, dict) or 'slug' not in p:
                continue
            m = meta[p['slug']]
            m['year'] = m['year'] or p.get('year')
            m['script_class'] = m['script_class'] or p.get('script_class')
            m['book_id'] = m['book_id'] or p.get('book_id')
            for e in (p.get('engines') or {}).values():
                c = e.get('chars') if isinstance(e, dict) else None
                c = c if isinstance(c, (int, float)) else (e.get('n_content') if isinstance(e, dict) else None)
                if isinstance(c, (int, float)) and c > 0:
                    m['chars'].append(c)
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rows', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--manifest', required=True)
    a = ap.parse_args()
    charts = json.load(open(a.rows))
    meta = page_meta()
    works = json.load(open(f'{E}/results/pareto-works.json'))['books']
    syr_print = {p['slug']: p for p in json.load(open(f'{E}/results/syriac-pareto-6295/ocr-summary.json'))['per_page']}

    def gt(dirname, slug):
        f = f'{E}/{dirname}/{slug}.json'
        return json.load(open(f)) if os.path.exists(f) else None

    def work_of(page, stratum, slug):      # build-ocr-pareto.mjs workOfPage(), plus its two Syriac rules
        if stratum == 'ref-ws':
            g = gt('ground-truth-ws', slug) or {}
            return f"scan:{g.get('commons_file') or g.get('work') or slug}"
        if stratum == 'ref-pinned':
            g = gt('ground-truth', slug) or {}
            b = g.get('book_id')
            return f"work:{works.get(b, b)}" if b else f"text:{g.get('work') or slug}"
        if stratum == 'syriac-gt':
            return f"ms:{slug.split('-')[0]}"
        if stratum == 'syriac-print-6295':
            p = syr_print.get(slug, {})
            return f"edition:{p.get('edition') or slug.split('_')[0]}"
        b = meta[slug]['book_id']
        return f"work:{works.get(b, b)}" if b else f'page:{page}'

    def ref_len(stratum, slug):
        for d in ('ground-truth-ws', 'ground-truth'):
            g = gt(d, slug) if stratum in ('ref-ws', 'ref-pinned') else None
            if g and isinstance(g.get('ocr_ground_truth'), str):
                return len(g['ocr_ground_truth']), 'reference'
        ch = meta[slug]['chars']
        return (int(statistics.median(ch)), 'engine-median') if ch else (None, None)

    out = []
    for chart, rows in charts.items():
        for r in rows:
            stratum, slug = r['page'].split('|', 1)
            m = meta[slug]
            sc = m['script_class'] or ''
            kind = 'manuscript' if chart in MANUSCRIPT_CHARTS or sc.startswith('manuscript') else 'print'
            n, nsrc = ref_len(stratum, slug)
            out.append(dict(chart=chart, panel=stratum, page=r['page'], work=work_of(r['page'], stratum, slug),
                            engine=r['engine'], engine_family=family(r['engine']), kind=kind,
                            period=period(m['year']), year=m['year'], cer=r['cer'], scored=r['cer'] is not None,
                            failure=r['failure'], n_ref=n, n_ref_source=nsrc))
    med = {c: statistics.median([x['n_ref'] for x in out if x['chart'] == c and x['n_ref']] or [1000]) for c in charts}
    for x in out:
        if not x['n_ref']:
            x['n_ref'], x['n_ref_source'] = int(med[x['chart']]), 'chart-median'
    with open(a.out, 'w') as f:
        for x in out:
            f.write(json.dumps(x) + '\n')
    C = collections.Counter
    man = dict(built_by='scripts/eval/estimator/ocr/build-ocr-table.py', source='build-ocr-pareto.mjs --dump-rows',
               rows=len(out), scored=sum(x['scored'] for x in out), failed=sum(not x['scored'] for x in out),
               pages=len({x['page'] for x in out}), works=len({x['work'] for x in out}),
               by_chart=C(x['chart'] for x in out), by_engine=C(x['engine'] for x in out),
               by_family=C(x['engine_family'] for x in out), by_kind=C(x['kind'] for x in out),
               by_period=C(x['period'] for x in out), n_ref_source=C(x['n_ref_source'] for x in out),
               failures=C(f"{x['engine']}|{x['failure']}" for x in out if not x['scored']))
    json.dump(man, open(a.manifest, 'w'), indent=1, sort_keys=True)
    print(json.dumps({k: v for k, v in man.items() if k not in ('by_engine', 'failures')}, indent=1, sort_keys=True))


if __name__ == '__main__':
    main()
