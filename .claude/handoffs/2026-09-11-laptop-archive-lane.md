# Laptop archive lane for MDZ, and the network guard that could not see the network — 2026-09-11

PR: https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/pull/4739 (open, green, review-gated).
Epic: #4404 (R2 growth). Side issue: #4737 (e-rara 403s the Mac; the Mac IIIF daemon archives nothing).

## What was built
- `scripts/catalog-coverage/archive-acquired.ts`: `--newest-first` (sort `_id:-1`, so a second lane meets
  the Hetzner lane in the middle and fresh acquisitions stop waiting behind the June backlog) and
  `--hosts a,b` (archive only books whose first un-archived page lives on those hosts; the queue's
  `source` label is not the host — "iiif" rows point at MDZ, IA, Gallica and e-rara). Both off by default.
- `scripts/catalog-coverage/archive-acquired-mac.sh` + `org.sourcelibrary.archive-acquired-mac.plist`:
  launchd KeepAlive loop, MDZ only, bounded 50 min per cycle (perl `alarm` — macOS has no `timeout`),
  falls back to the main checkout's `.env.production.local` from a worktree, re-checks the network guard
  every minute and SIGTERMs the archiver on DENY (positive-controlled with `--park`), and sets
  `BULK_NET_ALLOW_ONLY=1` so it runs only on an allow-listed network.

## Why
MDZ rate-limits per IP: a lone curl from Hetzner got 429 in 60 ms while the hourly archiver ran; that lane
converges on ~0.2 pages/s (~21K MDZ pages/day) against a 3.85M-page MDZ backlog. Ten concurrent full-res
fetches from the Mac at the same moment all returned 200 in 3–4 s. Measured lane rate from the Mac at the
unchanged 2/s in-process cap: 1.8–1.9 pages/s (209 pages / 150 s smoke; 106 pages in the first launchd
minute), 0 failures.

## The incident inside the session
The Mac's network guard (`~/bin/bulk-net-guard.sh`, per-machine, NOT in this repo) keys on the Wi-Fi name.
macOS 26 redacts the SSID from `networksetup`, `ipconfig getsummary`, `system_profiler` and `ioreg` without
Location permission, so the guard reported "ALLOW: not associated with a Wi-Fi network" on a live link.
The lane ran ~15 min on LAX lounge wifi (top saved SSIDs "_LAX Free WiFi", "AF Lounge"; egress colo LAX;
VMware-OUI gateway) under a deny-list that had just been widened with forty airline names and could never
fire. Derek: "only do it on wifido."

Guard now (all per-machine, backup `~/bin/bulk-net-guard.sh.bak-2026-09-11`):
1. Allow-list `~/.config/bulk-net-allow` keyed on the network SIGNATURE (default gateway hardware address +
   DHCP server), written by `--pin <name>` while on the network; shown by `--status`. Binds for every
   caller once the file exists, and for `BULK_NET_ALLOW_ONLY=1` callers before it exists.
2. Fails CLOSED on a Wi-Fi network whose name is redacted (negative control: DENY on the lounge).
3. Tether check (default-route service name) unchanged; SSID deny-list kept for machines that can read it.

## State at close
- Lane PARKED (`DENY … no allow-list`, 0 archiver processes). Derek pins at home:
  `~/bin/bulk-net-guard.sh --pin wifido`, then `--why` must print `allow-list: matched mac:…`; the lane
  wakes within 10 min; log `/tmp/archive-acquired-mac.log`.
- The agent runs from the worktree `.claude/worktrees/feat-archive-mac-lane` until #4739 merges; after
  merge, re-point the plist's script path to `~/sourcelibrary/scripts/catalog-coverage/archive-acquired-mac.sh`,
  `launchctl kickstart -k gui/$(id -u)/org.sourcelibrary.archive-acquired-mac`, then unlock/reap the worktree.
- The older Mac launchd jobs (gallica/erara/harvard/iiif) call the same guard, so they inherit home-only once
  wifido is pinned; they still check only once per cycle, not every minute.
- Not done: raising MDZ's per-process rate above 2/s (needs evidence from a clean run — this lane produces it);
  the BSB rate-allowance email (#4404 step 2); #4737.

## Atlas (separate repo, deployed)
`refresh-theme-data.mjs` (in-place map refresh, never `build-theme.mjs` on the built maps), re-parse of the
197 no-author queue rows (168 back to pending), 2 more IA imports — all in
`~/sourcelibrary-atlas/.claude/handoffs/2026-09-11-atlas-acquisition-wave.md` and on #4716.
