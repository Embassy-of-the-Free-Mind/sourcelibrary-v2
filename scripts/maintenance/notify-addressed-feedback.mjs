#!/usr/bin/env node
/**
 * Backstop notifier for addressed feedback.
 *
 * The admin route PATCH /api/feedback/[id] already emails a submitter the moment
 * an item is marked addressed (via src/lib/feedback-reply-email.ts). But feedback
 * can also be addressed out-of-band — batch fulfillment scripts, direct DB edits,
 * bulk triage. This script catches those: any feedback row that is
 *   addressed:true  AND  has an email  AND  has no reply_sent_at
 * gets the same "we read your feedback and acted on it" email, then is stamped
 * reply_sent_at so it never double-sends (matching the route's idempotency guard).
 *
 * Usage:
 *   node scripts/maintenance/notify-addressed-feedback.mjs            # dry-run
 *   node scripts/maintenance/notify-addressed-feedback.mjs --go       # send
 *
 * Env: MONGODB_URI, RESEND_API_KEY, EMAIL_FROM (optional).
 */
import { MongoClient } from 'mongodb';

const GO = process.argv.includes('--go');

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const isPublicUrl = (u) => /^https?:\/\//i.test((u || '').trim());

function buildHtml({ name, originalMessage, replyBody, link }) {
  const greeting = name && name.trim() ? `Hi ${escapeHtml(name.trim())},` : 'Hi,';
  const body = replyBody && replyBody.trim()
    ? escapeHtml(replyBody.trim())
    : 'We&rsquo;ve looked into this and made a change based on what you sent.';
  const linkBlock = link && isPublicUrl(link)
    ? `<div style="text-align:center;margin:28px 0 4px;"><a href="${escapeHtml(link.trim())}" style="display:inline-block;padding:11px 28px;background:#9e4a3a;color:#fff;text-decoration:none;border-radius:8px;font-size:15px;font-family:-apple-system,sans-serif;">See the change</a></div>`
    : '';
  return `
<div style="font-family:Georgia,'Times New Roman',serif;max-width:520px;margin:0 auto;padding:40px 24px;color:#1a1612;">
  <div style="text-align:center;margin-bottom:28px;">
    <img src="https://sourcelibrary.org/brand/svg/icon-only--black-on-white.svg" alt="Source Library" width="44" height="44" style="margin-bottom:14px;" />
    <h1 style="font-size:23px;font-weight:500;margin:0;letter-spacing:-0.01em;">Thanks for your feedback</h1>
  </div>
  <p style="font-size:15px;line-height:1.7;margin:0 0 16px;">${greeting}</p>
  <p style="font-size:15px;line-height:1.7;margin:0 0 16px;">A little while ago you sent us a note about Source Library. We wanted to let you know we read it &mdash; and acted on it.</p>
  <div style="background:#f5f0e8;border-left:3px solid #d8cfc0;border-radius:6px;padding:14px 18px;margin:0 0 20px;">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#8a8480;margin-bottom:6px;">You wrote</div>
    <p style="font-size:14px;line-height:1.6;margin:0;color:#4a443c;white-space:pre-wrap;">${escapeHtml((originalMessage || '').trim())}</p>
  </div>
  <p style="font-size:15px;line-height:1.7;margin:0 0 8px;">${body}</p>
  ${linkBlock}
  <div style="border-top:1px solid #e8e4dc;padding-top:22px;margin-top:28px;text-align:center;">
    <p style="color:#8a8480;font-size:12px;line-height:1.6;margin:0;">Thank you for helping make these texts more readable.<br /><a href="https://sourcelibrary.org" style="color:#8a8480;">sourcelibrary.org</a></p>
  </div>
</div>`;
}

function buildText({ name, originalMessage, replyBody, link }) {
  const greeting = name && name.trim() ? `Hi ${name.trim()},` : 'Hi,';
  const body = replyBody && replyBody.trim() ? replyBody.trim() : 'We’ve looked into this and made a change based on what you sent.';
  const lines = [greeting, '', 'A little while ago you sent us a note about Source Library. We wanted to let you know we read it — and acted on it.', '', 'You wrote:', `  "${(originalMessage || '').trim()}"`, '', body];
  if (link && isPublicUrl(link)) lines.push('', `See the change: ${link.trim()}`);
  lines.push('', 'Thank you for helping make these texts more readable.', 'sourcelibrary.org');
  return lines.join('\n');
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const fb = client.db('bookstore').collection('feedback');

const pending = await fb.find({
  addressed: true,
  email: { $type: 'string', $regex: /@/ },
  $or: [{ reply_sent_at: { $exists: false } }, { reply_sent_at: null }],
}).toArray();

console.log(`Addressed + email + not-yet-notified: ${pending.length}`);
if (pending.length === 0) { await client.close(); process.exit(0); }

let resend = null;
if (GO) {
  if (!process.env.RESEND_API_KEY) { console.error('RESEND_API_KEY not set — cannot send'); await client.close(); process.exit(1); }
  const { Resend } = await import('resend');
  resend = new Resend(process.env.RESEND_API_KEY);
}
const from = process.env.EMAIL_FROM || 'Source Library <noreply@sourcelibrary.org>';

let sent = 0, failed = 0;
for (const row of pending) {
  const params = { name: row.name, originalMessage: row.message, replyBody: row.addressed_action, link: row.addressed_link };
  console.log(`  ${GO ? 'SEND' : 'would send'} → ${row.email}  «${(row.message || '').slice(0, 50)}»`);
  if (!GO) continue;
  try {
    const r = await resend.emails.send({ from, to: row.email, subject: 'We read your feedback on Source Library', html: buildHtml(params), text: buildText(params) });
    if (r.error) { console.error(`    Resend error: ${JSON.stringify(r.error).slice(0, 120)}`); failed++; continue; }
    await fb.updateOne({ _id: row._id }, { $set: { reply_sent_at: new Date(), reply_recipient: row.email } });
    sent++;
  } catch (e) { console.error(`    send failed: ${e.message?.slice(0, 100)}`); failed++; }
}
console.log(`\n${GO ? `Sent: ${sent}, failed: ${failed}` : '(dry-run — re-run with --go to send)'}`);
await client.close();
