#!/usr/bin/env node
/**
 * Tag canonical Kanjur volumes as `is_first_translation: false` with provenance
 * noting they are canonical scriptures — by definition not first English translations.
 *
 * The Kanjur (bka' 'gyur, "translated words of the Buddha") has been actively
 * translated to English since ~1900 (Conze, Cleary, Thurman, Watson, etc.) and is
 * being completed systematically by 84000.co (130+ sutras translated as of 2024).
 * Flagging any Kanjur volume as "first English translation" would be wrong; this
 * tag removes them from the unevaluated set permanently and prevents accidental
 * FT-flagging in future passes.
 *
 * Usage:
 *   node scripts/maintenance/tag-kanjur-not-ft.mjs              # dry-run
 *   node scripts/maintenance/tag-kanjur-not-ft.mjs --apply      # actually write
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

function loadEnv() {
  const env = {};
  try {
    const content = fs.readFileSync('.env.production.local', 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        env[m[1].trim()] = v;
      }
    }
  } catch {}
  return { ...process.env, ...env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB || 'bookstore';

const KANJUR_RX = [
  { title: { $regex: 'kanjur', $options: 'i' } },
  { title: { $regex: 'kangyur', $options: 'i' } },
  { title: { $regex: 'kah-?gyur', $options: 'i' } },
  { title: { $regex: "bka\\' \\'gyur", $options: 'i' } },
  { title: { $regex: 'thadrak', $options: 'i' } },
];

async function main() {
  const dryRun = !process.argv.includes('--apply');
  console.log('=== Tag Kanjur volumes as NOT a first English translation ===');
  console.log('Mode:', dryRun ? 'DRY RUN' : 'APPLYING');
  console.log();

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 3, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(MONGODB_DB);

  const q = {
    hidden: { $ne: true },
    pages_ocr: { $gt: 0 },
    language: 'Tibetan',
    is_first_translation: { $exists: false },
    $or: KANJUR_RX,
  };

  const total = await db.collection('books').countDocuments(q);
  console.log(`Kanjur volumes to tag: ${total}`);

  const sample = await db.collection('books').find(q).limit(10).project({ title: 1, pages_ocr: 1 }).toArray();
  console.log('\nSample:');
  sample.forEach(s => console.log(`  - ${s.title.slice(0, 95)}  [${s.pages_ocr}p]`));
  console.log();

  if (dryRun) {
    console.log('Dry-run complete. Re-run with --apply to write.');
    await client.close();
    return;
  }

  const now = new Date();
  const verification = {
    has_english_translation: 'partial',
    translations: [],
    confidence: 'high',
    reasoning: 'Canonical Kanjur volume (bka\' \'gyur — "translated words of the Buddha"). The Kanjur has been actively translated to English since the early 20th century by scholars including Conze (Prajnaparamita), Cleary (Avatamsaka), Thurman (Vimalakirti), Watson (Lotus Sutra), and is being systematically completed by 84000.co (130+ sutras translated as of 2024). Individual sutras within this Kanjur volume may or may not have published English translations; consult https://84000.co for current status. This Bhutanese Thadrak woodblock recension itself is a specific witness, but the texts it contains are canonical and not eligible for "first English translation" classification.',
    source: 'canonical_kanjur',
    method: 'kanjur_volume_categorical',
    verified_at: now,
  };

  const provenance = {
    is_first_translation: {
      source: 'canonical_kanjur',
      method: 'kanjur_volume_categorical',
      date: now,
      confidence: 'high',
      script: 'tag-kanjur-not-ft.mjs',
    },
  };

  let processed = 0;
  const cursor = db.collection('books').find(q).project({ _id: 1, id: 1 });
  for await (const book of cursor) {
    const update = {
      $set: {
        is_first_translation: false,
        translation_verification: verification,
        updated_at: now,
        ...Object.fromEntries(Object.entries(provenance).map(([k, v]) => [`field_provenance.${k}`, v])),
      },
    };
    const res = await db.collection('books').updateOne({ _id: book._id }, update);
    if (res.modifiedCount !== 1) console.warn(`  WARN: ${book.id} not modified (count=${res.modifiedCount})`);
    processed++;
    if (processed % 50 === 0) console.log(`  [${processed}/${total}] tagged...`);
  }

  console.log(`\nDone. Tagged ${processed} Kanjur volumes as is_first_translation: false.`);
  await client.close();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
