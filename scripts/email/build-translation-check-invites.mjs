#!/usr/bin/env node
/**
 * Turn queued translation-check pages into personal invitations.
 *
 * PRIOR ART: scripts/maintenance/build-page-check-candidates.mjs draws the
 * sample and writes the pool; this does not duplicate it and refuses to run if
 * the pool is empty. scripts/email/send-test.mjs renders a body through the
 * real email shell. Neither addresses the pairing step — which reader gets
 * which page — which is all this does.
 *
 * IT SENDS NOTHING. It writes one JSON file of {to, subject, html} plus a
 * plain-text preview, for a human to read before any of it reaches a person.
 * The newsletter rules are explicit that a letter with an ask needs a named
 * person to absorb the replies; a script that could mail 893 strangers on a
 * typo is not something to leave lying around.
 *
 *   node --env-file=.env.production.local \
 *     scripts/email/build-translation-check-invites.mjs \
 *     --language=Latin --emails=a@x.org,b@y.org [--out=invites.json]
 *
 * One page per person. Not five: the ask has to be small enough to say yes to,
 * and a reader who wants another can have one.
 */
import { MongoClient } from 'mongodb';
import { createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const SITE = 'https://sourcelibrary.org';
const args = process.argv.slice(2);
const argOf = (n, d) => args.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;

const LANGUAGE = argOf('language', 'Latin');
const OUT = argOf('out', `invites-${LANGUAGE.toLowerCase()}.json`);
const EMAILS = (argOf('emails', '') || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (!EMAILS.length) {
  console.error('Need --emails=a@x.org,b@y.org (one page is assigned per address).');
  process.exit(1);
}
const SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
if (!SECRET) { console.error('AUTH_SECRET required — it keys the invitation links.'); process.exit(1); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI required'); process.exit(1); }

/** Mirrors src/lib/review-invite-token.ts. Both must agree or no link verifies. */
const inviteeIdFor = email => {
  const h = createHmac('sha256', SECRET).update(`invitee:${email.trim().toLowerCase()}`).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), `4${h.slice(13, 16)}`, `8${h.slice(17, 20)}`, h.slice(20, 32)].join('-');
};
const mintToken = (itemId, invitee) => {
  const body = `${encodeURIComponent(itemId)}.${invitee}`;
  const mac = createHmac('sha256', SECRET).update(`invite:${body}`).digest('hex').slice(0, 32);
  return `${body}.${mac}`;
};

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const candidates = await client.db('bookstore').collection('review_candidates')
  .find({ queue: 'translation-check', 'stratum.language': LANGUAGE })
  .toArray();
await client.close();

if (candidates.length < EMAILS.length) {
  console.error(
    `Only ${candidates.length} ${LANGUAGE} pages are queued but ${EMAILS.length} people were given. ` +
    `Queue more first:\n  node scripts/maintenance/build-page-check-candidates.mjs translations ` +
    `--language=${LANGUAGE} --n=${EMAILS.length} --apply`,
  );
  process.exit(1);
}

// Which reader gets which page does not matter statistically — the SAMPLE was
// drawn at random, and this is just dealing it out. Taking them in pool order
// keeps the run reproducible.
const invites = EMAILS.map((email, i) => {
  const c = candidates[i];
  const invitee = inviteeIdFor(email);
  const token = mintToken(c.item_id, invitee);
  const link = `${SITE}/check/${token}`;
  const title = /This is “([^”]+)”/.exec(c.payload?.prompt ?? '')?.[1] ?? 'a page from the library';

  // Three verdict links preselect an answer; none of them RECORDS one — the
  // page still needs a click. Mail scanners fetch every URL in a message.
  const verdict = (v, label) =>
    `<a href="${link}?v=${v}" style="color:#9e4a3a;">${label}</a>`;

  const html = `
<p style="margin:0 0 20px;">Dear reader,</p>

<p style="margin:0 0 20px;">
  Almost every translation in Source Library was made by a machine, and almost none of them
  has been read by someone who knows the language. I would like to change that, and it needs
  about thirty-five people per language rather than a crowd — which is why I am writing to you
  in particular.
</p>

<p style="margin:0 0 20px;">
  Would you look at <b>one page</b>? It is from
  <i>${title}</i>. The scan, our transcription and our English sit side by side:
</p>

<p style="margin:0 0 20px;">
  <a href="${link}" style="display:inline-block;padding:10px 18px;background:#9e4a3a;color:#fff;border-radius:4px;text-decoration:none;">Open the page</a>
</p>

<p style="margin:0 0 20px;">
  Two questions, in this order. Does our transcription match what is actually on the page? And
  does the English say what the ${LANGUAGE} says? If the transcription is wrong the English
  cannot be judged — that is a different failure and we count it separately.
</p>

<p style="margin:0 0 20px;">
  You can answer in one click:
  ${verdict('both_sound', 'both sound')} ·
  ${verdict('translation_drift', 'the English drifts')} ·
  ${verdict('transcription_off', 'the transcription is wrong')}
</p>

<p style="margin:0 0 20px;">
  Telling us a page is <i>fine</i> is worth just as much as finding a fault — without it we only
  ever hear about failures and never learn how much has been checked at all. And if you would
  rather just write back in prose, please do; I read the replies myself.
</p>

<p style="margin:0 0 6px;">&mdash; Derek</p>
<p style="margin:0;font-size:14px;color:#666;">
  Derek Lomas, PhD &middot; Founder, Source Library
</p>`.trim();

  return {
    to: email,
    subject: `One page of ${LANGUAGE}, if you have ten minutes`,
    item_id: c.item_id,
    page_url: c.payload?.url,
    link,
    html,
  };
});

writeFileSync(OUT, JSON.stringify(invites, null, 2));

console.log(`${invites.length} invitation(s) written to ${OUT} — NOTHING WAS SENT.\n`);
for (const i of invites) {
  console.log(`  ${i.to}`);
  console.log(`    page  ${i.page_url}`);
  console.log(`    link  ${i.link}`);
}
console.log(`
Before any of this goes out:
  1. Open one link and check the page loads and shows the right book.
  2. Decide who reads the replies. The rule is in .claude/docs/newsletter-queue.md:
     do not ask for something you cannot receive.
  3. Send from the composer or paste into a mail client. This script does not send.`);
