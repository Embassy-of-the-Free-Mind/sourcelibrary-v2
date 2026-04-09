import { Resend } from 'resend';

/**
 * Send the API key to a developer whose request was approved.
 */
export async function sendApiKeyEmail(
  email: string,
  name: string,
  apiKey: string,
  tier: string,
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  const resend = new Resend(process.env.RESEND_API_KEY);
  const firstName = name.split(' ')[0] || 'there';

  await resend.emails.send({
    from: process.env.EMAIL_FROM || 'Source Library <noreply@sourcelibrary.org>',
    to: email,
    subject: 'Your Source Library API Key',
    html: `
      <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #1a1612;">
        <div style="text-align: center; margin-bottom: 32px;">
          <img src="https://sourcelibrary.org/brand/svg/icon-only--black-on-white.svg" alt="Source Library" width="48" height="48" style="margin-bottom: 16px;" />
          <h1 style="font-size: 24px; font-weight: 400; margin: 0; letter-spacing: -0.01em;">
            Source Library API
          </h1>
        </div>

        <div style="line-height: 1.8; font-size: 15px; color: #1a1612;">
          <p>Hi ${firstName},</p>
          <p>
            Your API key request has been approved. Here is your key &mdash;
            save it somewhere safe, as it cannot be retrieved again.
          </p>
        </div>

        <div style="background: #f5f0e8; border-radius: 8px; padding: 20px 24px; margin: 20px 0 28px; font-family: monospace; font-size: 14px; word-break: break-all; color: #1a1612; letter-spacing: 0.02em;">
          ${apiKey}
        </div>

        <div style="line-height: 1.8; font-size: 15px; color: #1a1612;">
          <p style="margin: 0 0 8px;"><strong>Tier:</strong> ${tier}</p>
          <p>
            Include your key in the <code style="background: #f5f0e8; padding: 2px 6px; border-radius: 4px; font-size: 13px;">Authorization</code>
            header as a Bearer token. Full documentation is at
            <a href="https://sourcelibrary.org/developers" style="color: #9e4a3a; text-decoration: none;">sourcelibrary.org/developers</a>.
          </p>
        </div>

        <div style="margin-top: 36px; padding-top: 20px; border-top: 1px solid #e8e4dc; line-height: 1.7; font-size: 14px; color: #8a8480;">
          <p style="margin: 0;">The Source Library team</p>
          <p style="margin: 8px 0 0; font-size: 12px;">
            <a href="https://sourcelibrary.org" style="color: #8a8480;">sourcelibrary.org</a>
          </p>
        </div>
      </div>
    `,
  });
}

/**
 * Send a welcome email when someone joins the Ficino Society (free).
 * Tone: welcome to the circle, here's where to go.
 */
export async function sendSocietyWelcomeEmail(email: string, name?: string): Promise<void> {
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
          <h1 style="font-size: 24px; font-weight: 400; margin: 0; letter-spacing: -0.01em;">
            The Ficino Society
          </h1>
        </div>

        <div style="line-height: 1.8; font-size: 15px; color: #1a1612;">
          <p>${greeting}</p>
          <p>
            Welcome to the circle. You've joined a community of scholars and readers
            who are translating the Western esoteric tradition together.
          </p>
          <p>Here's where to start:</p>
        </div>

        <div style="background: #f5f0e8; border-radius: 8px; padding: 20px 24px; margin: 20px 0 28px; line-height: 1.8; font-size: 14px; color: #1a1612;">
          <strong><a href="https://sourcelibrary.org/ficino-society/discussions" style="color: #9e4a3a; text-decoration: none;">The Correspondence</a></strong>
          &mdash; introduce yourself and join the discussion.<br>
          <strong><a href="https://sourcelibrary.org/ficino-society/members" style="color: #9e4a3a; text-decoration: none;">Members page</a></strong>
          &mdash; set your name and bio from your
          <a href="https://sourcelibrary.org/account" style="color: #9e4a3a; text-decoration: none;">account</a>.<br>
          <strong><a href="https://sourcelibrary.org" style="color: #9e4a3a; text-decoration: none;">The library</a></strong>
          &mdash; browse over 5,000 digitized texts, many newly translated.
        </div>

        <div style="line-height: 1.8; font-size: 15px; color: #1a1612;">
          <p>
            We'll write to you each quarter about what we've translated and what's
            coming next. If you have thoughts about what we should translate,
            post in the Correspondence or reply to this email.
          </p>
        </div>

        <div style="margin-top: 36px; padding-top: 20px; border-top: 1px solid #e8e4dc; line-height: 1.7; font-size: 14px; color: #8a8480;">
          <p style="margin: 0;">Welcome,</p>
          <p style="margin: 4px 0 0; color: #1a1612;">The Source Library team</p>
          <p style="margin: 16px 0 0; font-size: 12px;">
            <a href="https://sourcelibrary.org" style="color: #8a8480;">sourcelibrary.org</a>
          </p>
        </div>
      </div>
    `,
  });
}

/**
 * Send a thank-you email to a new financial contributor.
 * Tone: a letter of welcome into a scholarly tradition, not a SaaS receipt.
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
          <h1 style="font-size: 26px; font-weight: 500; margin: 0; letter-spacing: -0.01em;">
            The Ficino Society
          </h1>
        </div>

        <div style="line-height: 1.8; font-size: 15px; color: #1a1612;">
          <p>${greeting}</p>
          <p>
            Welcome. You have joined a small group of people who believe that these texts
            matter &mdash; that the ideas of Ficino, Paracelsus, Agrippa, and thousands of
            other thinkers deserve to be read, not just preserved.
          </p>
          <p>
            Your support makes it possible for us to keep translating. Every book
            in the library is free to read because of people like you.
          </p>
          <p>
            A few things that are now yours:
          </p>
        </div>

        <div style="background: #f5f0e8; border-radius: 8px; padding: 20px 24px; margin: 20px 0 28px; line-height: 1.7; font-size: 14px; color: #1a1612;">
          You can download any book or gallery image without limit.
          New translations are yours a month before they go public.
          Your name appears on the <a href="https://sourcelibrary.org/ficino-society/members" style="color: #9e4a3a; text-decoration: none;">members page</a>,
          if you choose &mdash; you can set your display name from your
          <a href="https://sourcelibrary.org/account" style="color: #9e4a3a; text-decoration: none;">account</a>.
        </div>

        <div style="line-height: 1.8; font-size: 15px; color: #1a1612;">
          <p>
            We will write to you from time to time &mdash; when we finish
            a translation we think you should know about, or when something
            interesting turns up in the archive. Not often. Only when it matters.
          </p>
          <p>
            If you ever want to talk about the texts, or have ideas for what
            we should translate next, reply to this email. We read everything.
          </p>
        </div>

        <div style="margin-top: 36px; padding-top: 20px; border-top: 1px solid #e8e4dc; line-height: 1.7; font-size: 14px; color: #8a8480;">
          <p style="margin: 0;">
            With gratitude,
          </p>
          <p style="margin: 4px 0 0; color: #1a1612;">
            The Source Library team
          </p>
          <p style="margin: 16px 0 0; font-size: 12px;">
            <a href="https://sourcelibrary.org" style="color: #8a8480;">sourcelibrary.org</a>
          </p>
        </div>
      </div>
    `,
  });
}
