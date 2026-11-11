# PRIOR ART: flip_nn.py (same check against the Manchu training words instead of our renders).
# CPU check of the orientation hypothesis (#5664, mongol-selfgt): cut words from synthetic training columns, embed
# with the same pixel feature, and compare each real word crop's nearest-synthetic distance as-is vs flipped
# top-to-bottom. If the training renders are the vertical mirror of the real crops, flipped real crops sit nearer.
import os; os.environ['OMP_NUM_THREADS'] = '4'
import json, random, sys, numpy as np, torch, wordseg
from PIL import Image, ImageOps
torch.set_num_threads(4)
random.seed(0)
def words_of(im):
    segs, s, r = wordseg.segment(im); out = []
    for a, b, m in segs:
        if b - a < 14: continue
        out.append((im.crop((max(0, a - 2), 0, min(im.width, b + 2), im.height)), int(r[min((a + b) // 2, len(r) - 1)]) - max(0, a - 2) * 0))
    return out
def _feat(im, sp):
    s = wordseg.ink_map(im); H, L = 24, 96
    band = np.zeros((60, s.shape[1]), np.float32)
    for y in range(60):
        yy = sp - 30 + y
        if 0 <= yy < s.shape[0]: band[y] = s[yy]
    full = np.zeros((60, L * 4), np.float32); n = min(s.shape[1], L * 4); full[:, :n] = band[:, :n]
    t = full[:H * 2 + 12].reshape(H + 6, 2, L, 4).mean((1, 3))[3:H + 3]
    v = np.concatenate([t.ravel(), [np.log(max(8, s.shape[1]))]]); return v
def emb(ims):
    X = np.stack([_feat(im, int(np.median(wordseg.spine_rows(wordseg.ink_map(im))))) for im in ims]).astype(np.float32)
    A = torch.from_numpy(X[:, :-1]); A = A / (A.norm(dim=1, keepdim=True) + 1e-6)
    return torch.cat([A, 0.15 * torch.from_numpy(X[:, -1:])], 1)
import glob, io, pyarrow.parquet as pq
from huggingface_hub import snapshot_download
p = snapshot_download('mic7ch/manchu-2025-0033', repo_type='dataset')
T = pq.read_table(glob.glob(p + '/data/train-*.parquet')[0]).slice(0, 12000).to_pylist()
def mcrop(b):
    im = Image.open(io.BytesIO(b)).convert('RGB'); a = np.asarray(im.convert('L')) < 128
    xs = np.where(a.any(0))[0]; ys = np.where(a.any(1))[0]
    im = im.crop((max(0, xs[0] - 2), max(0, ys[0] - 4), xs[-1] + 3, ys[-1] + 5))
    sc = 50 / im.height; return im.resize((max(14, int(im.width * sc)), 50))  # ~ Kanjur word height in the 84px crops
S = [mcrop(r['im']['bytes']) for r in T[:10000]]
R = [json.loads(l) for l in open('words-realgt/words.jsonl')]
R = [w for w in R if w['x1'] - w['x0'] >= 14]; R = random.sample(R, 2000)
real = [Image.open(f'words-realgt/w/{w["wid"]}.png').convert('RGB') for w in R]
Se = emb(S); A = emb(real); B = emb([ImageOps.flip(i) for i in real])
dA = torch.cdist(A, Se).min(1).values; dB = torch.cdist(B, Se).min(1).values
# control: synthetic crops themselves (held out from S) as-is vs flipped
S2 = []
S2 = [mcrop(r['im']['bytes']) for r in T[10000:12000]]
S2 = S2[:2000]; cA = torch.cdist(emb(S2), Se).min(1).values; cB = torch.cdist(emb([ImageOps.flip(i) for i in S2]), Se).min(1).values
print(f'manchu train words {len(S)}; real sample {len(real)}')
print(f'real as-is   : median NN dist {dA.median():.3f}')
print(f'real flipped : median NN dist {dB.median():.3f}; flipped nearer for {(dB < dA).float().mean():.2f} of crops')
print(f'control synth as-is {cA.median():.3f} flipped {cB.median():.3f}; flipped nearer for {(cB < cA).float().mean():.2f}')
