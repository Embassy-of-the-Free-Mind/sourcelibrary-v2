# On-box Gemma-4 OCR sweep against local Ollama (OpenAI-compat endpoint).
# Emits rows in the scorecard-outputs JSONL shape so build-observations
# ingests them directly: {work, model, run, finishReason, text}.
import json, base64, urllib.request, sys, time

MODEL = "gemma4:31b-it-qat"
RECORDED = "gemma-4-31b-it-qat@l40s"
PROMPT = ("Transcribe ALL text visible in this image using the appropriate "
          "Unicode script. Output ONLY the raw text. No commentary, no "
          "translation, no labels, no markdown.")
RUNS = 3
OUT = "/root/gemma4-outputs.jsonl"
DONE_KEY = lambda w, r: f"{w}\t{r}"

done = set()
try:
    with open(OUT) as f:
        for line in f:
            row = json.loads(line)
            done.add(DONE_KEY(row["work"], row["run"]))
except FileNotFoundError:
    pass

pages = json.load(open("/root/gemma4-manifest.json"))
for i, p in enumerate(pages):
    img = None
    for run in range(1, RUNS + 1):
        if DONE_KEY(p["work"], run) in done:
            continue
        if img is None:
            # Images are pre-fetched and shipped — the box's datacenter IP is
            # 403'd by our own Cloudflare bot rules if it fetches them itself.
            img = base64.b64encode(open(f"/root/gemma4-images/{p['slug']}.jpg", "rb").read()).decode()
        # Native /api/chat with think:false — Ollama's Gemma-4 vision routes
        # the whole answer into a discarded thinking channel unless thinking
        # is explicitly off (ollama/ollama#16184; empty content, eval_count
        # maxed). The OpenAI-compat endpoint has no think switch.
        body = json.dumps({
            "model": MODEL,
            "think": False,
            "stream": False,
            "messages": [{"role": "user", "content": PROMPT, "images": [img]}],
            "options": {"temperature": 0, "num_predict": 8000},
        }).encode()
        t = time.time()
        try:
            req = urllib.request.Request("http://127.0.0.1:11434/api/chat",
                                         data=body, headers={"Content-Type": "application/json"})
            resp = json.load(urllib.request.urlopen(req, timeout=600))
            row = {"work": p["work"], "model": RECORDED, "run": run,
                   "finishReason": resp.get("done_reason", "unknown"),
                   "text": resp.get("message", {}).get("content", "")}
        except Exception as e:
            print(f"ERR {p['slug']} run{run}: {e}", flush=True)
            continue
        with open(OUT, "a") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"[{i+1}/{len(pages)}] {p['slug']} run{run} {len(row['text'])} chars {time.time()-t:.0f}s", flush=True)
print("SWEEP COMPLETE", flush=True)
