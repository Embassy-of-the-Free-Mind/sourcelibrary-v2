// Sends a reply email to a submitter who left an address. Two wordings:
//   'addressed' (default) — "we read your feedback and acted on it"; fired from
//     PATCH /api/feedback/[id] when an admin marks an item done, and by the lanes.
//   'reply' — a plain "thanks for your note" with the admin's message; fired by
//     the admin's Send reply button, which does not close the item (#7678).
// Best-effort: returns false (never throws) if email can't be
// sent so it never breaks the admin action.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isPublicUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

interface FeedbackReplyParams {
  to: string;
  name?: string | null;
  /** The submitter's original feedback message, quoted back to them. */
  originalMessage: string;
  /** Friendly note about what changed. Falls back to a generic line if empty. */
  replyBody?: string | null;
  /** Optional public link to the change (e.g. a PR or the fixed page). */
  link?: string | null;
  /** 'reply' is a plain answer that claims no change was made. Default 'addressed'. */
  kind?: 'addressed' | 'reply';
}

function wording(kind: FeedbackReplyParams['kind']) {
  return kind === 'reply'
    ? {
        title: 'About your note to Source Library',
        intro: 'Thank you for writing to Source Library. Here is our reply.',
        linkLabel: 'Open the link',
        subject: 'A reply to your note on Source Library',
      }
    : {
        title: 'Thanks for your feedback',
        intro: 'A little while ago you sent us a note about Source Library. We wanted to let you know we read it and acted on it.',
        linkLabel: 'See the change',
        subject: 'We read your feedback on Source Library',
      };
}

function buildHtml({ name, originalMessage, replyBody, link, kind }: FeedbackReplyParams): string {
  const w = wording(kind);
  const greeting = name && name.trim() ? `Hi ${escapeHtml(name.trim())},` : 'Hi,';
  const body = (replyBody && replyBody.trim())
    ? escapeHtml(replyBody.trim())
    : 'We&rsquo;ve looked into this and made a change based on what you sent.';
  const linkBlock = link && isPublicUrl(link)
    ? `<div style="text-align: center; margin: 28px 0 4px;">
        <a href="${escapeHtml(link.trim())}" style="display: inline-block; padding: 11px 28px; background: #9e4a3a; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-family: -apple-system, sans-serif;">${w.linkLabel}</a>
      </div>`
    : '';

  return `
<div style="font-family: Georgia, 'Times New Roman', serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #1a1612;">
  <div style="text-align: center; margin-bottom: 28px;">
    <img src="https://sourcelibrary.org/brand/svg/icon-only--black-on-white.svg" alt="Source Library" width="44" height="44" style="margin-bottom: 14px;" />
    <h1 style="font-size: 23px; font-weight: 500; margin: 0; letter-spacing: -0.01em;">${w.title}</h1>
  </div>
  <p style="font-size: 15px; line-height: 1.7; margin: 0 0 16px;">${greeting}</p>
  <p style="font-size: 15px; line-height: 1.7; margin: 0 0 16px;">${w.intro}</p>
  <div style="background: #f5f0e8; border-left: 3px solid #d8cfc0; border-radius: 6px; padding: 14px 18px; margin: 0 0 20px;">
    <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #8a8480; margin-bottom: 6px;">You wrote</div>
    <p style="font-size: 14px; line-height: 1.6; margin: 0; color: #4a443c; white-space: pre-wrap;">${escapeHtml(originalMessage.trim())}</p>
  </div>
  <p style="font-size: 15px; line-height: 1.7; margin: 0 0 8px; white-space: pre-wrap;">${body}</p>
  ${linkBlock}
  <div style="border-top: 1px solid #e8e4dc; padding-top: 22px; margin-top: 28px; text-align: center;">
    <p style="color: #8a8480; font-size: 12px; line-height: 1.6; margin: 0;">
      Thank you for helping make these texts more readable.
      <br />
      <a href="https://sourcelibrary.org" style="color: #8a8480;">sourcelibrary.org</a>
    </p>
  </div>
</div>
`;
}

function buildText({ name, originalMessage, replyBody, link, kind }: FeedbackReplyParams): string {
  const w = wording(kind);
  const greeting = name && name.trim() ? `Hi ${name.trim()},` : 'Hi,';
  const body = (replyBody && replyBody.trim())
    ? replyBody.trim()
    : 'We’ve looked into this and made a change based on what you sent.';
  const lines = [
    greeting,
    '',
    w.intro,
    '',
    'You wrote:',
    `  "${originalMessage.trim()}"`,
    '',
    body,
  ];
  if (link && isPublicUrl(link)) {
    lines.push('', `${w.linkLabel}: ${link.trim()}`);
  }
  lines.push('', 'Thank you for helping make these texts more readable.', 'sourcelibrary.org');
  return lines.join('\n');
}

/**
 * Sends the reply email. Returns true if Resend accepted it, false otherwise
 * (missing API key, send error, etc.). Never throws.
 */
export async function sendFeedbackReplyEmail(params: FeedbackReplyParams): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[feedback-reply] RESEND_API_KEY not set — skipping reply email');
    return false;
  }
  if (!params.to || !params.to.includes('@')) return false;

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Source Library <noreply@sourcelibrary.org>',
      to: params.to,
      subject: wording(params.kind).subject,
      html: buildHtml(params),
      text: buildText(params),
    });
    if (result.error) {
      console.error('[feedback-reply] Resend error:', result.error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[feedback-reply] send failed:', error);
    return false;
  }
}
