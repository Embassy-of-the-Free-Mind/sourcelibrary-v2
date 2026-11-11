#!/usr/bin/env python3
"""
PRIOR ART: ManchuAI-OCR (arXiv 2507.06761; github.com/mic7ch1/ManchuAI-OCR) — the recipe: a VLM LoRA trained on
synthetic word images only; Unsloth's FastVisionModel Qwen2.5-VL notebook (the training loop shape). In this repo:
scripts/gpu/gex45-bench-6871/vlm-bench.py (inference only, vLLM) and the PR #5807 Qwen3-8B student (text-only
LoRA). Nothing here fine-tunes a vision model.

Mongolian Kanjur column reader (#5664): LoRA (4-bit base, Unsloth) on Qwen2.5-VL-7B-Instruct from synthetic
Kanjur-style columns (render.py), then inference on the frozen real columns.

Stages (one process, so the 4-bit base loads once per stage):
  base      read the frozen sets with the untrained model (the "before" row)
  train     LoRA from DATA/labels.jsonl until --max-steps or --hours, checkpoint every --save-every steps
  infer     read the frozen sets + held-out synthetic with the newest checkpoint; writes JSONL

  python3 train.py --stage base|train|infer --data DIR --eval EVALDIR --out OUTDIR [...]

The frozen sets: EVALDIR/columns.jsonl (one object per column image: {id, image, set}). Output:
OUTDIR/reads-<tag>.jsonl {id, set, text, n_tokens, seconds}. Nothing here touches Mongo or any production store.
"""
import argparse, glob, json, os, sys, time

PROMPT = ('This image is one column of the Mongolian Kanjur (Beijing woodblock print, 1720), Classical Mongolian in '
          'Uighur-Mongol script, turned so that it reads left to right. Transcribe it exactly in Unicode Mongolian '
          'script (U+1800 block). Output only the transcription.')


def load_rows(path, limit=None):
    rows = []
    with open(path, encoding='utf8') as f:
        for l in f:
            if l.strip():
                rows.append(json.loads(l))
            if limit and len(rows) >= limit:
                break
    return rows


def to_conv(img, text=None):
    from PIL import Image
    im = Image.open(img).convert('RGB')
    msgs = [{'role': 'user', 'content': [{'type': 'image', 'image': im}, {'type': 'text', 'text': PROMPT}]}]
    if text is not None:
        msgs.append({'role': 'assistant', 'content': [{'type': 'text', 'text': text}]})
    return {'messages': msgs}


def lazy_dataset(rows, root):
    """A datasets.Dataset that opens each image only when the collator asks for it, so 80K columns never sit in RAM."""
    from datasets import Dataset
    ds = Dataset.from_list([{'image': os.path.join(root, r['image']), 'text': r['text']} for r in rows])
    return ds.with_transform(lambda b: {'messages': [to_conv(i, t)['messages'] for i, t in zip(b['image'], b['text'])]})


def load_model(args, adapter=None):
    from unsloth import FastVisionModel
    model, tok = FastVisionModel.from_pretrained(args.base, load_in_4bit=True, use_gradient_checkpointing='unsloth',
                                                 max_seq_length=args.max_len)
    if adapter:
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, adapter)
    return model, tok


def infer(args, model, tok, tag):
    from unsloth import FastVisionModel
    from PIL import Image
    import torch
    FastVisionModel.for_inference(model)
    items = load_rows(os.path.join(args.eval, 'columns.jsonl'))
    if args.heldout and os.path.exists(os.path.join(args.data, 'heldout.jsonl')):
        for r in load_rows(os.path.join(args.data, 'heldout.jsonl'), args.heldout):
            items.append({'id': 'synth/' + r['image'], 'image': os.path.abspath(os.path.join(args.data, r['image'])), 'set': 'synth-heldout', 'ref': r['text']})
    out_path = os.path.join(args.out, f'reads-{tag}.jsonl')
    done = set()
    if os.path.exists(out_path):
        done = {json.loads(l)['id'] for l in open(out_path, encoding='utf8') if l.strip()}
    fo = open(out_path, 'a', encoding='utf8')
    todo = [it for it in items if it['id'] not in done]
    if args.sets:
        todo = [it for it in todo if it.get('set') in args.sets.split(',')]
    tok.tokenizer.padding_side = 'left'
    msgs = [{'role': 'user', 'content': [{'type': 'image'}, {'type': 'text', 'text': PROMPT}]}]
    text_in = tok.apply_chat_template(msgs, add_generation_prompt=True)
    for k in range(0, len(todo), args.infer_batch):
        chunk = todo[k:k + args.infer_batch]
        ims = [Image.open(it['image'] if os.path.isabs(it['image']) else os.path.join(args.eval, it['image'])).convert('RGB') for it in chunk]
        enc = tok(ims, [text_in] * len(chunk), add_special_tokens=False, return_tensors='pt', padding=True).to('cuda')
        t0 = time.time()
        with torch.no_grad():
            gen = model.generate(**enc, max_new_tokens=args.max_new, do_sample=False, use_cache=True)
        dt = (time.time() - t0) / len(chunk)
        for it, g in zip(chunk, gen):
            new = g[enc['input_ids'].shape[1]:]
            new = new[new != tok.tokenizer.pad_token_id]
            text = tok.decode(new, skip_special_tokens=True).strip()
            row = {'id': it['id'], 'set': it.get('set'), 'text': text, 'n_tokens': int(len(new)), 'seconds': round(dt, 2)}
            if 'ref' in it:
                row['ref'] = it['ref']
            fo.write(json.dumps(row, ensure_ascii=False) + '\n')
        fo.flush()
        print(f'[{tag}] {k + len(chunk)}/{len(todo)} {dt:.2f}s/item {text[:60]!r}', flush=True)
    fo.close()


def train(args):
    import torch
    from unsloth import FastVisionModel
    from unsloth.trainer import UnslothVisionDataCollator
    from trl import SFTTrainer, SFTConfig
    from transformers import TrainerCallback
    model, tok = load_model(args)
    if args.init_adapter:   # continue an existing LoRA (10-mongol-real-train starts from the synthetic adapter, #5664)
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, args.init_adapter, is_trainable=True)
    else:
        model = FastVisionModel.get_peft_model(model, finetune_vision_layers=True, finetune_language_layers=True,
                                               finetune_attention_modules=True, finetune_mlp_modules=True,
                                               r=args.rank, lora_alpha=args.rank, lora_dropout=0, bias='none', random_state=3407)
    rows = load_rows(os.path.join(args.data, 'labels.jsonl'))
    ds = lazy_dataset(rows, args.data)
    deadline = time.time() + args.hours * 3600

    class Clock(TrainerCallback):
        def on_step_end(self, a, state, control, **kw):
            if time.time() > deadline:
                print(f'time budget reached at step {state.global_step}', flush=True)
                control.should_save = True; control.should_training_stop = True
            return control

    FastVisionModel.for_training(model)
    resume = sorted(glob.glob(os.path.join(args.out, 'ckpt', 'checkpoint-*')), key=lambda p: int(p.rsplit('-', 1)[1]))
    cfg = SFTConfig(
        per_device_train_batch_size=args.batch, gradient_accumulation_steps=args.accum,
        warmup_steps=args.warmup, max_steps=args.max_steps, learning_rate=args.lr, lr_scheduler_type='cosine',
        logging_steps=25, optim='adamw_8bit', weight_decay=0.01, seed=3407,
        output_dir=os.path.join(args.out, 'ckpt'), save_steps=args.save_every, save_total_limit=3,
        report_to='none', bf16=True, remove_unused_columns=False, dataset_text_field='',
        dataset_kwargs={'skip_prepare_dataset': True}, max_length=args.max_len, dataloader_num_workers=4,
    )
    trainer = SFTTrainer(model=model, tokenizer=tok, data_collator=UnslothVisionDataCollator(model, tok, resize='max'),  # no resize: the default (512 px long side) would train at ~48 px high and infer at 84
                         train_dataset=ds, args=cfg, callbacks=[Clock()])
    stats = trainer.train(resume_from_checkpoint=resume[-1] if resume else None)
    final = os.path.join(args.out, 'adapter-final')
    model.save_pretrained(final); tok.save_pretrained(final)
    json.dump({'steps': trainer.state.global_step, 'train_runtime': stats.metrics.get('train_runtime'),
               'loss_log': [h for h in trainer.state.log_history if 'loss' in h],
               'peak_vram_mib': int(torch.cuda.max_memory_allocated() / 2**20)},
              open(os.path.join(args.out, 'train-stats.json'), 'w'), indent=1)
    print('saved', final, flush=True)
    return model, tok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--stage', required=True, choices=['base', 'train', 'infer'])
    ap.add_argument('--base', default='unsloth/Qwen2.5-VL-7B-Instruct-unsloth-bnb-4bit')
    ap.add_argument('--data', required=True)
    ap.add_argument('--eval', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--adapter')
    ap.add_argument('--init-adapter', help='train: start from this LoRA instead of a fresh one')
    ap.add_argument('--warmup', type=int, default=100)
    ap.add_argument('--tag', default='lora')
    ap.add_argument('--rank', type=int, default=16)
    ap.add_argument('--batch', type=int, default=8)
    ap.add_argument('--accum', type=int, default=2)
    ap.add_argument('--lr', type=float, default=2e-4)
    ap.add_argument('--max-steps', type=int, default=6000)
    ap.add_argument('--hours', type=float, default=7.0)
    ap.add_argument('--save-every', type=int, default=500)
    ap.add_argument('--max-len', type=int, default=1024)
    ap.add_argument('--max-new', type=int, default=192)
    ap.add_argument('--heldout', type=int, default=300)
    ap.add_argument('--infer-batch', type=int, default=16)
    ap.add_argument('--sets', help='comma list: only read these sets (meaning,name,synth-heldout)')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    if args.stage == 'base':
        m, t = load_model(args)
        infer(args, m, t, 'base')
    elif args.stage == 'train':
        m, t = train(args)
    else:
        m, t = load_model(args, adapter=args.adapter)
        infer(args, m, t, args.tag)


if __name__ == '__main__':
    main()
