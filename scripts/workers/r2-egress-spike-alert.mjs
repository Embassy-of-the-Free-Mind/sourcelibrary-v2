#!/usr/bin/env node
/**
 * R2 egress spike detector — the free alternative to Logpush (#4373).
 *
 * The bucket has two ways out: the custom domain (behind our Cloudflare zone,
 * where WAF/rate rules apply) and — until 2026-08-30 — the managed
 * `pub-*.r2.dev` subdomain, which sat OUTSIDE the zone entirely. A bulk pull
 * through either left NO app-side log, so a ~3.5 TB / ~3M-object extraction on
 * 2026-08-02/03 went unnoticed until a retroactive R2-metrics audit found it.
 *
 * This watches the one signal that DOES see direct-bucket traffic: R2's own
 * operation metrics (GraphQL `r2OperationsAdaptiveGroups`). It cannot name the
 * puller (R2 metrics carry no client dimension — that needs Logpush, which is
 * paid), but it answers "is an extraction happening?" within a day, for $0.
 *
 * THE KEY DISCRIMINATOR — reads vs writes.
 * Our OWN acquisition pipeline reads a master and writes display/thumb variants,
 * so on a busy pipeline day GETs and PUTs rise together (the 2026-08-09..20
 * push moved ~5.9 TB of reads WITH matching writes — legitimate). An extraction
 * reads without writing. So we alert on a GET spike whose PUTs did NOT keep
 * pace — a high read-to-write ratio — not on raw volume. Raw-volume alerting
 * would fire on every acquisition sprint and get muted, which is the failure
 * `traffic-anomaly-alert.mjs` was written to avoid repeating.
 *
 * Reports, never acts (same doctrine as the traffic detector). The lever that
 * caps the damage is the /archived/ rate rule; this just makes the decision
 * possible in hours.
 *
 * Env:
 *   CF_ANALYTICS_TOKEN     Cloudflare API token, scope: Account Analytics Read
 *   CLOUDFLARE_ACCOUNT_ID  (defaults to the known account)
 *   MONGODB_URI            for alert de-dup (one ping per anomalous day)
 *
 * Usage (Hetzner daily cron):
 *   set -a; source .env.production.local; set +a; node scripts/workers/r2-egress-spike-alert.mjs
 *   node scripts/workers/r2-egress-spike-alert.mjs --json --no-push   # dry run
 */
import { MongoClient } from 'mongodb';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'eb0562555fd5ce2a4ec0f29b6df10e7b';
const TOKEN = process.env.CF_ANALYTICS_TOKEN;
const BUCKET = 'sourcelibrary';
const NTFY_TOPIC = 'https://ntfy.sh/sourcelibrary-uptime';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const NO_PUSH = args.includes('--no-push');

// Tunables. A day is flagged when BOTH fire, so neither alone cries wolf:
//  - reads are >= SPIKE_MULT × the trailing median (a real surge), and
//  - the read:write BYTE ratio is >= RW_RATIO_MULT × the trailing median ratio
//    (reads outran writes — i.e. NOT our variant-writing pipeline).
// Plus an absolute floor so a quiet-day blip can't trip the multiplier.
const LOOKBACK_DAYS = 14;
const SPIKE_MULT = 3;
const RW_RATIO_MULT = 3;
// A flagged day must move at least this many read-GB. Sized off measured
// reality (2026-08): ordinary serving-heavy, low-write days run 250–300 GB
// (cache-miss reads of EXISTING variants — reads without writes, but benign),
// while the confirmed Aug 2–3 extraction was 911 and 2570 GB. 700 sits above
// the serving band and below the extraction, so the read:write ratio check
// isn't left to carry the whole decision (it can't — normal serving is also
// read-only). A slow-drip pull under 700 GB/day is the accepted blind spot;
// the /archived/ rate rule is the lever for that, not this alarm.
const ABS_FLOOR_GB = 700;

/** Pure: given daily rows (oldest→newest), decide whether the latest COMPLETE
 *  day is an extraction-shaped spike. Exported for tests. */
export function assessSpike(days) {
  // Drop today (partial) — compare the latest complete day against history.
  if (days.length < 4) return { flagged: false, reason: 'insufficient_history' };
  const latest = days[days.length - 1];
  const history = days.slice(0, -1);

  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const medReads = median(history.map((d) => d.readBytes));
  // read:write ratio per day; guard divide-by-zero (a pure-read day → large ratio)
  const ratio = (d) => d.readBytes / Math.max(d.writeBytes, 1);
  const medRatio = median(history.map(ratio));

  const readsSpiked = medReads > 0 && latest.readBytes >= SPIKE_MULT * medReads;
  const ratioSpiked = medRatio > 0 && ratio(latest) >= RW_RATIO_MULT * medRatio;
  const aboveFloor = latest.readBytes >= ABS_FLOOR_GB * 1e9;

  return {
    flagged: readsSpiked && ratioSpiked && aboveFloor,
    date: latest.date,
    latestReadGB: +(latest.readBytes / 1e9).toFixed(1),
    medianReadGB: +(medReads / 1e9).toFixed(1),
    latestRW: +ratio(latest).toFixed(1),
    medianRW: +medRatio.toFixed(1),
    readsSpiked, ratioSpiked, aboveFloor,
  };
}

async function fetchDaily() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
  const query = `{
    viewer { accounts(filter: {accountTag: "${ACCOUNT_ID}"}) {
      gets: r2OperationsAdaptiveGroups(filter: {datetime_geq: "${since}", bucketName: "${BUCKET}", actionType: "GetObject", actionStatus: "success"}, limit: 40, orderBy: [date_ASC]) {
        dimensions { date } sum { requests responseObjectSize }
      }
      puts: r2OperationsAdaptiveGroups(filter: {datetime_geq: "${since}", bucketName: "${BUCKET}", actionType: "PutObject", actionStatus: "success"}, limit: 40, orderBy: [date_ASC]) {
        dimensions { date } sum { requests responseObjectSize }
      }
    } }
  }`;
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(`CF GraphQL: ${JSON.stringify(json.errors)}`);
  const acct = json.data?.viewer?.accounts?.[0];
  if (!acct) throw new Error('no account data (token scope? account id?)');
  const byDate = new Map();
  for (const g of acct.gets) byDate.set(g.dimensions.date, { date: g.dimensions.date, readBytes: g.sum.responseObjectSize, writeBytes: 0 });
  for (const p of acct.puts) {
    const row = byDate.get(p.dimensions.date) || { date: p.dimensions.date, readBytes: 0, writeBytes: 0 };
    row.writeBytes = p.sum.responseObjectSize;
    byDate.set(p.dimensions.date, row);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function pushNtfy(title, message) {
  if (NO_PUSH) { console.log('[r2-spike] --no-push: skipping ntfy'); return; }
  try {
    await fetch(NTFY_TOPIC, { method: 'POST', headers: { Title: title, Priority: 'high', Tags: 'rotating_light' }, body: message });
    console.log('[r2-spike] ntfy push sent');
  } catch (err) { console.error(`[r2-spike] ntfy push failed: ${err.message}`); }
}

async function run() {
  if (!TOKEN) {
    console.error('[r2-spike] CF_ANALYTICS_TOKEN not set — create an "Account Analytics: Read" token and add it to the env. Exiting UNKNOWN (not clear).');
    process.exit(2);
  }
  const days = await fetchDaily();
  const verdict = assessSpike(days);

  if (JSON_OUT) { console.log(JSON.stringify({ verdict, days }, null, 2)); }
  else {
    console.log(`[r2-spike] latest complete day ${verdict.date}: ${verdict.latestReadGB} GB read (median ${verdict.medianReadGB}), read:write ${verdict.latestRW} (median ${verdict.medianRW})`);
    console.log(`[r2-spike] reads spiked=${verdict.readsSpiked} ratio spiked=${verdict.ratioSpiked} above floor=${verdict.aboveFloor} → ${verdict.flagged ? 'FLAGGED' : 'ok'}`);
  }

  if (!verdict.flagged) return;

  // De-dup: one ping per anomalous day.
  let alreadyAlerted = false;
  if (process.env.MONGODB_URI) {
    const c = new MongoClient(process.env.MONGODB_URI);
    await c.connect();
    const col = c.db('bookstore').collection('monitor_state');
    const key = `r2-spike-alert:${verdict.date}`;
    const existing = await col.findOne({ _id: key });
    if (existing) alreadyAlerted = true;
    else await col.insertOne({ _id: key, at: new Date(), verdict });
    await c.close();
  }
  if (alreadyAlerted) { console.log('[r2-spike] already alerted for', verdict.date); return; }

  await pushNtfy(
    `R2 egress spike — possible bulk extraction`,
    `${verdict.date}: ${verdict.latestReadGB} GB read (median ${verdict.medianReadGB}), read:write ${verdict.latestRW}× vs usual ${verdict.medianRW}× — reads outran the variant pipeline. ` +
    `R2 metrics can't name the puller (that needs Logpush). Check: which books, and whether the /archived/ rate rule is on. Bucket 'sourcelibrary'.`,
  );
}

// Only run when invoked directly, so tests can import assessSpike().
if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => { console.error(`[r2-spike] ${err.message}`); process.exit(2); });
}
