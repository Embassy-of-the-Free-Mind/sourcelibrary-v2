# PRIOR ART: scripts/eval/mongol-synth-5664/render.py states the orientation (checked by eye); this checks it numerically.
# CPU check of the orientation hypothesis (#5664, mongol-selfgt): cut words from synthetic training columns, embed
# with the same pixel feature, and compare each real word crop's nearest-synthetic distance as-is vs flipped
# top-to-bottom. If the training renders are the vertical mirror of the real crops, flipped real crops sit nearer.
import os; os.environ['OMP_NUM_THREADS'] = '4'
import json, random, sys, numpy as np, torch, wordseg
from PIL import Image, ImageOps
torch.set_num_threads(4)
random.seed(0)
syn = [json.loads(l) for l in open('/root/jobs/mongol-synth-5664/data/labels.jsonl')][:3000]
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
S = []
for r in syn:
    im = Image.open('/root/jobs/mongol-synth-5664/data/' + r['image']).convert('RGB')
    S += [w for w, _ in words_of(im)]
    if len(S) > 20000: break
R = [json.loads(l) for l in open('words-realgt/words.jsonl')]
R = [w for w in R if w['x1'] - w['x0'] >= 14]; R = random.sample(R, 2000)
real = [Image.open(f'words-realgt/w/{w["wid"]}.png').convert('RGB') for w in R]
Se = emb(S); A = emb(real); B = emb([ImageOps.flip(i) for i in real])
dA = torch.cdist(A, Se).min(1).values; dB = torch.cdist(B, Se).min(1).values
# control: synthetic crops themselves (held out from S) as-is vs flipped
S2 = []
for r in syn[-300:]:
    S2 += [w for w, _ in words_of(Image.open('/root/jobs/mongol-synth-5664/data/' + r['image']).convert('RGB'))]
S2 = S2[:2000]; cA = torch.cdist(emb(S2), Se).min(1).values; cB = torch.cdist(emb([ImageOps.flip(i) for i in S2]), Se).min(1).values
print(f'synthetic words {len(S)}; real sample {len(real)}')
print(f'real as-is   : median NN dist {dA.median():.3f}')
print(f'real flipped : median NN dist {dB.median():.3f}; flipped nearer for {(dB < dA).float().mean():.2f} of crops')
print(f'control synth as-is {cA.median():.3f} flipped {cB.median():.3f}; flipped nearer for {(cB < cA).float().mean():.2f}')
