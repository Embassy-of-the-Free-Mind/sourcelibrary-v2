# PRIOR ART: ManchuAI-OCR (github.com/mic7ch1/ManchuAI-OCR) configs/base.yaml prompt and src/utils/dataset.py chat format; scripts/eval/mongol-synth-5664/train.py infer() — it reads columns with our Qwen LoRA, this reads word crops with the Manchu Llama LoRA.
# Test 2 (#5664, mongol-selfgt): read Kanjur word crops with the Manchu woodblock/handwriting OCR LoRA
# mic7ch/manchu-ocr-llama-mix-v2 (Apache-2.0; Llama-3.2-11B-Vision 4-bit + LoRA), prompt verbatim from
# ManchuAI-OCR configs/base.yaml. Crops are binarised black-on-white and padded onto the dataset's 480x64 canvas.
# First reads N real test words of mic7ch/manchu-2025-0033 as a sanity check that this harness reproduces the model.
import json, sys, io, glob, time, os, numpy as np, torch
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wordseg
from huggingface_hub import snapshot_download
BASE = 'unsloth/llama-3.2-11b-vision-instruct-unsloth-bnb-4bit'
ADAPTER = 'mic7ch/manchu-ocr-llama-mix-v2'; SUB = os.environ.get('SUB', 'checkpoints/checkpoint-19000')
INSTR = "You are an expert OCR system for Manchu script. Extract the text from the provided image with perfect accuracy. Format your answer exactly as follows: first line with 'Manchu:' followed by the Manchu script, then a new line with 'Roman:' followed by the romanized transliteration.\n"
words_dir, list_file, out = sys.argv[1], sys.argv[2], sys.argv[3]
n_sanity = int(os.environ.get('N_SANITY', 100)); BS = int(os.environ.get('BS', 8))
DRY = os.environ.get('DRY') == '1'   # CPU dry run: build the inputs, skip the model
AD_DIR = os.path.join(snapshot_download(ADAPTER, allow_patterns=[SUB + '/*']), SUB)
if DRY:
    from transformers import AutoProcessor
    proc = AutoProcessor.from_pretrained(BASE)
else:
    # transformers+peft fails on this bnb-4bit checkpoint (peft dispatch_bnb_4bit: no compress_statistics);
    # load as the authors trained it, through Unsloth, which reads the adapter dir's base_model_name_or_path.
    from unsloth import FastVisionModel
    model = None
    try:
        model, proc = FastVisionModel.from_pretrained(AD_DIR, load_in_4bit=True)
    except Exception as e:
        print('load 1 (unsloth adapter dir) failed:', repr(e)[:300], flush=True)
    if model is None:
        try:   # train.py's pattern: Unsloth base, then the adapter through peft
            from peft import PeftModel
            model, proc = FastVisionModel.from_pretrained(BASE, load_in_4bit=True)
            model = PeftModel.from_pretrained(model, AD_DIR)
        except Exception as e:
            print('load 2 (unsloth base + peft) failed:', repr(e)[:300], flush=True); model = None
    if model is None:   # plain transformers, no dtype cast (the cast is the suspect in the first failure)
        from transformers import AutoProcessor, AutoModelForImageTextToText
        from peft import PeftModel
        proc = AutoProcessor.from_pretrained(BASE)
        model = PeftModel.from_pretrained(AutoModelForImageTextToText.from_pretrained(BASE, device_map='cuda:0'), AD_DIR).eval()
    print('model loaded', type(model).__name__, flush=True)
    if hasattr(proc, 'tokenizer'): proc.tokenizer.padding_side = 'left'
    FastVisionModel.for_inference(model)
def to_manchu_canvas(im, flip):
    from PIL import ImageOps
    if flip: im = ImageOps.flip(im)   # control arm only: top-to-bottom mirror
    s = wordseg.ink_map(im)                       # 0..1 ink
    a = (255 * (1 - (s > 0.45))).astype(np.uint8)  # black ink on white
    g = Image.fromarray(a)
    ys = np.where((s > 0.45).any(1))[0]
    if len(ys): g = g.crop((0, max(0, ys[0] - 2), g.width, min(g.height, ys[-1] + 3)))
    sc = min(34 / g.height, 470 / g.width); g = g.resize((max(1, int(g.width * sc)), max(1, int(g.height * sc))))
    c = Image.new('L', (480, 64), 255); c.paste(g, (4, (64 - g.height) // 2)); return c.convert('RGB')
def read(images):
    msgs = [[{'role': 'user', 'content': [{'type': 'image'}, {'type': 'text', 'text': INSTR}]}]] * len(images)
    texts = [proc.apply_chat_template(m, add_generation_prompt=True) for m in msgs]
    inp = proc(images=[[i] for i in images], text=texts, return_tensors='pt', padding=True)
    if DRY: return [f'Manchu: x\nRoman: {tuple(inp["input_ids"].shape)}'] * len(images)
    inp = inp.to('cuda:0')
    with torch.no_grad():
        o = model.generate(**inp, max_new_tokens=64, do_sample=False)
    return proc.batch_decode(o[:, inp['input_ids'].shape[1]:], skip_special_tokens=True)
def parse(t):
    m = r = ''
    for line in t.splitlines():
        if line.startswith('Manchu:'): m = line[7:].strip()
        if line.startswith('Roman:'): r = line[6:].strip()
    return m, r
t0 = time.time()
with open(out, 'w') as f:
    if n_sanity:
        import pyarrow.parquet as pq
        p = snapshot_download('mic7ch/manchu-2025-0033', repo_type='dataset')
        rows = pq.read_table(glob.glob(p + '/data/test-*.parquet')[0]).slice(0, n_sanity).to_pylist()
        for i in range(0, len(rows), BS):
            b = rows[i:i + BS]; outs = read([Image.open(io.BytesIO(r['im']['bytes'])).convert('RGB') for r in b])
            for r, o in zip(b, outs):
                m, ro = parse(o); f.write(json.dumps({'set': 'manchu-test', 'gold_m': r['manchu'], 'gold_r': r['roman'], 'manchu': m, 'roman': ro, 'raw': o}, ensure_ascii=False) + '\n')
        print('sanity done', time.time() - t0, flush=True)
    wids = [l.strip() for l in open(list_file) if l.strip()]
    n_unflip = int(os.environ.get('N_UNFLIP', 300))
    jobs = [(w, 0) for w in wids] + [(w, 1) for w in wids[:n_unflip]]   # as-is (matches the Manchu set by NN check) + a flipped arm
    for i in range(0, len(jobs), BS):
        b = jobs[i:i + BS]; ims = [to_manchu_canvas(Image.open(f'{words_dir}/w/{w}.png').convert('RGB'), fl) for w, fl in b]
        if i == 0:
            for j, im in enumerate(ims[:4]): im.save(f'{os.path.dirname(os.path.abspath(out))}/canvas{j}.png')
        for (w, fl), o in zip(b, read(ims)):
            m, ro = parse(o); f.write(json.dumps({'set': 'kanjur', 'wid': w, 'flip': fl, 'manchu': m, 'roman': ro, 'raw': o}, ensure_ascii=False) + '\n')
        f.flush()
        if i % (BS * 25) == 0: print(i, len(jobs), time.time() - t0, flush=True)
print('done', time.time() - t0, 0 if DRY else torch.cuda.max_memory_allocated() / 2**30, 'GiB', flush=True)
