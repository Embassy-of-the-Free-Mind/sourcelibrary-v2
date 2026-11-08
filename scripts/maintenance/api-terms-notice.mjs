#!/usr/bin/env node
/**
 * Email every holder of a free API key that has not agreed to the current API
 * terms, once (#8235). Free keys made before the terms keep working until the
 * deadline in src/lib/api-terms-version.ts; after it they are refused until the
 * holder agrees at /developers#get-key.
 *
 * PRIOR ART: scripts/maintenance/notify-addressed-feedback.mjs — same shape
 * (dry run by default, reserved-domain skip, stamp after each send so a re-run
 * never double-sends). Copied, not imported: that script runs at module level.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/api-terms-notice.mjs        # dry run
 *   node --env-file=.env.production.local scripts/maintenance/api-terms-notice.mjs --go   # send
 *
 * Run it only after /terms#api-terms is live: the email links there.
 * Writes: api_keys.api_terms_notice_sent_at on each key whose holder was emailed.
 * Env: MONGODB_URI, RESEND_API_KEY, EMAIL_FROM (optional).
 */
import { MongoClient, ObjectId } from 'mongodb';

// Mirror of src/lib/api-terms-version.ts (a .ts file this .mjs cannot import).
const API_TERMS_VERSION = '2026-11-08';
const API_TERMS_DEADLINE = '2026-11-23T00:00:00Z';

const GO = process.argv.includes('--go');
const RESERVED = /(@|\.)(example\.(com|org|net)|test|invalid|localhost)$/i;

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const keys = db.collection('api_keys');

const pending = await keys.find({
  status: 'active',
  $or: [{ tier: 'explorer' }, { tier: null }, { tier: { $exists: false } }],
  $and: [
    { $or: [{ terms_version: { $exists: false } }, { terms_version: null }, { terms_version: { $lt: API_TERMS_VERSION } }] },
    { api_terms_notice_sent_at: { $exists: false } },
  ],
}, { projection: { key_hash: 0 } }).toArray();

// user_id is an account id for self-serve keys, an email for keys minted from a reviewed request.
async function emailOf(userId) {
  const s = String(userId || '');
  if (s.includes('@')) return s;
  const or = [{ id: s }];
  if (ObjectId.isValid(s)) or.push({ _id: new ObjectId(s) });
  const u = await db.collection('users').findOne({ $or: or }, { projection: { email: 1, name: 1 } });
  return u?.email || null;
}

const byEmail = new Map();
const skipped = new Map();
for (const k of pending) {
  const email = await emailOf(k.user_id);
  const why = !email ? 'no email on the account' : RESERVED.test(email) ? 'reserved domain' : null;
  if (why) { skipped.set(why, (skipped.get(why) || 0) + 1); continue; }
  const key = email.toLowerCase();
  if (!byEmail.has(key)) byEmail.set(key, { email, keys: [] });
  byEmail.get(key).keys.push(k);
}

console.log(`${pending.length} free key(s) without the ${API_TERMS_VERSION} terms and not yet emailed.`);
for (const [why, n] of skipped) console.log(`  skipped ${n}: ${why}`);
console.log(`${byEmail.size} holder(s) to email.\n`);

const deadline = new Date(API_TERMS_DEADLINE).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const subject = 'Your Source Library API key: please agree to the new terms';
function text(prefixes) {
  return [
    'Hello,',
    '',
    `You hold a free Source Library API key (${prefixes.join(', ')}). We have written terms for the API: https://sourcelibrary.org/terms#api-terms`,
    '',
    'In short: a free key is for one person studying, teaching, writing or doing non-profit research. Do not share it, stay within the posted limits, and do not republish our text in bulk or use it to train a commercial AI model without a licence.',
    '',
    `To keep using your key, sign in and agree here: https://sourcelibrary.org/developers#get-key . Your key does not change. From ${deadline}, a free key whose holder has not agreed stops working until they do.`,
    '',
    'If you are building something larger, or for an organisation, write to team@sourcelibrary.org and we will find the right arrangement.',
    '',
    'Source Library',
  ].join('\n');
}
const html = (prefixes) => text(prefixes)
  .split('\n\n').map(p => `<p>${p.replace(/https:\/\/[^\s]+[^\s.,)]/g, u => `<a href="${u}">${u}</a>`).replace(/\n/g, '<br>')}</p>`).join('');

let resend = null;
if (GO) {
  if (!process.env.RESEND_API_KEY) { console.error('RESEND_API_KEY not set: cannot send'); await client.close(); process.exit(1); }
  const { Resend } = await import('resend');
  resend = new Resend(process.env.RESEND_API_KEY);
}
const from = process.env.EMAIL_FROM || 'Source Library <noreply@sourcelibrary.org>';

let sent = 0, failed = 0;
for (const { email, keys: ks } of byEmail.values()) {
  const prefixes = ks.map(k => k.key_prefix || String(k._id).slice(0, 8));
  console.log(`  ${GO ? 'SEND' : 'would send'} -> ${email}  (${ks.length} key${ks.length > 1 ? 's' : ''})`);
  if (!GO) continue;
  try {
    const r = await resend.emails.send({ from, to: email, replyTo: 'team@sourcelibrary.org', subject, text: text(prefixes), html: html(prefixes) });
    if (r.error) { console.error(`    Resend error: ${JSON.stringify(r.error).slice(0, 160)}`); failed++; continue; }
    await keys.updateMany({ _id: { $in: ks.map(k => k._id) } }, { $set: { api_terms_notice_sent_at: new Date() } });
    sent++;
    await new Promise(res => setTimeout(res, 600)); // stay under Resend's 2 requests/second
  } catch (e) { console.error(`    send failed: ${String(e.message).slice(0, 120)}`); failed++; }
}
console.log(`\n${GO ? `Sent: ${sent}, failed: ${failed}` : '(dry run: re-run with --go to send)'}`);
await client.close();
