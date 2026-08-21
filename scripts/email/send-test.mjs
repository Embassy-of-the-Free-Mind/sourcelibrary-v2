/**
 * Send ONE letter to ONE address, for proofing.
 *
 * The newsletter path (/admin/email) can only send to the whole audience, and
 * send-user-broadcast.mjs --test is welded to the welcome letter's copy. So
 * proofing a new letter meant either pasting it into the composer and trusting
 * the preview, or sending it for real. This does the missing middle.
 *
 *   node scripts/email/send-test.mjs \
 *     scripts/email/feedback-newsletter-2026-08.body.html \
 *     "Can I get your feedback?" you@example.com
 *
 * SAFETY. It refuses more than one recipient, prefixes the subject with [TEST],
 * and prints the address before sending. A proofing tool that can reach a list
 * is a broadcast tool with a misleading name.
 *
 * The body is wrapped in the real shell via render-newsletter-preview.mjs's
 * extraction, so what arrives is what subscribers would get — the point of a
 * proof is that nothing about the rendering is different.
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const [, , bodyPath, subject, to] = process.argv;
if (!bodyPath || !subject || !to) {
  console.error('Usage: send-test.mjs <body.html> "<subject>" <one-email-address>');
  process.exit(1);
}
if (/[,;]/.test(to) || to.split('@').length !== 2) {
  console.error(`Refusing: "${to}" is not a single address. This is a proofing tool, not a sender.`);
  process.exit(1);
}
if (!process.env.RESEND_API_KEY) {
  console.error('RESEND_API_KEY required. set -a; source .env.production.local; set +a');
  process.exit(1);
}

const FROM = process.env.EMAIL_FROM || 'Derek at Source Library <derek@sourcelibrary.org>';
const REPLY_TO = process.env.EMAIL_REPLY_TO || 'derek@sourcelibrary.org';

// Reuse the preview renderer so the shell can never drift between proof and send.
const tmp = path.join(process.env.TMPDIR || '/tmp', `sl-test-${Date.now()}.html`);
execFileSync('node', [
  path.join(path.dirname(new URL(import.meta.url).pathname), 'render-newsletter-preview.mjs'),
  bodyPath, subject, tmp,
], { stdio: 'pipe' });
const html = readFileSync(tmp, 'utf8').replace('#unsubscribe', 'https://sourcelibrary.org');
unlinkSync(tmp);

console.log(`Sending ONE test to ${to}`);
console.log(`  from: ${FROM}`);
console.log(`  subject: [TEST] ${subject}`);
console.log(`  body: ${bodyPath} (${html.length} bytes rendered)`);

const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: FROM, reply_to: REPLY_TO, to: [to], subject: `[TEST] ${subject}`, html }),
});
const out = await res.json();
if (!res.ok) {
  console.error('Send failed:', res.status, JSON.stringify(out));
  process.exit(1);
}
console.log(`Sent. id=${out.id}`);
