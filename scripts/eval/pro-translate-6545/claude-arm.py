#!/usr/bin/env python3
# PRIOR ART: scripts/eval/run-cli-arm.py (the Gemini-CLI arm runner: request rows in, one result row per request, resumable,
# a quota stop) and scripts/eval/pareto-6182/opus-arm.mjs (#6182's Opus arm, an Agent-tool context request, not a
# headless runner). This is run-cli-arm.py's shape for `claude -p` on the subscription (no API key).
"""
claude-arm.py --requests REQ.jsonl --out OUT.jsonl --arm OPUS [--model opus] [--parallel 3]

One `claude -p --model <model>` per request, prompt on stdin, cwd a fresh scratch dir. A row with `image` gets the image
copied into that dir, IMAGE_PATH in the prompt replaced by "the file <path>; open it with the Read tool", and only the
Read tool allowed; without an image no tool is allowed. The reply's text between <<<BEGIN>>>/<<<END>>> is the result.
OUT rows: {uid, arm, model, route: 'claude-cli', date, raw, text, problem, secs, attempts, error}. Restart skips uids
with text. A usage-limit reply sleeps 20 min and retries (up to 12 times), as the judge drivers do.
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, threading, time, datetime
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(__file__))
from prompts import unwrap

lock = threading.Lock()
LIMIT = ('session limit', 'weekly limit', 'usage limit', 'rate limit', 'limit reached', 'overloaded', '529', 'resets at', 'hit your limit')


def sealed_env():
    """The caller's env without API-key / session variables: subscription login only, no link to the parent session."""
    return {k: v for k, v in os.environ.items() if not re.match(r'^(ANTHROPIC_|CLAUDE_CODE_USE_|OPENROUTER|CLAUDE_CODE_MESSAGING|CLAUDE_CODE_SESSION)', k)}


def one_call(prompt, model, image, scratch, sealed=False):
    ws = tempfile.mkdtemp(prefix='cl-', dir=scratch)
    args = ['claude', '-p', '--model', model, '--output-format', 'json']
    if sealed: args += ['--strict-mcp-config', '--no-session-persistence', '--disallowedTools', 'Agent', 'Skill', 'Workflow', 'ToolSearch', 'ScheduleWakeup', 'ListAgents']
    if image:
        dst = os.path.join(ws, os.path.basename(image)); shutil.copyfile(image, dst)
        prompt = prompt.replace('IMAGE_PATH', f'the file {dst}; open it with the Read tool')
        args += ['--allowedTools', 'Read', '--disallowedTools', 'Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'Task', 'Glob', 'Grep']
    else:
        args += ['--disallowedTools', 'Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'Task', 'Read', 'Glob', 'Grep']
    t0 = time.time()
    try:
        r = subprocess.run(args, input=prompt, capture_output=True, text=True, cwd=ws, timeout=1500, env=sealed_env() if sealed else None)
        out, err, code = r.stdout, r.stderr, r.returncode
    except subprocess.TimeoutExpired:
        out, err, code = '', 'timeout', -9
    shutil.rmtree(ws, ignore_errors=True)
    try:
        j = json.loads(out); res = j.get('result') or ''; is_err = j.get('is_error'); turns = j.get('num_turns')
    except ValueError:
        res, is_err, turns = out, True, None
    return res, err, code, time.time() - t0, bool(is_err), turns


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--requests', required=True); ap.add_argument('--out', required=True); ap.add_argument('--arm', required=True)
    ap.add_argument('--model', default='opus'); ap.add_argument('--parallel', type=int, default=3); ap.add_argument('--limit', type=int)
    ap.add_argument('--sealed', action='store_true', help='no MCP servers, no session file, API-key and session env stripped (#6690 judge)')
    ap.add_argument('--raw-json', action='store_true', help='keep the reply whole (the edit-contract arm answers JSON in markers)')
    a = ap.parse_args()
    scratch = os.path.join(os.environ.get('JOB_SCRATCH', '/tmp'), 'claude-ws'); os.makedirs(scratch, exist_ok=True)
    reqs = [json.loads(l) for l in open(a.requests, encoding='utf-8') if l.strip()]
    done = set()
    if os.path.exists(a.out):
        for l in open(a.out, encoding='utf-8'):
            if l.strip():
                r = json.loads(l)
                if r.get('text'): done.add(r['uid'])
    todo = [r for r in reqs if r['uid'] not in done][: a.limit or None]
    print(f'{a.arm}: {len(reqs)} requests, {len(done)} done, {len(todo)} to run, model {a.model}', flush=True)

    def run(req):
        total, tries, res, prob, err, turns = 0.0, 0, '', 'empty', None, None
        for tries in range(1, 15):
            res, e, code, secs, is_err, turns = one_call(req['prompt'], a.model, req.get('image'), scratch, a.sealed)
            total += secs
            if is_err or code != 0:
                blob = (res + e).lower()
                if any(x in blob for x in LIMIT):
                    print(f"  LIMIT on {req['uid']}; sleeping 20m: {(res + e)[-200:]}", flush=True); time.sleep(1200); continue
                err = f'exit {code}: {(res + e)[-300:]}'
                if tries >= 3: break
                time.sleep(30); continue
            text, prob = unwrap(res)
            err = None
            if text and prob in (None, 'text outside the markers', 'reply cut before <<<END>>>'): break
            if tries >= 2: break
        text, prob = unwrap(res) if not err else ('', 'error')
        row = {'uid': req['uid'], 'arm': a.arm, 'model': f'{a.model} (claude -p)', 'route': 'claude-cli', 'date': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'raw': res, 'text': text if prob != 'empty' and not err else '', 'problem': prob, 'secs': round(total, 1), 'attempts': tries, 'turns': turns, 'error': err}
        with lock, open(a.out, 'a', encoding='utf-8') as f:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
        print(f"  {req['uid']} {prob or 'ok'} {len(row['text'])} chars {round(total)}s x{tries}", flush=True)

    with ThreadPoolExecutor(max_workers=a.parallel) as ex:
        list(ex.map(run, todo))


if __name__ == '__main__':
    main()
