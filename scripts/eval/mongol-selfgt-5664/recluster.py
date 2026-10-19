# PRIOR ART: embed_cluster.py (variant A); this is variant B on the same embedding.
# Variant B (#5664, mongol-selfgt): k-means with more centroids on the cached embedding, then keep each cluster's
# CORE only (members nearer than the cluster's 60th-percentile distance AND a global distance cap), rank by core size.
import os; os.environ['OMP_NUM_THREADS'] = '6'
import json, sys, numpy as np, torch
D, K, tag = sys.argv[1], int(sys.argv[2]), sys.argv[3]
torch.set_num_threads(6)
W = [json.loads(l) for l in open(f'{D}/words.jsonl')]
Z = torch.from_numpy(np.load(f'{D}/emb-{sys.argv[4] if len(sys.argv) > 4 else "pix"}.npy'))
w = np.array([r['x1'] - r['x0'] for r in W]); idx = np.where(w >= 14)[0]; Zk = Z[idx]
g = torch.Generator().manual_seed(0); C = Zk[torch.randperm(len(Zk), generator=g)[:K]].clone()
asg = lambda: torch.cat([torch.cdist(Zk[i:i+20000], C).argmin(1) for i in range(0, len(Zk), 20000)])
for it in range(30):
    a = asg(); S = torch.zeros_like(C).index_add_(0, a, Zk); n = torch.bincount(a, minlength=K).float()[:, None]
    C = torch.where(n > 0, S / n.clamp(min=1), C)
a = asg(); dist = (Zk - C[a]).norm(dim=1)
cap = float(dist.quantile(0.35))
keep = torch.zeros(len(Zk), dtype=torch.bool)
for k in torch.unique(a).tolist():
    m = (a == k).nonzero()[:, 0]
    if len(m) < 5: continue
    q = dist[m].quantile(0.6); keep[m[(dist[m] <= q) & (dist[m] <= cap)]] = True
with open(f'{D}/clusters-{tag}.jsonl', 'w') as f:
    for j in keep.nonzero()[:, 0].tolist():
        f.write(json.dumps({'wid': W[idx[j]]['wid'], 'c': int(a[j]), 'd': round(float(dist[j]), 4)}) + '\n')
sz = torch.bincount(a[keep], minlength=K)
print(tag, 'K', K, 'kept core', int(keep.sum()), 'of', len(Zk), 'top core sizes', sz.sort(descending=True).values[:10].tolist(), '200th', int(sz.sort(descending=True).values[199]))
