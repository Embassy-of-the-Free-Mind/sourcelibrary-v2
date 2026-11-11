import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { checkRateLimitShared, getClientIp } from '@/lib/rate-limit';
import { clientCountry } from '@/lib/client-ip';
import { welcomeEmailHtml, LIST_WELCOME_LEAD } from '@/lib/welcome-email';

// Every new address here triggers a welcome email to that address. Uncapped,
// that is a spam relay: a script can make sourcelibrary.org mail strangers,
// and the resulting Resend suspension would also kill the health-check alerts.
const RATE_LIMIT = { name: 'beta-subscribe', limit: 3, windowSeconds: 3600 };


const RESEND_AUDIENCE_ID = '62145526-c584-4230-81f1-a62387c49055';

async function sendWelcomeEmail(email: string) {
  if (!process.env.RESEND_API_KEY) return;

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    await Promise.allSettled([
      resend.emails.send({
        from: process.env.EMAIL_FROM || 'Source Library <noreply@sourcelibrary.org>',
        to: email,
        subject: 'Welcome to Source Library',
        html: await welcomeEmailHtml(LIST_WELCOME_LEAD),
      }),
      resend.contacts.create({
        audienceId: RESEND_AUDIENCE_ID,
        email,
      }),
    ]);
  } catch (error) {
    console.error('[subscribe] Welcome email failed:', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = body.email;
    const source = body.source;
    const comment = body.comment;
    const efmNewsletter = body.efmNewsletter === true;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const db = await getDb();
    const collection = db.collection('beta_subscribers');

    // Check for existing subscriber
    const existing = await collection.findOne({ email: normalizedEmail });
    if (existing) {
      // If they're newly opting into the EFM newsletter, record it without
      // overwriting a prior opt-in.
      if (efmNewsletter && !existing.efm_newsletter_opt_in) {
        await collection.updateOne(
          { _id: existing._id },
          { $set: { efm_newsletter_opt_in: true, efm_newsletter_opt_in_at: new Date() } },
        );
      }
      return NextResponse.json({ message: 'Already subscribed!', alreadySubscribed: true });
    }

    // Gate only the path that actually sends mail. A returning subscriber hits
    // the early return above without spending budget; a script walking a list of
    // fresh addresses spends it on every request, which is the case we care about.
    const limit = await checkRateLimitShared(RATE_LIMIT, getClientIp(request));
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many subscription attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      );
    }

    // Get IP and country from headers (Cloudflare / Vercel)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    const country = clientCountry(request.headers)
      || null;

    const doc: Record<string, unknown> = {
      email: normalizedEmail,
      ip,
      country,
      source: source === 'reader_gate' ? 'reader_gate'
        : source === 'reader_gate_magic' ? 'reader_gate_magic'
        : source === 'ficino_society' ? 'ficino_society'
        : source === 'support' ? 'support'
        : source === 'article' ? 'article'
        : 'beta_landing',
      subscribed_at: new Date(),
      notified: false,
      efm_newsletter_opt_in: efmNewsletter,
    };
    if (efmNewsletter) {
      doc.efm_newsletter_opt_in_at = new Date();
    }
    if (comment && typeof comment === 'string' && comment.trim()) {
      doc.comment = comment.trim().slice(0, 1000);
    }
    await collection.insertOne(doc);

    // Send welcome email (non-blocking — don't await)
    sendWelcomeEmail(normalizedEmail).catch(() => {});

    return NextResponse.json({ message: 'Subscribed successfully' });
  } catch (error) {
    console.error('Beta subscribe error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
