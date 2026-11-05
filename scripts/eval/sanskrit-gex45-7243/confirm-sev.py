#!/usr/bin/env python3
# PRIOR ART: sevprep.mjs + SEVERITY-GRADER.md + sevagg.mjs (this directory: the 7243 blind severity packets, brief and
# aggregate, reused as they are) and scripts/eval/spot-check/REVIEWER.md (the serious/moderate/minor severity and the
# 1–5 ocr_score). 7243 graded with no controls; this adds the planted controls CONFIRM.md asks for, the REVIEWER.md
# fields, and runs the graders as headless `claude -p --model opus` calls (the run-reviewers.sh shape).
"""
  python3 confirm-sev.py controls <refs dir> <arms dir>      K0 (reference as is) and K1 (one planted error) → <arms dir>
  SEV_PAGES=pages-confirm.json node sevprep.mjs <arms dir> <refs dir> <tiles dir> <sev dir>
  python3 confirm-sev.py grade <sev dir> [--par 8]           one blind Opus grader per page → <sev dir>/<slug>/grades.json
  python3 confirm-sev.py report <sev dir> <controls.json>    per-arm counts, REVIEWER.md fields, control hit rates (json)
K1 alternates by page in manifest order, seeded (7243): even = one word replaced by another word of the same page,
odd = one whole line deleted. What was planted is written to <arms dir>/controls.json, never shown to the grader.
"""
import json, os, random, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = json.load(open(os.environ.get('SEV_PAGES', os.path.join(HERE, 'pages-confirm.json'))))['pages']
DEVA = re.compile(r'[ऀ-ॿ]')
cmd = sys.argv[1]


def controls(refs, arms):
    rnd = random.Random(7243); k0 = open(os.path.join(arms, 'K0.jsonl'), 'w'); k1 = open(os.path.join(arms, 'K1.jsonl'), 'w'); key = {}
    for i, p in enumerate(PAGES):
        s = p['slug']; ref = open(os.path.join(refs, s + '.txt')).read()
        k0.write(json.dumps({'page_id': s, 'text': ref}, ensure_ascii=False) + '\n')
        lines = ref.split('\n')
        if i % 2 == 0:   # word swap: a word of ≥ 3 Devanagari letters in the middle half → another such word of the page
            cand = [(li, m) for li, l in enumerate(lines) for m in re.finditer(r'\S+', l) if len(DEVA.findall(m.group())) >= 3]
            mid = cand[len(cand) // 4: 3 * len(cand) // 4] or cand
            li, m = rnd.choice(mid); others = sorted({x.group() for _, x in cand if x.group() != m.group()})
            new = rnd.choice(others) if others else m.group()[::-1]
            lines[li] = lines[li][:m.start()] + new + lines[li][m.end():]
            key[s] = {'kind': 'word', 'line': li + 1, 'was': m.group(), 'now': new, 'expected_grade_min': 2}
        else:            # line deletion: a line of ≥ 15 Devanagari letters, not the first
            cand = [li for li, l in enumerate(lines) if li > 0 and len(DEVA.findall(l)) >= 15] or [li for li, l in enumerate(lines) if DEVA.search(l)]
            li = rnd.choice(cand); key[s] = {'kind': 'line', 'line': li + 1, 'was': lines[li], 'expected_grade_min': 3}; del lines[li]
        k1.write(json.dumps({'page_id': s, 'text': '\n'.join(lines)}, ensure_ascii=False) + '\n')
    json.dump(key, open(os.path.join(arms, 'controls.json'), 'w'), ensure_ascii=False, indent=1)
    print(len(key), 'pages;', sum(v['kind'] == 'word' for v in key.values()), 'word plants,', sum(v['kind'] == 'line' for v in key.values()), 'line plants')


ADDENDUM = """
ADDENDUM for this run (#7243 confirmation): in each output's JSON object, add two more fields from
{REVIEWER} (read only its "Severity" and "ocr_score" definitions):
  "reviewer_severity": the severity of the output's worst error, "serious" | "moderate" | "minor" | "none" (none = no error),
  "ocr_score": 1-5 as defined there (null for DNR).
Some outputs may be near-perfect and some may carry a single error; grade each on its own, exactly as you find it."""


def grade(sev, par):
    def one(s):
        out = os.path.join(sev, s, 'grades.json')
        if os.path.exists(out) and os.path.getsize(out) > 0: return s, 'ok'
        brief = re.sub(r'^<!--.*?-->\s*', '', open(os.path.join(HERE, 'SEVERITY-GRADER.md')).read(), flags=re.S)
        prompt = brief.replace('{PACKET}', os.path.join(sev, s, 'packet.json')).replace('{OUT}', out) + \
            ADDENDUM.replace('{REVIEWER}', os.path.join(HERE, '..', 'spot-check', 'REVIEWER.md'))
        for att in ('', '.retry'):
            with open(os.path.join(sev, s, f'meta{att}.json'), 'w') as mf, open(os.path.join(sev, s, f'meta{att}.err'), 'w') as ef:
                subprocess.run(['claude', '-p', '--model', 'opus', '--output-format', 'json', '--allowedTools', 'Read', 'Write'],
                               input=prompt, text=True, stdout=mf, stderr=ef, cwd=sev, timeout=2400)
            if os.path.exists(out) and os.path.getsize(out) > 0: return s, 'ok'
        return s, 'FAILED'
    with ThreadPoolExecutor(par) as ex: res = list(ex.map(one, [p['slug'] for p in PAGES]))
    print([s for s, r in res if r != 'ok'] or 'all graded')


def report(sev, ctrl_file):
    key = json.load(open(os.path.join(sev, 'key.json'))); ctrl = json.load(open(ctrl_file)); per = {}
    for p in PAGES:
        f = os.path.join(sev, p['slug'], 'grades.json')
        if not os.path.exists(f): continue
        g = json.load(open(f)); per[p['slug']] = {key[p['slug']][L]: v for L, v in g.items() if L in key[p['slug']]}
    arms = sorted({a for v in per.values() for a in v}); out = {'n_pages': len(per), 'arms': {}, 'controls': {}}
    for a in arms:
        vs = [v[a] for v in per.values() if a in v]; gr = [str(x.get('grade')) for x in vs]
        sc = [x.get('ocr_score') for x in vs if isinstance(x.get('ocr_score'), (int, float))]
        out['arms'][a] = {'n': len(vs), 'grades': {k: gr.count(k) for k in ['DNR', '0', '1', '2', '3', '4']},
                          'ge2_or_dnr': sum(1 for k in gr if k in ('DNR', '2', '3', '4')), 'misleading_4': gr.count('4'),
                          'reviewer': {k: sum(1 for x in vs if x.get('reviewer_severity') == k) for k in ['serious', 'moderate', 'minor', 'none']},
                          'mean_ocr_score': round(sum(sc) / len(sc), 2) if sc else None,
                          'n_ge2_errors': sum(int(x.get('n_ge2') or 0) for x in vs)}
    hit = [s for s, v in per.items() if 'K1' in v and str(v['K1'].get('grade')) not in ('DNR',) and v['K1'].get('grade') is not None
           and int(v['K1']['grade']) >= ctrl[s]['expected_grade_min']]
    hit_any = [s for s, v in per.items() if 'K1' in v and str(v['K1'].get('grade')) not in ('DNR', '0')]
    fa = [s for s, v in per.items() if 'K0' in v and str(v['K0'].get('grade')) not in ('0', 'DNR')]
    out['controls'] = {'K1_caught_at_expected_grade': len(hit), 'K1_flagged_any_error': len(hit_any), 'K1_n': sum(1 for v in per.values() if 'K1' in v),
                       'K1_by_kind': {k: [sum(1 for s in hit if ctrl[s]['kind'] == k), sum(1 for s in per if ctrl[s]['kind'] == k)] for k in ('word', 'line')},
                       'K0_false_alarm_grade_ge1': len(fa), 'K0_n': sum(1 for v in per.values() if 'K0' in v), 'K0_false_alarm_pages': fa,
                       'K1_missed_pages': sorted(set(per) - set(hit))}
    out['reliable'] = len(hit) >= 40
    out['per_page'] = per
    print(json.dumps({k: v for k, v in out.items() if k != 'per_page'}, ensure_ascii=False, indent=1))
    json.dump(out, open(os.path.join(sev, 'confirm-severity.json'), 'w'), ensure_ascii=False, indent=1)


if cmd == 'controls': controls(sys.argv[2], sys.argv[3])
elif cmd == 'grade': grade(sys.argv[2], int(sys.argv[sys.argv.index('--par') + 1]) if '--par' in sys.argv else 8)
elif cmd == 'report': report(sys.argv[2], sys.argv[3])
