#!/usr/bin/env python3
"""
run_baseline.py — one Gemini baseline over pairs.jsonl (stdlib only, runs on Hetzner).

PRIOR ART: scripts/eval/lib/runners.mjs `runGemini` is the repo's Gemini caller
(Node; key rotation, thinkingBudget opt-in, pricing via scripts/lib/model-pricing.mjs).
The baseline has to run on the Hetzner box (the laptop is geo-blocked for Gemini) where
only python3 and no node_modules are guaranteed, so this is a 60-line stdlib port of the
same request shape: temperature 0, explicit thinkingConfig.thinkingBudget = 0 (CLAUDE.md
"AI Models" — Gemini 3.x thinks by default and bills it), images inline, one request per
pair with all of the pair's pages in order.

Budget guard: --max-usd stops the run when the metered cost (usageMetadata × the price
table below) crosses the cap; the handoff cap is $2.

Outputs: results/<run>/<pair_id>.json  {"text", "status", "usage", "model", "prompt"}
"""
import argparse, base64, json, os, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
# USD per 1M tokens — copied from scripts/lib/model-pricing.mjs (2026-09-13 vendor list).
PRICE = {
    'gemini-3-flash-preview': (0.50, 3.00),
    'gemini-3.1-flash-lite':  (0.25, 1.50),
    'gemini-3.5-flash':       (1.50, 9.00),
    'gemini-3.6-flash':       (0.75, 3.75),
}

PROMPT = (
    "This is a page from a printed Egyptological edition. Transcribe every Egyptian hieroglyph "
    "on the page as Unicode Egyptian Hieroglyphs (code points U+13000–U+1342F), in reading order, "
    "one line of output per line or column of the original. Output ONLY hieroglyph characters and "
    "newlines: no transliteration, no translation, no Gardiner codes, no commentary, no Latin or "
    "German text. Skip hatched (damaged) areas. If the page shows more than one inscription, "
    "transcribe them all in the order they appear on the page."
)
FOCUS = " Transcribe ONLY the item labelled \"{focus}\" and ignore everything else on the page."

def fetch(url, tries=3):
    for i in range(tries):
        try:
            r = subprocess.run(['curl', '-sfL', '-m', '120', '-A', 'Mozilla/5.0 (sourcelibrary eval)', url], capture_output=True)
            if r.returncode == 0 and len(r.stdout) > 10000:
                return r.stdout
        except Exception:
            pass
        time.sleep(3 * (i + 1))
    return None

def call(model, key, prompt, images, max_out):
    body = {
        'contents': [{'parts': [{'text': prompt}] + [{'inline_data': {'mime_type': 'image/jpeg', 'data': base64.b64encode(b).decode()}} for b in images]}],
        'generationConfig': {'temperature': 0, 'maxOutputTokens': max_out, 'thinkingConfig': {'thinkingBudget': 0}},
    }
    req = urllib.request.Request(
        f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}',
        data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.load(resp)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pairs', default=os.path.join(HERE, 'pairs.jsonl'))
    ap.add_argument('--model', default='gemini-3-flash-preview')
    ap.add_argument('--run', required=True, help='results/<run>/')
    ap.add_argument('--max-usd', type=float, default=2.0)
    ap.add_argument('--max-out', type=int, default=8000)
    ap.add_argument('--only', help='comma-separated pair_ids')
    a = ap.parse_args()
    key = os.environ.get('GEMINI_API_KEY')
    if not key:
        sys.exit('GEMINI_API_KEY not set')
    pin, pout = PRICE.get(a.model, (1.50, 9.00))   # unknown model: price at the dearest flash, not free
    outdir = os.path.join(HERE, 'results', a.run); os.makedirs(outdir, exist_ok=True)
    pairs = [json.loads(l) for l in open(a.pairs) if l.strip()]
    if a.only:
        want = set(a.only.split(',')); pairs = [p for p in pairs if p['pair_id'] in want]
    spent = 0.0
    for p in pairs:
        f = os.path.join(outdir, p['pair_id'] + '.json')
        if os.path.exists(f):
            spent += json.load(open(f)).get('usd', 0); continue
        if spent >= a.max_usd:
            print(f'BUDGET STOP at ${spent:.3f} before {p["pair_id"]}'); break
        images = []
        for pg in p['pages']:
            b = fetch(pg['image_url']) or fetch(pg['fallback_image_url'])
            if b is None:
                print(p['pair_id'], 'IMAGE FETCH FAILED', pg['image_url']); break
            images.append(b)
        if len(images) != len(p['pages']):
            json.dump({'status': 'image_fetch_failed', 'text': ''}, open(f, 'w')); continue
        prompt = PROMPT + (FOCUS.format(focus=p['focus']) if p.get('focus') else '')
        try:
            resp = call(a.model, key, prompt, images, a.max_out)
        except Exception as e:
            print(p['pair_id'], 'API ERROR', str(e)[:200]); json.dump({'status': 'api_error', 'text': '', 'error': str(e)[:500]}, open(f, 'w')); time.sleep(5); continue
        cand = (resp.get('candidates') or [{}])[0]
        text = ''.join(part.get('text', '') for part in (cand.get('content') or {}).get('parts', []))
        finish = cand.get('finishReason', '')
        um = resp.get('usageMetadata', {})
        usd = (um.get('promptTokenCount', 0) * pin + (um.get('candidatesTokenCount', 0) + um.get('thoughtsTokenCount', 0)) * pout) / 1e6
        spent += usd
        status = 'ok' if text and finish == 'STOP' else ('empty' if not text else finish.lower())
        n_signs = sum(1 for ch in text if 0x13000 <= ord(ch) <= 0x1342F)
        json.dump({'status': status, 'finish_reason': finish, 'text': text, 'usage': um, 'usd': round(usd, 5),
                   'model': a.model, 'prompt': prompt, 'n_signs': n_signs}, open(f, 'w'), ensure_ascii=False, indent=1)
        print(f"{p['pair_id']:<24} {status:<10} gt={p['sign_count']:>4} out={n_signs:>4} ${usd:.4f} total=${spent:.3f}")
    print(f'DONE spent=${spent:.3f} model={a.model}')

if __name__ == '__main__':
    main()
