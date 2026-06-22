import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { getDb } from '@/lib/mongodb';

/**
 * Adopt-a-book checkout.
 *
 * Creates a Stripe Checkout Session for a single book. The donor names a gift
 * (minimum €222.22, open-ended above) and, on success, the Stripe webhook
 * (src/app/api/stripe/webhook/route.ts → checkout.session.completed, kind=adopt_book)
 * attaches their credit to the book as `digitization_sponsor`, which renders as
 * "Digitized thanks to ___" on the book page.
 *
 * Pay-what-you-want with a minimum requires a real Stripe Price with
 * `custom_unit_amount` (inline price_data does not support it). We create one
 * reusable Price lazily, keyed by a stable lookup_key, so no dashboard setup is
 * needed. The specific book is tracked via session metadata + the return URL.
 */

const MIN_ADOPT_CENTS = 25000; // €250 minimum; donors may give more
const ADOPT_CURRENCY = 'eur';
const ADOPT_PRICE_LOOKUP_KEY = 'adopt_book_eur_250';

let cachedPriceId: string | null = null;

async function getAdoptPriceId(): Promise<string> {
  if (cachedPriceId) return cachedPriceId;
  const existing = await stripe!.prices.list({
    lookup_keys: [ADOPT_PRICE_LOOKUP_KEY],
    active: true,
    limit: 1,
  });
  if (existing.data[0]) {
    cachedPriceId = existing.data[0].id;
    return cachedPriceId;
  }
  const price = await stripe!.prices.create({
    currency: ADOPT_CURRENCY,
    custom_unit_amount: { enabled: true, minimum: MIN_ADOPT_CENTS },
    lookup_key: ADOPT_PRICE_LOOKUP_KEY,
    product_data: { name: 'Adopt a book — Embassy of the Free Mind' },
  });
  cachedPriceId = price.id;
  return cachedPriceId;
}

export async function POST(request: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ error: 'Payments not configured' }, { status: 503 });
  }

  let bookRef: string | undefined;
  try {
    const body = await request.json();
    bookRef = body?.bookId;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!bookRef || typeof bookRef !== 'string') {
    return NextResponse.json({ error: 'bookId is required' }, { status: 400 });
  }

  const db = await getDb();
  const book = await db.collection('books').findOne(
    { $or: [{ id: bookRef }, { slug: bookRef }] },
    { projection: { id: 1, slug: 1, title: 1, display_title: 1, visible: 1, hidden: 1, digitization_sponsor: 1 } }
  );

  if (!book || book.visible === false || book.hidden === true) {
    return NextResponse.json({ error: 'Book not found' }, { status: 404 });
  }
  if (book.digitization_sponsor) {
    return NextResponse.json({ error: 'This book has already been adopted' }, { status: 409 });
  }

  const title = (book.display_title || book.title || 'a book') as string;
  const bookPath = `/book/${book.slug || book.id}`;
  const origin = request.nextUrl.origin;

  try {
    const priceId = await getAdoptPriceId();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      submit_type: 'donate',
      line_items: [{ price: priceId, quantity: 1 }],
      custom_fields: [
        {
          key: 'creditname',
          label: { type: 'custom', custom: 'How to credit you (blank = your name)' },
          type: 'text',
          optional: true,
        },
      ],
      custom_text: {
        submit: { message: `You are adopting "${title}". It will be digitized with your name credited on its page.`.slice(0, 1200) },
      },
      metadata: { kind: 'adopt_book', bookId: String(book.id), bookSlug: (book.slug as string) || '' },
      success_url: `${origin}${bookPath}?adopted=1`,
      cancel_url: `${origin}${bookPath}`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('[adopt] Failed to create checkout session:', err);
    return NextResponse.json({ error: 'Could not start checkout' }, { status: 500 });
  }
}
