#!/usr/bin/env node
/**
 * Audit artworks whose images were replaced by upgrade-artwork-images.mjs.
 *
 * Background: the upgrade script's findHigherResOnCommons() did a free-text
 * Commons search for "<author> <title>" and took the highest-resolution image
 * hit with NO verification it depicted the same artwork. Result: e.g.
 * art-angelic-concert (El Greco) served a 2013 concert photo of the Hevia Trio
 * for weeks (found 2026-06-04).
 *
 * This script vision-checks every `image_upgraded: true` artwork: it sends the
 * served thumbnail + the artwork's title/author/description to Gemini and asks
 * whether the image plausibly depicts that artwork. Mismatches are written to
 * a report and flagged in Mongo (`image_mismatch_suspected: true`).
 *
 * It does NOT modify images. Run revert-bad-artwork-upgrades.mjs on the report
 * to restore originals.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/audit-upgraded-artwork-images.mjs [--limit N] [--slug SLUG]
 *
 * Output: scripts/output/artwork-upgrade-audit.json
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'fs';

const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '0') || 999999;
const ONLY_SLUG = process.argv.find((_, i, a) => a[i - 1] === '--slug') || null;

const MODEL = 'gemini-3.1-flash-lite';
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('GEMINI_API_KEY missing'); process.exit(1); }

const client = new MongoClient(process.env.MONGODB_URI);

async function visionCheck(thumbUrl, title, author, description) {
  const imgRes = await fetch(thumbUrl, { signal: AbortSignal.timeout(30000) });
  if (!imgRes.ok) return { error: `thumb fetch ${imgRes.status}` };
  const b64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');

  const prompt = `You are auditing a digital art library for image/metadata mismatches.

The catalog record says this image is:
Title: ${title}
Artist: ${author || 'Unknown'}
${description ? `Catalog description: ${description.substring(0, 600)}` : ''}

Look at the attached image. Does it plausibly depict THIS artwork (or a detail/crop/engraving of it)?
A mismatch means the image is clearly a DIFFERENT subject — e.g. a modern photograph when the record describes an old master painting, a different artwork entirely, a book page about an unrelated topic.
Style variations, crops, details, different photographic reproductions of the same work, or black-and-white versions are MATCHES.

Respond with JSON only: {"match": true|false, "confidence": "high"|"medium"|"low", "image_shows": "<one short sentence describing what the image actually depicts>"}`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: 'image/jpeg', data: b64 } },
        { text: prompt },
      ] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) return { error: `gemini ${res.status}` };
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return { error: `no candidate (${data.candidates?.[0]?.finishReason || 'empty'})` };
  try { return JSON.parse(text); } catch { return { error: 'unparseable: ' + text.substring(0, 100) }; }
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  const query = { image_upgraded: true };
  if (ONLY_SLUG) query.slug = ONLY_SLUG;

  const docs = await books.find(query, {
    projection: { slug: 1, title: 1, author: 1, description: 1, summary: 1, thumbnail: 1, commons_title: 1, image_upgrade_source: 1, 'image_source.identifier': 1, 'image_source.provider': 1 },
  }).limit(LIMIT).toArray();

  console.log(`Auditing ${docs.length} upgraded artworks…`);
  const results = [];
  let mismatches = 0, errors = 0, done = 0;

  for (const d of docs) {
    done++;
    const thumb = d.thumbnail;
    if (!thumb) { results.push({ slug: d.slug, error: 'no thumbnail' }); errors++; continue; }
    let verdict;
    try {
      verdict = await visionCheck(thumb, d.title, d.author, d.description || d.summary);
    } catch (err) {
      verdict = { error: err.message?.substring(0, 80) };
    }
    const row = {
      slug: d.slug, title: d.title, author: d.author,
      upgrade_source: d.image_upgrade_source,
      upgraded_to: d.commons_title,
      original_file: d.image_source?.identifier,
      original_provider: d.image_source?.provider,
      ...verdict,
    };
    results.push(row);
    if (verdict.error) {
      errors++;
      console.log(`[${done}/${docs.length}] ERR  ${d.slug}: ${verdict.error}`);
    } else if (!verdict.match) {
      mismatches++;
      console.log(`[${done}/${docs.length}] MISMATCH ${d.slug} (${d.author} — ${d.title?.substring(0, 40)}) → image shows: ${verdict.image_shows}`);
      await books.updateOne({ _id: d._id }, { $set: { image_mismatch_suspected: true } });
    } else if (done % 25 === 0) {
      console.log(`[${done}/${docs.length}] ok (${mismatches} mismatches so far)`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  mkdirSync('scripts/output', { recursive: true });
  const out = 'scripts/output/artwork-upgrade-audit.json';
  writeFileSync(out, JSON.stringify({ audited_at: new Date().toISOString(), total: docs.length, mismatches, errors, results }, null, 2));
  console.log(`\n━━━ Done: ${docs.length} audited, ${mismatches} mismatches, ${errors} errors → ${out}`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
