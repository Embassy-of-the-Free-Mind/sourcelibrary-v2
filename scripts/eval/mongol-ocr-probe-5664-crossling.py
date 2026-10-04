# PRIOR ART: none for GOT-family models in this repo; looked in scripts/eval/ (INDEX.md lib table), scripts/gpu/,
# scripts/eval/persian-ganjoor/ and the MinerU eval venv on Hetzner (/root/mineru-eval) — MinerU's runner wraps a
# different pipeline API and cannot load a GOT checkpoint.
#
# CrossLing-OCR-Mini arm of the Mongolian Kanjur OCR probe (#5664). Runs NCUTNLP/CrossLing-OCR-Mini at revision
# 4cd6067ab9aa97ecc2f3bdbbdf1d37555a787472 on CPU. Writes JSON under
# scripts/eval/results/mongol-ocr-probe-5664/crossling/. No Mongo, no network beyond the one-time model download.
#
# Setup (Hetzner, 2026-10-04): python3 -m venv venv; pip install torch torchvision (CPU index), transformers==4.37.2,
# tiktoken, accelerate, verovio, requests. Download the repo files at the pinned revision into crossling-cpu/, then
# patch modeling_GOT.py for CPU: `.cuda()` -> `.to("cpu")`, `torch.autocast("cuda", dtype=bfloat16)` ->
# `torch.autocast("cpu", enabled=False)`, `.half()` -> `.to(torch.float32)`, default device/dtype -> cpu/float32,
# and `max_new_tokens=4096` -> env GOT_MAX_NEW. float32 because the Hetzner CPU has no bf16 matmul path (bf16 fell
# back to BLAS and did not finish a page in 10 min); float32 takes 5–7.5 min a page at 512 new tokens.
#
#   GOT_MAX_NEW=512 MODES=ocr THREADS=6 venv/bin/python mongol-ocr-probe-5664-crossling.py v047_f193a ...
import sys, os, time, json, torch
sys.path.insert(0, '/root/mongol-ocr-probe-5664')
from transformers import AutoModel, AutoTokenizer
torch.set_num_threads(int(os.environ.get('THREADS','4')))
P='/root/mongol-ocr-probe-5664/crossling-cpu'
OUT='/root/sourcelibrary/.claude/worktrees/job-mongol-ocr-probe-5664/scripts/eval/results/mongol-ocr-probe-5664/crossling'
os.makedirs(OUT, exist_ok=True)
tok=AutoTokenizer.from_pretrained(P, trust_remote_code=True)
t0=time.time()
model=AutoModel.from_pretrained(P, trust_remote_code=True, low_cpu_mem_usage=True, torch_dtype=torch.float32, use_safetensors=True, pad_token_id=tok.eos_token_id).eval()
print('loaded', round(time.time()-t0), 's', flush=True)
keys=sys.argv[1:]
for k in keys:
    for mode in os.environ.get('MODES','ocr,crop').split(','):
        out=f'{OUT}/{k}.{mode}.json'
        if os.path.exists(out): continue
        img=f'/root/mongol-ocr-probe-5664/images/{k}.jpg'
        t=time.time()
        with torch.no_grad():
            if mode=='ocr': r=model.chat(tok, img, ocr_type='ocr')
            else: r=model.chat_crop(tok, img, ocr_type='ocr')
        rec={'key':k,'mode':mode,'model':'NCUTNLP/CrossLing-OCR-Mini','revision':'4cd6067ab9aa97ecc2f3bdbbdf1d37555a787472','device':'cpu-fp32','max_new_tokens':int(os.environ.get('GOT_MAX_NEW','1024')),'seconds':round(time.time()-t),'text':r}
        json.dump(rec, open(out,'w'), ensure_ascii=False, indent=1)
        print(k, mode, rec['seconds'],'s', len(r),'chars', repr(r[:200]), flush=True)
