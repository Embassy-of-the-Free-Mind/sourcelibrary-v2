#!/usr/bin/env python3
# PRIOR ART: scripts/batch/claude-ocr.mjs (#6559) — the sealed `claude -p --restricted --tools Read` Opus reader on the
# subscription, with its API-key strip and usage-limit test, copied here; it reads whole books from Mongo and writes a
# per-page tree for `cli-ocr.mjs apply`. scripts/eval/run-cli-arm.py (#6523) — the request/row format and the
# <<<BEGIN>>>/<<<END>>> markers this keeps, so score.mjs reads both routes the same way. Neither takes an eval
# request file through `claude`.
"""
OPUS arm for #6731 through the Claude CLI (Amendment 1: agy's Claude pool was capped for 161 h after 2 calls).

  python3 run-claude-arm.py --requests REQ.jsonl --out OUT.jsonl --arm OPUS-greek [--parallel 2] [--model claude-opus-5-5]

One page per call: the image is copied as page.<ext> into a sealed one-file folder, and the request's prompt is sent
with an instruction to open it with the Read tool, then the marker instruction. Rows as run-cli-arm.py writes them.
A usage-limit reply stops the run (exit 3); re-running skips uids already read.
"""
import argparse, json, os, re, shutil, subprocess, sys, time, datetime, threading
from concurrent.futures import ThreadPoolExecutor

SENTINEL = 'Write the transcription between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers: no preamble, no plan, no summary, no offers, no questions.'
USAGE_LIMIT = re.compile(r"usage limit|limit reached|hit your (?:usage )?limit|out of extra usage|rate.?limit|\b429\b|resets? (?:at )?\d", re.I)
lock = threading.Lock(); stop = threading.Event()


def unwrap(raw):
    m = re.search(r'<<<\s*BEGIN\s*>>>', raw or '')
    if not m:
        return (raw or '').strip(), ('no <<<BEGIN>>> marker' if (raw or '').strip() else None)
    rest = raw[m.end():]
    e = re.search(r'<<<\s*END\s*>>>', rest)
    inside = (rest[:e.start()] if e else rest).strip()
    outside = (raw[:m.start()] + (rest[e.end():] if e else '')).strip()
    return inside, ('text outside the markers' if outside else None if e else 'reply cut before <<<END>>>')


def env():
    e = dict(os.environ)
    for k in list(e):
        if re.match(r'^(ANTHROPIC_|CLAUDE_CODE_USE_|OPENROUTER)', k):
            del e[k]
    return e


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--requests', required=True); ap.add_argument('--out', required=True); ap.add_argument('--arm', required=True)
    ap.add_argument('--model', default='claude-opus-5-5'); ap.add_argument('--parallel', type=int, default=2)
    ap.add_argument('--workdir', default=os.environ.get('JOB_SCRATCH', '/tmp') + '/claude-ws'); ap.add_argument('--timeout', type=int, default=900)
    ap.add_argument('--limit', type=int)
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
    print(f'{a.arm}: {len(reqs)} requests, {len(reqs) - len(todo)} done, {len(todo)} to run, {a.model} via claude CLI', flush=True)

    def one(req):
        if stop.is_set():
            return
        stem = re.sub(r'[^\w.-]', '_', req['uid'])
        cwd = os.path.join(a.workdir, f'{a.arm}-{stem}'); shutil.rmtree(cwd, ignore_errors=True); os.makedirs(cwd)
        prompt = req['prompt']
        if req.get('image'):
            ext = os.path.splitext(req['image'])[1] or '.jpg'
            shutil.copyfile(req['image'], os.path.join(cwd, 'page' + ext))
            prompt += f'\n\nThe page image is the file page{ext} in this folder. Open it with the Read tool and transcribe it.'
        prompt += '\n\n' + SENTINEL
        t0 = time.time(); err = ''
        try:
            p = subprocess.run(['claude', '-p', prompt, '--model', a.model, '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config',
                                '--no-session-persistence', '--output-format', 'json'], cwd=cwd, capture_output=True, text=True, timeout=a.timeout, env=env())
            out, err, code = p.stdout, p.stderr, p.returncode
        except subprocess.TimeoutExpired:
            out, code, err = '', None, 'timeout'
        secs = time.time() - t0
        try:
            j = json.loads(out)
        except ValueError:
            j = {}
        raw = str(j.get('result') or '').strip()
        failed = bool(j.get('is_error')) or code != 0
        cls = 'usage_limit' if failed and USAGE_LIMIT.search(raw + out + err) else 'timeout' if code is None else (f'exit_{code}' if failed else ('empty' if not raw else None))
        if cls == 'usage_limit':
            stop.set(); print(f"USAGE LIMIT on {req['uid']}: {(raw + err)[-300:]}", flush=True); return
        text, wrapper = unwrap(raw) if raw and not failed else ('', None)
        u = j.get('usage') or {}
        row = {'uid': req['uid'], 'arm': a.arm, 'model': a.model, 'resolved_model': list((j.get('modelUsage') or {}).keys()), 'route': 'claude-cli', 'date': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'text': text, 'raw': raw, 'wrapper': wrapper, 'secs': round(secs, 1), 'attempts': 1, 'blocked': False, 'empty': cls in ('empty', 'timeout'),
               'gate_denials': 0, 'turns': j.get('num_turns'), 'usage': {'input': u.get('input_tokens'), 'output': u.get('output_tokens'), 'cache_read': u.get('cache_read_input_tokens')},
               'error': None if cls is None else f'{cls}: {err[-300:]}'}
        with lock, open(a.out, 'a', encoding='utf-8') as f:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
        print(f"  {req['uid']} {cls or 'ok'} {len(text)} chars {round(secs)}s", flush=True)
        shutil.rmtree(cwd, ignore_errors=True)

    with ThreadPoolExecutor(max_workers=a.parallel) as ex:
        list(ex.map(one, todo))
    sys.exit(3 if stop.is_set() else 0)


if __name__ == '__main__':
    main()
