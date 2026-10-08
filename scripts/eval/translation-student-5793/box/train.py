# PRIOR ART: none in repo for open-weights training — the only tune (#4320) ran on Vertex SFT. Looked in
# scripts/eval, scripts/gpu, /root/paddle-zh-5600/code, /root/olmocr-5660b/code.
"""LoRA SFT of the #5793 student (TRL + PEFT), prompt-completion, loss on the completion only.

  python train.py --model Qwen/Qwen3-8B --train train.jsonl --out /root/st/adapter [--max-pairs N] [--probe-steps 15]
The prompt string is the model's chat template around the #5793 prompt (enable_thinking=False) — byte-identical to
what gen.py sends at inference. Progress lines (step, loss, tokens/s) go to /root/st/progress.jsonl.
"""
import argparse, json, time, os
import torch

PROMPT = ('Translate this page of a historical Latin book into English. Translate all of it, faithfully, '
          'in plain modern English. Do not add notes, glosses or commentary.\n\n')

ap = argparse.ArgumentParser()
ap.add_argument('--model', required=True)
ap.add_argument('--train', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--max-pairs', type=int, default=0)
ap.add_argument('--probe-steps', type=int, default=0)
ap.add_argument('--attn', default='flash_attention_2')
ap.add_argument('--bs', type=int, default=8)
ap.add_argument('--accum', type=int, default=2)
a = ap.parse_args()

from datasets import Dataset
from transformers import AutoTokenizer, AutoModelForCausalLM, TrainerCallback
from peft import LoraConfig
from trl import SFTTrainer, SFTConfig

tok = AutoTokenizer.from_pretrained(a.model)
rows = [json.loads(l) for l in open(a.train) if l.strip()]
if a.max_pairs:
    rows = rows[:a.max_pairs]


def prompt_of(src):
    return tok.apply_chat_template([{'role': 'user', 'content': PROMPT + src}], tokenize=False,
                                   add_generation_prompt=True, enable_thinking=False)


ds = Dataset.from_list([{'prompt': prompt_of(r['source']), 'completion': r['target']} for r in rows])
padding_free = a.attn == 'flash_attention_2'
cfg = SFTConfig(
    output_dir='/root/st/ckpt', num_train_epochs=1, max_steps=a.probe_steps or -1,
    per_device_train_batch_size=a.bs, gradient_accumulation_steps=a.accum,
    learning_rate=2e-4, lr_scheduler_type='cosine', warmup_ratio=0.03, weight_decay=0.0,
    bf16=True, gradient_checkpointing=True, logging_steps=5, save_strategy='no', report_to=[],
    max_length=4096, completion_only_loss=True, padding_free=padding_free, group_by_length=not padding_free,
    seed=5793, dataloader_num_workers=2, include_num_input_tokens_seen=True,
    model_init_kwargs={'torch_dtype': torch.bfloat16, 'attn_implementation': a.attn},
)
lora = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.0, bias='none', task_type='CAUSAL_LM',
                  target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'])


class Progress(TrainerCallback):
    def __init__(self):
        self.t0 = None; self.tokens = 0

    def on_step_begin(self, args, state, control, **kw):
        if self.t0 is None:
            self.t0 = time.time()

    def on_log(self, args, state, control, logs=None, **kw):
        el = time.time() - (self.t0 or time.time())
        rec = {'t': int(time.time()), 'step': state.global_step, 'max_steps': state.max_steps, 'elapsed_s': round(el, 1),
               'num_tokens': state.num_input_tokens_seen or None, **(logs or {})}
        if state.global_step:
            rec['s_per_step'] = round(el / state.global_step, 2)
            rec['eta_min'] = round((state.max_steps - state.global_step) * el / state.global_step / 60, 1)
        with open('/root/st/progress.jsonl', 'a') as f:
            f.write(json.dumps(rec) + '\n')


tr = SFTTrainer(model=a.model, args=cfg, train_dataset=ds, processing_class=tok, peft_config=lora, callbacks=[Progress()])
t0 = time.time()
tr.train()
wall = time.time() - t0
summary = {'model': a.model, 'pairs': len(rows), 'steps': tr.state.global_step, 'wall_s': round(wall, 1),
           'tokens_seen': tr.state.num_input_tokens_seen, 'attn': a.attn, 'padding_free': padding_free,
           'bs': a.bs, 'accum': a.accum, 'probe': bool(a.probe_steps),
           'final_loss': next((h['loss'] for h in reversed(tr.state.log_history) if 'loss' in h), None),
           'gpu': torch.cuda.get_device_name(0)}
print(json.dumps(summary))
os.makedirs(a.out, exist_ok=True)
json.dump(summary, open(os.path.join(a.out, 'train-summary.json'), 'w'), indent=1)
if not a.probe_steps:
    tr.save_model(a.out)
