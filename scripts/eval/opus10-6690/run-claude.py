#!/usr/bin/env python3
# PRIOR ART: scripts/eval/pro-translate-6545/claude-arm.py (the #6545 OPUS arm runner: one `claude -p` per request, tools
# off, the reply's text between the markers) — kept as is, but it drops the CLI's usage block, and #6690 must report
# quota per 100 pages; scripts/batch/claude-ocr.mjs (claudeEnv strip, the usage fields it keeps, and splitPages: a
# reply whose page markers are not exactly the pages sent is refused whole, retried once).
"""
run-claude.py --requests REQ.jsonl --out OUT.jsonl --arm O1|O10 [--model opus] [--parallel 2] [--only RUN,...]

One `claude -p --model opus --output-format json` per request, prompt on stdin, no tools, a fresh empty cwd, the
API-key variables stripped (subscription only). OUT rows: {uid, arm, run, raw, text, problem, pages?, secs, attempts,
usage, model, date, meter_before}. For O10 a request is a block of pages: the text between <<<BEGIN>>>/<<<END>>> must
hold exactly one <translation page="N"> per page sent, in order; otherwise the call is retried once and then recorded
as refused (problem 'markers'). Restart skips uids that have text. A usage-limit reply sleeps 20 min (12 tries).
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, threading, time, datetime
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'pro-translate-6545'))
from prompts import unwrap

lock = threading.Lock()
LIMIT = re.compile(r'usage limit|limit reached|hit your (?:usage |session |weekly )?limit|rate.?limit|\b429\b|overloaded|resets? (?:at )?\d', re.I)
TOOLS_OFF = ['Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'Task', 'Read', 'Glob', 'Grep', 'NotebookEdit']
PAGE_RE = re.compile(r'<translation\s+page="(\d+)"\s*>([\s\S]*?)</translation>')


def env():
    e = dict(os.environ)
    for k in list(e):
        if re.match(r'^(ANTHROPIC_|CLAUDE_CODE_USE_|OPENROUTER|CLAUDE_CODE_MESSAGING|CLAUDE_CODE_SESSION)', k): del e[k]
    return e


def meter():
    try:
        out = subprocess.check_output([os.path.join(os.environ.get('JOB_SCRATCH', '/tmp'), 'wk.sh')], text=True, timeout=20)
        m = re.search(r"'weekly_all:all', (\d+)", out); a = re.search(r'age_s (\d+)', out)
        return {'weekly_pct': int(m.group(1)) if m else None, 'age_s': int(a.group(1)) if a else None}
    except Exception as ex:
        return {'error': str(ex)[:80]}


def split_block(text, pages):
    """The page texts in order, or None unless the blocks are exactly `pages` in order with nothing else around them."""
    ms = list(PAGE_RE.finditer(text or ''))
    if [int(m.group(1)) for m in ms] != list(pages): return None
    rest = PAGE_RE.sub('', text)
    rest = re.sub(r'<(summary|keywords)>[\s\S]*?</\1>', '', rest).strip()
    if rest: return None
    return [m.group(2).strip() for m in ms]


def one_call(prompt, model, scratch):
    ws = tempfile.mkdtemp(prefix='cl-', dir=scratch)
    args = ['claude', '-p', '--model', model, '--output-format', 'json', '--strict-mcp-config', '--no-session-persistence', '--disallowedTools', *TOOLS_OFF]
    t0 = time.time()
    try:
        r = subprocess.run(args, input=prompt, capture_output=True, text=True, cwd=ws, timeout=1800, env=env())
        out, err, code = r.stdout, r.stderr, r.returncode
    except subprocess.TimeoutExpired:
        out, err, code = '', 'timeout', -9
    shutil.rmtree(ws, ignore_errors=True)
    try:
        j = json.loads(out)
    except ValueError:
        j = {'result': out, 'is_error': True}
    u = j.get('usage') or {}
    usage = {'input': u.get('input_tokens'), 'output': u.get('output_tokens'), 'cache_read': u.get('cache_read_input_tokens'),
             'cache_creation': u.get('cache_creation_input_tokens'), 'turns': j.get('num_turns'), 'list_cost_usd': j.get('total_cost_usd'),
             'models': list((j.get('modelUsage') or {}).keys())}
    return j.get('result') or '', err, code, time.time() - t0, bool(j.get('is_error')), usage


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--requests', required=True); ap.add_argument('--out', required=True); ap.add_argument('--arm', required=True)
    ap.add_argument('--model', default='opus'); ap.add_argument('--parallel', type=int, default=2); ap.add_argument('--only')
    ap.add_argument('--skip', help='uids to leave out (the reused #6545 anchors)')
    a = ap.parse_args()
    scratch = os.path.join(os.environ.get('JOB_SCRATCH', '/tmp'), 'claude-ws'); os.makedirs(scratch, exist_ok=True)
    reqs = [json.loads(l) for l in open(a.requests, encoding='utf-8') if l.strip()]
    if a.only: reqs = [r for r in reqs if r['run'] in a.only.split(',')]
    skip = set((a.skip or '').split(','))
    done = set()
    if os.path.exists(a.out):
        for l in open(a.out, encoding='utf-8'):
            if l.strip():
                r = json.loads(l)
                if r.get('text') or r.get('pages_text'): done.add(r['uid'])
    todo = [r for r in reqs if r['uid'] not in done and r['uid'] not in skip]
    print(f'{a.arm}: {len(reqs)} requests, {len(done)} done, {len(todo)} to run, model {a.model}, meter {meter()}', flush=True)

    def run(req):
        m0 = meter(); total, usages, prob, res, err, out_pages = 0.0, [], 'empty', '', None, None
        tries = 0
        while tries < 14:
            tries += 1
            res, e, code, secs, is_err, usage = one_call(req['prompt'], a.model, scratch)
            total += secs; usages.append(usage)
            if is_err or code != 0:
                if LIMIT.search(res + e):
                    print(f"  LIMIT on {req['uid']}; sleeping 20m: {(res + e)[-200:]}", flush=True); time.sleep(1200); continue
                err = f'exit {code}: {(res + e)[-300:]}'
                if tries >= 3: break
                time.sleep(30); continue
            err = None
            text, prob = unwrap(res)
            if a.arm == 'O10':
                out_pages = split_block(text, req['pages']) if text else None
                if out_pages is None:
                    prob = 'markers'
                    if tries >= 2: break
                    continue
                break
            if text and prob in (None, 'text outside the markers', 'reply cut before <<<END>>>', 'tags after <<<END>>>'): break
            if tries >= 2: break
        text, prob2 = unwrap(res) if not err else ('', 'error')
        if a.arm != 'O10': prob = prob2
        row = {'uid': req['uid'], 'arm': a.arm, 'run': req['run'], 'lang': req['lang'], 'model': f'{a.model} (claude -p)', 'route': 'claude-cli',
               'date': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'raw': res, 'secs': round(total, 1), 'attempts': tries,
               'usage': usages, 'error': err, 'meter_before': m0, 'meter_after': meter()}
        if a.arm == 'O10':
            row.update({'pages': req['pages'], 'page_uids': req['page_uids'], 'problem': None if out_pages else (prob if not err else 'error'),
                        'pages_text': dict(zip(req['page_uids'], out_pages)) if out_pages else None})
            n = len(out_pages) if out_pages else 0
        else:
            row.update({'text': text if prob not in ('empty',) and not err else '', 'problem': prob})
            n = len(row['text'])
        with lock, open(a.out, 'a', encoding='utf-8') as f:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
        print(f"  {req['uid']} {row['problem'] or 'ok'} {n} {'pages' if a.arm == 'O10' else 'chars'} {round(total)}s x{tries} ${sum((u.get('list_cost_usd') or 0) for u in usages):.2f} list", flush=True)

    with ThreadPoolExecutor(max_workers=a.parallel) as ex:
        list(ex.map(run, todo))
    print('meter after', meter(), flush=True)


if __name__ == '__main__':
    main()
