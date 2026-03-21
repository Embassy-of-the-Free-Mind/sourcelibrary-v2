/**
 * Seed the Ficino Society discussions with initial threads.
 * Run: set -a; source .env.production.local; set +a; node scripts/seed-ficino-discussions.mjs
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

const client = new MongoClient(uri);
const db = client.db('bookstore');
const now = new Date();

const threads = [
  {
    title: 'Welcome to the Ficino Society',
    body: `This is the Correspondence — a space for members of the Ficino Society to discuss the texts, the translations, and the tradition.

A few notes on how this works:

This isn't a chat room or a social feed. Think of it as a place to write letters to each other — considered, unhurried, worth reading twice. There's no character limit. Take your time.

Some things you might discuss here:
- A passage in a newly translated text that struck you
- A text you think should be translated next, and why
- Something you noticed while reading that connects two works
- A question about the tradition that you've been sitting with

If you're new, consider introducing yourself in the thread below. Tell us what brought you here and what you're reading.

Welcome to the circle.`,
    authorId: 'system',
    authorName: 'The Ficino Society',
    createdAt: now,
    lastActivityAt: now,
    replyCount: 0,
    pinned: true,
  },
  {
    title: 'Introduce yourself',
    body: `Who are you? What brought you to the Western esoteric tradition? What are you reading right now?

There are no wrong answers. Some of us are academics, some are independent scholars, some are artists, some are simply curious readers who stumbled into a rabbit hole and never came out. All are welcome here.`,
    authorId: 'system',
    authorName: 'The Ficino Society',
    createdAt: new Date(now.getTime() + 1000),
    lastActivityAt: new Date(now.getTime() + 1000),
    replyCount: 0,
    pinned: true,
  },
  {
    title: 'What should we translate next?',
    body: `One of the privileges of the Society is shaping what Source Library translates. If there's a text you've been wanting to read in English — something locked in Latin, German, Greek, Arabic, or Hebrew — tell us about it here.

What is it? Why does it matter? What would it open up if it were available?

We can't promise we'll get to everything, but this is how priorities are set. The community decides.`,
    authorId: 'system',
    authorName: 'The Ficino Society',
    createdAt: new Date(now.getTime() + 2000),
    lastActivityAt: new Date(now.getTime() + 2000),
    replyCount: 0,
    pinned: false,
  },
  {
    title: 'Reading group: what should we read first?',
    body: `Each quarter, the Society reads a text together. We're choosing our first one now.

Some candidates from the collection:

- Marsilio Ficino, De Amore (Commentary on Plato's Symposium) — the foundational text of Renaissance Neoplatonism
- Heinrich Cornelius Agrippa, De Occulta Philosophia — the encyclopedia of Renaissance magic
- Michael Maier, Atalanta Fugiens — alchemical emblems with musical fugues
- Robert Fludd, Utriusque Cosmi Historia — macrocosm and microcosm

Or suggest something else entirely. What would you want to read with others?`,
    authorId: 'system',
    authorName: 'The Ficino Society',
    createdAt: new Date(now.getTime() + 3000),
    lastActivityAt: new Date(now.getTime() + 3000),
    replyCount: 0,
    pinned: false,
  },
];

async function seed() {
  try {
    await client.connect();

    // Check if already seeded
    const existing = await db.collection('discussions').countDocuments();
    if (existing > 0) {
      console.log(`Already ${existing} threads. Skipping seed.`);
      return;
    }

    const result = await db.collection('discussions').insertMany(threads);
    console.log(`Seeded ${result.insertedCount} discussion threads.`);
  } finally {
    await client.close();
  }
}

seed().catch(console.error);
