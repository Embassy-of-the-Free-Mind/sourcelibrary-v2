#!/usr/bin/env python3
# train.py — LoRA-distil a Flash teacher's Latin reads into GLM-OCR 0.9B (#6871; PREREGISTRATION.md in this directory).
#
# PRIOR ART: scripts/eval/mongol-realpilot-5664 (a LoRA on real labels on this box, via Unsloth on a 4-bit Qwen2.5-VL).
# Unsloth has no GLM-OCR, and a 0.9B model needs no 4-bit, so this is plain transformers 5.17 + peft in bf16 with the
# same shape: frozen vision tower, loss on the label only, a smoke gate at step 25, the adapter then merged for vLLM.
#
#   python train.py --train train.jsonl --val val.jsonl --img img --out run   (env: GPU free, under /root/gpu.lock)
# Writes run/adapter, run/merged (full weights + processor, served by vLLM), run/train-log.jsonl, run/summary.json.
import argparse, json, math, os, random, sys, time

import torch
from PIL import Image
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForImageTextToText, AutoProcessor, get_cosine_schedule_with_warmup

ap = argparse.ArgumentParser()
ap.add_argument("--train", required=True); ap.add_argument("--val", required=True)
ap.add_argument("--img", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--epochs", type=int, default=2); ap.add_argument("--accum", type=int, default=8)
ap.add_argument("--lr", type=float, default=1e-4); ap.add_argument("--warmup", type=int, default=30)
ap.add_argument("--max-label", type=int, default=2048); ap.add_argument("--seed", type=int, default=6871)
ap.add_argument("--limit-steps", type=int, default=0, help="stop after N optimizer steps (smoke runs only)")
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
random.seed(a.seed); torch.manual_seed(a.seed)
MODEL, PROMPT = "zai-org/GLM-OCR", "Text Recognition:"

proc = AutoProcessor.from_pretrained(MODEL)
tok = proc.tokenizer
END = tok.convert_tokens_to_ids("<|user|>")  # the end-of-turn the chat model emits (generation_config eos [59246, 59253])
model = AutoModelForImageTextToText.from_pretrained(MODEL, dtype=torch.bfloat16, device_map="cuda")
model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
model.enable_input_require_grads()
lcfg = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, bias="none",
                  target_modules=r".*language_model.*\.(q_proj|k_proj|v_proj|o_proj|gate_up_proj|gate_proj|up_proj|down_proj)")
model = get_peft_model(model, lcfg)
ntrain = sum(p.numel() for p in model.parameters() if p.requires_grad)
print(f"trainable params {ntrain:,}", flush=True)


def load(path):
    rows = [json.loads(l) for l in open(path) if l.strip()]
    return [r for r in rows if os.path.exists(os.path.join(a.img, r["id"] + ".jpg"))]


def encode(r):
    im = Image.open(os.path.join(a.img, r["id"] + ".jpg")).convert("RGB")
    user = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": PROMPT}]}]
    prompt = proc.apply_chat_template(user, tokenize=False, add_generation_prompt=True)
    x = proc(text=[prompt], images=[im], return_tensors="pt")
    lab = tok("<think></think>\n" + r["text"], add_special_tokens=False)["input_ids"][: a.max_label] + [END]
    lab = torch.tensor([lab])
    ids = torch.cat([x["input_ids"], lab], 1)
    labels = torch.cat([torch.full_like(x["input_ids"], -100), lab], 1)
    out = {"input_ids": ids, "attention_mask": torch.ones_like(ids), "labels": labels,
           "pixel_values": x["pixel_values"], "image_grid_thw": x["image_grid_thw"]}
    if "mm_token_type_ids" in x:
        out["mm_token_type_ids"] = torch.cat([x["mm_token_type_ids"], torch.zeros_like(lab)], 1)
    return {k: v.to("cuda") for k, v in out.items()}


train, val = load(a.train), load(a.val)
steps = math.ceil(len(train) * a.epochs / a.accum)
if a.limit_steps: steps = min(steps, a.limit_steps)
opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=a.lr, weight_decay=0.0)
sch = get_cosine_schedule_with_warmup(opt, a.warmup, steps)
print(f"train {len(train)} val {len(val)} optimizer steps {steps}", flush=True)
log = open(os.path.join(a.out, "train-log.jsonl"), "a")
model.train(); step, micro, acc, hist, t0 = 0, 0, [], [], time.time()
order = [r for _ in range(a.epochs) for r in random.sample(train, len(train))]
for r in order:
    loss = model(**encode(r)).loss
    if not torch.isfinite(loss):
        print(f"non-finite loss on {r['id']}", flush=True); sys.exit(3)
    (loss / a.accum).backward(); acc.append(loss.item()); micro += 1
    if micro % a.accum: continue
    torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], 1.0)
    opt.step(); sch.step(); opt.zero_grad(set_to_none=True); step += 1
    m = sum(acc) / len(acc); acc = []
    hist.append(m)
    log.write(json.dumps({"step": step, "loss": round(m, 4), "lr": sch.get_last_lr()[0], "secs": round(time.time() - t0)}) + "\n"); log.flush()
    if step % 10 == 0: print(f"step {step}/{steps} loss {m:.4f} {time.time() - t0:.0f}s", flush=True)
    if step == 25:  # the preregistered smoke gate: mean loss of steps 21-25 below that of steps 1-5
        early, late = sum(hist[:5]) / 5, sum(hist[20:25]) / 5
        print(f"smoke gate: steps 1-5 {early:.4f}, steps 21-25 {late:.4f}", flush=True)
        if not late < early: print("SMOKE GATE FAILED", flush=True); sys.exit(4)
    if step >= steps: break

model.eval(); vl = []
with torch.no_grad():
    for r in val: vl.append(model(**encode(r)).loss.item())
model.save_pretrained(os.path.join(a.out, "adapter"))
merged = model.merge_and_unload()
merged.save_pretrained(os.path.join(a.out, "merged"), safe_serialization=True)
proc.save_pretrained(os.path.join(a.out, "merged"))
summary = {"steps": step, "train_pages": len(train), "val_pages": len(val), "first5_loss": sum(hist[:5]) / max(1, len(hist[:5])), "last5_loss": sum(hist[-5:]) / max(1, len(hist[-5:])), "val_loss": sum(vl) / max(1, len(vl)),
           "secs": round(time.time() - t0), "peak_vram_mib": round(torch.cuda.max_memory_allocated() / 2**20)}
json.dump(summary, open(os.path.join(a.out, "summary.json"), "w"), indent=1)
print("SUMMARY", json.dumps(summary), flush=True)
