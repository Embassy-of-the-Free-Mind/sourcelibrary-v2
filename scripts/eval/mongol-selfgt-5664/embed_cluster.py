# PRIOR ART: none in scripts/eval (INDEX.md has no word-image clustering); D-methods.md (session research) proposes the method.
# Pixel-shape embedding + k-means of word crops (#5664, mongol-selfgt). CPU only.
# Feature: ink map in a spine-centred band, resized to 24x96 (aspect kept by padding to a fixed length per width bin),
# blurred, plus log-width; PCA to 96 dims; spherical k-means in torch.
import os; os.environ['OMP_NUM_THREADS'] = '1'
import json, sys, numpy as np, torch, wordseg
from PIL import Image
from multiprocessing import Pool
D = sys.argv[1]; K = int(sys.argv[2]) if len(sys.argv) > 2 else 3000
W = [json.loads(l) for l in open(f'{D}/words.jsonl')]
H, L = 24, 96
def feat(w):
    im = Image.open(f'{D}/w/{w["wid"]}.png')
    s = wordseg.ink_map(im)
    sp = w['spine']; top = sp - 30; band = np.zeros((60, s.shape[1]), np.float32)
    for y in range(60):
        yy = top + y
        if 0 <= yy < s.shape[0]: band[y] = s[yy]
    wpx = s.shape[1]
    canvas = np.zeros((60, max(wpx, 1)), np.float32); canvas[:, :wpx] = band
    # fixed scale: 1 px of feature = 4 px of crop, so widths stay comparable; pad/crop to L*4 px
    full = np.zeros((60, L * 4), np.float32); n = min(wpx, L * 4); full[:, :n] = canvas[:, :n]
    t = full[:H * 2 + 12].reshape(H + 6, 2, L, 4).mean((1, 3))[3:H + 3]      # 24 x 96 (rows 6..54 of the band)
    tp = np.pad(t, 1, mode='edge'); t = sum(tp[i:i + H, j:j + L] for i in range(3) for j in range(3)) / 9
    return np.concatenate([t.ravel(), [np.log(max(8, wpx))]]).astype(np.float32), wpx
if __name__ == '__main__':
    import os
    if os.path.exists(f'{D}/feat-pix.npz'):
        z = np.load(f'{D}/feat-pix.npz'); X, widths = z['X'], z['w']
    else:
        with Pool(6) as p: R = p.map(feat, W, chunksize=256)
        X = np.stack([r[0] for r in R]); widths = np.array([r[1] for r in R]); np.savez(f'{D}/feat-pix.npz', X=X, w=widths)
    torch.set_num_threads(6)
    keep = widths >= 14
    Xt = torch.from_numpy(X[:, :-1]); Xt = Xt / (Xt.norm(dim=1, keepdim=True) + 1e-6)
    mu = Xt[keep].mean(0); U, S, V = torch.pca_lowrank(Xt[keep] - mu, q=96)
    Z = (Xt - mu) @ V
    lw = torch.from_numpy(X[:, -1:]) ; Z = torch.cat([Z / Z.norm(dim=1, keepdim=True).clamp(min=1e-6), 1.5 * (lw - lw.mean())], 1)
    np.save(f'{D}/emb-pix.npy', Z.numpy())
    idx = np.where(keep)[0]; Zk = Z[idx]
    g = torch.Generator().manual_seed(0); C = Zk[torch.randperm(len(Zk), generator=g)[:K]].clone()
    for it in range(25):
        a = torch.cat([torch.cdist(Zk[i:i+20000], C).argmin(1) for i in range(0, len(Zk), 20000)])
        S = torch.zeros_like(C).index_add_(0, a, Zk); n = torch.bincount(a, minlength=K).float()[:, None]
        C = torch.where(n > 0, S / n.clamp(min=1), C)
    a = torch.cat([torch.cdist(Zk[i:i+20000], C).argmin(1) for i in range(0, len(Zk), 20000)])
    dist = (Zk - C[a]).norm(dim=1)
    with open(f'{D}/clusters-pix.jsonl', 'w') as f:
        for j, i in enumerate(idx): f.write(json.dumps({'wid': W[i]['wid'], 'c': int(a[j]), 'd': round(float(dist[j]), 4)}) + '\n')
    sz = torch.bincount(a, minlength=K)
    print('kept', len(idx), 'of', len(W), 'K', K, 'top sizes', sz.sort(descending=True).values[:20].tolist())
