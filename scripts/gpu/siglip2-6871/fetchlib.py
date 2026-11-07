# fetchlib.py — fetch + decode + preprocess for embed-shards.py, run inside worker PROCESSES (#6871 row 8, fetch fix).
#
# PRIOR ART: embed-shards.py's own load() (pilot: urllib per image through images.sourcelibrary.org, 24 threads in the
# GPU process — 15.8 img/s, GPU busy 0.33: a fresh TLS connection per image, a Worker invocation per image, and decode +
# preprocessing fighting the GPU loop for one GIL). This keeps the pilot's preprocessing byte for byte and changes only
# where the bytes come from and which process does the work:
#   * R2 straight over the S3 API (SigV4, UNSIGNED-PAYLOAD) for images.sourcelibrary.org/<key>: the same object the
#     Worker serves, with no Worker request (Workers bill per request; R2 bills one Class B read either way);
#   * one keep-alive HTTPS connection per thread, reused across images;
#   * a batch is fetched by T threads and decoded in its own process, so the GPU process only unpickles tensors.
# Credentials: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME from the environment; without them
# every row falls back to the public URL (the pilot path).
import datetime, hashlib, hmac, http.client, io, os, threading, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
MODEL = "google/siglip2-so400m-patch14-384"
PUBLIC_HOST = "images.sourcelibrary.org"
_iproc = None; _pool = None; _tl = threading.local(); _r2 = None


def init(threads):
    """process initializer: the image processor and this process's fetch threads."""
    global _iproc, _pool, _r2
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    from transformers import AutoProcessor
    _iproc = AutoProcessor.from_pretrained(MODEL).image_processor
    _pool = ThreadPoolExecutor(threads)
    acct, kid, sec = (os.environ.get(k) for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"))
    _r2 = {"host": f"{acct}.r2.cloudflarestorage.com", "kid": kid, "sec": sec,
           "bucket": os.environ.get("R2_BUCKET_NAME") or "sourcelibrary"} if acct and kid and sec else None


def _sign(key, k):
    return hmac.new(key, k.encode(), hashlib.sha256).digest()


def _r2_get(key):
    """GET one R2 object over a kept-alive connection; returns (status, body)."""
    path = "/" + _r2["bucket"] + "/" + urllib.parse.quote(key, safe="/-_.~")
    now = datetime.datetime.now(datetime.timezone.utc); amz = now.strftime("%Y%m%dT%H%M%SZ"); day = amz[:8]
    hdr = {"host": _r2["host"], "x-amz-content-sha256": "UNSIGNED-PAYLOAD", "x-amz-date": amz}
    signed = ";".join(sorted(hdr))
    canon = "\n".join(["GET", path, "", "".join(f"{k}:{hdr[k]}\n" for k in sorted(hdr)), signed, "UNSIGNED-PAYLOAD"])
    scope = f"{day}/auto/s3/aws4_request"
    sts = "\n".join(["AWS4-HMAC-SHA256", amz, scope, hashlib.sha256(canon.encode()).hexdigest()])
    k = _sign(_sign(_sign(_sign(("AWS4" + _r2["sec"]).encode(), day), "auto"), "s3"), "aws4_request")
    sig = hmac.new(k, sts.encode(), hashlib.sha256).hexdigest()
    h = {**hdr, "Authorization": f"AWS4-HMAC-SHA256 Credential={_r2['kid']}/{scope}, SignedHeaders={signed}, Signature={sig}"}
    for attempt in range(3):
        conn = getattr(_tl, "conn", None)
        if conn is None: conn = _tl.conn = http.client.HTTPSConnection(_r2["host"], timeout=120)
        try:
            conn.request("GET", path, headers=h); resp = conn.getresponse(); body = resp.read()
            return resp.status, body
        except (http.client.HTTPException, OSError):
            try: conn.close()
            except Exception: pass
            _tl.conn = None
            if attempt == 2: raise
            time.sleep(0.5 * (attempt + 1))


def load(r):
    """fetch + decode + resize + preprocess one image → (float16 pixel_values | None, stats). Preprocessing = the pilot's."""
    st = {"bytes": 0, "fetch_s": 0.0, "decode_s": 0.0, "cache": None, "err": None}
    t0 = time.time()
    try:
        u = urllib.parse.urlsplit(r["src"].strip())
        if _r2 and u.hostname == PUBLIC_HOST:
            status, body = _r2_get(urllib.parse.unquote(u.path[1:])); st["cache"] = "r2"
            if status != 200: raise IOError(f"r2 {status}: {body[:120]!r}")
        else:
            req = urllib.request.Request(r["src"], headers={"User-Agent": "sourcelibrary-siglip2-6871"})
            with urllib.request.urlopen(req, timeout=120) as f:
                body = f.read(); st["cache"] = f.headers.get("cf-cache-status")
        st["bytes"] = len(body); t1 = time.time(); st["fetch_s"] = t1 - t0
        im = Image.open(io.BytesIO(body))
        im.draft("RGB", (768, 768))          # JPEG DCT downscale; never below 768 on the long side
        im = im.convert("RGB")
        if max(im.size) > 768:              # the eval's preprocessing (fetch.py): long side ≤ 768, LANCZOS
            s = 768 / max(im.size); im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
        pv = _iproc(images=im, return_tensors="np")["pixel_values"][0].astype(np.float16)
        st["decode_s"] = time.time() - t1
        return pv, st
    except Exception as e:
        st["err"] = repr(e)[:300]; st["fetch_s"] = st["fetch_s"] or time.time() - t0
        return None, st


def load_batch(rows):
    """one batch, in order: (stacked float16 pixel_values of the rows that loaded, [index of each loaded row], stats)."""
    out = list(_pool.map(load, rows))
    ok = [i for i, (pv, _) in enumerate(out) if pv is not None]
    X = np.stack([out[i][0] for i in ok]) if ok else np.zeros((0, 3, 384, 384), np.float16)
    return X, ok, [st for _, st in out]
