import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { getDb } from '@/lib/mongodb';
import { ADOPT_TIERS, ADOPT_MAX_CENTS, resolveAdoptTier, formatEuros } from '@/lib/adopt-tiers';
import type { Book } from '@/lib/types';

/**
 * Adopt-a-book checkout.
 *
 * Creates a Stripe Checkout Session for a single book at the donor-chosen
 * amount (validated server-side against the book's tier minimum). On success
 * the Stripe webhook (src/app/api/stripe/webhook/route.ts → checkout.session.completed,
 * kind=adopt_book) attaches their credit as `digitization_sponsor`, rendered as
 * "Digitized thanks to ___" on the book page.
 */

const ADOPT_CURRENCY = 'eur';

export async function POST(request: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ error: 'Payments not configured' }, { status: 503 });
  }

  let bookRef: unknown;
  let amount: unknown;
  try {
    const body = await request.json();
    bookRef = body?.bookId;
    amount = body?.amount;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!bookRef || typeof bookRef !== 'string') {
    return NextResponse.json({ error: 'bookId is required' }, { status: 400 });
  }
  if (!Number.isInteger(amount)) {
    return NextResponse.json({ error: 'A valid amount is required' }, { status: 400 });
  }
  const amountCents = amount as number;

  const db = await getDb();
  const book = await db.collection('books').findOne(
    { $or: [{ id: bookRef }, { slug: bookRef }] },
    { projection: { id: 1, slug: 1, title: 1, display_title: 1, visible: 1, hidden: 1, resource_type: 1, adopt_tier: 1, digitization_sponsor: 1, digitization_adopted_at: 1 } }
  );

  if (!book || book.visible === false || book.hidden === true) {
    return NextResponse.json({ error: 'Book not found' }, { status: 404 });
  }
  if (book.digitization_sponsor || book.digitization_adopted_at) {
    return NextResponse.json({ error: 'This book has already been adopted' }, { status: 409 });
  }

  const tier = resolveAdoptTier(book as { adopt_tier?: 'standard' | 'rare'; resource_type?: Book['resource_type'] });
  const minCents = ADOPT_TIERS[tier].minCents;
  if (amountCents < minCents || amountCents > ADOPT_MAX_CENTS) {
    return NextResponse.json(
      { error: `Amount must be between ${formatEuros(minCents)} and ${formatEuros(ADOPT_MAX_CENTS)}` },
      { status: 400 }
    );
  }

  const title = (book.display_title || book.title || 'a book') as string;
  const bookPath = `/book/${book.slug || book.id}`;
  const origin = request.nextUrl.origin;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      submit_type: 'donate',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: ADOPT_CURRENCY,
            unit_amount: amountCents,
            product_data: {
              name: `Adopt a book: ${title}`.slice(0, 250),
              description: 'Digitize this book in your name, with a lasting credit on its page.',
            },
          },
        },
      ],
      custom_fields: [
        {
          key: 'creditname',
          label: { type: 'custom', custom: 'Name or dedication to show (blank = anonymous)' },
          type: 'text',
          optional: true,
        },
      ],
      custom_text: {
        submit: {
          message: `You are adopting "${title}". It will be digitized with your name credited on its page.`.slice(0, 1200),
        },
      },
      metadata: {
        kind: 'adopt_book',
        bookId: String(book.id),
        bookSlug: (book.slug as string) || '',
        tier,
      },
      success_url: `${origin}${bookPath}?adopted=1`,
      cancel_url: `${origin}${bookPath}`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('[adopt] Failed to create checkout session:', err);
    return NextResponse.json({ error: 'Could not start checkout' }, { status: 500 });
  }
}
