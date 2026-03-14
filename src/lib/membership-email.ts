import { Resend } from 'resend';

/**
 * Send a welcome email to a new Ficino Society member.
 * Uses the same Resend setup as auth emails.
 */
export async function sendMembershipWelcomeEmail(email: string, name?: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  const resend = new Resend(process.env.RESEND_API_KEY);
  const firstName = name?.split(' ')[0] || '';
  const greeting = firstName ? `Dear ${firstName},` : 'Dear friend,';

  await resend.emails.send({
    from: process.env.EMAIL_FROM || 'Source Library <noreply@sourcelibrary.org>',
    to: email,
    subject: 'Welcome to the Ficino Society',
    html: `
      <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #1a1612;">
        <div style="text-align: center; margin-bottom: 32px;">
          <img src="https://sourcelibrary.org/brand/svg/icon-only--black-on-white.svg" alt="Source Library" width="48" height="48" style="margin-bottom: 16px;" />
          <h1 style="font-size: 26px; font-weight: 500; margin: 0 0 8px; letter-spacing: -0.01em;">
            Welcome to the Ficino Society
          </h1>
        </div>

        <div style="line-height: 1.7; font-size: 15px; color: #1a1612;">
          <p>${greeting}</p>
          <p>
            Thank you for joining the Ficino Society. Your membership directly supports
            the digitization and translation of rare historical texts &mdash; work that
            makes these ideas accessible to scholars, seekers, and anyone curious about
            the intellectual traditions that shaped the modern world.
          </p>
          <p>As a member, you now have access to:</p>
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 16px 0 24px;">
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #e8e4dc;">
              <a href="https://sourcelibrary.org/gallery" style="color: #9e4a3a; text-decoration: none; font-size: 15px; font-weight: 500;">High-resolution gallery downloads</a>
              <div style="color: #6b6560; font-size: 13px; margin-top: 2px;">Full-size woodcuts, emblems, engravings, and diagrams</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #e8e4dc;">
              <span style="color: #1a1612; font-size: 15px; font-weight: 500;">Complete translation downloads</span>
              <div style="color: #6b6560; font-size: 13px; margin-top: 2px;">Every translated book as EPUB, PDF, or plain text</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #e8e4dc;">
              <span style="color: #1a1612; font-size: 15px; font-weight: 500;">API access</span>
              <div style="color: #6b6560; font-size: 13px; margin-top: 2px;">Programmatic access for research tools and applications</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 0;">
              <span style="color: #1a1612; font-size: 15px; font-weight: 500;">Your name in the colophon</span>
              <div style="color: #6b6560; font-size: 13px; margin-top: 2px;">Credited in every scholarly edition we publish</div>
            </td>
          </tr>
        </table>

        <div style="text-align: center; margin: 32px 0;">
          <a href="https://sourcelibrary.org/gallery" style="display: inline-block; padding: 12px 32px; background: #9e4a3a; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-family: -apple-system, sans-serif;">
            Browse the gallery
          </a>
        </div>

        <div style="line-height: 1.7; font-size: 15px; color: #6b6560;">
          <p>
            Your membership renews annually. You can manage it anytime from
            your <a href="https://sourcelibrary.org/account" style="color: #9e4a3a; text-decoration: none;">account page</a>.
          </p>
          <p>
            If you have questions or ideas, just reply to this email. We read everything.
          </p>
        </div>

        <div style="border-top: 1px solid #e8e4dc; padding-top: 24px; margin-top: 32px; text-align: center;">
          <p style="color: #8a8480; font-size: 12px; line-height: 1.6; margin: 0;">
            The Ficino Society &mdash; Source Library
            <br />
            <a href="https://sourcelibrary.org" style="color: #8a8480;">sourcelibrary.org</a>
          </p>
        </div>
      </div>
    `,
  });
}
