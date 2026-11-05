#!/usr/bin/env python3
# PRIOR ART: scripts/eval/temp-6202/dispatch.sh (one claude -p --model opus per chunk) — this is the same shape, one call
# per page with the page image opened, for #7611's "does the misread reach the English" judge. Resumable; read-only.
#   python3 judge.py <tasks.json> <outdir> [concurrency]
import json, os, re, subprocess, sys, concurrent.futures as cf
TASKS, OUT = sys.argv[1], sys.argv[2]
CONC = int(sys.argv[3]) if len(sys.argv) > 3 else 5
TPL = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'judge-prompt.md')).read()
os.makedirs(OUT, exist_ok=True)
def run(t):
    f = os.path.join(OUT, t['key'] + '.json')
    if os.path.exists(f): return t['key'], 'done already'
    spots = '\n'.join(f'{i+1}. {s}' for i, s in enumerate(t['spots']))
    prompt = TPL.replace('{IMAGE}', t['image']).replace('{TRANSCRIPTION}', t['transcription']).replace('{ENGLISH}', t['english']).replace('{SPOTS}', spots)
    for attempt in range(2):
        try:
            r = subprocess.run(['/usr/local/bin/claude', '-p', '--model', 'opus', '--allowedTools', 'Read', '--add-dir', os.path.dirname(t['image']), '--output-format', 'json'],
                               input=prompt, capture_output=True, text=True, timeout=1200)
            env = json.loads(r.stdout)
            txt = env.get('result', '')
            m = re.search(r'\{.*\}', txt, re.S)
            res = json.loads(m.group(0))
            assert len(res['spots']) == len(t['spots'])
            json.dump({'key': t['key'], 'result': res, 'raw': txt, 'cost_usd': env.get('total_cost_usd'), 'model': 'opus'}, open(f, 'w'), ensure_ascii=False)
            return t['key'], 'ok'
        except Exception as e:
            err = f'{type(e).__name__}: {e} | {r.stdout[-300:] if "r" in dir() else ""} {r.stderr[-300:] if "r" in dir() else ""}'
    return t['key'], 'FAIL ' + err[:500]
tasks = json.load(open(TASKS))
if len(sys.argv) > 4: tasks = [t for t in tasks if t['key'] in sys.argv[4].split(',')]
with cf.ThreadPoolExecutor(CONC) as ex:
    for k, s in ex.map(run, tasks): print(k, s, flush=True)
