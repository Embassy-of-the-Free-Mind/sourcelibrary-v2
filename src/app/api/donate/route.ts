import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { Resend } from 'resend';
import { checkRateLimitShared, getClientIp } from '@/lib/rate-limit';

const VALID_ROUTES = ['naf', 'efm', 'undecided'] as const;
const VALID_AMOUNTS = ['under-1000', '1000-5000', '5000-10000', '10000-25000', '25000-50000', '50000-plus', ''] as const;

// This route emails the submitted address. Uncapped, that is a spam relay:
// anyone can make sourcelibrary.org mail a stranger. A donor submits once.
const RATE_LIMIT = { name: 'donate', limit: 3, windowSeconds: 3600 };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface DonationIntention {
  name: string;
  email: string;
  route: (typeof VALID_ROUTES)[number];
  amount_range?: string;
  message?: string;
  referrer?: string;
}

function buildDonorEmail(firstName: string, route: string): string {
  const routeInfo =
    route === 'naf'
      ? `Since you indicated interest in donating via the <strong>Netherland-America Foundation</strong> (NAF),
         your gift will be tax-deductible under US law as a 501(c)(3) contribution.`
      : route === 'efm'
        ? `Your contribution will go directly to the <strong>Embassy of the Free Mind</strong> in Amsterdam,
           earmarked for the Source Library project.`
        : `We'll help you find the best donation route for your situation.`;

  return `
    <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #1a1612;">
      <div style="text-align: center; margin-bottom: 32px;">
        <img src="https://sourcelibrary.org/brand/svg/icon-only--black-on-white.svg" alt="Source Library" width="48" height="48" style="margin-bottom: 16px;" />
        <h1 style="font-size: 24px; font-weight: 400; margin: 0; letter-spacing: -0.01em;">
          Source Library
        </h1>
      </div>

      <div style="line-height: 1.8; font-size: 15px; color: #1a1612;">
        <p>Dear ${escapeHtml(firstName)},</p>
        <p>
          Thank you for your interest in supporting Source Library. Every contribution
          moves us closer to making these extraordinary texts freely available to the world.
        </p>
        <p>${routeInfo}</p>
      </div>

      <div style="background: #f5f0e8; border-radius: 8px; padding: 20px 24px; margin: 24px 0; line-height: 1.8; font-size: 14px; color: #1a1612;">
        <strong>Your point of contact:</strong><br>
        Derek Lomas, Project Director<br>
        <a href="mailto:team@sourcelibrary.org" style="color: #9e4a3a; text-decoration: none;">team@sourcelibrary.org</a><br><br>
        Derek can walk you through the donation process, answer questions about the project,
        or help with wire transfers and larger gifts. Don't hesitate to reach out directly.
      </div>

      <div style="line-height: 1.8; font-size: 15px; color: #1a1612;">
        <p>
          Source Library is an initiative of the Embassy of the Free Mind in Amsterdam,
          home to one of the world's most important collections of Hermetic, alchemical,
          and esoteric manuscripts. We are digitizing and translating these texts &mdash;
          many for the first time &mdash; and publishing them freely online.
        </p>
        <p>
          We'll be in touch soon. In the meantime, feel free to explore the library at
          <a href="https://sourcelibrary.org" style="color: #9e4a3a; text-decoration: none;">sourcelibrary.org</a>.
        </p>
      </div>

      <div style="margin-top: 36px; padding-top: 20px; border-top: 1px solid #e8e4dc; line-height: 1.7; font-size: 14px; color: #8a8480;">
        <p style="margin: 0;">With gratitude,</p>
        <p style="margin: 4px 0 0; color: #1a1612;">The Source Library team</p>
        <p style="margin: 16px 0 0; font-size: 12px;">
          <a href="https://sourcelibrary.org" style="color: #8a8480;">sourcelibrary.org</a>
          &nbsp;&middot;&nbsp;
          Embassy of the Free Mind, Amsterdam
        </p>
      </div>
    </div>
  `;
}

function buildNotificationEmail(intention: DonationIntention): string {
  const routeLabel = intention.route === 'naf' ? 'NAF (US tax-deductible)' : intention.route === 'efm' ? 'Direct via EFM' : 'Undecided';
  const amountLabel = intention.amount_range
    ? intention.amount_range.replace('under-', 'Under $').replace('plus', '+').replace(/-/g, ' - $').replace(/^(\d)/, '$$$1')
    : 'Not specified';

  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #1a1612;">
      <h2 style="font-size: 18px; margin: 0 0 16px;">New Donation Interest</h2>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 8px 12px; background: #f5f0e8; font-weight: 600; width: 120px;">Name</td><td style="padding: 8px 12px;">${escapeHtml(intention.name)}</td></tr>
        <tr><td style="padding: 8px 12px; background: #f5f0e8; font-weight: 600;">Email</td><td style="padding: 8px 12px;"><a href="mailto:${escapeHtml(intention.email)}">${escapeHtml(intention.email)}</a></td></tr>
        <tr><td style="padding: 8px 12px; background: #f5f0e8; font-weight: 600;">Route</td><td style="padding: 8px 12px;">${routeLabel}</td></tr>
        <tr><td style="padding: 8px 12px; background: #f5f0e8; font-weight: 600;">Amount</td><td style="padding: 8px 12px;">${escapeHtml(amountLabel)}</td></tr>
        ${intention.message ? `<tr><td style="padding: 8px 12px; background: #f5f0e8; font-weight: 600; vertical-align: top;">Message</td><td style="padding: 8px 12px;">${escapeHtml(intention.message)}</td></tr>` : ''}
        ${intention.referrer ? `<tr><td style="padding: 8px 12px; background: #f5f0e8; font-weight: 600;">Referrer</td><td style="padding: 8px 12px;">${escapeHtml(intention.referrer)}</td></tr>` : ''}
      </table>
      <p style="margin-top: 16px; font-size: 13px; color: #8a8480;">
        Reply directly to this email to reach the donor at ${escapeHtml(intention.email)}.
      </p>
    </div>
  `;
}

export async function POST(request: NextRequest) {
  try {
    const limit = await checkRateLimitShared(RATE_LIMIT, getClientIp(request));
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many submissions. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      );
    }

    const body = await request.json();
    const { name, email, route, amount_range, message, referrer } = body;

    // Validate required fields
    if (!name?.trim() || !email?.trim() || !route) {
      return NextResponse.json({ error: 'Name, email, and donation route are required' }, { status: 400 });
    }

    if (!VALID_ROUTES.includes(route)) {
      return NextResponse.json({ error: 'Invalid donation route' }, { status: 400 });
    }

    if (amount_range && !VALID_AMOUNTS.includes(amount_range)) {
      return NextResponse.json({ error: 'Invalid amount range' }, { status: 400 });
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const intention: DonationIntention = {
      name: name.trim(),
      email: email.trim(),
      route,
      amount_range: amount_range || undefined,
      message: message?.trim() || undefined,
      referrer: referrer?.trim() || undefined,
    };

    // Save to Supabase
    if (supabaseAdmin) {
      const { error: dbError } = await supabaseAdmin.from('donation_intentions').insert({
        name: intention.name,
        email: intention.email,
        route: intention.route,
        amount_range: intention.amount_range || null,
        message: intention.message || null,
        referrer: intention.referrer || null,
      });

      if (dbError) {
        console.error('Failed to save donation intention:', dbError);
        // Don't fail the request — still send emails
      }
    }

    // Send emails
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const from = process.env.EMAIL_FROM || 'Source Library <noreply@sourcelibrary.org>';
      const firstName = intention.name.split(' ')[0] || 'friend';

      // Email to donor
      await resend.emails.send({
        from,
        to: intention.email,
        subject: 'Thank you for your interest in Source Library',
        replyTo: 'derek@sourcelibrary.org',
        html: buildDonorEmail(firstName, intention.route),
      });

      // Notification to Derek
      await resend.emails.send({
        from,
        to: 'derek@sourcelibrary.org',
        replyTo: intention.email,
        subject: `Donation interest: ${intention.name}`,
        html: buildNotificationEmail(intention),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Donation intention error:', err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
