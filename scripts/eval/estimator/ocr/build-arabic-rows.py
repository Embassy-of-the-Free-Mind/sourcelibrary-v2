#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/ocr/build-ocr-table-v1.py — joins the Pareto rows and the #4763 gate rows into
# v1's long table; it has no Arabic source and no key-type column. scripts/eval/mss-thinking-6544/score.py scores
# #6544's arms but writes only aggregates; its per-page counts are recomputed here with its own functions (imported,
# not copied). The #7341 gate already wrote its rows in this shape (results/arabic-mss-gate-7341/gate-rows.jsonl).
"""Every Arabic-script OCR observation on main, as rows of OCR estimator v1's long table (#7341, #6740).

  python3 scripts/eval/estimator/ocr/build-arabic-rows.py --mss6544 /mnt/HC_Volume_105839809/jobs/mss-thinking-6544 \
      --out scripts/eval/estimator/ocr/results/arabic-rows.jsonl

Sources (one row per page x engine; a failed read is a did-not-read row, never scored):
  gate-7341    results/arabic-mss-gate-7341/gate-rows.jsonl: 13 Jabir manuscripts (26 pages) + Kraus 1935 print (4),
               Flash-Lite (production prompt), agy 3.8 Flash low, Opus; CER = KEY-O skeleton letters. Key: model
               (Opus referee over the Opus read and the agy read, or the Flash-Lite read where agy was filter-cut).
  6544-setA    RASAM Maghrebi Arabic, 18 pages, 9 manuscripts, EXPERT line references (BULAC). Arms: Flash-Lite,
               3.8 Flash low / high, 3.1 Pro (agy), Opus. score.py's fold and failed-read rules, re-run per page from
               the job's reads (scratch: --mss6544).
  6544-setB    Our Arabic-script manuscripts, 6 pages (2 Arabic, 3 Persian, 1 Malay Jawi), KEY-O (Opus referee over
               the Pro and Opus reads): a MODEL key, DIRECTIONAL.
  reocr-5700   11 Arabic print pages (#5695 T4 track) with a by-eye corrected transcription OF THE SERVED OCR: the
               served read (Flash-Lite or 3 Flash) and a fresh 3 Flash read, CER from ocr-score.json. The key is
               built from the served read, so the served row is self-keyed.

Columns beyond build-ocr-table-v1.py's:
  script_group  the script family the chart belongs to (model_ocr_v1.GROUP_OF): Arabic, Hebrew and Syriac are one
                group (Semitic abjads written right to left), so a new Arabic chart borrows from the other two
  key_type      reference (expert / published, every non-Arabic row) | model | corrected-served
  key_self      1 when the scored read is one the key was built from (its errors can survive into the key)
  alchemy       1 for the Jabir books (#7341): the content Gemini's CLI safety filter cut
  language      the page's language (Set B mixes Persian and Malay in Arabic script)
Skipped (and why) is listed in the experiment file; in short: every other `languages: [.. ar ..]` experiment scores
OCR by a judge of the English it yields, or by agreement, never by CER per page.
"""
import argparse, collections, json, os, sys
import sys, os as _os
sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
from provenance import label_legacy  # noqa: E402  every row says where it came from (#6740)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'eval', 'mss-thinking-6544'))

ENG = {'lite': ('gemini-3.1-flash-lite', 'gemini-lite'),
       'f38l': ('gemini-3.8-flash+antigravity-cli', 'gemini-cli'),
       'f38h': ('gemini-3.8-flash-high+antigravity-cli', 'gemini-cli'),
       'pro': ('gemini-3.1-pro+antigravity-cli', 'gemini-cli'),
       'opus': ('claude-opus-5-5', 'claude')}
SERVED = {'lite': ('gemini-3.1-flash-lite', 'gemini-lite'), 'flash': ('gemini-3-flash-preview', 'gemini-flash')}


def era_of(year):
    if year is None:
        return 'unknown'
    return 'before 1700' if year < 1700 else '1700-1879' if year < 1880 else '1880 on'


def base(**kw):
    r = dict(fame_web=0, dense=0, num_ref=None, num_sub=None, num_drop=None, num_ins=None, script='Arab',
             script_group='semitic-rtl', alchemy=0, key_self=0)
    r.update(kw)
    r['era'] = era_of(r.get('year'))
    return r


def gate_rows(path):
    rows = [json.loads(l) for l in open(path)]
    agy_failed = {r['page'] for r in rows if r['engine'].startswith('gemini-3.8') and not r['scored']}
    out = []
    for r in rows:
        eng = r['engine']
        # KEY-O spans come from the Opus read and the agy read, or Flash-Lite's where agy was cut (key-reads.py)
        self_ = eng == 'claude-opus-5-5' or (eng.startswith('gemini-3.8') and r['scored']) or \
            (eng == 'gemini-3.1-flash-lite' and r['page'] in agy_failed)
        keep = {k: r[k] for k in ('chart', 'panel', 'page', 'work', 'engine', 'engine_family', 'kind', 'period', 'year',
                                  'cer', 'scored', 'failure', 'n_ref', 'language')}
        keep['n_ref_source'] = 'reference'
        out.append(base(**keep, source='gate-7341', key_type='model', key_self=int(self_), alchemy=1,
                        usability=r.get('usability_worse')))
    return out


def mss6544_rows(root):
    import score as S  # scripts/eval/mss-thinking-6544/score.py
    out = []
    # Set A, RASAM: expert references
    P = [json.loads(l) for l in open(os.path.join(root, 'setA', 'pages.jsonl'), encoding='utf-8') if l.strip()]
    P = [p for p in P if p['dataset'] == 'rasam']
    ref = {p['uid']: p['gt'] for p in P}
    uids = list(ref)
    for arm, (eng, fam) in ENG.items():
        rows = S.load(os.path.join(root, 'setA', 'out', f'{arm}.jsonl'))
        T, _, _ = S.reads(arm, rows, uids)
        for p in P:
            u = p['uid']
            if u not in rows:
                continue  # never run (quota): neither read nor failed
            c = S.counts(T[u], ref[u]) if u in T else None
            n = S.counts(ref[u], ref[u])['cl']
            k = None if u in T else S.reads(arm, {u: rows[u]}, [u])[1]
            out.append(base(chart='arabic-manuscript', panel='rasam-6544', page=f'rasam-6544|{u}',
                            work=f"rasam:{p['work']}", engine=eng, engine_family=fam, kind='manuscript',
                            period='unknown', year=None, cer=min(1.0, c['cd'] / max(1, c['cl'])) if c else None,
                            scored=c is not None, failure=None if c else 'did_not_read', failure_kind=k and next(iter(k)),
                            n_ref=n, n_ref_source='reference', language='ar', source='6544-setA', key_type='reference'))
    # Set B, our Arabic-script manuscripts: KEY-O, built from the Pro and Opus reads
    D = [p for p in json.load(open(os.path.join(root, 'setB', 'draw.json')))['picks'] if p['stratum'] == 'arabic']
    key = json.load(open(os.path.join(root, 'setB', 'keys', 'key-o.json')))
    uids = [p['uid'] for p in D]
    lang = {'Arabic': 'ar', 'Persian': 'fa', 'Malay': 'ms'}
    for arm, (eng, fam) in ENG.items():
        rows = S.load(os.path.join(root, 'setB', 'out', f'{arm}.jsonl'))
        T, _, _ = S.reads(arm, rows, uids)
        for p in D:
            u = p['uid']
            if u not in rows or u not in key:
                continue
            c = S.counts(T[u], key[u]) if u in T else None
            n = S.counts(key[u], key[u])['cl']
            y = next((int(x) for x in __import__('re').findall(r'\b1[0-9]{3}\b', p['published'] or '')), None)
            k = None if u in T else S.reads(arm, {u: rows[u]}, [u])[1]
            out.append(base(chart='arabic-manuscript', panel='setb-6544', page=f'setb-6544|{u}',
                            work=f"book:{p['book_id']}", engine=eng, engine_family=fam, kind='manuscript',
                            period='unknown', year=y, cer=min(1.0, c['cd'] / max(1, c['cl'])) if c else None,
                            scored=c is not None, failure=None if c else 'did_not_read', failure_kind=k and next(iter(k)),
                            n_ref=max(n, 20), n_ref_source='reference', language=lang.get(p['language'], p['language']),
                            source='6544-setB', key_type='model', key_self=int(arm in ('pro', 'opus'))))
    return out


def reocr5700_rows(score_path, tracks_path):
    import score as S
    tr = {t['id']: t for t in (json.loads(l) for l in open(tracks_path))}
    out = []
    for p in json.load(open(score_path))['pages']:
        if p.get('script') != 'Arabic' or not p.get('has_corrected') or p.get('cer_served') is None:
            continue
        t = tr[p['id']]
        n = len(S.fold(t['corrected_text']).replace(' ', ''))
        y = t.get('edition_year')
        y = int(y) if isinstance(y, (int, float)) or (isinstance(y, str) and y.isdigit()) else None
        common = dict(chart='arabic-print', panel='reocr-5700', page=f"reocr-5700|{p['id']}", work=f"book:{t['book_id']}",
                      kind='print', period='unknown', year=y, scored=True, failure=None, n_ref=max(n, 20),
                      n_ref_source='reference', language='ar', source='reocr-5700', key_type='corrected-served')
        eng, fam = SERVED[p['served_engine']]
        out.append(base(**common, engine=eng, engine_family=fam, cer=min(1.0, p['cer_served']), key_self=1, arm='served'))
        if p.get('reocr_outcome') == 'text' and p.get('cer_reocr') is not None:
            out.append(base(**common, engine='gemini-3-flash-preview', engine_family='gemini-flash',
                            cer=min(1.0, p['cer_reocr']), key_self=0, arm='reocr'))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mss6544', required=True, help="#6544's job scratch (its reads, Set A pages and Set B keys)")
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    res = os.path.join(ROOT, 'scripts', 'eval', 'results')
    out = gate_rows(os.path.join(res, 'arabic-mss-gate-7341', 'gate-rows.jsonl'))
    out += mss6544_rows(a.mss6544)
    out += reocr5700_rows(os.path.join(res, 'reocr-lift-2026-10', 'ocr-score.json'),
                          os.path.join(res, 'reocr-lift-2026-10', 'track-pages.jsonl'))
    out = [label_legacy(r, 'arabic-rows', [r['source']]) for r in out]
    with open(a.out, 'w') as f:
        for r in out:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    c = collections.Counter((r['source'], r['chart'], r['engine'], r['scored']) for r in out)
    for k, v in sorted(c.items()):
        print(v, *k)
    print(len(out), 'rows,', len({r['page'] for r in out}), 'pages,', len({r['work'] for r in out}), 'works')


if __name__ == '__main__':
    main()
