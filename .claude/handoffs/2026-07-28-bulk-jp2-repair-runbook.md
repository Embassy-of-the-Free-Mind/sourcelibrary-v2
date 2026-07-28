# Runbook: finishing the #3368 repair (2026-07-28)

Continuation of `.claude/handoffs/2026-07-27-bulk-jp2-leaf-offset.md` (the postmortem —
read that first for the mechanism). This file is the operational state: what is
running, where, and what remains.

PR #3369 is **merged to main**. Hetzner auto-pulls main, so the archiver fix is live
on the pipeline box and cannot create new damage.

## Running right now, on Hetzner (`root@46.224.122.120`)

Both detached with `setsid nohup`; they survive SSH disconnect and do not depend on
Derek's laptop.

| job | command | log |
|---|---|---|
| image repair | `node scripts/maintenance/repair-bulk-jp2-offset.mjs --from-audit scripts/output/bulk-archive-alignment.jsonl --apply --concurrency 8` | `/root/repair-3368.log` |
| audit sweep | `node scripts/audit/bulk-archive-alignment.mjs --all --resume --concurrency 3` | `/root/audit-3368.log` |

Check them:

```bash
ssh root@46.224.122.120 'pgrep -f repair-bulk-jp2-offset >/dev/null && echo repair-alive; \
  grep -c "\[OK\]" /root/repair-3368.log; grep "^\[book" /root/repair-3368.log | tail -1'
```

Both are **resumable**. The repair skips books with
`archive_metadata.jp2_offset_repaired: true`; the sweep skips book ids already in its
JSONL. If either dies, re-run the same command.

Measured throughput on the laptop was ~79 pages/min at concurrency 6 → ~58h for
275,002 pages. Hetzner runs at concurrency 8 with better bandwidth, so expect faster,
but budget a couple of days.

## Remaining work, in order

### 1. Second repair pass (free)

The repair loaded its queue from a snapshot taken while the sweep was still
discovering books. When the sweep finishes, re-run the same repair command — it will
pick up stragglers and skip everything already done.

### 2. Re-OCR the stranded pages (PAID, ~$88, approved 2026-07-28)

**Do not start before the repair finishes.** Re-OCR'ing a book whose images are still
shifted just transcribes the wrong scans again.

~111,777 pages across the repaired books are flagged:

```js
db.pages.find({ needs_reocr: true, needs_reocr_reason: 'jp2-offset-repair-#3368' })
```

These are the pages whose OCR was transcribed from the shifted image — they looked
*correct* before the repair and are stranded by it. Rate ≈ $0.00079/page
(`scripts/batch/bulk-reocr-local.mjs`). Re-translation of whichever of those pages
carry translations is a further, uncosted step.

### 3. Purge Cloudflare

The image objects are CDN-cached; without a purge readers keep seeing the pre-repair
scan. Run once after the repair completes:

```bash
set -a; source .env.production.local; set +a
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

(Purge needs `CLOUDFLARE_API_TOKEN`; `CF_API_TOKEN` is WAF-scoped only.)

### 4. Close the feedback loop

Two entries in `feedback` remain unmarked, deliberately — they stay open until the
books actually read correctly:

- `6a6677f0c66e034ebe69a378` — "This page has errors — not the same as image"
- `6a667308432cf8ba89cbe4d3` — "I'm seeing chapter 4 on the image page and chapter 5 in the text"

Both are *Pseudodoxia*, which **is** repaired and verified — these can be marked once
spot-checked in a browser. The 2026-07-16 *Federalist* report is the same defect and
is still queued.

## Deliberately NOT done

- **`severity: none` books (315).** Shifted, but their OCR was transcribed from the
  same shifted images, so text and image agree and no reader sees a defect. Repairing
  them would *create* one. The script refuses them by construction.
- **1,178 `ambiguous` books.** Unverified, not verified-good. ~65 lean shifted. Nobody
  has characterised them.
- **Alignment guards on the other `archived_photo` writers** (`archive-ia-bulk.mjs`,
  `archive-images-fast.ts`, `archive-unarchived-books.ts`, `archiving-watchdog.mjs`).
  Only `archive-bulk.mjs` and `rearchive-iiif-fullres.mjs` verify before writing. The
  weekly sampling job partially covers this gap by detecting drift after the fact.
- **410 Gone for withdrawn books.** The Kloss takedown (813 books, 2026-07-08) returns
  a bare 404, so every inbound link and prior citation dead-ends silently. A "this item
  has been withdrawn" 410 would preserve the citation trail. Policy call, not made.

## Watchdogs now scheduled

`.github/workflows/corpus-integrity-watch.yml` — feedback symptom clustering daily,
alignment sampling weekly. Both read-only, both file an issue rather than failing a
build. Backtested: the clustering fires on 2026-07-16, ten days before this bug was
actually found.
