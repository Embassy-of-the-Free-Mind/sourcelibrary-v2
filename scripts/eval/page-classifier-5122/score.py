# PRIOR ART: scripts/eval/estimator/ocr/model_ocr_v1.py (fits engine quality per cell; takes the cell as given),
# scripts/audit/spread-screen.mjs (aspect-ratio spread rule, reproduced as the `aspect` arm). This scores the
# pre-read classifier arms against the labels we hold (#5122): book-grouped 5-fold CV inside the held label sets, and
# train-on-all → the Opus by-eye check set. Prints markdown confusion matrices with n. Read only.
# Usage: python score.py LABELS FEAT.npz[,FEAT2.npz] [VLM.jsonl] > results.md
import sys, json, collections, numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.decomposition import PCA
labp, featp = sys.argv[1:3]; vlmp = sys.argv[3] if len(sys.argv) > 3 else None
L = [json.loads(l) for l in open(labp)]
# FEAT may be a comma-separated list of featurize.py outputs; the first supplies the image statistics
# materialise each array ONCE: indexing an NpzFile re-reads and decompresses the whole array on every access
FS = [dict(np.load(f, allow_pickle=True)) for f in featp.split(',')]
idxs = [{u: i for i, u in enumerate(F['uid'])} for F in FS]
keep = [r for r in L if all(r['uid'] in ix and F['ok'][ix[r['uid']]] for F, ix in zip(FS, idxs))]
X_s = np.nan_to_num(np.stack([FS[0]['stats'][idxs[0][r['uid']]] for r in keep]))
EMB = {}
for F, ix in zip(FS, idxs):
    for k in F:
        if k.startswith('emb:'):
            nm = k[4:].split('/')[-1].replace('-patch16-224', '').replace('-patch14-384', '') + ('+tiles' if F[k].shape[1] > 1000 else '')
            EMB[nm] = np.stack([F[k][ix[r['uid']]] for r in keep])
featp = featp.split(',')[-1]
VLM = {}
if vlmp:
    for l in open(vlmp):
        o = json.loads(l); VLM[o['uid']] = o.get('pred') or {}
grp = np.array([r.get('book_id') or r['uid'] for r in keep])
is_check = np.array([r['set'] == 'check' for r in keep])

def lab(r, h):
    if h == 'medium':  # print vs hand, from the script-class print-technique labels (the `manuscripts` routing row)
        sc = r['labels'].get('script_class') or ''
        return 'manuscript' if sc.startswith('manuscript') else ('print' if sc in ('woodblock', 'typeset', 'typeset-print', 'rubbing') else None)
    v = r['labels'].get({'kind_train': 'kind'}.get(h, h))
    if h == 'script_train': v = r['labels'].get('script') or r['labels'].get('script_silver')
    if v is None: return None
    if h == 'kind_train': v = {'diagram': 'plate', 'mixed': 'table'}.get(v, v)
    if h == 'leaves': v = '1' if int(v) <= 1 else ('2' if int(v) == 2 else '3+')
    return v
SCRIPTS_MAIN = {'Latn', 'Grek', 'Hani', 'Jpan', 'Arab', 'Hebr', 'Syrc', 'Tibt', 'Armn', 'Deva', 'Cyrl', 'Mong'}
def fold_script(v): return v if v in SCRIPTS_MAIN else ('none' if v == 'none' else 'other')
def vlm_pred(uid, h):
    p = VLM.get(uid, {}); v = p.get({'script_train': 'script', 'kind_train': 'kind', 'leaves': 'leaves', 'medium': 'medium'}[h])
    if v is None: return 'no-answer'
    if h == 'script_train': return fold_script(str(v))
    if h == 'leaves':
        try: n = int(v)
        except Exception: return 'no-answer'
        return '1' if n <= 1 else ('2' if n == 2 else '3+')
    return str(v)

def fit(X, y):
    # PCA to 256 keeps a 2,300-dim embedding arm to seconds per fit; no effect on the 19-dim statistics arm
    steps = [StandardScaler()] + ([PCA(256, random_state=0)] if X.shape[1] > 256 else [])
    return make_pipeline(*steps, LogisticRegression(C=0.5, max_iter=3000, class_weight='balanced')).fit(X, y)
def arms(h):
    a = {'stats': X_s}
    for nm, X_e in EMB.items(): a[f'{nm}+stats'] = np.hstack([X_e, X_s])
    return a
def run(h):
    """returns {arm: (cv_pred[array or None], check_pred, check_conf)} over keep rows"""
    y = np.array([lab(r, h) if not (h == 'script_train' and r['labels'].get('script') is None and r['labels'].get('script_silver') is None) else None for r in keep], dtype=object)
    if h == 'script_train': y = np.array([fold_script(v) if v else None for v in y], dtype=object)
    has = np.array([v is not None for v in y]); tr = has & ~is_check
    out = {}
    for name, X in arms(h).items():
        cv = np.array([None] * len(keep), dtype=object); conf = np.zeros(len(keep))
        ii = np.where(tr)[0]
        for a, b in GroupKFold(5).split(ii, groups=grp[ii]):
            m = fit(X[ii[a]], y[ii[a]].astype(str)); P = m.predict_proba(X[ii[b]])
            cv[ii[b]] = m.classes_[P.argmax(1)]; conf[ii[b]] = P.max(1)
        m = fit(X[tr], y[tr].astype(str)); P = m.predict_proba(X[is_check])
        cv[is_check] = m.classes_[P.argmax(1)]; conf[is_check] = P.max(1)
        out[name] = (cv, conf)
    if h == 'leaves':
        ar = X_s[:, 0]; out['aspect 1.05–2.2 (spread-screen rule)'] = (np.where((ar >= 1.05) & (ar <= 2.2), '2', '1').astype(object), np.ones(len(keep)))
    if VLM and h != 'medium':  # the VLM prompt does not ask print vs hand
        vp = np.array([vlm_pred(r['uid'], h) for r in keep], dtype=object)
        out['qwen3-vl-8b zero-shot'] = (vp, np.ones(len(keep)))
        # the router's candidate: take a label only where the best probe and the VLM agree, else abstain (catalogue)
        best = [k for k in out if k.endswith('+stats')][-1]
        bp = out[best][0]
        out[f'agree({best}, qwen3-vl)'] = (np.array([a if str(a) == str(b) else 'abstain' for a, b in zip(bp, vp)], dtype=object), np.ones(len(keep)))
    return y, out

def cm(true, pred, title):
    true = list(map(str, true)); pred = list(map(str, pred))
    rows = sorted(set(true)); cols = sorted(set(pred) | set(true))
    c = collections.Counter(zip(true, pred)); n = len(true)
    acc = sum(c[(t, t)] for t in rows) / n if n else 0
    s = [f"\n**{title}** — n = {n}, accuracy {acc:.3f}\n", '| true \\ predicted | ' + ' | '.join(cols) + ' | n | recall |', '|---' * (len(cols) + 3) + '|']
    for t in rows:
        nt = sum(c[(t, p)] for p in cols)
        s.append(f'| **{t}** | ' + ' | '.join(str(c[(t, p)]) if c[(t, p)] else '·' for p in cols) + f' | {nt} | {c[(t, t)] / nt:.2f} |')
    prec = [f"{p}: {c[(p, p)] / sum(c[(t, p)] for t in rows):.2f} (of {sum(c[(t, p)] for t in rows)})" for p in cols if sum(c[(t, p)] for t in rows)]
    s.append('\nprecision — ' + '; '.join(prec))
    return '\n'.join(s)

HEADS = {'script_train': 'script', 'kind_train': 'page kind', 'leaves': 'leaf count', 'medium': 'print or manuscript'}
res = {}
for h, title in HEADS.items():
    y, out = run(h)
    res[h] = (y, out)
    print(f"\n## {title}\n")
    for arm, (pred, conf) in out.items():
        print(f"\n### {title} · arm `{arm}`")
        # scoring populations: gold only (silver script labels train, never score)
        pops = []
        if h == 'script_train':
            g = [i for i, r in enumerate(keep) if r['labels'].get('script') and not is_check[i]]
            pops.append(('held gold labels, book-grouped CV (reference census; IA English; #6561 Opus; #5771 frames)', g, [fold_script(keep[i]['labels']['script']) for i in g]))
        if h == 'kind_train':
            for st, nm in (('dd4763', '#4763 English strata: date-dense vs prose'), ('tab6561', '#6561 Chinese Paddle-flagged pages, Opus layout call'),
                           ('bench', 'sealed benchmark pages, #4763 rule on the reference text'), ('music', 'music transcription pages (positives only)')):
                g = [i for i, r in enumerate(keep) if r['set'] == st and r['labels'].get('kind')]
                pops.append((f'{nm}, book-grouped CV', g, [keep[i]['labels']['kind'] for i in g]))
        if h == 'leaves':
            for st, nm in (('bench', 'script-class spread labels (#5122 Sonnet by eye)'), ('frames', '#5771 split-leaves pilot pecha frames'),
                           ('usplit', 'user-split images'), ('dd4763', 'IA per-leaf English')):
                g = [i for i, r in enumerate(keep) if r['set'] == st and lab(r, 'leaves')]
                pops.append((f'{nm}, book-grouped CV', g, [lab(keep[i], 'leaves') for i in g]))
        if h == 'medium':
            g = [i for i, r in enumerate(keep) if lab(r, 'medium')]
            pops.append(('script-class print technique (#5122 Sonnet by eye; Chinese and Greek only), book-grouped CV', g, [lab(keep[i], 'medium') for i in g]))
        c = [i for i in np.where(is_check)[0] if h != 'medium' and lab(keep[i], h if h != 'script_train' else 'script')]
        tl = [ (fold_script(keep[i]['labels']['script']) if h == 'script_train' else (keep[i]['labels']['kind'] if h == 'kind_train' else lab(keep[i], 'leaves'))) for i in c]
        pops.append(('**Opus by-eye check set** (fresh random draw, trained on everything else)', c, tl))
        for nm, g, t in pops:
            if g: print(cm(t, [pred[i] for i in g], nm))
        if 'zero-shot' not in arm and 'aspect' not in arm and c:
            # coverage/accuracy when the router takes the label only above a confidence
            for thr in (0.6, 0.8, 0.9):
                sel = [j for j, i in enumerate(c) if conf[i] >= thr]
                if sel: print(f"\ncheck set at confidence ≥ {thr}: coverage {len(sel)}/{len(c)}, accuracy {np.mean([str(pred[c[j]]) == str(tl[j]) for j in sel]):.3f}")
json.dump({h: {arm: {keep[i]['uid']: [str(p[i]), float(cf[i])] for i in range(len(keep))} for arm, (p, cf) in out.items()} for h, (y, out) in res.items()},
          open(featp.replace('.npz', '-preds.json'), 'w'))
