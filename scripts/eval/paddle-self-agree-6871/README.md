# Paddle self-agreement as a cheap OCR quality flag (#6871)

**Why.** Routing needs to know which Paddle pages are wrong. A Kanripo screen does that for free on the Siku
(Spearman −0.90 with true CER, #6561), but Chinese print and non-Siku books have no Kanripo text. A 3.8 Flash-low
second read flags about as well, but costs agy quota (14 s a page). Re-reading with Paddle itself under other settings
costs only GPU time on the owned card. Does Paddle disagreeing with itself point at its errors?

**Pages** (`draw.mjs`, seed 6871; files in `/root/jobs/paddle-self-agree-6871` on gex45):
- R: 150 random zh-shi-ji-8053 pages, one per book, interior, ≥ 40 Han, with a trusted own Kanripo leaf (lane dice ≥ 0.6)
- L: 50 more the same way with lane dice in [0.6, 0.9), so the test has wrong pages to rank
- F: the 58 #6561 set-B pages with a Kanripo leaf, which already carry a 3.8 Flash-low read (head to head)

**Arms** (`task.sh`, one gpu-queue task, ~20 min, $0): P = production settings (layout on, server, width 2400),
R = P again, L = layout off, S = long side capped at 1600 px.

**Score** (`score.mjs`): truth = Han CER of P against its own Kanripo leaf (fitted, `bodyCer`). Signals = symmetric
Han CER between P and each other read. Rules in `PREREG.md`. Files only; nothing is written to Mongo.
