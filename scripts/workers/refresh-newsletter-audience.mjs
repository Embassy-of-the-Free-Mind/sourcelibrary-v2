/**
 * refresh-newsletter-audience.mjs
 *
 * Keeps the standing "Source Library Newsletter" Resend audience current by
 * syncing in every email address we legitimately hold, deduped, and never
 * re-adding anyone who has unsubscribed.
 *
 * This is the ONE general "everyone" list (distinct from the one-off
 * "Cohort N" send-batches). It is the deduped union of:
 *   users · signup_interest · verification_tokens (incomplete sign-ups) ·
 *   beta_subscribers · volunteers · memberships
 *
 * Contacts are pulled from Mongo at runtime — no addresses are stored in this
 * file. The script is diff-based: it fetches the audience's current contacts
 * and only POSTs the ones that are missing, so a daily run is cheap and
 * idempotent. Anyone marked unsubscribed (in any Resend audience) is excluded.
 *
 * Env: MONGODB_URI, RESEND_API_KEY. Optional: NEWSLETTER_AUDIENCE_NAME
 * (default "Source Library Newsletter").
 *
 * Run: node scripts/workers/refresh-newsletter-audience.mjs
 *      (cron on the Hetzner box; see crontab)
 */
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const AUDIENCE_NAME = process.env.NEWSLETTER_AUDIENCE_NAME || 'Source Library Newsletter';
const H = { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' };

const norm = (e) => (e || '').trim().toLowerCase();
// example.com/.test/.invalid are test artifacts; Resend refuses to send a
// broadcast if the audience contains ANY such address (422), so never sync them.
const valid = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !/@(?:[^@\s]+\.)?example\.com$|\.(?:test|invalid|localhost)$/.test(e);

if (!MONGODB_URI || !RESEND_API_KEY) {
  console.error('Missing MONGODB_URI or RESEND_API_KEY in env. Aborting.');
  process.exit(1);
}

async function resend(path, init) {
  const r = await fetch(`https://api.resend.com${path}`, { headers: H, ...init });
  return r;
}

async function main() {
  // 1) Resolve the audience by name (create if somehow missing).
  const audList = (await (await resend('/audiences')).json()).data || [];
  let audience = audList.find((a) => a.name === AUDIENCE_NAME);
  if (!audience) {
    const r = await resend('/audiences', { method: 'POST', body: JSON.stringify({ name: AUDIENCE_NAME }) });
    audience = await r.json();
    console.log(`Created audience "${AUDIENCE_NAME}" (${audience.id})`);
  }

  // 2) Build the global unsubscribe set + the target audience's current emails.
  const unsubscribed = new Set();
  let existing = new Set();
  for (const a of audList) {
    const cj = await (await resend(`/audiences/${a.id}/contacts`)).json();
    for (const c of cj.data || []) {
      const e = norm(c.email);
      if (c.unsubscribed) unsubscribed.add(e);
      if (a.id === audience.id && e) existing.add(e);
    }
  }

  // 3) Build the deduped union of every Mongo email source (+ first names).
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 2 });
  await client.connect();
  const db = client.db('bookstore'); // prod DB — the connection-string default is not it
  const union = new Map(); // email -> firstName|null
  const addFrom = async (coll, field = 'email') => {
    try {
      const docs = await db.collection(coll).find({}, { projection: { [field]: 1, name: 1 } }).toArray();
      let n = 0;
      for (const d of docs) {
        const e = norm(d[field]);
        if (!valid(e)) continue;
        if (!union.has(e)) union.set(e, d.name ? String(d.name).trim().split(/\s+/)[0] : null);
        n++;
      }
      return n;
    } catch { return 0; }
  };
  await addFrom('users');
  await addFrom('signup_interest');
  await addFrom('beta_subscribers');
  await addFrom('volunteers');
  await addFrom('memberships');
  // incomplete sign-ups: verification_tokens.identifier
  try {
    for (const id of await db.collection('verification_tokens').distinct('identifier')) {
      const e = norm(id);
      if (valid(e) && !union.has(e)) union.set(e, null);
    }
  } catch {}
  await client.close();

  // 4) Diff: add only emails not already in the audience and not unsubscribed.
  const toAdd = [...union.keys()].filter((e) => !existing.has(e) && !unsubscribed.has(e));
  console.log(`union=${union.size} existing=${existing.size} unsubscribed=${unsubscribed.size} → adding ${toAdd.length}`);

  let ok = 0, fail = 0;
  for (const email of toAdd) {
    const first = union.get(email) || undefined;
    try {
      const r = await resend(`/audiences/${audience.id}/contacts`, {
        method: 'POST',
        body: JSON.stringify({ email, first_name: first, unsubscribed: false }),
      });
      if (r.ok) ok++;
      else { const t = await r.text(); if (/already|exist/i.test(t)) ok++; else { fail++; if (fail <= 5) console.error(`FAIL ${email}: ${t.slice(0, 80)}`); } }
    } catch (e) { fail++; }
    await new Promise((r) => setTimeout(r, 60));
  }
  console.log(`DONE "${AUDIENCE_NAME}": added=${ok} failed=${fail} | audience total ≈ ${existing.size + ok}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
