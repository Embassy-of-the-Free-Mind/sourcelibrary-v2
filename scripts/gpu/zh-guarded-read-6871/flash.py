#!/usr/bin/env python3
"""flash.py: agy Gemini 3.8 Flash on the pages the Paddle guard rejected, with a guard on Flash's reply (#6871 row 3).

PRIOR ART: scripts/eval/zh-confirm-6871/agy.sh (the B2 arm: run-cli-arm.py, gemini-3.8-flash-low, the bake-off
prompt, 2 parallel; called the same way here); scripts/eval/run-cli-arm.py (the runner, unchanged: resumable, logs
every call to /var/log/sourcelibrary/agy-calls.jsonl, exits 3 on quota); scripts/batch/cli-ocr.mjs `read` (writes
reads to files for a later apply, but on the live default OCR prompt, not the prompt the bar was measured with).

Run on a box with agy signed in, from the repo root, after the GPU task's per-book JSONLs are copied here:
  python3 scripts/gpu/zh-guarded-read-6871/flash.py --books <dir of <bid>.jsonl> --out <dir> [--limit N] [--parallel 2]

Per FLASH-routed page: fetch the image the GPU read and check its sha256 against the GPU record (a different image is
not read), cap the long side at 2,744 px (fetch.py), then round 1 (arm F1), the reply guard, and round 2 (F2) for
every page round 1 failed. A page that fails both stays held (route HOLD).

THE REPLY GUARD (not preregistered; set on the confirmation's own B2/B2r replies, 2026-10-18):
  fail if the CLI reply was blocked, empty, cut before <<<END>>>, had text outside the markers, or errored;
  else guard.py on the reply, with the page's ink, keeping COLLAPSE and OVERRUN, and LOOP only on pages that were
  not routed for NUMERIC. NUMERIC is a property of the image and is why the page came here, so it is dropped. LOOP
  is dropped on numeric pages because guard.py's LOOP rule flagged all three of Flash's GOOD ephemeris-table reads
  (bag CER 1-8%): a numeral table repeats 6-grams. In-sample on the in-scope Flash-routed confirmation pages:
  3/3 failed replies caught (a filter cut at 97.7%, a 79% collapse twice), 0/7 good replies flagged. Every reply is
  checked again by the writer's own loop guards.

Output: <out>/flash.jsonl, one row per FLASH-routed page: {page_id, book_id, page_number, route: FLASH|HOLD, text,
attempt, reply_flags[], image{url, sha256}, cli{name, version}, model, prompt_sha256, raw, secs, date}. $0: agy
subscription. No Mongo.
"""
import argparse, glob, hashlib, io, json, os, re, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'scripts/eval/zh-confirm-6871'))
from guard import guard  # noqa: E402  (frozen; imported unchanged)

ap = argparse.ArgumentParser()
ap.add_argument('--books', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--limit', type=int, default=0); ap.add_argument('--parallel', type=int, default=2)
ap.add_argument('--model', default='gemini-3.8-flash-low')
a = ap.parse_args()
O = os.path.abspath(a.out); os.makedirs(f'{O}/img', exist_ok=True)
JOB = 'zh-guarded-read-6871'

# the bake-off prompt, byte for byte (zh-residue-bakeoff-6871/read.py PROMPT, as agy.sh sent it)
src = open(os.path.join(REPO, 'scripts/eval/zh-residue-bakeoff-6871/read.py')).read()
PROMPT = eval(re.search(r"PROMPT = (\(.*?\))\n", src, re.S).group(1))  # noqa: S307 (a string literal from our own file)
open(f'{O}/prompt.txt', 'w').write(PROMPT)
PROMPT_SHA = hashlib.sha256(PROMPT.encode()).hexdigest()
# what run-cli-arm.py sends for --kind ocr with an image: prompt + the #6523 marker instruction + the attachment
SENTINEL = re.search(r"SENTINEL_INSTRUCTION = '([^']*)'", open(os.path.join(REPO, 'scripts/eval/run-cli-arm.py')).read()).group(1)
sent = lambda pid: f'{PROMPT}\n\n{SENTINEL} @./{re.sub(r"[^\w.-]", "_", pid)}.jpg'
CLI_VERSION = subprocess.run(['agy', '--version'], capture_output=True, text=True).stdout.strip()

rows = [r for f in sorted(glob.glob(f'{a.books}/*.jsonl')) for r in map(json.loads, open(f)) if r['route'] == 'FLASH']
if a.limit: rows = rows[:a.limit]
print(f'{len(rows)} FLASH-routed pages; agy {CLI_VERSION}; {a.model}', flush=True)

# PIL is not installed on the ARM job box: the 2,744 px cap is done by sharp (node), as fit-inside, JPEG q90
RESIZE = "const s=require('sharp');s(process.argv[1]).resize(2744,2744,{fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toFile(process.argv[2]).then(()=>{},e=>{console.error(e.message);process.exit(1)})"
def fetch(r):
    p = f'{O}/img/{r["page_id"]}.jpg'
    if os.path.exists(p): return p, None
    for t in range(4):
        try:
            raw = urllib.request.urlopen(urllib.request.Request(r['image']['url'], headers={'User-Agent': f'sourcelibrary-paddle-lane/6871 (+https://sourcelibrary.org)'}), timeout=120).read(); break
        except Exception as e:  # noqa: BLE001
            err = str(e)[:160]; time.sleep(5 * (t + 1))
    else:
        return None, f'fetch: {err}'
    if hashlib.sha256(raw).hexdigest() != r['image']['sha256']: return None, 'image changed since the GPU read (sha256 differs)'
    open(p + '.src', 'wb').write(raw)
    rc = subprocess.run(['node', '-e', RESIZE, p + '.src', p], cwd=REPO, capture_output=True, text=True)
    os.remove(p + '.src')
    return (p, None) if rc.returncode == 0 else (None, f'resize: {rc.stderr[:160]}')

def reply_flags(x, r):
    if not x: return ['CLI:no_row']
    if x.get('blocked'): return ['CLI:blocked']
    if x.get('error'): return [f'CLI:{str(x["error"])[:40]}']
    if x.get('wrapper'): return [f'CLI:wrapper:{x["wrapper"]}']
    if x.get('empty') or not (x.get('text') or '').strip(): return ['CLI:empty']
    numeric = 'NUMERIC' in (r['guard'] or {}).get('flags', [])
    g = guard(x['text'], r['ink'])
    return [f for f in g['flags'] if f != 'NUMERIC' and not (f == 'LOOP' and numeric)]

def arm(name, todo):
    req = f'{O}/requests-{name}.jsonl'
    with open(req, 'w') as f:
        for r, p in todo: f.write(json.dumps({'uid': r['page_id'], 'image': p}) + '\n')
    rc = subprocess.run([sys.executable, os.path.join(REPO, 'scripts/eval/run-cli-arm.py'), '--requests', req, '--out', f'{O}/{name}.jsonl', '--arm', name,
                         '--model', a.model, '--job', JOB, '--kind', 'ocr', '--parallel', str(a.parallel), '--prompt-file', f'{O}/prompt.txt',
                         '--workdir', f'{O}/ws-{name}'], cwd=REPO).returncode
    got = {}
    if os.path.exists(f'{O}/{name}.jsonl'):
        for x in map(json.loads, open(f'{O}/{name}.jsonl')): got[x['uid']] = x   # the last row per uid wins
    return rc, got

final = {}
todo = []
for r in rows:
    p, err = fetch(r)
    if err: final[r['page_id']] = (r, None, 0, [err]); continue
    todo.append((r, p))
rc1, g1 = arm('F1', todo)
retry = []
for r, p in todo:
    fl = reply_flags(g1.get(r['page_id']), r)
    if fl: retry.append((r, p)); final[r['page_id']] = (r, g1.get(r['page_id']), 1, fl)
    else: final[r['page_id']] = (r, g1[r['page_id']], 1, [])
rc2 = 0
if retry and rc1 != 3:
    rc2, g2 = arm('F2', retry)
    for r, p in retry:
        fl = reply_flags(g2.get(r['page_id']), r)
        if not fl or g2.get(r['page_id']): final[r['page_id']] = (r, g2.get(r['page_id']), 2, fl)
quota = 3 in (rc1, rc2)
with open(f'{O}/flash.jsonl', 'w') as f:
    for pid, (r, x, att, fl) in final.items():
        unanswered = quota and (x is None or fl and fl[0].startswith('CLI'))
        f.write(json.dumps({'page_id': pid, 'book_id': r['book_id'], 'page_number': r['page_number'], 'class': r['class'],
                            'route': 'PENDING' if unanswered else ('FLASH' if not fl else 'HOLD'), 'text': (x or {}).get('text') if not fl else None,
                            'attempt': att, 'reply_flags': fl, 'paddle_flags': (r['guard'] or {}).get('flags'), 'ink': r['ink'],
                            'image': {'url': r['image']['url'], 'sha256': r['image']['sha256'], 'bytes': r['image'].get('bytes')}, 'cli': {'name': 'agy', 'version': CLI_VERSION},
                            'model': a.model, 'prompt_sha256': PROMPT_SHA, 'prompt_sent': sent(pid), 'prompt_file': 'scripts/eval/zh-residue-bakeoff-6871/read.py PROMPT',
                            'raw': (x or {}).get('raw'), 'secs': (x or {}).get('secs'), 'date': (x or {}).get('date'), 'job': JOB}, ensure_ascii=False) + '\n')
tally = {}
for line in open(f'{O}/flash.jsonl'):
    k = json.loads(line)['route']; tally[k] = tally.get(k, 0) + 1
print(json.dumps({'pages': len(rows), 'routes': tally, 'round1_failed': len(retry), 'quota_stop': quota}), flush=True)
sys.exit(3 if quota else 0)
