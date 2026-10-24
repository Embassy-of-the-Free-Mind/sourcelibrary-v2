#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/ocr/build-ocr-table.py — the v0 long table (Pareto chart rows + work, period, kind,
# n_ref, family). It has no #4763 rows, no number counts, no era finer than the century and no fame marker. This adds
# them to its output and re-scores nothing (#6740).
"""Long table for the OCR estimator v1 (#6740): v0's Pareto rows plus the #4763 English gate rows.

  python3 scripts/eval/estimator/ocr/build-ocr-table-v1.py --table $S/ocr-table.jsonl \
      --gate $S/agy-scores.jsonl --bench $S/bench-122.json --meta $S/meta122.json --out $S/ocr-table-v1.jsonl

Inputs:
  --table  build-ocr-table.py's output (one row per page x engine of the Pareto charts)
  --gate   the #4763 gate scores: per page x engine (ia-djvu, lite, agy = gemini-3.8-flash-low via the agy CLI),
           scored by en-ocr-reference-5124.mjs scorePage; cer=null means the engine did not read the page
  --bench  the 122 referenced pages (slug, stratum, book_id, page_id). S1 pre-1880 prose, S2 pre-1880 date-dense,
           S3 1880-1930 prose, S4 1880-1930 date-dense
  --meta   the books' catalogue rows (year, published, editions held of the work), read from Mongo by hand

Columns added to every row:
  era        before 1700 | 1700-1879 | 1880 on | unknown. From the catalogue year; #4763 S3/S4 are 1880-1930 by
             construction, S1/S2 before 1880 (split at 1700 by year).
  fame_web   1 when the page's text is a public web transcription the reader could have seen in training (the
             Wikisource panels: ref-ws and english-ia-5124), else 0. The recitation filter keys on that.
  dense      1 for the #4763 date-dense strata (S2, S4), else 0 (the Pareto panels are prose pages).
  num_ref, num_sub, num_drop, num_ins   numbers printed / misread / dropped / spurious (#4763 rows only)
  chart      the English panels are five charts: english (EEBO-TCP early print, v0's chart),
             english-pre1880-prose (S1), english-pre1880-dense (S2), english-1880-1930-prose (S3),
             english-1880-1930-dense (S4). Prose and date-dense pages differ ~6x in median CER; a single dense
             term beside free page effects did not carry that (the SVI fit put S3's median page at 10x its observed).
"""
import argparse, collections, json, re

GATE_ENGINE = {'agy': ('gemini-3.8-flash+antigravity-cli', 'gemini-cli'),
               'lite': ('gemini-3.1-flash-lite', 'gemini-lite'),
               'ia-djvu': ('ia-djvu', 'archive-text')}
WEB_PANELS = {'ref-ws', 'english-ia-5124'}


def era_of(year):
    if year is None:
        return 'unknown'
    return 'before 1700' if year < 1700 else '1700-1879' if year < 1880 else '1880 on'


def year_of(m):
    for k in ('year', 'published'):
        hit = re.match(r'-?\d{1,4}', str(m.get(k) or ''))
        if hit:
            return int(hit.group())
    return None


def main():
    ap = argparse.ArgumentParser()
    for k in ('table', 'gate', 'bench', 'meta', 'out'):
        ap.add_argument('--' + k, required=True)
    a = ap.parse_args()
    out = []
    for line in open(a.table):
        r = json.loads(line)
        r.update(era=era_of(r.get('year')), fame_web=int(r['panel'] in WEB_PANELS), dense=0, num_ref=None,
                 num_sub=None, num_drop=None, num_ins=None, source='pareto')
        out.append(r)
    bench = {b['page_id']: b for b in json.load(open(a.bench))}
    meta = {m['book_id']: m for m in json.load(open(a.meta))}
    gate = [json.loads(l) for l in open(a.gate)]
    ref_chars = {g['page_id']: g['chars'] for g in gate if g['chars']}  # the reference's length, from any read
    for g in gate:
        b = bench[g['page_id']]
        m = meta[b['book_id']]
        late = b['stratum'] in ('S3', 'S4')
        y = year_of(m)
        era = '1880 on' if late else ('before 1700' if y is not None and y < 1700 else '1700-1879')
        eng, fam = GATE_ENGINE[g['engine']]
        scored = g['cer'] is not None
        n = int(ref_chars.get(g['page_id']) or 20)  # no engine read the page: the beta-binomial floor (n >= 20)
        out.append(dict(chart=('english-1880-1930' if late else 'english-pre1880') + ('-dense' if b['stratum'] in ('S2', 'S4') else '-prose'),
                        panel='english-ia-5124',
                        page=f"english-ia-5124|{g['page_id']}", work=f"book:{b['book_id']}", engine=eng,
                        engine_family=fam, kind='print', period=era, year=y,
                        cer=min(1.0, g['cer']) if scored else None, scored=scored,
                        failure=None if scored else 'did_not_read', n_ref=n, n_ref_source='reference',
                        era=era, fame_web=1, dense=int(b['stratum'] in ('S2', 'S4')), stratum=b['stratum'],
                        editions_held=m.get('editions_held'), num_ref=g['num_ref'] if scored else None,
                        num_sub=g['num_sub'] if scored else None, num_drop=g['num_drop'] if scored else None,
                        num_ins=g['num_ins'] if scored else None, source='gate-4763'))
    with open(a.out, 'w') as f:
        for r in out:
            f.write(json.dumps(r) + '\n')
    c = collections.Counter((r['source'], r['chart'], r['scored']) for r in out if r['chart'].startswith('english'))
    print(len(out), 'rows;', sorted(c.items()))
    print('era', collections.Counter(r['era'] for r in out))


if __name__ == '__main__':
    main()
