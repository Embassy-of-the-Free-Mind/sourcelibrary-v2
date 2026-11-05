#!/usr/bin/env python3
# PRIOR ART: scripts/eval/caseless-drift-7503/ (rules over Han column layout, no model) and the Supabase page
# embeddings (.claude/docs/embeddings.md: Gemini embeddings of ONE text per page, translation or OCR, never the pair).
# Neither scores a translation against its own source and its neighbours'. This does, with LaBSE, a local open bitext
# model (#5021 Part B: "a cross-lingual embedding test with a LOCAL open model ... on gex45's GPU").
"""
labse_sims.py IN.jsonl.gz OUT.jsonl [--windows]  — for each row (extract.mjs): cosine of LaBSE(en) with LaBSE(src), LaBSE(srcPrev),
LaBSE(srcNext). Texts are cut at 512 tokens. Writes {page_id, s_own, s_prev, s_next} per row. Runs as one gpu-queue task.
"""
import gzip, json, sys, torch
from transformers import AutoModel, AutoTokenizer

inp, out = sys.argv[1], sys.argv[2]
rows = [json.loads(l) for l in gzip.open(inp, 'rt')]
dev = 'cuda' if torch.cuda.is_available() else 'cpu'
tok = AutoTokenizer.from_pretrained('sentence-transformers/LaBSE')
model = AutoModel.from_pretrained('sentence-transformers/LaBSE').to(dev).eval().half() if dev == 'cuda' else AutoModel.from_pretrained('sentence-transformers/LaBSE').eval()
texts, index = [], {}
def tid(t):
    if t not in index:
        index[t] = len(texts); texts.append(t)
    return index[t]
# --windows: the head and the tail of the English (600 chars) against the same SHARE of each source (scaled by the
# page's own SRC/EN length ratio), so that one 512-token window of a dense Han page is not set against a window of
# English that covers a third of the text. s_* is then the mean of the head and tail cosines.
WIN = '--windows' in sys.argv
def cut(t, n, tail):
    n = max(20, int(n)); return t[-n:] if tail else t[:n]
if WIN:
    keys = []
    for r in rows:
        ratio = max(0.05, len(r['src']) / max(1, len(r['en'])))
        q = []
        for tail in (False, True):
            q.append((tid(cut(r['en'], 600, tail)), tid(cut(r['src'], 600 * ratio, tail)), tid(cut(r['srcPrev'], 600 * ratio, tail)), tid(cut(r['srcNext'], 600 * ratio, tail))))
        keys.append(q)
else:
    keys = [[(tid(r['en']), tid(r['src']), tid(r['srcPrev']), tid(r['srcNext']))] for r in rows]
embs = torch.empty((len(texts), 768), dtype=torch.float32)
B = 64
with torch.no_grad():
    for i in range(0, len(texts), B):
        enc = tok(texts[i:i + B], padding=True, truncation=True, max_length=512, return_tensors='pt').to(dev)
        e = model(**enc).pooler_output.float()
        embs[i:i + B] = torch.nn.functional.normalize(e, dim=-1).cpu()
        if i % (B * 50) == 0: print(f'{i}/{len(texts)}', flush=True)
with open(out, 'w') as f:
    for r, q in zip(rows, keys):
        m = lambda i, j: sum(float(embs[w[0]] @ embs[w[j]]) for w in q) / len(q)
        f.write(json.dumps({'page_id': r['page_id'], 's_own': m(0, 1), 's_prev': m(0, 2), 's_next': m(0, 3)}) + '\n')
print('done', len(rows), 'rows', len(texts), 'texts')
