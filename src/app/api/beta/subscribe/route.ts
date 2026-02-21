import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

async function sendWelcomeEmail(email: string) {
  if (!process.env.RESEND_API_KEY) return;

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Source Library <noreply@sourcelibrary.org>',
      to: email,
      subject: 'Welcome to Source Library',
      html: `
        <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #1a1612;">
          <div style="text-align: center; margin-bottom: 32px;">
            <img src="https://sourcelibrary.org/brand/svg/icon-only--black-on-white.svg" alt="Source Library" width="48" height="48" style="margin-bottom: 16px;" />
            <h1 style="font-size: 26px; font-weight: 500; margin: 0 0 8px; letter-spacing: -0.01em;">Welcome to Source Library</h1>
            <p style="color: #6b6560; font-size: 15px; line-height: 1.6; margin: 0;">
              You now have full access to our collection of rare historical texts.
            </p>
          </div>

          <div style="background: #f5f0e8; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
            <p style="font-size: 15px; line-height: 1.7; margin: 0 0 16px; color: #1a1612;">
              Source Library is a digital archive of over 2,000 rare books in alchemy, Hermetica, Kabbalah,
              astrology, and the Western esoteric tradition &mdash; many translated into English for the first time using AI.
            </p>
            <p style="font-size: 15px; line-height: 1.7; margin: 0; color: #1a1612;">
              Every text is free to read, search, and cite. Here are a few places to start:
            </p>
          </div>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e8e4dc;">
                <a href="https://sourcelibrary.org/search" style="color: #9e4a3a; text-decoration: none; font-size: 15px; font-weight: 500;">Search the collection</a>
                <div style="color: #6b6560; font-size: 13px; margin-top: 4px;">Full-text search across all books and translations</div>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e8e4dc;">
                <a href="https://sourcelibrary.org/gallery" style="color: #9e4a3a; text-decoration: none; font-size: 15px; font-weight: 500;">Browse the gallery</a>
                <div style="color: #6b6560; font-size: 13px; margin-top: 4px;">Thousands of illustrations extracted from the texts</div>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e8e4dc;">
                <a href="https://sourcelibrary.org/encyclopedia" style="color: #9e4a3a; text-decoration: none; font-size: 15px; font-weight: 500;">Explore the encyclopedia</a>
                <div style="color: #6b6560; font-size: 13px; margin-top: 4px;">People, places, and concepts across the collection</div>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 0;">
                <a href="https://sourcelibrary.org/developers" style="color: #9e4a3a; text-decoration: none; font-size: 15px; font-weight: 500;">Developer tools (MCP)</a>
                <div style="color: #6b6560; font-size: 13px; margin-top: 4px;">Use Source Library from Claude, ChatGPT, or your own tools</div>
              </td>
            </tr>
          </table>

          <div style="text-align: center; margin: 32px 0;">
            <a href="https://sourcelibrary.org" style="display: inline-block; padding: 12px 32px; background: #9e4a3a; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-family: -apple-system, sans-serif;">
              Start reading
            </a>
          </div>

          <div style="border-top: 1px solid #e8e4dc; padding-top: 24px; text-align: center;">
            <p style="color: #8a8480; font-size: 12px; line-height: 1.6; margin: 0;">
              Source Library &mdash; Rare texts, translated and searchable.
              <br />
              <a href="https://sourcelibrary.org" style="color: #8a8480;">sourcelibrary.org</a>
            </p>
          </div>
        </div>
      `,
    });
  } catch (error) {
    // Non-blocking — log but don't fail the subscribe
    console.error('[subscribe] Welcome email failed:', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = body.email;
    const source = body.source;
    const comment = body.comment;

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
      return NextResponse.json({ message: 'Already subscribed!', alreadySubscribed: true });
    }

    // Get IP and country from headers (Cloudflare / Vercel)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    const country = request.headers.get('x-vercel-ip-country')
      || request.headers.get('cf-ipcountry')
      || null;

    const doc: Record<string, unknown> = {
      email: normalizedEmail,
      ip,
      country,
      source: source === 'reader_gate' ? 'reader_gate'
        : source === 'reader_gate_magic' ? 'reader_gate_magic'
        : 'beta_landing',
      subscribed_at: new Date(),
      notified: false,
    };
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
