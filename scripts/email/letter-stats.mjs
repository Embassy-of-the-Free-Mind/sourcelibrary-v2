/**
 * After-send numbers for one newsletter: delivery, opens, clicks, unsubscribes,
 * and site visits that arrived through the letter's utm-tagged links.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/email/letter-stats.mjs "Solve et Coagula 2026-11"
 *
 * The argument matches Resend broadcast NAMES (substring), so the A and B halves
 * of one letter are reported separately and together. Run at about 1 h, 24 h and
 * 72 h, and put the 72 h line in .claude/docs/newsletter-queue.md.
 *
 * How it counts, and the limits:
 * - Resend's email objects carry no broadcast id, so an email belongs to a
 *   broadcast if it has the broadcast's subject and was created after that
 *   broadcast's sent_at and before the next matching broadcast's. Halves sent
 *   minutes apart under one subject split by that window.
 * - last_event is the furthest event per email: "clicked" emails are also opened.
 *   Apple Mail privacy preloads count as opens, so the open rate runs high;
 *   clicks are the number to trust.
 * - Unsubscribes are counted per audience (all time), not per letter: compare
 *   against the figure from the previous letter.
 * - Site visits need the links to have been tagged (render-newsletter-preview.mjs
 *   tags by default since #8507). Untagged letters read as "direct".
 */
const KEY = process.env.RESEND_API_KEY;
const name = process.argv[2];
if (!KEY || !name) {
  console.error('Usage: RESEND_API_KEY=… letter-stats.mjs "<broadcast name substring>"');
  process.exit(1);
}

async function get(path) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`https://api.resend.com${path}`, { headers: { Authorization: `Bearer ${KEY}` } });
      if (r.status === 429 && i < 5) { await new Promise((s) => setTimeout(s, 1500 * (i + 1))); continue; }
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= 4) throw e;
      await new Promise((s) => setTimeout(s, 1500));
    }
  }
}
const ts = (s) => new Date(String(s).replace(' ', 'T').replace(/\+00$/, 'Z')).getTime();

const list = (await get('/broadcasts')).data || [];
const casts = list
  .filter((b) => b.name?.includes(name) && b.status === 'sent')
  .sort((a, b) => ts(a.sent_at) - ts(b.sent_at));
if (!casts.length) {
  console.error(`No sent broadcast named like "${name}". Names: ${list.slice(0, 8).map((b) => b.name).join(' | ')}`);
  process.exit(1);
}
for (const b of casts) Object.assign(b, await get(`/broadcasts/${b.id}`));

const first = ts(casts[0].sent_at);
const counts = new Map(casts.map((b) => [b.id, {}]));
let after = '';
for (;;) {
  const page = await get(`/emails?limit=100${after ? `&after=${after}` : ''}`);
  const rows = page.data || [];
  for (const e of rows) {
    const t = ts(e.created_at);
    const owner = [...casts].reverse().find((b) => e.subject === b.subject && t >= ts(b.sent_at) - 60_000);
    if (!owner) continue;
    const c = counts.get(owner.id);
    c[e.last_event] = (c[e.last_event] || 0) + 1;
  }
  if (!rows.length || !page.has_more || ts(rows.at(-1).created_at) < first - 60_000) break;
  after = rows.at(-1).id;
}

const line = (label, c) => {
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  const clicked = c.clicked || 0;
  const opened = (c.opened || 0) + clicked;
  const pct = (n) => (total ? `${((100 * n) / total).toFixed(1)}%` : '-');
  return `${label}: ${total} sent · opened ${opened} (${pct(opened)}) · clicked ${clicked} (${pct(clicked)}) · bounced ${c.bounced || 0} · suppressed ${c.suppressed || 0} · delayed ${c.delivery_delayed || 0}`;
};
const all = {};
for (const b of casts) {
  const c = counts.get(b.id);
  for (const [k, v] of Object.entries(c)) all[k] = (all[k] || 0) + v;
  console.log(line(`${b.name} (sent ${b.sent_at.slice(0, 16)} UTC)`, c));
}
if (casts.length > 1) console.log(line('Together', all));

for (const b of casts) {
  const aud = b.audience_id || b.segment_id;
  if (!aud) continue;
  let n = 0, unsub = 0, cursor = '';
  for (;;) {
    const page = await get(`/audiences/${aud}/contacts?limit=100${cursor ? `&after=${cursor}` : ''}`);
    const rows = page.data || [];
    n += rows.length;
    unsub += rows.filter((r) => r.unsubscribed).length;
    if (!rows.length || !page.has_more) break;
    cursor = rows.at(-1).id;
  }
  console.log(`${b.name}: audience ${n} contacts, ${unsub} unsubscribed (all time)`);
}

if (process.env.MONGODB_URI) {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const rows = await client.db('bookstore').collection('analytics_pageviews').aggregate([
      { $match: { timestamp: { $gte: new Date(first) }, 'utm.medium': 'email' } },
      { $group: { _id: { campaign: '$utm.campaign', path: '$path' }, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 15 },
    ]).toArray();
    if (!rows.length) console.log('Site visits with utm_medium=email since the send: none (were the links tagged?)');
    for (const r of rows) console.log(`visits  ${String(r.n).padStart(5)}  ${r._id.campaign}  ${r._id.path}`);
  } finally {
    await client.close();
  }
}
