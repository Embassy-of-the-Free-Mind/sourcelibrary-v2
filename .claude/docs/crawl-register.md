# Crawl register: every bulk crawl of the library we know about

PRIOR ART: .claude/docs/invariants/crawler-access-gate.md — holds the LESSONS and the controls, one bullet per incident, but no single list of the crawls themselves. This is that list; the invariant doc stays the place for rules.

**Read this when:** a crawl is found, a crawl protection is added or removed, or someone asks "has this happened before?". Add a row the same day a crawl is found. Figures are as measured at the time; the issue holds the evidence.

**Why it exists:** on 2026-10-10 Derek asked which crawls had happened and whether they could happen again, and the answer was spread across a 60-bullet invariant doc, six issues and a bill review. Every row below was found late, and most were found by accident.

## The register

| When | Who / network | Disguise | Volume | Found how, how late | Cost | Status / control |
|---|---|---|---|---|---|---|
| Jun–Jul 2026, 9 weeks | Tencent Cloud Singapore (AS132203) fleet | 28 forged Chrome UAs, 84 rotating /24s, came in via an unguarded Vercel alias | 2,043,739 page views in the final 30 days; 17,357 books | A reading-depth metric looked wrong: **9 weeks** | ~$234 Vercel transfer | Blocked (Cloudflare + `blocked-asn-prefixes.json`), alias hosts scoped (#3438, #3446) |
| Jun 2026 | Tencent / Alibaba US / Byteplus (AS132203, 45102, 396986) | ~15 fake desktop Chrome UAs | ~1.6M requests/day on ten static pages + `/api/auth/session` | Cloudflare analytics review | Not measured | Managed challenge on the three ASNs (still firing: 789,533 challenged 2026-10-09/10, almost all Alibaba) |
| 2026-08-06, 4 days | Huawei Cloud, Tencent (AS45090), Byteplus, Huawei HK | Chrome 103–150 forgeries | 361,503 reads | Volume check | Not measured | Operator-level ASN blocks (#3658) |
| Aug 2026, hours after the above | China Mobile provincial ASNs, 4,093 /24s | Residential spread | ~20–26% of reads | Total volume did not fall after a block | Not measured | #3669 |
| Aug 2026 | Residential proxy pool, one forged `X11; Linux … Chrome/150` UA | Real home IPs | Pool-shaped, tens of thousands/day | Shared-fingerprint check | Not measured | Managed challenge on that exact UA (still matching ~2,900/day) |
| 2026-09-01 | Lightpanda headless browser | Honest UA, 26,822 residential IPs | 32,069 reads/24h | Classifier review | Not measured | Blocked by UA (#4476) |
| 2026-09-02 → 09-20, 18 days | Same proxy-pool operator, rotated to `Windows NT 10.0 … Chrome/151` | Real home IPs | Up to 87% of site pageviews; 149,296 reads, 137,135 pages | **18 days** | Not measured | Challenge, escalated to block 2026-09-28 (#4947). Also blocks genuine Chrome 151 readers (~1,700 requests/day from Comcast homes) |
| Sep–Oct 2026, 3 weeks | OneCable (AS401560), 12 leased /24s | One Linux Chrome/146 UA, ~100 reads/day per /24 | ~15K pages | Walker analysis | Small | ASN block 2026-10-06 (#5993) |
| **2026-09-29 → 10-04** | **thegreeklibrary.org**, one Orange FR home connection (AS3215), rotating IPv6 | Honest UA `thegreeklibrary.org (accord de D. Lomas)`, a **false** claim of Derek's agreement | ~500,000 requests in the week to 10-06 (56% of Vercel origin bytes); peak 6,695/h, 289/min from one address. Reader pages, the text API and the dataset API; no images | Vercel bill review: **~6 days**. Invisible to every detector (no JavaScript, so no analytics rows; the proxy logs only blocked bots) | **~$60–100** Vercel (estimate: its share of that week's usage charges) | UA blocked at Cloudflare 2026-10-10; rate limit below; Derek's email drafted. Its translations carry the reader-path imprimatur (#3857); its Greek transcriptions are unmarked by design (#6398, #4753) |
| 2026-10-06 | Google Cloud host (AS396982) | Firefox/120 UA | 3,028 book pages in 1 h | 7-day edge sweep, 2026-10-10 | Small | Rate limit |
| 2026-10-07, 4 h | Harvard University network (AS1742) | Firefox/155 on a Mac | 6,318 book pages, peak 3,465/h | 7-day edge sweep, 2026-10-10 | Small | Rate limit (probably a researcher; a contact would do more than a block) |
| 2026-10-08, 3 h | AGOWResearchBot on AWS | Honest research-crawler UA with a contact address | Peak 1,207/h | 7-day edge sweep | Small | Rate limit |
| 2026-10-09 | Telenor DK (AS9158) | Windows Chrome UA | 3,791 in 1 h | 7-day edge sweep | Small | Rate limit |
| 2026-10-09 → 10-10, 11 h and running | OVH SAS FR (AS16276) | Windows Chrome UA from a hosting provider | 26,434 book pages, peak 3,030/h | 7-day edge sweep | Small | Rate limit; will alert via `edge-crawl-alert` |
| Ongoing | Reflectionbot (Google LLC ASN) | Unverified bot UA | ~399K reader pages/week (2026-10-06) | Vercel bill review | Part of the Vercel bill | Challenged by `cf.client.bot` rule (1,026/h challenged 2026-10-03); #4753 row R |

**Not crawls, but they look like one at the edge:** a reader's browser stuck in a redirect loop on `/book/<id>` (Vodafone NL, 2026-10-10 10:02–10:08 UTC, ~31K 301/304 responses in 10 minutes; a site bug, tracked separately); our own `sourcelibrary-blog-link-check` (up to ~1,300/h); our Hetzner boxes (peak ~30 full book loads/min).

## What stops the next one (as of 2026-10-10)

1. **Crawl brake** (Cloudflare `http_ratelimit` rule): more than 60 full `/book/` page loads a minute from one address gets a managed challenge for 10 minutes. Excludes `_rsc=` requests (a real browser's in-app navigation) and verified bots. Tested 2026-10-10: requests 1–60 answered, request 61 challenged. Every crawl in the table above exceeded this rate. Our Pro plan cannot exempt by user agent in rate-limit rules.
2. **Detector** (`scripts/workers/edge-crawl-alert.mjs`, hourly at :07 on Hetzner): reads Cloudflare, which sees clients our own analytics cannot, and pushes ntfy when one address reads more than 1,500 book pages an hour, or one user agent on one network more than 2,000. Catches crawls that stay under the brake by spreading out.
3. **Canary** (`edge-crawl-alert.mjs --canary`, weekly): proves the brake still challenges and the detector can still see traffic; pages ntfy if either fails. A protection that stops working looks exactly like a quiet week.
4. **Existing layers**: Cloudflare custom rules (blocks and challenges), app-layer network blocks (`src/lib/blocked-networks.ts`, `blocked-asn-prefixes.json`), the tripwire link (`/catalog/complete`, since 2026-10-06), `traffic-anomaly-alert` (JavaScript-running clients only), `r2-egress-spike-alert` (direct bucket pulls). Rules and lessons for all of these: `invariants/crawler-access-gate.md`.

**Known gap:** a fleet that spreads below 60 pages a minute per address AND below the detector's hourly limits across many addresses. That is the wide-shallow walker case; `wide_shallow_walker` in `traffic-anomaly-alert` watches it for JavaScript-running clients only.
