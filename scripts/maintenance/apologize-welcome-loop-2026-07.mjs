/**
 * One-off apology to the readers caught in the /welcome redirect loop
 * (2026-07-29 → 2026-07-30, fixed in PR #3467).
 *
 * What happened to them: they filled in the welcome form, it saved correctly,
 * and the site sent them straight back to the same form — on every page — because
 * the session token was never re-minted. See src/components/welcome/WelcomeForm.tsx.
 *
 * WHO THIS EMAILS: users whose `welcomedAt` falls inside the bug window, i.e.
 * people who deliberately filled the form in and watched it fail. It deliberately
 * does NOT include the ~35 gated readers who were bounced without ever saving —
 * an apology for something you may not have noticed is a confusing email, and
 * that population can't be enumerated properly anyway (analytics_pageviews stores
 * no user_id, #3405).
 *
 * TRANSACTIONAL, not marketing: sent per-recipient via resend.emails.send rather
 * than through a Resend audience/broadcast. It is a service apology to a named
 * incident, so it does not belong in the newsletter audience and must not consume
 * a marketing cohort (see scripts/send-user-broadcast.mjs for that machinery).
 *
 * DOUBLE-SEND GUARD: every successful send stamps
 * `users.apologies.welcomeLoop2026_07` with the sent timestamp, and anyone
 * already stamped is skipped. Re-running is therefore safe; there is no way to
 * mail the same person twice short of clearing that field by hand.
 *
 *   node scripts/maintenance/apologize-welcome-loop-2026-07.mjs              # dry run (default)
 *   node scripts/maintenance/apologize-welcome-loop-2026-07.mjs --test me@x  # one real send to yourself
 *   node scripts/maintenance/apologize-welcome-loop-2026-07.mjs --send       # irreversible
 *
 * Env: MONGODB_URI, RESEND_API_KEY.
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/apologize-welcome-loop-2026-07.mjs
 */
import { MongoClient } from 'mongodb';
import { Resend } from 'resend';

// The window in which the gate was live AND the session bug was present: from
// #3448 (the fix that made the gate actually fire) to #3467 (this fix).
const WINDOW_START = new Date('2026-07-29T00:00:00Z');
const WINDOW_END = new Date('2026-07-30T14:00:00Z');

const SENT_FIELD = 'apologies.welcomeLoop2026_07';

// Internal / test accounts. These belong to us, not to readers.
const EXCLUDE = /@sourcelibrary\.org$/i;

const FROM = process.env.EMAIL_FROM || 'Derek at Source Library <derek@sourcelibrary.org>';
const REPLY_TO = process.env.EMAIL_REPLY_TO || 'derek@sourcelibrary.org';

const SUBJECT = 'Sorry — we broke the form you just filled in';

// Authored copy. Do not reword without Derek's say-so (see memory:
// feedback-dont-change-authored-copy).
function buildText(firstName) {
  return `${firstName ? `${firstName},` : 'Hello,'}

You told us a bit about yourself when you joined Source Library, and then the site sent you straight back to the same form. That was our bug, not anything you did, and it is fixed now.

Your answers did save. The site simply failed to notice, so it kept asking. If you gave up and left, that was the reasonable response.

You can change any of it whenever you like, on your account page: https://sourcelibrary.org/account

Thank you for telling us what you're after — we read every one of these.

Sorry for the wasted minutes.

Derek
Source Library
`;
}

function buildHtml(firstName) {
  const p = (s) => `<p style="margin:0 0 16px">${s}</p>`;
  return `<div style="font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.6;color:#1c1917;max-width:34em">
${p(firstName ? `${escapeHtml(firstName)},` : 'Hello,')}
${p('You told us a bit about yourself when you joined Source Library, and then the site sent you straight back to the same form. That was our bug, not anything you did, and it is fixed now.')}
${p('Your answers did save. The site simply failed to notice, so it kept asking. If you gave up and left, that was the reasonable response.')}
${p('You can change any of it whenever you like, on your <a href="https://sourcelibrary.org/account" style="color:#9a3412">account page</a>.')}
${p("Thank you for telling us what you're after — we read every one of these.")}
${p('Sorry for the wasted minutes.')}
${p('Derek<br><span style="color:#78716c">Source Library</span>')}
</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

const args = process.argv.slice(2);
const testTo = args.includes('--test') ? args[args.indexOf('--test') + 1] : null;
const doSend = args.includes('--send');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
  if ((doSend || testTo) && !process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const candidates = await db.collection('users').find({
    welcomedAt: { $gte: WINDOW_START, $lte: WINDOW_END },
    email: { $exists: true, $ne: null },
  }).project({ email: 1, name: 1, welcomedAt: 1, apologies: 1 }).sort({ welcomedAt: 1 }).toArray();

  const skippedInternal = candidates.filter(u => EXCLUDE.test(u.email));
  const skippedAlready = candidates.filter(u => !EXCLUDE.test(u.email) && u.apologies?.welcomeLoop2026_07);
  const recipients = candidates.filter(u => !EXCLUDE.test(u.email) && !u.apologies?.welcomeLoop2026_07);

  console.log(`window        : ${WINDOW_START.toISOString()} → ${WINDOW_END.toISOString()}`);
  console.log(`candidates    : ${candidates.length}`);
  console.log(`skip internal : ${skippedInternal.length} (${skippedInternal.map(u => u.email).join(', ') || 'none'})`);
  console.log(`skip already  : ${skippedAlready.length}`);
  console.log(`TO SEND       : ${recipients.length}\n`);

  if (testTo) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const r = await resend.emails.send({
      from: FROM, replyTo: REPLY_TO, to: testTo,
      subject: `[TEST] ${SUBJECT}`,
      text: buildText('Derek'), html: buildHtml('Derek'),
    });
    console.log('test send:', r.error ? `FAILED ${JSON.stringify(r.error)}` : `ok id=${r.data?.id}`);
    await client.close();
    return;
  }

  if (!doSend) {
    console.log('DRY RUN — nobody emailed. Recipients:');
    for (const u of recipients) {
      console.log(`  ${u.email}  (saved ${new Date(u.welcomedAt).toISOString()})`);
    }
    console.log(`\n--- text body (firstName = "Ada") ---\n${buildText('Ada')}`);
    await client.close();
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  let sent = 0, failed = 0;
  for (const u of recipients) {
    const firstName = (u.name || '').trim().split(' ')[0] || '';
    const r = await resend.emails.send({
      from: FROM, replyTo: REPLY_TO, to: u.email,
      subject: SUBJECT, text: buildText(firstName), html: buildHtml(firstName),
    });
    if (r.error) {
      failed++;
      console.error(`  FAIL ${u.email}: ${JSON.stringify(r.error)}`);
      continue;
    }
    // Stamp only after Resend accepted it, so a crash mid-run cannot mark
    // someone as emailed who wasn't.
    await db.collection('users').updateOne(
      { _id: u._id },
      { $set: { [SENT_FIELD]: new Date(), [`${SENT_FIELD}_emailId`]: r.data?.id || null } }
    );
    sent++;
    console.log(`  sent ${u.email} (${r.data?.id})`);
    await new Promise(res => setTimeout(res, 600)); // stay under Resend's rate limit
  }
  console.log(`\ndone: ${sent} sent, ${failed} failed`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
