import { Resend } from 'resend';

/**
 * Thank-you email sent when a donor adopts a book (Stripe webhook → adopt_book).
 * Includes a link to a personalized, printable certificate.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://sourcelibrary.org';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface AdoptionEmailParams {
  to: string;
  payerName?: string | null;
  publicCredit?: string | null; // shown on the book; blank/absent = anonymous
  bookTitle: string;
  bookPath: string;             // "/book/<slug>"
  sessionId: string;            // certificate token
  amountLabel?: string;         // "€500"
}

export async function sendAdoptionThankYou(p: AdoptionEmailParams): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  const resend = new Resend(process.env.RESEND_API_KEY);

  const firstName = escapeHtml((p.payerName || '').split(' ')[0] || 'friend');
  const title = escapeHtml(p.bookTitle);
  const bookUrl = `${SITE_URL}${p.bookPath}`;
  const certUrl = `${SITE_URL}/adopt/certificate/${encodeURIComponent(p.sessionId)}`;

  const creditLine = p.publicCredit
    ? `Your credit &mdash; <strong>&ldquo;Digitized thanks to ${escapeHtml(p.publicCredit)}&rdquo;</strong> &mdash; now appears on the book&rsquo;s page, and will for as long as it is read.`
    : `At your request your gift is credited anonymously; the book&rsquo;s page simply records that a patron made its digitization possible.`;

  await resend.emails.send({
    from: process.env.EMAIL_FROM || 'Source Library <noreply@sourcelibrary.org>',
    to: p.to,
    replyTo: 'derek@sourcelibrary.org',
    subject: `Thank you for adopting "${p.bookTitle}"`,
    html: `
    <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 540px; margin: 0 auto; padding: 40px 24px; color: #1a1612;">
      <div style="text-align: center; margin-bottom: 28px;">
        <img src="https://sourcelibrary.org/brand/svg/icon-only--black-on-white.svg" alt="Source Library" width="48" height="48" style="margin-bottom: 14px;" />
        <h1 style="font-size: 22px; font-weight: 400; margin: 0; letter-spacing: -0.01em;">Source Library</h1>
      </div>

      <div style="line-height: 1.8; font-size: 15px;">
        <p>Dear ${firstName},</p>
        <p>
          Thank you for adopting <a href="${bookUrl}" style="color:#9e4a3a; text-decoration:none;"><em>${title}</em></a>${p.amountLabel ? ` with a gift of ${escapeHtml(p.amountLabel)}` : ''}.
          Because of you, this book will be digitized, translated, and made freely readable by anyone, anywhere &mdash; permanently.
        </p>
        <p>${creditLine}</p>
      </div>

      <div style="text-align:center; margin: 30px 0;">
        <a href="${certUrl}" style="display:inline-block; background:#9e4a3a; color:#fff; text-decoration:none; padding:12px 22px; border-radius:6px; font-size:14px;">
          View your certificate
        </a>
      </div>

      <div style="background:#f5f0e8; border-radius:8px; padding:18px 22px; margin: 22px 0; line-height:1.7; font-size:14px;">
        <strong>Your point of contact:</strong><br>
        Derek Lomas, Project Director<br>
        <a href="mailto:derek@sourcelibrary.org" style="color:#9e4a3a; text-decoration:none;">derek@sourcelibrary.org</a>
      </div>

      <div style="margin-top: 30px; padding-top: 18px; border-top: 1px solid #e8e4dc; line-height:1.7; font-size:13px; color:#8a8480;">
        <p style="margin:0;">With gratitude,</p>
        <p style="margin:4px 0 0; color:#1a1612;">The Source Library team</p>
        <p style="margin:14px 0 0; font-size:12px;">
          <a href="https://sourcelibrary.org" style="color:#8a8480;">sourcelibrary.org</a> &nbsp;&middot;&nbsp; Embassy of the Free Mind, Amsterdam
        </p>
      </div>
    </div>`,
  });
}
