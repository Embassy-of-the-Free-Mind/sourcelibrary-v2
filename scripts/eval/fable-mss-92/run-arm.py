#!/usr/bin/env python3
# PRIOR ART: scripts/eval/replicate-6547/run-claude-arm.py (the sealed one-image `claude -p` runner used for the
# October Opus arm of #6544) — imported, not copied: its request shape, sealed folder, prompt suffix and failure
# classes are reused as they are. What it lacks for #92: the lean per-item flags (JOB-HOSTS.md "Per-item claude -p
# calls run lean"), the CLI's output-token and per-model report per row (pattern from
# scripts/eval/pro-translate-6545/claude-arm.py, PR #87), and a hard stop on the first limit message.
"""
One arm of #92 (Fable 5.2 / Opus 5.5 as manuscript readers): the October sealed runner, one image per call.

  python3 run-arm.py --requests REQ.jsonl --out OUT.jsonl --arm FABLE-d1 --model claude-fable-5-2 --effort high \
      [--image-root-from /mnt/HC_Volume_105839809/jobs --image-root-to /root/jobs/_shared-6544] [--parallel 3]

The call is the October one (`--restricted --tools Read --allowedTools Read --strict-mcp-config --output-format json`),
plus `--setting-sources local --disable-slash-commands --no-session-persistence`, which only drop what a sealed
one-image call never uses. Rows add {output_tokens, input_tokens, cache_read, cache_write, model_usage} to the
October row shape. A limit reply stops the arm (exit 3); the row is not written, so a restart resumes it.
"""
import argparse, json, os, shutil, subprocess, sys, threading, time, datetime
from concurrent.futures import ThreadPoolExecutor

lock = threading.Lock()
QUOTA = ('usage limit', 'rate limit', 'usage limit reached', 'out of extra usage', 'session limit', 'weekly limit',
         'hit your limit', 'limit reached', 'resets at')


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def call(prompt, model, cwd, timeout, effort):
    args = ['claude', '-p', prompt, '--model', model, '--restricted', '--tools', 'Read', '--allowedTools', 'Read',
            '--strict-mcp-config', '--output-format', 'json', '--setting-sources', 'local',
            '--disable-slash-commands', '--no-session-persistence'] + (['--effort', effort] if effort else [])
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
    if not isinstance(j, dict):
        j = {}
    out = (j.get('result') or '').strip()
    blob = (raw + '\n' + err).lower()
    if code == -9:
        cls = 'timeout'
    elif any(q in blob for q in QUOTA) and (j.get('is_error') or not out or code != 0):
        cls = 'quota'
    elif j.get('is_error') or code != 0:
        cls = f'exit_{code}'
    elif not out:
        cls = 'empty'
    else:
        cls = None
    u = j.get('usage') or {}
    mu = j.get('modelUsage') or {}
    meta = {'turns': j.get('num_turns'), 'cost_usd_equiv': j.get('total_cost_usd'),
            'model_resolved': ','.join(mu) or None, 'output_tokens': u.get('output_tokens'),
            'input_tokens': u.get('input_tokens'), 'cache_read': u.get('cache_read_input_tokens'),
            'cache_write': u.get('cache_creation_input_tokens'), 'model_usage': mu,
            # the CLI's own wall time, which excludes the pace guard's wait for a slot (secs includes it)
            'duration_ms': j.get('duration_ms'), 'duration_api_ms': j.get('duration_api_ms')}
    return out, err or (raw[-300:] if cls else ''), secs, cls, meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--requests', required=True); ap.add_argument('--out', required=True); ap.add_argument('--arm', required=True)
    ap.add_argument('--model', required=True); ap.add_argument('--effort'); ap.add_argument('--parallel', type=int, default=2)
    ap.add_argument('--attempts', type=int, default=2); ap.add_argument('--timeout', type=int, default=900); ap.add_argument('--limit', type=int)
    ap.add_argument('--image-root-from'); ap.add_argument('--image-root-to'); ap.add_argument('--image-map', help='JSON {uid: local image path}')
    ap.add_argument('--workdir', default=os.environ.get('JOB_SCRATCH', '/tmp') + '/claude-ws')
    a = ap.parse_args()
    imap = json.load(open(a.image_map)) if a.image_map else {}
    reqs = [json.loads(l) for l in open(a.requests, encoding='utf-8') if l.strip()]
    for r in reqs:
        if r['uid'] in imap:
            r['image'] = imap[r['uid']]
        elif a.image_root_from:
            r['image'] = r['image'].replace(a.image_root_from, a.image_root_to)
    done = {}
    if os.path.exists(a.out):
        for l in open(a.out, encoding='utf-8'):
            if l.strip():
                r = json.loads(l); done[r['uid']] = r
    todo = [r for r in reqs if not (done.get(r['uid']) or {}).get('text') and os.path.exists(r['image'])]
    skipped = [r['uid'] for r in reqs if not os.path.exists(r['image'])]
    if a.limit:
        todo = todo[:a.limit]
    print(f'{a.arm}: {len(reqs)} requests, {len(todo)} to run, {len(skipped)} without image, model {a.model} effort {a.effort}', flush=True)
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
        cost, otok, dur = 0.0, 0, 0
        for tries in range(1, a.attempts + 1):
            if stop.is_set():
                return
            out, err, secs, cls, meta = call(prompt, a.model, cwd, a.timeout, a.effort)
            total += secs; cost += meta.get('cost_usd_equiv') or 0; otok += meta.get('output_tokens') or 0; dur += meta.get('duration_ms') or 0
            if cls == 'quota':
                stop.set(); print(f"QUOTA on {req['uid']}: {err[-300:]}", flush=True)
                with lock, open(a.out + '.QUOTA.txt', 'a') as f:
                    f.write(f"{now()} {req['uid']} {err[-500:]}\n")
                return
            if cls is None:
                break
        meta.update(cost_usd_equiv=round(cost, 5), output_tokens=otok, duration_ms=dur or None)
        row = {'uid': req['uid'], 'arm': a.arm, 'model': a.model, 'route': 'claude-p', 'effort': a.effort, 'date': now(),
               'text': out if cls is None else '', 'secs': round(total, 1), 'attempts': tries,
               'empty': cls in ('empty', 'timeout'), 'error': None if cls is None else f'{cls}: {err[-300:]}', **meta}
        with lock, open(a.out, 'a', encoding='utf-8') as f:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
        print(f"  {req['uid']} {cls or 'ok'} {len(row['text'])} chars {round(total)}s x{tries} {meta.get('model_resolved')}", flush=True)
        shutil.rmtree(cwd, ignore_errors=True)

    with ThreadPoolExecutor(max_workers=a.parallel) as ex:
        list(ex.map(one, todo))
    sys.exit(3 if stop.is_set() else 0)


if __name__ == '__main__':
    main()
