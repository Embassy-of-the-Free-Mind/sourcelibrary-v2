# PRIOR ART: /root/jobs/siglip2-6871/code/embed-shards.py (SigLIP2 crops for image search, #6871: embeddings only,
# no page labels), scripts/audit/spread-screen.mjs (stored aspect ratio 1.05–2.2 → spread; its rule is reproduced
# here as the baseline), split_training_examples.features (the old gutter features of the split tool). This computes,
# for every manifest image, cheap image statistics AND SigLIP2 image embeddings, on the CPU (the GPU queue is busy;
# the arm must be $0 and must not disturb it). Read only.
# Usage: [DEVICE=cuda] [TILES=1] python featurize.py MANIFEST IMGDIR OUT.npz [model ...]
import sys, json, hashlib, os, numpy as np, torch
from PIL import Image, ImageOps
torch.set_num_threads(int(os.environ.get('THREADS', 8)))
man, imgdir, outp = sys.argv[1:4]; models = sys.argv[4:] or ['google/siglip2-base-patch16-224']
rows = [json.loads(l) for l in open(man)]
key = lambda u: hashlib.sha1(u.encode()).hexdigest()[:16]
paths = [f"{imgdir}/{key(r['image_url'])}.jpg" for r in rows]
ok = np.array([os.path.exists(p) for p in paths])

def stats(path):
    im = ImageOps.exif_transpose(Image.open(path)).convert('L'); W, H = im.size
    g = np.asarray(im.resize((256, 256)), dtype=np.float32) / 255.0
    ink = g < 0.5  # rough: dark = ink
    col = g.mean(0); row = g.mean(1)
    mid = col[96:160]; edge = np.r_[col[32:96], col[160:224]]
    f = [W / H, np.log(W / H), g.mean(), g.std(), ink.mean(),
         # gutter: a dark or a bright vertical band near the centre, against the text blocks on either side
         mid.min() - edge.mean(), mid.max() - edge.mean(), (np.argmin(mid) - 32) / 32,
         col.std(), row.std(),
         # mid-tones: illustrations and photographs are full of greys; text is ink on paper
         ((g > 0.25) & (g < 0.6)).mean(),
         # ruled lines: long dark runs along rows / columns (tables, frames)
         (ink.mean(1) > 0.6).mean(), (ink.mean(0) > 0.6).mean()]
    # periodicity of the row profile: text lines give a strong peak in the spectrum
    for prof in (row - row.mean(), col - col.mean()):
        sp = np.abs(np.fft.rfft(prof))[1:64]; f += [sp.max() / (sp.sum() + 1e-6), float(np.argmax(sp))]
    # colour: red rubrics, coloured plates
    c = np.asarray(Image.open(path).convert('RGB').resize((128, 128)), dtype=np.float32) / 255.0
    sat = c.max(2) - c.min(2); f += [sat.mean(), (sat > 0.25).mean()]
    return f

S = np.zeros((len(rows), 19), np.float32)
for i, p in enumerate(paths):
    if ok[i]:
        try: S[i] = stats(p)
        except Exception as e: ok[i] = False; print('stats fail', p, e)
out = {'uid': np.array([r['uid'] for r in rows]), 'ok': ok, 'stats': S}
from transformers import AutoModel, AutoProcessor
for m in models:
    dev = os.environ.get('DEVICE', 'cpu'); tiles = os.environ.get('TILES') == '1'
    model = AutoModel.from_pretrained(m).eval().to(dev); proc = AutoProcessor.from_pretrained(m)
    E = None; B = 32
    def emb(ims):
        with torch.no_grad():
            x = proc(images=ims, return_tensors='pt').to(dev)
            e = model.get_image_features(**x)
            e = e.pooler_output if hasattr(e, 'pooler_output') else e
            return torch.nn.functional.normalize(e.float(), dim=-1).cpu().numpy()
    def quads(im):  # 2x2 tiles: the model sees each quarter at its full input size (4x the pixels per glyph)
        w, h = im.size
        return [im.crop((x0, y0, x0 + w // 2, y0 + h // 2)) for y0 in (0, h // 2) for x0 in (0, w // 2)]
    idx = np.where(ok)[0]
    for s in range(0, len(idx), B):
        b = idx[s:s + B]
        ims = [Image.open(paths[i]).convert('RGB') for i in b]
        e = emb(ims)
        if tiles:  # full-page embedding, then the mean of its four quarter embeddings
            q = emb([t for im in ims for t in quads(im)]).reshape(len(ims), 4, -1).mean(1)
            e = np.hstack([e, q])
        if E is None: E = np.zeros((len(rows), e.shape[1]), np.float32)
        E[b] = e
        if s % 640 == 0: print(m, s, '/', len(idx), flush=True)
    out['emb:' + m] = E
np.savez_compressed(outp, **out)
print('wrote', outp, ok.sum(), 'of', len(rows))
