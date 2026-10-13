#!/usr/bin/env python3
# PRIOR ART: scripts/eval/second-reader/run-readers.sh (sealed `claude -p --restricted` readers; it reads packets of
# many pages and writes a review JSON, not one transcription per request) and scripts/eval/run-cli-arm.py on branch
# job-cli-ocr-fix-6523c (the Gemini CLI runner: same request/out row shape, sentinels, tool gate). This is the
# Claude half of that runner: one request = one sealed folder with one image, the reply taken between the
# <<<BEGIN>>>/<<<END>>> markers by the scorer, the same out-row shape so both families score alike (#6547).
"""
Run one Claude arm (`claude -p`, subscription, $0) over eval requests, one result row per request.

  python3 run-claude-arm.py --requests REQ.jsonl --out OUT.jsonl --arm greif-opus-ocr --model opus [--parallel 2]

REQ.jsonl rows: {uid, prompt, image}. The image is copied into a sealed folder (the call's cwd) as page.<ext>; the
prompt is sent with a line naming that file. The CLI runs `--restricted --tools Read --strict-mcp-config`: Read only,
confined to the folder; no Bash, no web, no MCP. OUT rows match run-cli-arm.py: {uid, arm, model, route, date, text,
secs, attempts, empty, error}. A uid already written with text is skipped on restart.
"""
import argparse, json, os, shutil, subprocess, sys, threading, time, datetime
from concurrent.futures import ThreadPoolExecutor

lock = threading.Lock()
QUOTA = ('usage limit', 'rate limit', 'Claude AI usage limit reached', 'out of extra usage')


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def call(prompt, model, cwd, timeout, effort=None):
    args = ['claude', '-p', prompt, '--model', model, '--restricted', '--tools', 'Read', '--allowedTools', 'Read',
            '--strict-mcp-config', '--output-format', 'json'] + (['--effort', effort] if effort else [])
    t0 = time.time()
    try:
        r = subprocess.run(args, capture_output=True, text=True, cwd=cwd, timeout=timeout)
        raw, err, code = r.stdout.strip(), r.stderr.strip(), r.returncode
    except subprocess.TimeoutExpired:
        raw, err, code = '', 'timeout', -9
    secs = time.time() - t0
    try:
        j = json.loads(raw)
    except ValueError:
        j = {}
    out = (j.get('result') or '').strip() if isinstance(j, dict) else ''
    blob = raw + '\n' + err
    if code == -9:
        cls = 'timeout'
    elif any(q.lower() in blob.lower() for q in QUOTA) and not out:
        cls = 'quota'
    elif j.get('is_error') or code != 0:
        cls = f'exit_{code}'
    elif not out:
        cls = 'empty'
    else:
        cls = None
    return out, err or (raw[-300:] if cls else ''), secs, cls, {'turns': j.get('num_turns'), 'cost_usd_equiv': j.get('total_cost_usd'), 'model_resolved': ','.join(j.get('modelUsage') or {}) or None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--requests', required=True); ap.add_argument('--out', required=True); ap.add_argument('--arm', required=True)
    ap.add_argument('--model', default='opus'); ap.add_argument('--effort'); ap.add_argument('--parallel', type=int, default=1)
    ap.add_argument('--attempts', type=int, default=2); ap.add_argument('--timeout', type=int, default=420); ap.add_argument('--limit', type=int)
    ap.add_argument('--workdir', default=os.environ.get('JOB_SCRATCH', '/tmp') + '/claude-ws')
    a = ap.parse_args()
    reqs = [json.loads(l) for l in open(a.requests, encoding='utf-8') if l.strip()]
    done = {}
    if os.path.exists(a.out):
        for l in open(a.out, encoding='utf-8'):
            if l.strip():
                r = json.loads(l); done[r['uid']] = r
    todo = [r for r in reqs if not (done.get(r['uid']) or {}).get('text')]
    if a.limit:
        todo = todo[:a.limit]
    print(f'{a.arm}: {len(reqs)} requests, {len(todo)} to run, model {a.model}', flush=True)
    stop = threading.Event()

    def one(req):
        if stop.is_set():
            return
        ext = os.path.splitext(req['image'])[1] or '.png'
        cwd = os.path.join(a.workdir, a.arm + '-' + ''.join(c if c.isalnum() or c in '.-_' else '_' for c in req['uid']))
        shutil.rmtree(cwd, ignore_errors=True); os.makedirs(cwd)
        shutil.copyfile(req['image'], os.path.join(cwd, 'page' + ext))
        prompt = f"{req['prompt']}\n\nThe page image is the file ./page{ext} in this folder. Open it with the Read tool."
        out, err, total, cls, meta, tries = '', '', 0.0, None, {}, 0
        for tries in range(1, a.attempts + 1):
            out, err, secs, cls, meta = call(prompt, a.model, cwd, a.timeout, a.effort)
            total += secs
            if cls == 'quota':
                stop.set(); print(f"QUOTA on {req['uid']}: {err[-300:]}", flush=True); return
            if cls is None:
                break
        row = {'uid': req['uid'], 'arm': a.arm, 'model': a.model, 'route': 'claude-p', 'effort': a.effort, 'date': now(),
               'text': out if cls is None else '', 'secs': round(total, 1), 'attempts': tries,
               'empty': cls in ('empty', 'timeout'), 'error': None if cls is None else f'{cls}: {err[-300:]}', **meta}
        with lock, open(a.out, 'a', encoding='utf-8') as f:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
        print(f"  {req['uid']} {cls or 'ok'} {len(row['text'])} chars {round(total)}s x{tries}", flush=True)
        shutil.rmtree(cwd, ignore_errors=True)

    with ThreadPoolExecutor(max_workers=a.parallel) as ex:
        list(ex.map(one, todo))
    sys.exit(3 if stop.is_set() else 0)


if __name__ == '__main__':
    main()
