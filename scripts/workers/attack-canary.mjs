/**
 * Attack canary: play every scraper trick we have blocked, and every kind of
 * visitor we must let through, and page if any answer changed.
 *
 * PRIOR ART: scripts/workers/edge-crawl-alert.mjs --canary — proves the crawl
 * brake (rate limit) still challenges and the edge detector can still see
 * traffic. This file covers the other layers it does not touch: the Cloudflare
 * custom rules, the proxy's app-layer blocks, and the hosts outside the zone.
 * Kept separate because it has no Cloudflare token or Mongo dependency and
 * runs as plain HTTP.
 *
 * Why it exists (#4476): every defence we have built has silently stopped
 * working at least once, and each time it was found by accident:
 *   - a block rule sat below a terminating challenge rule and never fired;
 *   - a Vercel alias outside Cloudflare served a fleet for nine weeks;
 *   - three subdomains were DNS-only, so no edge rule applied there;
 *   - the client-hint rule saved fine and matched nothing until curl-tested.
 * The "must pass" rows matter as much as the "must block" rows: a rule that
 * starts refusing readers is also a broken defence.
 *
 * What it does NOT try: a real headless Chrome with correct client hints on a
 * residential proxy. That passes, by design; the levers against it are the
 * breadth cap (#5995) and the edge detector, not a header rule.
 *
 * Cost: ~25 requests a week, from the Hetzner box. HTML page loads only, so no
 * analytics pageview is written (that needs our JavaScript). Each URL carries
 * ?_canary=attack so the edge logs can be filtered.
 *
 * Usage:
 *   node scripts/workers/attack-canary.mjs            # run, page ntfy on any failure
 *   node scripts/workers/attack-canary.mjs --no-push  # run, print only
 *
 * When a row fails: the row names the rule it exercises. A "block" row that
 * passes means the rule is off, reordered, or edited; a "pass" row that is
 * blocked means a rule is catching readers. Rules: Cloudflare dashboard >
 * Security > WAF > Custom rules, and src/proxy.ts. History: #4476,
 * .claude/docs/crawl-register.md.
 */

const NTFY_TOPIC = 'https://ntfy.sh/sourcelibrary-uptime';
const NO_PUSH = process.argv.includes('--no-push');

// A public book that resolves directly (no redirect) on the canonical host.
const BOOK_PATH = '/book/the-cabinet-of-minerals-vreeswyk';

const UA = {
  // Fleet strings, as observed (#4476, crawl register).
  linux149: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  mac145: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  win151: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  lightpanda: 'Lightpanda/1.0',
  greek: 'Mozilla/5.0 (compatible; thegreeklibrary-crawler/1.0)',
  semrush: 'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
  // Visitors who must get through.
  mac155: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  win155: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',
  ours: 'sourcelibrary-attack-canary/1 (#4476)',
};

const hints = (v, platform) => ({
  'sec-ch-ua': `"Google Chrome";v="${v}", "Chromium";v="${v}", "Not.A/Brand";v="24"`,
  'sec-ch-ua-platform': platform,
});

// expect: 'block' = 403 without a challenge; 'challenge' = cf-mitigated:
// challenge; 'pass' = not refused (any status below 400, or 404).
const CANONICAL_CASES = [
  { name: 'fake Chrome, no client hints', rule: 'CF cb7dfe4b', ua: UA.linux149, expect: 'block' },
  { name: 'fake Chrome, unquoted platform hint', rule: 'CF cb7dfe4b', ua: UA.mac155, headers: hints(155, 'Mac OS X'), expect: 'block' },
  { name: 'Windows Chrome/151 pool string', rule: 'CF ffe9ff61', ua: UA.win151, headers: hints(151, '"Windows"'), expect: 'block' },
  { name: 'Mac Chrome/145 pool string', rule: 'CF 204695c8', ua: UA.mac145, headers: hints(145, '"macOS"'), expect: 'challenge' },
  { name: 'Lightpanda headless browser', rule: 'CF 11cee688', ua: UA.lightpanda, expect: 'block' },
  { name: 'Greek-library crawler', rule: 'CF 45229c1a', ua: UA.greek, expect: 'block' },
  { name: 'SEO crawler', rule: 'CF e227add6', ua: UA.semrush, expect: 'block' },
  { name: 'empty user agent', rule: 'CF 46240ecb', ua: '', expect: 'challenge' },
  { name: 'real Chrome (Mac) with hints', rule: 'must pass', ua: UA.mac155, headers: hints(155, '"macOS"'), expect: 'pass' },
  { name: 'real Chrome (Windows) with hints', rule: 'must pass', ua: UA.win155, headers: hints(155, '"Windows"'), expect: 'pass' },
  { name: 'Firefox', rule: 'must pass', ua: UA.firefox, expect: 'pass' },
  { name: 'Safari', rule: 'must pass', ua: UA.safari, expect: 'pass' },
  { name: 'Android Chrome without hints', rule: 'must pass', ua: UA.android, expect: 'pass' },
  { name: 'our own scripts', rule: 'must pass', ua: UA.ours, expect: 'pass' },
];

// Every other host the project answers on. Two rows each: the fleet's
// no-hints string must be refused (by Cloudflare inside the zone, by the
// proxy backstop outside it), and a real browser must not be. Hosts outside
// the zone redirect readers to the canonical host, which counts as a pass.
const OTHER_HOSTS = [
  { host: 'bph.sourcelibrary.org', layer: 'CF cb7dfe4b' },
  { host: 'kloss.sourcelibrary.org', layer: 'CF cb7dfe4b' },
  { host: 'bhutan.sourcelibrary.org', layer: 'CF cb7dfe4b' },
  { host: 'www.ficinosociety.org', layer: 'proxy client-hint-gate (outside the zone)' },
  { host: 'sourcelibrary-v2.vercel.app', layer: 'proxy client-hint-gate (outside the zone)' },
];

function classify(res) {
  const mitigated = (res.headers.get('cf-mitigated') || '').toLowerCase();
  if (mitigated === 'challenge') return 'challenge';
  if (res.status === 403) return 'block';
  if (res.status < 400 || res.status === 404) return 'pass';
  return `http ${res.status}`;
}

async function probe(host, c) {
  const url = `https://${host}${BOOK_PATH}?_canary=attack`;
  const headers = { ...(c.headers || {}) };
  // fetch() sends its own UA when none is given; '' must reach the edge as empty.
  headers['user-agent'] = c.ua;
  try {
    const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    await res.arrayBuffer().catch(() => {});
    const got = classify(res);
    return { host, ...c, got, ok: got === c.expect, status: res.status, cfRay: res.headers.get('cf-ray') };
  } catch (err) {
    return { host, ...c, got: `error: ${err.message}`, ok: false };
  }
}

async function main() {
  const rows = [];
  for (const c of CANONICAL_CASES) rows.push(await probe('sourcelibrary.org', c));
  for (const { host, layer } of OTHER_HOSTS) {
    rows.push(await probe(host, { name: 'fake Chrome, no client hints', rule: layer, ua: UA.linux149, expect: 'block' }));
    rows.push(await probe(host, { name: 'real Chrome with hints', rule: 'must pass', ua: UA.mac155, headers: hints(155, '"macOS"'), expect: 'pass' }));
  }

  const failed = rows.filter((r) => !r.ok);
  for (const r of rows) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.host.padEnd(28)} ${r.name.padEnd(38)} want ${r.expect.padEnd(9)} got ${String(r.got).padEnd(9)} (${r.rule})`);
  }
  console.log(`[attack-canary] ${new Date().toISOString()} ${rows.length - failed.length}/${rows.length} as expected`);

  if (failed.length && !NO_PUSH) {
    const lines = failed.map((r) => `• ${r.host}: ${r.name} — wanted ${r.expect}, got ${r.got} (${r.rule})`);
    try {
      await fetch(NTFY_TOPIC, {
        method: 'POST',
        headers: { Title: `Attack canary: ${failed.length} defence check(s) changed`, Priority: 'high', Tags: 'shield' },
        body: `${lines.join('\n')}\n\nA "block" row that passed = a rule is off, reordered or edited. A "pass" row refused = a rule is catching readers. See scripts/workers/attack-canary.mjs header, #4476.`,
      });
    } catch (err) {
      console.error(`[attack-canary] ntfy push failed: ${err.message}`);
    }
  }
  process.exitCode = failed.length ? 1 : 0;
}

main();
