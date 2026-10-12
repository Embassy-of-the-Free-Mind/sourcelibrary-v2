#!/usr/bin/env python3
# PRIOR ART: none for an edit contract in this repo (searched scripts/eval for "edit contract", "diagnose", "span-only",
# "TEaR"; the closest is xlref-t5's lite-check, a free check-and-fix pass). Design from Diagnose-then-Repair (arXiv
# 2609.22793): the corrector sees only the spans both judges flagged and may change only those. The contract is enforced
# here by construction: the model returns {old, new} replacements and this script applies only those whose `old` is an
# exact substring of the draft inside an agreed span; everything else is copied from the draft byte for byte.
"""
dr.py build SRC_ROUND LANG...   agreed accuracy spans on FP (Opus ∩ Pro, overlapping) → $W/dr-spans.json and requests
                                $W/req/DO.jsonl (Opus, claude -p) and $W/req/DF.jsonl (3.8 Flash, agy, image attached)
dr.py apply DST_ROUND LANG...   applies the returned edits → $W/arms-extra-<DST_ROUND>.json (texts and failed reads,
                                read by build-packet.py) and prints contract statistics (edits proposed, applied,
                                refused for falling outside the spans or not matching the draft)
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import W, read, write_jsonl, records, panel_uids, arm as stored, RESULTS
from prompts import contract_prompt, unwrap

MODE, RND = sys.argv[1], sys.argv[2]
langs = sys.argv[3:]
FP = stored('FP')
R = records()


def spans_for(src):
    J = f'{W}/judge/{src}'
    key = json.load(open(f'{J}/key.json'))['items']
    texts = json.load(open(f'{J}/texts.json'))
    import importlib.util
    os.environ.setdefault('W6545', W)
    sys.argv = ['score.py', src]
    spec = importlib.util.spec_from_file_location('sc', os.path.join(os.path.dirname(__file__), 'score.py'))
    sc = importlib.util.module_from_spec(spec); spec.loader.exec_module(sc)
    out = {}
    for i, k in key.items():
        if k['kind'] != 'ARMS' or k['lang'] not in langs: continue
        u = k['page_id']; draft = FP[u]
        got = {}
        for j in ('opus', 'pro'):
            d = sc.DEC[j].get(i, {}).get('FP')
            if not d: got = None; break
            got[j] = []
            for s in d['spans']:
                if s.get('type') != 'accuracy': continue
                q = s['quote'].strip().strip('"“”')
                k0 = draft.find(q)
                if k0 < 0:
                    k0 = draft.lower().find(q.lower()[:40])
                if k0 < 0: continue
                got[j].append((k0, k0 + len(q), s.get('why', '')))
        if not got: continue
        agreed = []
        for a in got['opus']:
            for b in got['pro']:
                if a[0] < b[1] and a[1] > b[0]:
                    lo, hi = min(a[0], b[0]), max(a[1], b[1])
                    agreed.append([lo, hi, f'{a[2]} / {b[2]}'])
        agreed.sort()
        merged = []
        for lo, hi, why in agreed:
            if merged and lo <= merged[-1][1]:
                merged[-1][1] = max(hi, merged[-1][1]); merged[-1][2] += ' / ' + why if why not in merged[-1][2] else ''
            else:
                merged.append([lo, hi, why])
        out[u] = [{'start': lo, 'end': hi, 'quote': draft[lo:hi], 'why': why} for lo, hi, why in merged]
    return out


if MODE == 'build':
    sp = spans_for(RND)
    json.dump(sp, open(f'{W}/dr-spans.json', 'w'), ensure_ascii=False, indent=1)
    DO, DF = [], []
    for u, spans in sp.items():
        if not spans: continue
        L = R[u]['lang']; img = f'{W}/img/{u}.jpg'
        DO.append({'uid': u, 'lang': L, 'image': img, 'prompt': contract_prompt(L, R[u]['ocr_text'], FP[u], spans, 'IMAGE_PATH')})
        DF.append({'uid': u, 'lang': L, 'image': img, 'prompt': contract_prompt(L, R[u]['ocr_text'], FP[u], spans, 'attached at the end of this message')})
    for name, rows in (('DO', DO), ('DF', DF)):
        p = f'{W}/req/{name}.jsonl'
        old = [r for r in read(p) if r['lang'] not in langs] if os.path.exists(p) else []
        write_jsonl(p, old + rows)
    print({L: {'pages': len([u for u in sp if R[u]['lang'] == L]), 'with_agreed_spans': len([u for u, s in sp.items() if s and R[u]['lang'] == L]),
               'spans': sum(len(s) for u, s in sp.items() if R[u]['lang'] == L)} for L in langs})

elif MODE == 'apply':
    sp = json.load(open(f'{W}/dr-spans.json'))
    texts, fails, stats = {}, {}, {}
    for name in ('DO', 'DF'):
        texts[name], fails[name] = {}, {}
        st = {'pages': 0, 'proposed': 0, 'applied': 0, 'outside_spans': 0, 'not_in_draft': 0, 'unparsed': 0, 'no_edit_pages': 0}
        rows = {}
        for r in read(f'{W}/arms/{name}.jsonl') if os.path.exists(f'{W}/arms/{name}.jsonl') else []:
            if r.get('text') or r['uid'] not in rows: rows[r['uid']] = r
        for u, spans in sp.items():
            if R[u]['lang'] not in langs: continue
            if not spans:
                continue                      # no agreed span: the arm is the draft, by construction; not judged
            r = rows.get(u)
            if not r or not (r.get('text') or '').strip(): fails[name][u] = (r or {}).get('error') or 'no read'; continue
            raw = r.get('raw') if r.get('route') == 'claude-cli' else r.get('text')
            t, _ = unwrap(raw)
            m = re.search(r'\{[\s\S]*\}', t)
            try:
                edits = json.loads(m.group(0)).get('edits', []) if m else None
            except ValueError:
                edits = None
            if edits is None: fails[name][u] = 'unparsed edits'; st['unparsed'] += 1; continue
            st['pages'] += 1
            draft = FP[u]; repl = []
            for e in edits:
                st['proposed'] += 1
                old, new = e.get('old') or '', e.get('new')
                if new is None or not old: st['not_in_draft'] += 1; continue
                k0 = draft.find(old)
                if k0 < 0: st['not_in_draft'] += 1; continue
                if not any(k0 >= s['start'] - 3 and k0 + len(old) <= s['end'] + 3 for s in spans): st['outside_spans'] += 1; continue
                repl.append((k0, k0 + len(old), new))
            repl.sort()
            out, pos = [], 0
            for a, b, new in repl:
                if a < pos: st['not_in_draft'] += 1; continue  # overlapping edits: keep the first
                out.append(draft[pos:a]); out.append(new); pos = b; st['applied'] += 1
            out.append(draft[pos:])
            texts[name][u] = ''.join(out)
            if not repl: st['no_edit_pages'] += 1
        stats[name] = st
    json.dump({'texts': texts, 'fails': fails, 'contract': stats}, open(f'{W}/arms-extra-{RND}.json', 'w'), ensure_ascii=False)
    os.makedirs(f'{RESULTS}/{RND}', exist_ok=True)
    json.dump(stats, open(f'{RESULTS}/{RND}/contract.json', 'w'), indent=1)
    print(json.dumps(stats))
