#!/usr/bin/env python3
# PRIOR ART: scripts/eval/hard-hands-6731/run-claude-arm.py — the sealed `claude -p --restricted --tools Read` Opus call
# on the subscription (API keys stripped, usage-limit stop), copied; it hands ONE image to a transcription prompt. This
# hands a folder of images (whole page + two halves) to the #6769 A/B judge prompt and parses a JSON verdict.
"""
#6769 blind A/B judge: Opus 5.5 through the Claude CLI (never agy, never an API key).

  python3 judge.py --requests OUT/requests.jsonl --out OUT/verdicts.jsonl [--parallel 2]

Each request row (draw.mjs) names a folder of images and the prompt; the images are copied into a sealed one-folder
workspace. A usage-limit reply stops the run (exit 3); re-running skips uids already judged.
"""
import argparse, json, os, re, shutil, subprocess, threading, time, datetime
from concurrent.futures import ThreadPoolExecutor

USAGE_LIMIT = re.compile(r"usage limit|limit reached|hit your (?:usage )?limit|out of extra usage|rate.?limit|\b429\b|resets? (?:at )?\d", re.I)
lock = threading.Lock(); stop = threading.Event()


def env():
    e = dict(os.environ)
    for k in list(e):
        if re.match(r'^(ANTHROPIC_|CLAUDE_CODE_USE_|OPENROUTER)', k):
            del e[k]
    return e


def parse(raw):
    m = re.search(r'<<<\s*BEGIN\s*>>>([\s\S]*?)(<<<\s*END\s*>>>|$)', raw or '')
    body = m.group(1) if m else (raw or '')
    j = re.search(r'\{[\s\S]*\}', body)
    if not j:
        return None
    try:
        v = json.loads(j.group(0))
    except ValueError:
        return None
    return v if v.get('verdict') in ('A', 'B', 'same') else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--requests', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--model', default='claude-opus-5-5'); ap.add_argument('--parallel', type=int, default=2)
    ap.add_argument('--workdir', default=os.environ.get('JOB_SCRATCH', '/tmp') + '/judge-ws'); ap.add_argument('--timeout', type=int, default=1200)
    a = ap.parse_args()
    reqs = [json.loads(l) for l in open(a.requests, encoding='utf-8') if l.strip()]
    done = set()
    if os.path.exists(a.out):
        for l in open(a.out, encoding='utf-8'):
            if l.strip():
                r = json.loads(l)
                if r.get('verdict'):
                    done.add(r['uid'])
    todo = [r for r in reqs if r['uid'] not in done]
    print(f'{len(reqs)} requests, {len(done)} judged, {len(todo)} to run; {a.model} via claude CLI x{a.parallel}', flush=True)

    def one(req):
        if stop.is_set():
            return
        cwd = os.path.join(a.workdir, req['uid']); shutil.rmtree(cwd, ignore_errors=True); os.makedirs(cwd)
        for f in req['files']:
            shutil.copyfile(os.path.join(req['dir'], f), os.path.join(cwd, f))
        t0 = time.time(); err = ''; v = None; raw = ''; tries = 0
        while tries < 2 and not v:
            tries += 1
            try:
                p = subprocess.run(['claude', '-p', '--model', a.model, '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config',
                                    '--no-session-persistence', '--output-format', 'json'], input=req['prompt'], cwd=cwd, capture_output=True, text=True, timeout=a.timeout, env=env())
                out, err, code = p.stdout, p.stderr, p.returncode
            except subprocess.TimeoutExpired:
                out, code, err = '', None, 'timeout'
            try:
                j = json.loads(out)
            except ValueError:
                j = {}
            raw = str(j.get('result') or '').strip()
            failed = bool(j.get('is_error')) or code != 0
            if failed and USAGE_LIMIT.search(raw + out + err):
                stop.set(); print(f"USAGE LIMIT on {req['uid']}: {(raw + err)[-300:]}", flush=True); return
            v = None if failed else parse(raw)
        row = {'uid': req['uid'], 'model': a.model, 'resolved_model': list((j.get('modelUsage') or {}).keys()), 'route': 'claude-cli',
               'date': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'secs': round(time.time() - t0, 1), 'tries': tries, 'turns': j.get('num_turns'),
               'verdict': v, 'raw': raw, 'error': None if v else f'unparsed (exit {code}): {err[-300:]}'}
        with lock, open(a.out, 'a', encoding='utf-8') as f:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
        print(f"  {req['uid']} {(v or {}).get('verdict', 'FAILED')} {round(time.time() - t0)}s", flush=True)
        shutil.rmtree(cwd, ignore_errors=True)

    with ThreadPoolExecutor(max_workers=a.parallel) as ex:
        list(ex.map(one, todo))
    raise SystemExit(3 if stop.is_set() else 0)


if __name__ == '__main__':
    main()
