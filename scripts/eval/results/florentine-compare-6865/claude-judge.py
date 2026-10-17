#!/usr/bin/env python3
# PRIOR ART: scripts/batch/claude-ocr.mjs (the sealed claude -p reader, same flags and env strip); scripts/eval/run-cli-arm.py is the agy twin used for the Gemini judge.
# Sealed Opus judge for the paired Florentine packets (copied from paired-translate-maya-6559/claude-judge.py): one `claude -p --model opus --restricted --tools Read` call per request,
# cwd = a folder holding only that page image, API keys stripped (subscription). Resumable: uids with text are skipped.
import json, os, re, shutil, subprocess, sys, time, tempfile
from concurrent.futures import ThreadPoolExecutor
req, out = sys.argv[1], sys.argv[2]; par = int(sys.argv[3]) if len(sys.argv) > 3 else 2
done = set()
if os.path.exists(out):
    for l in open(out):
        r = json.loads(l)
        if r.get('text'): done.add(r['uid'])
env = {k: v for k, v in os.environ.items() if not re.match(r'^(ANTHROPIC_|CLAUDE_CODE_USE_|OPENROUTER)', k)}
rows = [json.loads(l) for l in open(req) if l.strip()]
todo = [r for r in rows if r['uid'] not in done]
print(f'claude judge: {len(rows)} requests, {len(todo)} to run', flush=True)
def run(r):
    d = tempfile.mkdtemp(prefix='cj-', dir=os.environ.get('TMPDIR', '/tmp'))
    shutil.copy(r['image'], os.path.join(d, 'page.jpg'))
    prompt = r['prompt'] + ' the file page.jpg in this folder; open it with the Read tool.'
    t0 = time.time()
    p = subprocess.run(['claude', '-p', prompt, '--model', 'opus', '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], cwd=d, env=env, capture_output=True, text=True, timeout=1800)
    shutil.rmtree(d, ignore_errors=True)
    try: j = json.loads(p.stdout)
    except Exception: j = {}
    text = str(j.get('result') or '').strip() if not j.get('is_error') else ''
    row = {'uid': r['uid'], 'arm': 'claude-judge-florentine-6865', 'model': list((j.get('modelUsage') or {}).keys()), 'route': 'claude-cli', 'date': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'text': text, 'secs': round(time.time() - t0), 'error': None if text else (p.stdout + p.stderr)[-400:]}
    with open(out, 'a') as f: f.write(json.dumps(row) + '\n')
    print(f"  {r['uid']} {'ok' if text else 'FAIL'} {len(text)} chars {row['secs']}s", flush=True)
    if not text and re.search(r'usage limit|limit reached|rate.?limit', row['error'] or '', re.I): print('USAGE LIMIT', flush=True)
with ThreadPoolExecutor(par) as ex: list(ex.map(run, todo))
