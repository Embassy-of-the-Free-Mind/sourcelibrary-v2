#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/orig-lang-recall/embed-local.mjs — embeds pool A with
e5/BGE-M3 through @xenova/transformers v2, which has no Qwen3 architecture and
no last-token pooling; and it reads pool A only. This embeds pools A and T and
both query sets with Qwen3-Embedding, on CPU (int8 ONNX) or on a GPU (torch).

qwen-embed — arms A and B of #6172.

Format (the Qwen3-Embedding model card): documents bare; queries
  "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:{q}"
both ending in <|endoftext|>; last-token pooling; L2 norm. Documents are cut at
--max-tokens (1024) with the EOS kept as the last token.

Inputs (written by the eval's other scripts):
  --pool-a  orig-lang-recall pool.jsonl  (text = cleaned OCR)      -> vec-a-<arm>.jsonl, q-a-<arm>.json
  --pool-t  embed-models pool-t.jsonl    (trans = what the stored vector embeds) -> vec-t-<arm>.jsonl, q-t-<arm>.json
  --subset-a FILE  only these pool-A indices (the 3,000 sub-pool, for CPU)
  --gold-dir DIR   directory holding orig-lang-recall/gold.json, librarian-search/golden-set.json, embed-models/gold-c.json
Backends:
  --backend onnx --onnx PATH --tokenizer PATH     CPU, onnxruntime
  --backend torch --model Qwen/Qwen3-Embedding-4B  GPU, bf16, sdpa
Writes <out>/speed-<arm>.json: pages, tokens, seconds — the measured throughput.
Resumable: indices already in vec-*.jsonl are skipped.
"""
import argparse, json, os, sys, time

TASK = "Given a web search query, retrieve relevant passages that answer the query"
EOS = 151643

ap = argparse.ArgumentParser()
ap.add_argument("--arm", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--backend", choices=["onnx", "torch"], required=True)
ap.add_argument("--onnx"); ap.add_argument("--tokenizer"); ap.add_argument("--model")
ap.add_argument("--pool-a"); ap.add_argument("--subset-a"); ap.add_argument("--pool-t")
ap.add_argument("--gold-dir", required=True)
ap.add_argument("--max-tokens", type=int, default=1024)
ap.add_argument("--batch-tokens", type=int, default=8192, help="padded tokens per forward pass")
ap.add_argument("--threads", type=int, default=8)
ap.add_argument("--selftest", action="store_true", help="print the model card's 2x2 example scores and exit")
a = ap.parse_args()

import numpy as np
from tokenizers import Tokenizer

if a.backend == "onnx":
    import onnxruntime as ort
    tok = Tokenizer.from_file(a.tokenizer)
    so = ort.SessionOptions(); so.intra_op_num_threads = a.threads
    sess = ort.InferenceSession(a.onnx, so, providers=["CPUExecutionProvider"])
    kv = [i for i in sess.get_inputs() if i.name.startswith("past_key_values")]
    def forward(ids, mask):
        b, n = ids.shape
        feeds = {"input_ids": ids, "attention_mask": mask, "position_ids": np.broadcast_to(np.arange(n, dtype=np.int64), (b, n)).copy()}
        for i in kv: feeds[i.name] = np.zeros((b, i.shape[1], 0, i.shape[3]), dtype=np.float32)
        return sess.run(["last_hidden_state"], feeds)[0]
else:
    import torch
    from transformers import AutoModel, AutoTokenizer
    hf_tok = AutoTokenizer.from_pretrained(a.model)
    tok = Tokenizer.from_str(hf_tok.backend_tokenizer.to_str())
    model = AutoModel.from_pretrained(a.model, torch_dtype=torch.bfloat16, attn_implementation="sdpa").cuda().eval()
    def forward(ids, mask):
        with torch.inference_mode():
            h = model(input_ids=torch.from_numpy(ids).cuda(), attention_mask=torch.from_numpy(mask).cuda()).last_hidden_state
            return h.float().cpu().numpy()

def encode(texts):
    out = []
    for e in tok.encode_batch(texts):
        ids = list(e.ids)
        if not ids or ids[-1] != EOS: ids.append(EOS)
        if len(ids) > a.max_tokens: ids = ids[: a.max_tokens - 1] + [EOS]
        out.append(ids)
    return out

def embed_ids(seqs):
    """Right-padded batch; the last real token is the EOS each sequence ends with."""
    n = max(len(s) for s in seqs)
    ids = np.full((len(seqs), n), EOS, dtype=np.int64); mask = np.zeros((len(seqs), n), dtype=np.int64)
    for r, s in enumerate(seqs): ids[r, : len(s)] = s; mask[r, : len(s)] = 1
    h = forward(ids, mask)
    v = np.stack([h[r, len(s) - 1] for r, s in enumerate(seqs)])
    return v / np.linalg.norm(v, axis=1, keepdims=True)

def embed_texts(texts):
    seqs = encode(texts)
    return [embed_ids([s])[0] for s in seqs] if len(seqs) < 2 else list(embed_ids(seqs))

def query(q): return f"Instruct: {TASK}\nQuery:{q}"

def run_pool(prefix, rows, field, wanted, queries):
    qf = os.path.join(a.out, f"q-{prefix}-{a.arm}.json")
    if not os.path.exists(qf):
        vs = [embed_texts([query(t)])[0] for _, t in queries]
        json.dump({k: [round(float(x), 6) for x in v] for (k, _), v in zip(queries, vs)}, open(qf, "w"))
    vf = os.path.join(a.out, f"vec-{prefix}-{a.arm}.jsonl")
    done = set()
    if os.path.exists(vf):
        for l in open(vf):
            if l.strip(): done.add(json.loads(l)["i"])
    todo = [i for i in wanted if i not in done]
    print(f"{prefix}: {len(wanted)} pages, {len(done)} done, {len(todo)} to embed", flush=True)
    seqs = encode([rows[i][field] for i in todo])
    order = sorted(range(len(todo)), key=lambda k: len(seqs[k]))  # length-sorted batches: little padding
    t0 = time.time(); ntok = 0; npg = 0; k = 0
    with open(vf, "a") as f:
        while k < len(order):
            batch = []; longest = 0
            while k < len(order) and (not batch or max(longest, len(seqs[order[k]])) * (len(batch) + 1) <= a.batch_tokens):
                batch.append(order[k]); longest = max(longest, len(seqs[order[k]])); k += 1
            vs = embed_ids([seqs[j] for j in batch])
            for j, v in zip(batch, vs):
                f.write(json.dumps({"i": todo[j], "v": [round(float(x), 6) for x in v]}) + "\n")
            f.flush()
            npg += len(batch); ntok += sum(len(seqs[j]) for j in batch)
            if npg % 200 < len(batch):
                el = time.time() - t0
                print(f"  {npg}/{len(todo)}  {npg/el:.2f} pages/s  {ntok/el:.0f} tok/s", flush=True)
    el = time.time() - t0
    sp = os.path.join(a.out, f"speed-{prefix}-{a.arm}.json")
    prev = json.load(open(sp)) if os.path.exists(sp) else {"pages": 0, "tokens": 0, "seconds": 0}
    tot = {k2: prev[k2] + v for k2, v in {"pages": npg, "tokens": ntok, "seconds": el}.items()}
    tot.update(backend=a.backend, max_tokens=a.max_tokens, batch_tokens=a.batch_tokens)
    json.dump(tot, open(sp, "w"))
    if npg: print(f"done {prefix}: {npg} pages, {ntok} tokens in {el:.0f}s = {npg/el:.2f} pages/s, {ntok/el:.0f} tok/s", flush=True)

if a.selftest:
    # Model card (Qwen3-Embedding-0.6B): [[0.7646, 0.1414], [0.1355, 0.6000]].
    Q = np.array(embed_texts([query("What is the capital of China?"), query("Explain gravity")]))
    D = np.array(embed_texts(["The capital of China is Beijing.", "Gravity is a force that attracts two bodies towards each other. It gives weight to physical objects and is responsible for the movement of planets around the sun."]))
    print("selftest", np.round(Q @ D.T, 4).tolist(), flush=True)
    B = np.array(list(embed_ids(encode([query("Explain gravity"), "The capital of China is Beijing."]))))
    print("batch-vs-single cos", np.round([float(B[0] @ Q[1]), float(B[1] @ D[0])], 5).tolist(), flush=True)
    sys.exit(0)

def jsonl(p): return [json.loads(l) for l in open(p) if l.strip()]
G = a.gold_dir
if a.pool_a:
    rows = jsonl(a.pool_a)
    wanted = json.load(open(a.subset_a)) if a.subset_a else list(range(len(rows)))
    qs = [(q["qid"], q["query"]) for q in json.load(open(os.path.join(G, "orig-lang-recall/gold.json")))["queries"]]
    run_pool("a", rows, "text", wanted, qs)
if a.pool_t:
    rows = jsonl(a.pool_t)
    qs = [(q["id"], q["query"]) for q in json.load(open(os.path.join(G, "librarian-search/golden-set.json")))["queries"]]
    qs += [(q["qid"], q["query"]) for q in json.load(open(os.path.join(G, "embed-models/gold-c.json")))["queries"]]
    run_pool("t", rows, "trans", list(range(len(rows))), qs)
