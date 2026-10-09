#!/usr/bin/env python3
# PRIOR ART: run-cli-arm.py attaches one image per request; this is the hand-run four-image call the brief asks for, reusing its call().
# One book-level call with the book's 4 page images attached (`@./a.jpg @./b.jpg …`), per model: does the book shape hold?
# Uses run-cli-arm.py's call() and log_call() unchanged (plan mode, call log, nudge on a denied tool), up to 4 attempts.
import importlib.util, json, os, shutil, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('arm', f'{HERE}/run-cli-arm.py'); arm = importlib.util.module_from_spec(spec); spec.loader.exec_module(arm)

name, model, book_ix = sys.argv[1], sys.argv[2], sys.argv[3]
req = json.loads(subprocess.run(['python3', f'{HERE}/build_requests.py', 'book4', book_ix], capture_output=True, text=True, check=True).stdout)
ws = f'{HERE}/cli-ws/{name}-book4'; os.makedirs(ws, exist_ok=True)
for im in req['images']:
    shutil.copyfile(im, os.path.join(ws, os.path.basename(im)))
prompt = req['prompt'] + ' ' + ' '.join(f'@./{os.path.basename(im)}' for im in req['images'])
out, cls, total, meta, nudged = '', None, 0.0, {}, False
for tries in range(1, 5):
    if cls == 'denied_tool' and meta.get('conversation'):
        nudged = True
        out, err, code, secs, cls, waited, meta = arm.call(arm.NUDGE, model, cwd=ws, conversation=meta['conversation'])
    else:
        out, err, code, secs, cls, waited, meta = arm.call(prompt, model, cwd=ws, add_dir=ws, timeout=300)
    total += secs
    arm.log_call('second-reader-pilot-6338', model, 'review', secs, cls in (None, 'safety_filter'), cls)
    print(f'attempt {tries}: {cls or "ok"} {round(secs)}s {len(out)} chars', flush=True)
    if cls in (None, 'safety_filter', 'quota'):
        break
row = {'uid': req['uid'], 'arm': name + '-book4', 'model': model, 'route': 'cli', 'cli_mode': 'plan', 'date': arm.now(), 'text': out,
       'secs': round(total, 1), 'attempts': tries, 'class': cls, 'nudged': nudged, 'error': None if cls is None else f'{cls}: {err[-300:]}'}
with open(f'{HERE}/out/{name}-book4.jsonl', 'a', encoding='utf-8') as f:
    f.write(json.dumps(row, ensure_ascii=False) + '\n')
shutil.rmtree(ws, ignore_errors=True)
