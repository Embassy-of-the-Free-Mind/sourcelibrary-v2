#!/usr/bin/env python3
"""embed-bench.py — text and image embedding throughput on the GEX45 (#6871 capability card). Speed and VRAM only.

PRIOR ART: scripts/gpu/embed-models-6172-box.sh (#6172: which embedding model recalls best — a quality eval with its
own query set; it ran on a rented card, so its rates do not price this one) and scripts/workers/clip-server.mjs
(the CLIP model the corpus uses today, ONNX on CPU).

  embed-bench.py text  <model> <texts.jsonl> <out.json> [--batch 32] [--max-len 1024]
  embed-bench.py image <model> <img dir>     <out.json> [--batch 64] [--repeat 10]

text: sentence-transformers, bf16, the model's own pooling; items = page texts as stored (no prefix).
image: transformers AutoModel get_image_features, bf16; end-to-end rate includes JPEG decode + preprocessing on
8 CPU workers (the real bottleneck for full-size page images), plus a GPU-only rate on pre-processed batches.
"""
import argparse, json, os, time
import torch

ap = argparse.ArgumentParser()
ap.add_argument('kind'); ap.add_argument('model'); ap.add_argument('src'); ap.add_argument('out')
ap.add_argument('--batch', type=int, default=0); ap.add_argument('--max-len', type=int, default=1024)
ap.add_argument('--repeat', type=int, default=10)
a = ap.parse_args()
dev = 'cuda'
torch.cuda.reset_peak_memory_stats()
res = {'kind': a.kind, 'model': a.model, 'dtype': 'bf16', 'torch': torch.__version__}

if a.kind == 'text':
    from sentence_transformers import SentenceTransformer
    texts = [json.loads(l)['text'] for l in open(a.src) if l.strip()]
    bs = a.batch or 32
    m = SentenceTransformer(a.model, device=dev, model_kwargs={'torch_dtype': torch.bfloat16})
    m.max_seq_length = a.max_len
    tok = m.tokenizer
    lens = [len(tok(t, add_special_tokens=True)['input_ids']) for t in texts[:500]]
    m.encode(texts[:64], batch_size=bs)                      # warm-up
    torch.cuda.synchronize(); t0 = time.time()
    v = m.encode(texts, batch_size=bs, normalize_embeddings=True)
    torch.cuda.synchronize(); wall = time.time() - t0
    res.update({'items': len(texts), 'batch': bs, 'max_seq_len': a.max_len, 'dim': int(v.shape[1]),
                'median_tokens': sorted(lens)[len(lens) // 2], 'share_truncated': round(sum(l > a.max_len for l in lens) / len(lens), 3),
                'wall_secs': round(wall, 1), 'items_per_s': round(len(texts) / wall, 1), 'items_per_hour': round(len(texts) / wall * 3600)})
else:
    from PIL import Image
    from transformers import AutoModel, AutoProcessor
    bs = a.batch or 64
    proc = AutoProcessor.from_pretrained(a.model)
    m = AutoModel.from_pretrained(a.model, torch_dtype=torch.bfloat16).to(dev).eval()
    files = sorted(os.path.join(a.src, f) for f in os.listdir(a.src) if f.endswith('.jpg')) * a.repeat

    class DS(torch.utils.data.Dataset):
        def __len__(self): return len(files)
        def __getitem__(self, i):
            return proc(images=Image.open(files[i]).convert('RGB'), return_tensors='pt')['pixel_values'][0]
    dl = torch.utils.data.DataLoader(DS(), batch_size=bs, num_workers=8)

    @torch.no_grad()
    def emb(px):
        f = m.get_image_features(pixel_values=px.to(dev, torch.bfloat16))
        return f if torch.is_tensor(f) else f.pooler_output   # transformers 5 returns an output object
    first = next(iter(dl)); emb(first); torch.cuda.synchronize()     # warm-up
    t0 = time.time(); n = 0
    for px in dl:
        f = emb(px); n += px.shape[0]
    torch.cuda.synchronize(); wall = time.time() - t0
    t1 = time.time(); k = 0
    for _ in range(20):
        emb(first); k += first.shape[0]
    torch.cuda.synchronize(); gpu_wall = time.time() - t1
    res.update({'items': n, 'batch': bs, 'input_px': list(first.shape[-2:]), 'dim': int(f.shape[-1]),
                'wall_secs': round(wall, 1), 'items_per_s': round(n / wall, 1), 'items_per_hour': round(n / wall * 3600),
                'gpu_only_items_per_s': round(k / gpu_wall, 1), 'cpu_workers': 8})

res['torch_peak_alloc_mib'] = round(torch.cuda.max_memory_allocated() / 2**20)
res['torch_peak_reserved_mib'] = round(torch.cuda.max_memory_reserved() / 2**20)
json.dump(res, open(a.out, 'w'), indent=1)
print(json.dumps(res))
