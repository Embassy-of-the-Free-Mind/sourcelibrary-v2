#!/usr/bin/env python3
# PRIOR ART: #6388 Amendment 2 (scripts/eval/experiments/2026-10-10-ocr-prereg-adjudicated-6388.md: one call per page,
# candidates A/B in seeded random order with no engine names, pick / NONE / ILLEGIBLE, planted one-character controls,
# Fable as tiebreak) and scripts/eval/replicate-6547/disagree.py (word-level spans, imported). Neither builds a ROTATED
# pair of keys from two independent reads; this does, for #6544 Set B (our manuscripts, no reference).
"""
Set B keys for #6544 (no reference; DIRECTIONAL). Pro and Opus read each page independently; the words they agree on
stand. Each disputed span goes to two referees with the image: KEY-O (Opus, `claude -p`) and KEY-G (Gemini 3.1 Pro,
`agy -p`). Neither is told which reading came from which model. Where the two keys differ, Fable (`claude -p --model
claude-fable-5-1`) settles the span; key-f is the consensus key.

  python3 build-keys.py requests   # setB/keys/req-o.jsonl, req-g.jsonl, spans.json, controls (planted spans)
  python3 build-keys.py assemble   # parse the referees' verdicts -> key-o.json, key-g.json; req-f.jsonl for Fable
  python3 build-keys.py final      # Fable's verdicts -> key-f.json; referee control catch rates; report keys.json

Controls (#6388): on pages with enough agreed text, 2 agreed words become a disputed span whose second candidate is a
plausible one-character corruption. A referee catches it by choosing the real reading. They are mixed in unmarked.
"""
import argparse, collections, json, os, random, re, sys, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'replicate-6547'))
from textmetrics import unwrap, failed_kind  # noqa: E402
from disagree import load, toks, disagreement_spans, _opcodes, _map_boundary  # noqa: E402

SENT = ('Write your answer between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers.')
REFEREE = ('Two independent readers transcribed this handwritten page. Below is their text with every passage where '
           'they differ replaced by a numbered marker such as ⟦S1⟧. After the text, each marker lists the candidate '
           'readings, labelled A, B (in no particular order).\n\n'
           'Look at the page image and decide each marked passage on its own. For each marker answer on its own line '
           'with the letter of the reading the page shows, or NONE followed by what the page actually shows there, or '
           'ILLEGIBLE if the page cannot be read at that point. Format: "S1: A", "S2: NONE: <text>", "S3: ILLEGIBLE". '
           'Answer every marker.\n\n--- TEXT ---\n{text}\n--- END OF TEXT ---\n\n--- CANDIDATES ---\n{cands}\n'
           '--- END OF CANDIDATES ---\n\n' + SENT)
WHOLE = ('Transcribe all the handwritten text on this manuscript page exactly as written, in reading order, line by '
         'line. Keep the original spelling, abbreviations, punctuation and line breaks. Do not expand abbreviations, '
         'modernise, translate or comment. Write [?] for a word you cannot read.\n\n'
         'Write the transcription between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers.')
LOOK = {'c': 'e', 'e': 'c', 'n': 'u', 'u': 'n', 'm': 'n', 'r': 't', 't': 'r', 'i': 'l', 'l': 'i', 'a': 'o', 'o': 'a', 'h': 'b', 'b': 'h',
        'f': 's', 's': 'f', 'd': 'cl', 'v': 'u', 'ب': 'ت', 'ت': 'ث', 'ج': 'ح', 'ح': 'خ', 'د': 'ذ', 'ر': 'ز', 'س': 'ش', 'ص': 'ض', 'ع': 'غ',
        'ف': 'ق', 'ܕ': 'ܪ', 'ܪ': 'ܕ', 'ܒ': 'ܟ', 'ܝ': 'ܢ', 'ב': 'כ', 'כ': 'ב', 'ד': 'ר', 'ר': 'ד', 'ה': 'ח', 'ו': 'ז', 'ס': 'ם',
        'α': 'ο', 'ο': 'α', 'ν': 'υ', 'υ': 'ν', 'ε': 'σ', 'ρ': 'φ', '己': '已', '已': '己', '未': '末', '末': '未', '日': '曰', '曰': '日',
        '土': '士', '士': '土', '大': '太', '太': '大', '人': '入', '入': '人', '天': '夫', '夫': '天', '王': '玉', '玉': '王'}


def P(root, *a):
    return os.path.join(root, 'setB', *a)


def corrupt(word, rng):
    idx = [i for i, c in enumerate(word) if c.lower() in LOOK]
    if not idx:
        return None
    i = rng.choice(idx)
    c = word[i]; n = LOOK[c.lower()]
    return word[:i] + (n.upper() if c.isupper() else n) + word[i + 1:]


def page_spans(pro, opus, merge_gap=1):
    """Spans over Pro's tokens with each reader's version. Spans separated by <= merge_gap agreed tokens are merged so
    one marker covers one local disagreement."""
    Pt, Ot = toks(pro), toks(opus)
    sp = disagreement_spans(pro, [opus])
    merged = []
    for s, e in sp:
        if merged and s - merged[-1][1] <= merge_gap:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))
    ops = _opcodes(Pt, Ot)
    out = []
    for s, e in merged:
        out.append({'s': s, 'e': e, 'pro': ''.join(Pt[s:e]).strip(), 'opus': ''.join(Ot[_map_boundary(ops, s):_map_boundary(ops, e)]).strip()})
    return Pt, out


def requests(root):
    picks = json.load(open(P(root, 'draw.json')))['picks']
    reads = {k: load(P(root, 'out', f'{k}.jsonl')) for k in ('pro', 'opus')}
    rng = random.Random(6544)
    os.makedirs(P(root, 'keys'), exist_ok=True)
    spans, reqs, ctrl_pages = {}, [], 0
    for p in picks:
        u = p['uid']
        t = {k: unwrap(reads[k][u]['text'])[0] for k in reads if reads[k].get(u) and not failed_kind(reads[k][u])}
        if len(t) < 2:
            spans[u] = {'mode': 'whole', 'have': list(t)}
            reqs.append({'uid': u, 'image': p['image'], 'prompt': WHOLE})
            continue
        Pt, sp = page_spans(t['pro'], t['opus'])
        flagged = {k for x in sp for k in range(x['s'], x['e'])}
        # controls: up to 2 agreed single words of >= 4 letters, away from any disputed span
        ctrls = []
        if ctrl_pages < 14:
            cands = [i for i, w in enumerate(Pt) if i not in flagged and i - 1 not in flagged and i + 1 not in flagged and len(re.sub(r'\W', '', w)) >= 4]
            for i in rng.sample(cands, min(2, len(cands))):
                bad = corrupt(Pt[i].strip(), rng)
                if bad and bad != Pt[i].strip():
                    ctrls.append({'s': i, 'e': i + 1, 'pro': Pt[i].strip(), 'opus': Pt[i].strip(), 'control': True, 'planted': bad})
            ctrl_pages += bool(ctrls)
        allsp = sorted(sp + ctrls, key=lambda x: x['s'])
        text, k, cand_lines = [], 0, []
        for n, x in enumerate(allsp, 1):
            text.append(''.join(Pt[k:x['s']]))
            trail = re.search(r'\s*$', Pt[x['e'] - 1]).group(0) or ' '
            text.append(f'⟦S{n}⟧{trail}')
            k = x['e']
            if x.get('control'):
                opts = [x['pro'], x['planted']]
            else:
                opts = [x['pro'], x['opus']]
            rng.shuffle(opts)
            x['n'] = n; x['A'], x['B'] = opts
            cand_lines.append(f"S{n}: A: {opts[0] or '(nothing)'} | B: {opts[1] or '(nothing)'}")
        text.append(''.join(Pt[k:]))
        spans[u] = {'mode': 'spans', 'pro_tokens': Pt, 'spans': allsp}
        if allsp:
            reqs.append({'uid': u, 'image': p['image'], 'prompt': REFEREE.format(text=''.join(text), cands='\n'.join(cand_lines))})
    json.dump(spans, open(P(root, 'keys', 'spans.json'), 'w'), ensure_ascii=False, indent=1)
    for name in ('o', 'g'):
        with open(P(root, 'keys', f'req-{name}.jsonl'), 'w', encoding='utf-8') as f:
            f.writelines(json.dumps(r, ensure_ascii=False) + '\n' for r in reqs)
    real = sum(1 for v in spans.values() if v['mode'] == 'spans' for x in v['spans'] if not x.get('control'))
    ctl = sum(1 for v in spans.values() if v['mode'] == 'spans' for x in v['spans'] if x.get('control'))
    print(f"{len(reqs)} referee requests; {real} disputed spans, {ctl} controls on {ctrl_pages} pages; "
          f"{sum(1 for v in spans.values() if v['mode'] == 'whole')} whole-page (one reader failed); "
          f"{sum(1 for v in spans.values() if v['mode'] == 'spans' and not v['spans'])} pages with full agreement")


def parse(reply):
    body = unwrap(reply or '')[0]
    out = {}
    for m in re.finditer(r'^[^\S\n]*\W?S(\d+)[^\S\n]*[:\-–][ \t]*(A|B|NONE|ILLEGIBLE)\b[ \t]*[:\-–]?[ \t]*(.*)$', body, re.M | re.I):
        out[int(m.group(1))] = (m.group(2).upper(), m.group(3).strip())
    return out


def verdict_text(x, v):
    if not v:
        return None, 'missing'
    kind, txt = v
    if kind in ('A', 'B'):
        return x[kind], kind
    if kind == 'NONE':
        return txt, 'none'
    return x['A'], 'illegible'  # an illegible span takes candidate A (random order): neutral between the two readers


def build_key(root, spans, rows):
    key, stats = {}, collections.Counter()
    verdicts = {}
    for u, v in spans.items():
        r = rows.get(u)
        if v['mode'] == 'whole':
            if r and not failed_kind(r):
                key[u] = unwrap(r['text'])[0]; stats['whole_page'] += 1
            else:
                stats['whole_page_failed'] += 1
            continue
        Pt = v['pro_tokens']
        if not v['spans']:
            key[u] = ''.join(Pt).strip(); continue
        if not r or not r.get('text'):
            stats['referee_failed_page'] += 1; continue
        pv = parse(r['text'])
        out, k = [], 0
        for x in v['spans']:
            out.append(''.join(Pt[k:x['s']]))
            t, kind = verdict_text(x, pv.get(x['n']))
            if x.get('control'):
                stats['control_' + ('caught' if t == x['pro'] else 'missed' if t == x['planted'] else 'other')] += 1
                t = x['pro']  # the key keeps the agreed reading
            else:
                stats[kind] += 1
                if t is None:
                    t = x['pro'] if (zlib.crc32(u.encode()) + x['n']) % 2 else x['opus']  # no verdict: a seeded coin between the readers
            verdicts[(u, x['n'])] = (kind, t)
            trail = re.search(r'\s*$', Pt[x['e'] - 1]).group(0) or ' '
            out.append((t or '') + trail)
            k = x['e']
        out.append(''.join(Pt[k:]))
        key[u] = ''.join(out).strip()
    return key, dict(stats), verdicts


def norm(s):
    return re.sub(r'\s+', ' ', re.sub(r'[^\w\s]', '', (s or '').lower())).strip()


def assemble(root):
    spans = json.load(open(P(root, 'keys', 'spans.json')))
    rep = {}
    V = {}
    for name in ('o', 'g'):
        key, st, V[name] = build_key(root, spans, load(P(root, 'keys', f'out-{name}.jsonl')))
        json.dump(key, open(P(root, 'keys', f'key-{name}.json'), 'w'), ensure_ascii=False, indent=1)
        rep[f'key-{name}'] = {'pages': len(key), **st}
    # spans where the two keys differ -> Fable, one call per page, the two candidates only
    picks = {p['uid']: p for p in json.load(open(P(root, 'draw.json')))['picks']}
    rng = random.Random(65440)
    freq, fspans = [], {}
    for u, v in spans.items():
        if v['mode'] != 'spans':
            continue
        diff = []
        for x in v['spans']:
            if x.get('control'):
                continue
            a, b = V['o'].get((u, x['n'])), V['g'].get((u, x['n']))
            if a and b and norm(a[1]) != norm(b[1]):
                opts = [a[1], b[1]]; rng.shuffle(opts)
                diff.append({'n': x['n'], 'o': a[1], 'g': b[1], 'A': opts[0], 'B': opts[1], 's': x['s'], 'e': x['e']})
        if not diff:
            continue
        Pt = v['pro_tokens']; text, k = [], 0
        for d in diff:
            text.append(''.join(Pt[k:d['s']])); trail = re.search(r'\s*$', Pt[d['e'] - 1]).group(0) or ' '
            text.append(f"⟦S{d['n']}⟧{trail}"); k = d['e']
        text.append(''.join(Pt[k:]))
        cands = '\n'.join(f"S{d['n']}: A: {d['A'] or '(nothing)'} | B: {d['B'] or '(nothing)'}" for d in diff)
        freq.append({'uid': u, 'image': picks[u]['image'], 'prompt': REFEREE.format(text=''.join(text), cands=cands)})
        fspans[u] = diff
    with open(P(root, 'keys', 'req-f.jsonl'), 'w', encoding='utf-8') as f:
        f.writelines(json.dumps(r, ensure_ascii=False) + '\n' for r in freq)
    json.dump(fspans, open(P(root, 'keys', 'fable-spans.json'), 'w'), ensure_ascii=False, indent=1)
    agreed = sum(1 for (u, n), a in V['o'].items() if (u, n) in V['g'] and norm(a[1]) == norm(V['g'][(u, n)][1]))
    rep['spans_both_keys'] = sum(1 for k in V['o'] if k in V['g'])
    rep['spans_keys_agree'] = agreed
    rep['spans_to_fable'] = sum(len(v) for v in fspans.values())
    rep['fable_pages'] = len(freq)
    json.dump(rep, open(P(root, 'keys', 'keys-report.json'), 'w'), indent=1)
    print(json.dumps(rep, indent=1))


def final(root):
    spans = json.load(open(P(root, 'keys', 'spans.json')))
    fsp = json.load(open(P(root, 'keys', 'fable-spans.json')))
    rows = load(P(root, 'keys', 'out-f.jsonl'))
    ko = json.load(open(P(root, 'keys', 'key-o.json'))); kg = json.load(open(P(root, 'keys', 'key-g.json')))
    lost = collections.Counter()
    settle = {}
    for u, diff in fsp.items():
        pv = parse((rows.get(u) or {}).get('text'))
        for d in diff:
            v = pv.get(d['n'])
            if not v or v[0] not in ('A', 'B'):
                lost['fable_none_or_missing'] += 1
                settle[(u, d['n'])] = d['A'] if v is None else (v[1] if v[0] == 'NONE' else d['A'])
                continue
            t = d[v[0]]
            settle[(u, d['n'])] = t
            if norm(t) == norm(d['o']):
                lost['key_g_lost'] += 1
            else:
                lost['key_o_lost'] += 1
    # consensus key: start from KEY-O's page text; rebuild pages with Fable spans from the span list
    _, _, VO = build_key(root, spans, load(P(root, 'keys', 'out-o.jsonl')))
    _, _, VG = build_key(root, spans, load(P(root, 'keys', 'out-g.jsonl')))
    kf = {}
    for u, v in spans.items():
        if v['mode'] == 'whole':
            if u in ko and u in kg:
                continue  # two different whole-page transcriptions: no consensus key for this page
            kf_u = ko.get(u) or kg.get(u)
            if kf_u:
                kf[u] = kf_u
            continue
        if u not in ko or u not in kg:
            continue
        Pt = v['pro_tokens']; out, k = [], 0
        for x in v['spans']:
            out.append(''.join(Pt[k:x['s']]))
            if x.get('control'):
                t = x['pro']
            elif (u, x['n']) in settle:
                t = settle[(u, x['n'])]
            else:
                t = (VO.get((u, x['n'])) or VG.get((u, x['n'])) or (None, x['pro']))[1]
            trail = re.search(r'\s*$', Pt[x['e'] - 1]).group(0) or ' '
            out.append((t or '') + trail); k = x['e']
        out.append(''.join(Pt[k:]))
        kf[u] = ''.join(out).strip()
    json.dump(kf, open(P(root, 'keys', 'key-f.json'), 'w'), ensure_ascii=False, indent=1)
    rep = json.load(open(P(root, 'keys', 'keys-report.json')))
    rep['fable'] = dict(lost); rep['key-f_pages'] = len(kf)
    json.dump(rep, open(P(root, 'keys', 'keys-report.json'), 'w'), indent=1)
    print(json.dumps(rep, indent=1))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('step'); ap.add_argument('--root', default=os.environ.get('JOB_SCRATCH'))
    a = ap.parse_args()
    {'requests': lambda: requests(a.root), 'assemble': lambda: assemble(a.root), 'final': lambda: final(a.root)}[a.step]()
