#!/usr/bin/env python3
"""yigdzin-527 tender (#4523): Hetzner cron every 15 min, under flock. Drives N boxes (sl-yig527-<k>).
PRIOR ART: /root/tib-step2/tend.py (step 2, one box): pull -> if the worker exited: final pull, touch PULLED, API
poweroff, confirm stopped; idle stop at 40 min without new output; lease renewal 4 h at a time only while output grows;
a euro hard cap. Same per box. Added: a GLOBAL euro cap summed over boxes, and a rolling judge + apply each pass
(judge.py, then scripts/maintenance/apply-reocr-verdicts.mjs on that pass's SERVE rows), gated by the file
/root/yig527/APPLY-ENABLED. The rolling apply is what makes `progress=mongo:bdrc` on the lease true: every pass
writes `ocr.updated_at` on pages with `ocr.source: bdrc`, so the Hetzner watchdog stops the boxes if it stalls.
State: /root/yig527/tend-state.json  {boxes: {k: {...}}, pending: [batch files not yet applied], applied: [...]}
"""
import json, os, subprocess, time, urllib.request, glob
from datetime import datetime, timezone, timedelta

D = "/root/yig527"; ST = f"{D}/tend-state.json"; LOG = f"{D}/tend.log"
HERE = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.abspath(f"{HERE}/../../..")
EUR_H = 0.7875; EUR_CAP = 118.0   # L4-1-24G list price; a box's own eur_h (L4-4-24G 3.15) overrides. Hard cap 120 approved; stop 2 short
TOKEN = [l.split("=", 1)[1].strip().strip('"') for l in open("/root/.scaleway.env") if l.startswith("SCALEWAY_SECRET_KEY=")][0]
SSH = "ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
ENV = "/root/sourcelibrary/.env.production.local"


def api(zone, sid, path="", data=None):
    req = urllib.request.Request(f"https://api.scaleway.com/instance/v1/zones/{zone}/servers/{sid}{path}",
                                 data=json.dumps(data).encode() if data else None,
                                 headers={"X-Auth-Token": TOKEN, "Content-Type": "application/json"}, method="POST" if data else "GET")
    return json.load(urllib.request.urlopen(req, timeout=30))


def sh(cmd, t=1500): return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=t)
def now(): return datetime.now(timezone.utc)
def log(m):
    line = f"{now():%Y-%m-%dT%H:%M:%SZ} {m}"; open(LOG, "a").write(line + "\n"); print(line)


def poweroff(k, b, why):
    try: api(b["zone"], b["sid"], "/action", {"action": "poweroff"}); log(f"[{k}] POWEROFF requested ({why})")
    except Exception as e: log(f"[{k}] POWEROFF FAILED ({why}): {e}")
    st = "?"
    for _ in range(20):
        time.sleep(15); st = api(b["zone"], b["sid"])["server"]["state"]
        if st == "stopped": log(f"[{k}] confirmed stopped"); return True
    log(f"[{k}] NOT confirmed stopped after 5 min (state={st})"); return False


def box_hours(b, t):
    return b.get("billed_h", 0.0) + ((t - datetime.fromisoformat(b["running_since"])).total_seconds() / 3600 if b.get("running_since") else 0)


def tend_box(k, b, s):
    t = now()
    srv = api(b["zone"], b["sid"])["server"]; state = srv["state"]; ip = (srv.get("public_ip") or {}).get("address")
    if state not in ("running", "starting"):
        if b.get("running_since"): b["billed_h"] = box_hours(b, t); b["running_since"] = None
        if b.get("final_pulled") or b.get("exit"): b["done"] = True
        log(f"[{k}] box {state}; n={b.get('last_n', 0)} h={box_hours(b, t):.2f}{' DONE' if b.get('done') else ''}"); return
    if not b.get("running_since"): b["running_since"] = t.isoformat()
    B = f"root@{ip}"
    g = b.get("gpus", 1)
    # (remote run dir, remote log, remote exit file, local dir): one per GPU worker
    dirs = [("/root/tib2/run", "/root/tib2/run.log", "/root/tib2/run.exit", f"{D}/run-{k}")] if g == 1 else \
        [(f"/root/tib2/g{i}/run", f"/root/tib2/g{i}/run.log", f"/root/tib2/g{i}/run.exit", f"{D}/run-{k}g{i}") for i in range(g)]
    rc = 0; last = ""
    for rd, rl, rx, ld in dirs:
        os.makedirs(f"{ld}/txt", exist_ok=True)
        q = sh(f"rsync -a -e '{SSH}' {B}:{rd}/txt/ {ld}/txt/ && rsync -a -e '{SSH}' {B}:{rd}/pages.jsonl {B}:{rd}/worker.jsonl {B}:{rl} {ld}/")
        rc |= q.returncode
        last = sh(f"grep -ah ' done ' {ld}/run.log 2>/dev/null | tail -1").stdout.strip() or last
    exits = " ".join(rx for _, _, rx, _ in dirs)
    p = sh(f"{SSH} {B} 'cat {exits} 2>/dev/null | wc -l; pgrep -f [y]ig_leaf_worker | wc -l; pgrep -f [s]etup.sh >/dev/null && echo SETUP'")
    out_ = p.stdout.split()
    n_exit, n_alive = (int(out_[0]), int(out_[1])) if len(out_) >= 2 else (0, -1)
    tail = f"exits={n_exit}/{len(dirs)} alive={n_alive}" + (" SETUP" if "SETUP" in p.stdout else "")
    n = sum(len(os.listdir(f"{ld}/txt")) for *_, ld in dirs); prev = b.get("last_n", 0); b["last_n"] = n
    if n > prev: b["last_growth"] = t.isoformat()
    msg = f"[{k}] n={n} (+{n - prev}) h={box_hours(b, t):.2f} eur={box_hours(b, t) * b.get('eur_h', EUR_H):.1f} rc={rc} box[{tail}] :: {last[:100]}"
    if n_exit == len(dirs) and n_alive == 0:
        b["exit"] = tail
        sh(f"{SSH} {B} 'touch /root/tib2/PULLED'"); b["final_pulled"] = True
        log(msg + " -> worker finished; final pull done; PULLED touched")
        if poweroff(k, b, "run finished"):
            b["done"] = True; b["billed_h"] = box_hours(b, now()); b["running_since"] = None
        return
    since = b.get("last_growth") or b["running_since"]
    if (t - datetime.fromisoformat(since)) > timedelta(minutes=40) and (t - datetime.fromisoformat(b["running_since"])) > timedelta(minutes=45) \
            and "SETUP" not in tail:
        log(msg + " -> IDLE 40 min, no new output"); poweroff(k, b, "idle"); return
    tags = {x.split("=", 1)[0]: x.split("=", 1)[1] for x in srv.get("tags", []) if "=" in x}
    until = datetime.fromisoformat(tags.get("lease-until", t.isoformat()).replace("Z", "+00:00"))
    grew = b.get("last_growth") and (t - datetime.fromisoformat(b["last_growth"])) < timedelta(minutes=45)
    want_progress = s.get("applied_ok", 0) > 0 and tags.get("progress") != "mongo:bdrc"
    if (until - t < timedelta(hours=1.5) and grew) or (want_progress and grew):
        r = sh(f"cd {REPO} && set -a && . {ENV} && . /root/.scaleway.env && set +a && node scripts/maintenance/gpu-lease-watchdog.mjs "
               f"--lease {b['sid']} --zone {b['zone']} --hours 4 --owner 4523" + (" --progress mongo:bdrc" if s.get("applied_ok", 0) > 0 else ""))
        msg += f" -> lease: {r.stdout.strip()[-90:]}"
    log(msg)


def judge_and_apply(s):
    r = sh(f"python3 {HERE}/judge.py", t=3000)
    if r.returncode != 0: log(f"JUDGE FAILED rc={r.returncode} {r.stderr[-300:]}"); return
    j = json.loads(r.stdout.strip().splitlines()[-1]); log(f"judge: {json.dumps(j)[:300]}")
    if j.get("batch"): s.setdefault("pending", []).append(j["batch"])
    if not os.path.exists(f"{D}/APPLY-ENABLED"): return
    os.makedirs(f"{D}/apply", exist_ok=True)
    while s.get("pending"):
        bf = s["pending"][0]; tag = os.path.basename(bf)[:-6]
        cmd = (f"cd {REPO} && node --env-file={ENV} scripts/maintenance/apply-reocr-verdicts.mjs --verdicts={bf} --textdir={D}/stripped "
               f"--model=bdrc-yigdzin-v1 --run=yigdzin-leaf-2026-10-03 --read-mode=leaf --leaf-ledger={D}/ledger-all.jsonl --leafdir={D}/leafdir "
               f"--report={D}/apply/{tag}.report.jsonl --apply")
        r = sh(cmd, t=3000)
        if r.returncode != 0: log(f"APPLY FAILED {tag} rc={r.returncode} {r.stderr[-300:]}"); return
        log(f"apply {tag}: {r.stdout.strip().splitlines()[-1][:300]}")
        s["pending"].pop(0); s.setdefault("applied", []).append(bf); s["applied_ok"] = s.get("applied_ok", 0) + 1
        json.dump(s, open(ST, "w"), indent=1)


def main():
    if not os.path.exists(ST): return
    s = json.load(open(ST))
    if s.get("done"): return
    t = now()
    for k, b in sorted(s["boxes"].items()):
        if b.get("done"): continue
        try: tend_box(k, b, s)
        except Exception as e: log(f"[{k}] tend error: {type(e).__name__}: {e}")
        json.dump(s, open(ST, "w"), indent=1)
    eur = sum(box_hours(b, t) * b.get("eur_h", EUR_H) for b in s["boxes"].values()) + s.get("eur_other", 0.0)
    gpu_h = sum(box_hours(b, t) * b.get("gpus", 1) for b in s["boxes"].values())
    log(f"total GPU-hours {gpu_h:.2f} eur~{eur:.1f} (cap {EUR_CAP})")
    if eur >= EUR_CAP:
        for k, b in s["boxes"].items():
            if not b.get("done"):
                st = api(b["zone"], b["sid"])["server"]["state"]
                if st != "stopped": poweroff(k, b, "GLOBAL EUR CAP")
                b["billed_h"] = box_hours(b, now()); b["running_since"] = None; b["done"] = True; b["capped"] = True
        json.dump(s, open(ST, "w"), indent=1)
    judge_and_apply(s)
    if all(b.get("done") for b in s["boxes"].values()) and not s.get("pending") and os.path.exists(f"{D}/APPLY-ENABLED"):
        s["done"] = True; log("ALL BOXES DONE, all batches applied")
    json.dump(s, open(ST, "w"), indent=1)


if __name__ == "__main__":
    main()
