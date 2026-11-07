#!/usr/bin/env python3
# PRIOR ART: scripts/eval/ocr-error-to-translation-7611/judge.py — the same one-claude-p-a-page runner, sealed as the
# #8358 brief asks (--restricted --tools Read --strict-mcp-config, subscription through the box's claude pace guard,
# never the API), with the prompt template and the reply check passed in. Resumable; read-only.
#   python3 judge.py <prompt.md> <tasks.json> <outdir> [concurrency] [only-keys,comma]
import json, os, re, subprocess, sys, concurrent.futures as cf
TPL_F, TASKS, OUT = sys.argv[1:4]
CONC = int(sys.argv[4]) if len(sys.argv) > 4 else 4
TPL = open(TPL_F).read()
os.makedirs(OUT, exist_ok=True)
def fill(t):
    p = TPL.replace('{IMAGE}', t['image'])
    for k in ('TRANSCRIPTION', 'ENGLISH'):
        p = p.replace('{' + k + '}', t.get(k.lower(), ''))
    p = p.replace('{SPOTS}', '\n'.join(t.get('spots', [])) or '(none)').replace('{SPANS}', '\n'.join(t.get('spans', [])) or '(none)')
    return p
def ok(t, res):
    if 'spots' in res and len(res['spots']) != len(t.get('spots', [])): return False
    if 'spans' in t and len(res.get('spans', [])) != len(t['spans']): return False
    return True
def run(t):
    f = os.path.join(OUT, t['key'] + '.json')
    if os.path.exists(f): return t['key'], 'done already'
    prompt = fill(t); err = ''
    for attempt in range(2):
        try:
            r = subprocess.run(['claude', '-p', '--model', 'opus', '--restricted', '--tools', 'Read', '--strict-mcp-config',
                                '--add-dir', os.path.dirname(t['image']), '--output-format', 'json'],
                               input=prompt, capture_output=True, text=True, timeout=1500)
            env = json.loads(r.stdout)
            txt = env.get('result', '')
            m = re.search(r'\{.*\}', txt, re.S)
            res = json.loads(m.group(0))
            if not ok(t, res): raise ValueError('reply does not cover every spot/span')
            json.dump({'key': t['key'], 'result': res, 'raw': txt, 'cost_usd': env.get('total_cost_usd'), 'usage': env.get('usage'), 'model': 'opus'}, open(f, 'w'), ensure_ascii=False)
            return t['key'], 'ok'
        except Exception as e:
            err = f'{type(e).__name__}: {e} | {(r.stdout if "r" in dir() else "")[-300:]} {(r.stderr if "r" in dir() else "")[-300:]}'
    return t['key'], 'FAIL ' + err[:500]
tasks = json.load(open(TASKS))
if len(sys.argv) > 5: tasks = [t for t in tasks if t['key'] in sys.argv[5].split(',')]
with cf.ThreadPoolExecutor(CONC) as ex:
    for k, s in ex.map(run, tasks): print(k, s, flush=True)
