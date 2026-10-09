#!/usr/bin/env python3
# PRIOR ART: scripts/batch/cli-ocr.mjs — the CLI OCR writer; it builds its prompt from the live DB default and writes
# pages, so it cannot replay a SEALED eval request byte for byte. cli-export/README.md (#6295) and
# scripts/eval/pareto-6182/RUNBOOK-cli38-xl.md give the command shape but were run by hand on a laptop with no call
# log. This is that command shape as a resumable runner that logs every call (Derek, 2026-10-08).
"""
Run one Gemini CLI arm (`agy -p`, subscription, $0) over a list of eval requests, one result row per request.

  python3 scripts/eval/run-cli-arm.py --requests REQ.jsonl --out OUT.jsonl --arm C37-ocr --model gemini-3.7-flash-low \
      --job cli-queue-6293 --kind ocr [--parallel 1] [--prompt-file ocr-prompt.txt]
  python3 scripts/eval/run-cli-arm.py --probe --model gemini-3.7-flash-low --job cli-queue-6293

REQ.jsonl rows: {uid, prompt?, image?}. `prompt` is sent verbatim; with --prompt-file every row gets that file's text.
If `image` is set, the image is copied into a one-file workspace and attached as `@./<uid>.<ext>` at the end of the
prompt (the #6295 export's command shape), with that directory as the CLI's cwd. Every call runs with
`--mode plan --print-timeout 120s` (no tools; #6345).

OUT.jsonl rows: {uid, arm, model, route: "cli", date, text, secs, attempts, blocked, empty, error}. A uid already
written with non-empty text is skipped on restart; a row without text is retried on restart (its last row wins).
Every CLI call (each attempt) is appended to /var/log/sourcelibrary/agy-calls.jsonl as
{ts, job, model, kind, seconds, ok, error_class}. A quota error stops the run with exit 3.

Up to 2 attempts per request (--attempts). When attempt 1 ends empty because the model asked for a shell command
(denied), attempt 2 continues that conversation with NUDGE instead of starting over; the row is marked `nudged`. The empty outputs first blamed on parallelism (2026-10-08) were the model
asking for a tool headless mode cannot approve; under plan mode image calls may run 2 at a time.
"""
import argparse, json, os, re, shutil, subprocess, sys, time, datetime, threading
from concurrent.futures import ThreadPoolExecutor

CALL_LOG = '/var/log/sourcelibrary/agy-calls.jsonl'
BLOCK_MSG = "This request was blocked by Gemini's filters"
QUOTA = ('RESOURCE_EXHAUSTED', 'quota reached', 'Quota reached', 'quota exceeded', 'exhausted your')
lock = threading.Lock()
stop = threading.Event()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def log_call(job, model, kind, seconds, ok, error_class):
    row = {'ts': now(), 'job': job, 'model': model, 'kind': kind, 'seconds': round(seconds, 1), 'ok': ok, 'error_class': error_class}
    with lock, open(CALL_LOG, 'a') as f:
        f.write(json.dumps(row) + '\n')


def other_image_calls(own_dir):
    n = 0
    for pid in os.listdir('/proc'):
        if not pid.isdigit():
            continue
        try:
            c = open(f'/proc/{pid}/cmdline', 'rb').read().split(b'\0')
        except OSError:
            continue
        if len(c) > 2 and c[0] == b'agy' and c[1] == b'-p' and b'--add-dir' in c and not any(own_dir.encode() in x for x in c):
            n += 1
    return n


def wait_for_gap(own_dir, max_wait=20):
    # Other sessions' CLI jobs share the account: wait for a gap in their image calls (an image call carries
    # --add-dir) rather than racing them. Their calls can run back to back for hours with no gap (2026-10-08), so after
    # max_wait seconds this goes ahead alongside ONE other call; with two or more in flight it keeps waiting.
    t0 = time.time()
    while True:
        n = other_image_calls(own_dir)
        if n == 0 or (n == 1 and time.time() - t0 > max_wait):
            return round(time.time() - t0, 1), n
        time.sleep(0.02)


NUDGE = 'Running commands is not available here. Answer directly from the attached file now, following the instructions above exactly.'


def call(prompt, model, cwd=None, add_dir=None, timeout=180, gap_wait=20, conversation=None):
    # The CLI is an AGENT. Plan mode stops the model running tools, and never auto-approve (#6345): the image is
    # attached as `@./file` relative to cwd, so no tool is needed to open it. Even in plan mode the model sometimes
    # asks for a shell command (e.g. python to crop the image); headless mode denies it and the turn ends with an
    # empty response and `denied_actions` set. The caller then continues THAT conversation once with NUDGE.
    waited = (0, 0)
    if add_dir:
        waited = wait_for_gap(os.path.dirname(add_dir), gap_wait)
    args = ['agy', '-p', prompt, '--model', model, '--mode', 'plan', '--print-timeout', f'{timeout - 60}s', '--output-format', 'json']
    if conversation:
        args += ['--conversation', conversation]
    t0 = time.time()
    try:
        r = subprocess.run(args, capture_output=True, text=True, cwd=cwd, timeout=timeout)
        raw, err, code = r.stdout.strip(), r.stderr.strip(), r.returncode
    except subprocess.TimeoutExpired as e:
        raw, err, code = (e.stdout or b'').decode() if isinstance(e.stdout, bytes) else (e.stdout or ''), 'timeout', -9
    secs = time.time() - t0
    try:
        j = json.loads(raw)
    except ValueError:
        j = {}
    out = (j.get('response') or '').strip() if j else raw
    meta = {'conversation': j.get('conversation_id'), 'denied': [d.get('action') for d in (j.get('denied_actions') or [])]}
    blob = raw + '\n' + err
    if any(q in blob for q in QUOTA):
        cls = 'quota'
    elif code == -9:
        cls = 'timeout'
    elif code != 0:
        cls = f'exit_{code}'
    elif not out:
        cls = 'denied_tool' if meta['denied'] else 'empty'
    elif BLOCK_MSG in out:
        cls = 'safety_filter'
    else:
        cls = None
    return out, err, code, secs, cls, waited, meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--requests'); ap.add_argument('--out'); ap.add_argument('--arm'); ap.add_argument('--model', required=True)
    ap.add_argument('--job', required=True); ap.add_argument('--kind', default='ocr'); ap.add_argument('--parallel', type=int, default=1)
    ap.add_argument('--prompt-file'); ap.add_argument('--attempts', type=int, default=2); ap.add_argument('--probe', action='store_true')
    ap.add_argument('--workdir', default=os.environ.get('JOB_SCRATCH', '/tmp') + '/cli-ws'); ap.add_argument('--limit', type=int)
    ap.add_argument('--gap-wait', type=float, default=20, help='seconds to wait for a gap in other jobs\' image calls before going alongside one')
    a = ap.parse_args()

    if a.probe:
        out, err, code, secs, cls, _, _ = call('Reply with exactly: ok', a.model, timeout=180)
        log_call(a.job, a.model, 'probe', secs, cls is None, cls)
        print(json.dumps({'model': a.model, 'out': out[:200], 'err': err[-400:], 'code': code, 'secs': round(secs, 1), 'class': cls}))
        sys.exit(3 if cls == 'quota' else 0 if cls is None else 1)

    fixed = open(a.prompt_file, encoding='utf-8').read() if a.prompt_file else None
    reqs = [json.loads(l) for l in open(a.requests, encoding='utf-8') if l.strip()]
    done = {}
    if os.path.exists(a.out):
        for l in open(a.out, encoding='utf-8'):
            if l.strip():
                r = json.loads(l); done[r['uid']] = r
    todo = [r for r in reqs if not (done.get(r['uid']) or {}).get('text')]
    print(f'{a.arm}: {len(reqs)} requests, {len(reqs) - len(todo)} already done, {len(todo)} to run, model {a.model}', flush=True)
    if a.limit:
        todo = todo[:a.limit]

    def one(req):
        if stop.is_set():
            return
        prompt = fixed if fixed is not None else req['prompt']
        cwd = add_dir = None
        if req.get('image'):
            ext = os.path.splitext(req['image'])[1] or '.jpg'
            stem = re.sub(r'[^\w.-]', '_', req['uid'])  # a uid may be "stratum|slug"
            cwd = add_dir = os.path.join(a.workdir, f"{a.arm}-{stem}")
            os.makedirs(cwd, exist_ok=True)
            shutil.copyfile(req['image'], os.path.join(cwd, stem + ext))
            prompt = f"{prompt} @./{stem}{ext}"
        out, cls, total, tries, err, overlaps, waits, nudged, meta = '', None, 0.0, 0, '', 0, 0.0, False, {}
        for tries in range(1, a.attempts + 1):
            if cls == 'denied_tool' and meta.get('conversation'):
                nudged = True
                out, err, code, secs, cls, waited, meta = call(NUDGE, a.model, cwd=cwd, gap_wait=a.gap_wait, conversation=meta['conversation'])
            else:
                out, err, code, secs, cls, waited, meta = call(prompt, a.model, cwd=cwd, add_dir=add_dir, gap_wait=a.gap_wait)
            overlaps += waited[1] > 0; waits += waited[0]
            total += secs
            log_call(a.job, a.model, a.kind, secs, cls in (None, 'safety_filter'), cls)
            if cls == 'quota':
                stop.set(); print(f"QUOTA on {req['uid']}: {(out + err)[-500:]}", flush=True)
                with lock, open(os.path.join(os.path.dirname(os.path.abspath(a.out)), 'QUOTA.txt'), 'a') as f:
                    f.write(f"{now()} {a.arm} {req['uid']}\n{out}\n{err}\n")
                return
            if cls in (None, 'safety_filter'):
                break
        row = {'uid': req['uid'], 'arm': a.arm, 'model': a.model, 'route': 'cli', 'cli_mode': 'plan', 'date': now(), 'text': out if cls in (None, 'safety_filter') else '',
               'secs': round(total, 1), 'attempts': tries, 'blocked': cls == 'safety_filter', 'empty': cls in ('empty', 'denied_tool', 'timeout'), 'nudged': nudged, 'gap_wait_s': round(waits, 1), 'overlapped_other_job': overlaps, 'error': None if cls in (None, 'safety_filter') else f'{cls}: {err[-300:]}'}
        with lock, open(a.out, 'a', encoding='utf-8') as f:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
        print(f"  {req['uid']} {cls or 'ok'}{' (nudged)' if nudged else ''} {len(row['text'])} chars {round(total)}s x{tries}", flush=True)
        if cwd:
            shutil.rmtree(cwd, ignore_errors=True)

    with ThreadPoolExecutor(max_workers=a.parallel) as ex:
        list(ex.map(one, todo))
    sys.exit(3 if stop.is_set() else 0)


if __name__ == '__main__':
    main()
