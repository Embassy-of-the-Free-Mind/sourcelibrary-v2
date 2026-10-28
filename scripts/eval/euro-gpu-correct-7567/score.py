#!/usr/bin/env python3
"""score.py — #7567 page CER of any arm against the E0 panel's typed references.

PRIOR ART: scripts/eval/benchmark-score.mjs (windowed CER over passage references; strata layout of the bench, not one
jsonl per arm) and scripts/eval/latin-bakeoff-5924 score.mjs (view N, ſ→s v→u j→i, letters only, order-tolerant, Opus
references). This keeps their two choices that matter here, letters-only and a forgiving window, and adds the issue's
raw vs ſ-folded split; it reads every arm as one jsonl {page_id|slug, text, finish?, error?}.

Text handling, the same for reference and every arm:
  - engine wrappers out: ``` fences, CHURRO's XML (<Metadata> dropped, leaf text kept), HTML/markdown tags,
    $…$ LaTeX delimiters, and the corrector's metadata tags with their content (<scan-quality> <language> <script>
    <page-type> <vocab> <warning> <columns> <note> <meta> <image-desc>); other tags (e.g. <page-num>) lose the tag, keep the text;
  - line-end hyphens joined (- ¬ ⸗ = before a newline); NFC; lower case; letters and digits only.
  raw    : nothing else folded (ſ ≠ s ≠ f, u ≠ v, i ≠ j, abbreviation marks count).
  folded : ſ and f → s (the long-s-as-f habit is not counted), v → u, j → i, ß → ss, æ → ae, œ → oe, and combining
           abbreviation marks (U+0303–0305) dropped; DTA's superscript e (U+0364) → umlaut.
CER = edlib infix distance of the reference inside the arm's text (extra running heads / catchwords at the ends are
free) ÷ reference letters, capped at 1. A page is a LOOP if the arm stopped on the length cap or has > 2× the letters of
the page's median arm; TRUNCATED if it has < 0.5× that median. The median arm, not the reference, because a Wikisource
reference on a newspaper or dictionary page often covers one article of several (a full read is 2-4× it at CER 0.3%).
Both are counted, and their CER still enters the median as scored.

  score.py <panel.json> <refs.jsonl.gz> <out.json> ARM=path.jsonl [ARM=path.jsonl ...] [--shared] [--exclude=FILE]
  --shared   summaries over the pages EVERY arm answered (engines compared only on shared pages)
  --exclude  a file of slugs left out of every summary, besides panel.json `excluded_from_scoring` (always left out)
"""
import gzip, html, json, re, statistics, sys, unicodedata
import edlib

META_TAGS = 'scan-quality|language|script|page-type|vocab|warning|columns|note|header-type|meta|image-desc'


def clean(t):
    t = t or ''
    t = re.sub(r'^\s*```[a-zA-Z]*\s*$', '', t, flags=re.M)
    if '<HistoricalDocument' in t or '<Metadata>' in t:
        t = re.sub(r'<Metadata>.*?</Metadata>', '', t, flags=re.S)
        t = re.sub(r'<Description>.*?</Description>', '', t, flags=re.S)
    t = re.sub(rf'<({META_TAGS})\b[^>]*>.*?</\1>', ' ', t, flags=re.S | re.I)
    t = re.sub(rf'<({META_TAGS})\b[^>]*/?>', ' ', t, flags=re.I)
    t = re.sub(r'<br\s*/?>|</(p|div|li|tr|h\d|Line|Paragraph)>', '\n', t, flags=re.I)
    t = re.sub(r'<[^>\n]{1,200}>', ' ', t)
    t = html.unescape(t)
    t = re.sub(r'\\(alpha|beta|cdot|quad|text|mathrm|left|right)\b', ' ', t).replace('$', ' ')
    t = re.sub(r'[-¬⸗=]\s*\n\s*', '', t)
    return t


def letters(t, folded):
    t = unicodedata.normalize('NFC', clean(t)).lower()
    if folded:
        t = unicodedata.normalize('NFD', t).replace('\u0364', '\u0308')
        t = re.sub('[\u0303\u0304\u0305]', '', t)
        t = unicodedata.normalize('NFC', t)
        t = t.replace('ſ', 's').replace('f', 's').replace('v', 'u').replace('j', 'i').replace('ß', 'ss').replace('æ', 'ae').replace('œ', 'oe')
    return ''.join(c for c in t if c.isalnum())


def cer(ref, hyp):
    if not ref: return None
    if not hyp: return 1.0
    return min(1.0, edlib.align(ref, hyp, mode='HW', task='distance')['editDistance'] / len(ref))


def load_arm(p):
    rows = {}
    op = gzip.open if p.endswith('.gz') else open
    for l in op(p, 'rt'):
        if not l.strip(): continue
        r = json.loads(l); k = r.get('page_id') or r.get('slug')
        rows[k] = r
    return rows


def score_page(ref_text, row):
    out = {}
    if row is None or ('error' in row and not row.get('text')): return {'missing': True}
    txt = row.get('text') or ''
    for view in ('raw', 'folded'):
        r, h = letters(ref_text, view == 'folded'), letters(txt, view == 'folded')
        out[view] = round(cer(r, h), 4)
    rl, hl = len(letters(ref_text, True)), len(letters(txt, True))
    out['ratio'] = round(hl / rl, 3) if rl else None
    out['hl'] = hl; out['cap'] = row.get('finish') == 'length'
    return out


def flag_lengths(arms_scored):
    lens = sorted(v['hl'] for v in arms_scored.values() if not v.get('missing'))
    if not lens: return
    med = lens[len(lens) // 2]
    for v in arms_scored.values():
        if v.get('missing'): continue
        v['loop'] = bool(v.pop('cap') or v['hl'] > 2 * med)
        v['trunc'] = bool(v['hl'] < 0.5 * med)


def main():
    panel, refsp, outp = sys.argv[1:4]
    arms = dict(a.split('=', 1) for a in sys.argv[4:] if '=' in a and not a.startswith('--'))
    P = json.load(open(panel)); pages = P['pages']
    panel_excl = {e['slug'] for e in P.get('excluded_from_scoring', [])}
    refs = {json.loads(l)['slug']: json.loads(l)['ref_text'] for l in gzip.open(refsp, 'rt')}
    data = {a: load_arm(p) for a, p in arms.items()}
    per = {}
    for p in pages:
        s = p['slug']; per[s] = {'lang': p['lang'], 'set': p['set'], 'century': p['century'], 'arms': {}}
        for a in arms: per[s]['arms'][a] = score_page(refs[s], data[a].get(s))
        flag_lengths(per[s]['arms'])
    summ = {}
    excl = set(open(next(a.split('=', 1)[1] for a in sys.argv if a.startswith('--exclude='))).read().split()) if any(a.startswith('--exclude=') for a in sys.argv) else set()
    shared = '--shared' in sys.argv
    for lang in sorted({p['lang'] for p in pages}) + ['all']:
        sl = [s for s, v in per.items() if lang in ('all', v['lang']) and s not in excl and s not in panel_excl]
        if shared: sl = [s for s in sl if all(not per[s]['arms'][a].get('missing') for a in arms)]
        for a in arms:
            got = [per[s]['arms'][a] for s in sl if not per[s]['arms'][a].get('missing')]
            if not got: continue
            summ.setdefault(lang, {})[a] = {'shared_only': shared,
                'n': len(got), 'median_raw': round(statistics.median(g['raw'] for g in got), 4),
                'median_folded': round(statistics.median(g['folded'] for g in got), 4),
                'mean_folded': round(statistics.mean(g['folded'] for g in got), 4),
                'loops': sum(g['loop'] for g in got), 'trunc': sum(g['trunc'] for g in got)}
    json.dump({'arms': arms, 'summary': summ, 'pages': per}, open(outp, 'w'), indent=1)
    for lang, d in summ.items():
        print(f'== {lang}')
        for a, v in sorted(d.items(), key=lambda kv: kv[1]['median_folded']):
            print(f"  {a:14s} n={v['n']:3d} raw {v['median_raw']*100:6.2f}  folded {v['median_folded']*100:6.2f}  loops {v['loops']} trunc {v['trunc']}")


if __name__ == '__main__':
    main()
