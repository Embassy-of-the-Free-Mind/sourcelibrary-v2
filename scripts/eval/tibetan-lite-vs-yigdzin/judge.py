#!/usr/bin/env python3
"""yigdzin-527 (#4523): judge newly pulled per-leaf Yigdzin reads, incrementally. CPU only, no Mongo writes.
PRIOR ART: /root/tib-step2/judge.py (step 2, 10-02): same acceptance rule, v4 `leaf_v4.judge_one` imported, not
copied; same outputs (merged ledger, leafdir symlinks, stripped texts, SERVE verdict rows for
apply-reocr-verdicts.mjs, one decision row per page, provenance rows in the 2026-09-25 lane's shape).
The difference: step 2 judged a leaf read against the book's Yigdzin PAGE read. These 527 books have none, and the
text they do have (gemini-3.1-flash-lite, 10,630 pages) is the read under suspicion (#4195: it invents fluent text on
Tibetan cursive), so it cannot be the reference. Every read is judged against an EMPTY reference, which leaves v4's
absolute checks: non-Tibetan lines stripped, no near-duplicate lines, no hard loop, lexicon validity >= 0.50.
(fewer-syllables / fewer-lines / over-segmented cannot fire against an empty reference.)

Inputs:  /root/yig527/run-<k>/{pages.jsonl,txt/}  (pulled from box k by tend.py)
Outputs (all under /root/yig527):
  ledger-all.jsonl      merged ledger (one row per judged stem)  -> apply --leaf-ledger
  leafdir/<stem>.txt    symlink to the raw leaf read             -> apply --leafdir
  stripped/<stem>.txt   v4-stripped read, SERVE pages only       -> apply --textdir
  verdicts-all.jsonl    every SERVE row; verdicts/batch-<ts>.jsonl this pass's SERVE rows (printed on stdout)
  decisions.jsonl       one row per judged page: class serve|reject + reason
  provenance.jsonl      one row per judged page (engine, decode, geometry, rule, verdict)
  judged.txt            stems already judged (the checkpoint)
"""
import json, os, sys, time, collections, glob
sys.path.insert(0, "/root/tibetan-reocr"); sys.path.insert(0, "/root/tibetan-eval")
import leaf_v4 as V

D = "/root/yig527"
RUN = "yigdzin-leaf-2026-10-03"
REV = "50506eb6d8ed8738df86b448f6f6cdc688de29ea"


def main():
    for sub in ("leafdir", "stripped", "verdicts"): os.makedirs(f"{D}/{sub}", exist_ok=True)
    judged = set(open(f"{D}/judged.txt").read().split()) if os.path.exists(f"{D}/judged.txt") else set()
    todo = {}
    for r in map(json.loads, open(f"{D}/todo-all.jsonl")): todo[r["stem"]] = r
    ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    batch_path = f"{D}/verdicts/batch-{ts}.jsonl"
    c = collections.Counter()
    with open(f"{D}/ledger-all.jsonl", "a") as lf, open(f"{D}/verdicts-all.jsonl", "a") as va, open(batch_path, "w") as vb, \
            open(f"{D}/decisions.jsonl", "a") as df, open(f"{D}/provenance.jsonl", "a") as pf, open(f"{D}/judged.txt", "a") as jf:
        for run in sorted(glob.glob(f"{D}/run-*")):
            box = run.rsplit("-", 1)[1]
            led = f"{run}/pages.jsonl"
            if not os.path.exists(led): continue
            for line in open(led):
                try: r = json.loads(line)
                except Exception: continue                      # a half-pulled last line; next pass gets it
                s = r.get("id")
                if not s or s in judged or s not in todo: continue
                raw_f = f"{run}/txt/{s}.txt"
                if not os.path.exists(raw_f): continue          # ledger row pulled before its text; next pass
                t = todo[s]
                if t.get("gate"):                                # non-Tibetan page by its Gemini read (build-todo.mjs gate)
                    c[f"gated:{t['gate']}"] += 1
                    df.write(json.dumps({"stem": s, "id": t["id"], "book": t["book"], "page": t["page"], "prior": t["prior"], "box": box,
                                         "class": "gated", "reason": t["gate"]}) + "\n")
                    jf.write(s + "\n"); judged.add(s); continue
                link = f"{D}/leafdir/{s}.txt"
                if not os.path.lexists(link): os.symlink(raw_f, link)
                lf.write(json.dumps(r) + "\n")
                new = open(raw_f, encoding="utf-8").read().strip()
                j, new2 = V.judge_one(s, "", new)
                leaves = r.get("leaf") or []
                if j["accepted"]:
                    open(f"{D}/stripped/{s}.txt", "w", encoding="utf-8").write(new2)
                    v = {"book": t["book"], "page": t["page"], "verdict": "SERVE", "rule": "leaf-accept-v4-absolute",
                         "reason": f"leaf-accept-v4-absolute {j['reason']}", "valid": j["valid_new"],
                         **{k: j[k] for k in ("new_syl", "new", "stripped_lines")}}
                    vb.write(json.dumps(v) + "\n"); va.write(json.dumps(v) + "\n")
                    cls = "serve"
                else:
                    cls = "reject"
                c[f"{cls}:{j['reason']}"] += 1
                df.write(json.dumps({"stem": s, "id": t["id"], "book": t["book"], "page": t["page"], "prior": t["prior"], "box": box,
                                     "class": cls, "reason": j["reason"], "leaves": len(leaves), "path": r.get("path"), "nb": r.get("nb"),
                                     "new_syl": j["new_syl"], "valid_new": j["valid_new"], "stripped": j["stripped_lines"]}) + "\n")
                pl = [{"retry_temp0.4_n2": bool(l.get("retry")), "min_tokens300_redecode": bool(l.get("trunc")),
                       "redecode_kept": l.get("trunc_ok") if l.get("trunc") else None} for l in leaves]
                pf.write(json.dumps({"book": t["book"], "page": t["page"], "read_mode": "leaf", "leaves": len(leaves),
                                     "scope": "yigdzin-527", "prior_ocr_model": t["prior"], "split_method": r.get("path"), "spans_frac": r.get("spans"),
                                     "hf_model": "BDRC/tibetan-ocr", "hf_revision": REV, "vllm_version": "0.29.0",
                                     "plugin": "vllm-paddleocr-seqpos 0.1.0 (sequential M-RoPE)", "prompt": "Extract all Tibetan text. Preserve line breaks.",
                                     "downscale_px": 2400, "run": RUN, "worker": f"sl-yig527-{box}:/root/tib2/yig_leaf_worker.py (2026-09-25 worker, unchanged)",
                                     "decode": {"temperature": 0.0, "min_tokens": 0, "max_tokens": 4096,
                                                "dry": {"dry_multiplier": 0.8, "dry_base": 1.75, "dry_allowed_length": 12}, "per_leaf": pl},
                                     "reference": "empty (no Yigdzin page read exists; the lite read is not a reference)",
                                     "rule_version": j["rule_version"], "accepted": j["accepted"], "reject_reason": None if j["accepted"] else j["reason"],
                                     "new_lines": j["new"], "new_lines_norm": j["new_norm"], "new_syl": j["new_syl"], "stripped_lines": j["stripped_lines"],
                                     "valid_new": j["valid_new"], "class": cls, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}) + "\n")
                jf.write(s + "\n"); judged.add(s)
    n = sum(c.values())
    if not n: os.remove(batch_path); batch_path = None
    print(json.dumps({"judged_now": n, "judged_total": len(judged), "batch": batch_path, "classes": dict(c.most_common())}))


if __name__ == "__main__":
    main()
