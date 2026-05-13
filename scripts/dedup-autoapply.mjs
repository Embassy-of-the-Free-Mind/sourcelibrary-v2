#!/usr/bin/env node
/**
 * Auto-apply dedup proposals from scripts/dedup-scan-strict.mjs:
 *   - SHA groups: apply silently (byte-identical = same file, no review needed)
 *   - OCR groups: run Gemini-vision verification ("are these the same printed
 *     page?"). If vision says "yes" with high confidence, apply. Otherwise
 *     queue for human review.
 *
 * Inputs: .claude/docs/dedup-proposals/<book_id>.json (from scan-strict)
 * Outputs:
 *   - Applied dupes via the normal dedup-apply mechanism
 *   - Per-book snapshot at .claude/docs/snapshots/dedup-reviewed-<book_id>-<ts>.json
 *   - Ambiguous OCR pairs into .claude/docs/dedup-review-queue/<book_id>.json
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/dedup-autoapply.mjs --in-dir .claude/docs/dedup-proposals
 */

import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const args = process.argv.slice(2);
const IN_DIR = args[args.indexOf('--in-dir') + 1] || resolve(REPO_ROOT, '.claude/docs/dedup-proposals');
const SKIP_OCR = args.includes('--no-ocr');

const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY_2 || process.env.GOOGLE_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

async function fetchAsInlineData(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return { inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } };
}

async function visionVerifyPair(urlA, urlB) {
  if (!ai) return { decision: 'unsure', reason: 'no api key' };
  const prompt = `These are two page images from a scanned book. Are they showing the same content (i.e., the same printed page) — possibly with very minor crop/brightness differences — or different content?

Reply with one word: SAME, DIFFERENT, or UNSURE.`;
  try {
    const [a, b] = await Promise.all([fetchAsInlineData(urlA), fetchAsInlineData(urlB)]);
    const result = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [a, b, { text: prompt }] }],
    });
    const text = (result.text || '').trim().toUpperCase();
    if (text.startsWith('SAME')) return { decision: 'same', raw: text };
    if (text.startsWith('DIFFERENT') || text.startsWith('DIFF')) return { decision: 'different', raw: text };
    return { decision: 'unsure', raw: text };
  } catch (e) {
    return { decision: 'unsure', reason: e.message };
  }
}

async function processBook(db, proposalPath) {
  const p = JSON.parse(readFileSync(proposalPath, 'utf8'));
  const shaGroups = p.groups.filter(g => g.method === 'sha');
  const ocrGroups = p.groups.filter(g => g.method === 'ocr');

  const shaDecisions = [];
  for (const g of shaGroups) {
    const sorted = [...g.members].sort((a, b) => a.page_number - b.page_number);
    const canon = sorted[0];
    for (const d of sorted.slice(1)) {
      shaDecisions.push({ dup_id: d._id, canon_id: canon._id, method: 'sha', decision: 'accept' });
    }
  }

  const ocrAccepted = [];
  const ocrAmbiguous = [];
  if (!SKIP_OCR && ai) {
    for (const g of ocrGroups) {
      const sorted = [...g.members].sort((a, b) => a.page_number - b.page_number);
      const canon = sorted[0];
      for (const d of sorted.slice(1)) {
        const v = await visionVerifyPair(canon.cropped_photo, d.cropped_photo);
        const rec = { dup_id: d._id, canon_id: canon._id, method: 'ocr', vision: v };
        if (v.decision === 'same') {
          ocrAccepted.push({ ...rec, decision: 'accept' });
        } else {
          ocrAmbiguous.push({ ...rec, canon, dup: d });
        }
      }
    }
  } else {
    for (const g of ocrGroups) {
      const sorted = [...g.members].sort((a, b) => a.page_number - b.page_number);
      const canon = sorted[0];
      for (const d of sorted.slice(1)) ocrAmbiguous.push({ dup_id: d._id, canon_id: canon._id, method: 'ocr', canon, dup: d });
    }
  }

  const allAccepted = [...shaDecisions, ...ocrAccepted];
  if (allAccepted.length === 0 && ocrAmbiguous.length === 0) {
    return { book_id: p.book_id, slug: p.slug, sha: 0, ocr_same: 0, ocr_ambiguous: 0 };
  }

  // Apply accepted
  const book = await db.collection('books').findOne({ id: p.book_id }, { projection: { id: 1, slug: 1, pages_count: 1 } });
  if (!book) return { book_id: p.book_id, error: 'book not found' };

  if (allAccepted.length > 0) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const allPagesBefore = await db.collection('pages').find({ book_id: p.book_id }, { projection: { _id: 1, page_number: 1 } }).toArray();
    const snapPath = resolve(REPO_ROOT, '.claude/docs/snapshots', `dedup-reviewed-${p.book_id}-${ts}.json`);
    mkdirSync(dirname(snapPath), { recursive: true });
    writeFileSync(snapPath, JSON.stringify({
      book_id: p.book_id, slug: p.slug, ts, pages_count_before: book.pages_count,
      decisions_in: allAccepted,
      pages: allPagesBefore.map(p2 => ({ _id: String(p2._id), page_number: p2.page_number })),
    }, null, 2));

    // HIDE-ONLY: mark dup with negative page_number but DO NOT re-sequence
    // surviving pages. This preserves citation/bookmark stability (page 300
    // stays 300; if it's a dup, visible pages skip from 299 → 301).
    for (const d of allAccepted) {
      const dup = await db.collection('pages').findOne({ _id: new ObjectId(d.dup_id) }, { projection: { _id: 1, page_number: 1 } });
      if (!dup || dup.page_number <= 0) continue;
      await db.collection('pages').updateOne(
        { _id: dup._id },
        { $set: { is_duplicate: true, duplicate_of: new ObjectId(d.canon_id), original_page_number: dup.page_number, page_number: -Math.abs(dup.page_number), dedup_source: 'reviewed-auto', dedup_method: d.method, updated_at: new Date() } }
      );
    }
    const visible = await db.collection('pages').countDocuments({ book_id: p.book_id, page_number: { $gt: 0 } });
    await db.collection('books').updateOne({ id: p.book_id }, { $set: { pages_count: visible, updated_at: new Date() } });
  }

  // Queue ambiguous for review
  if (ocrAmbiguous.length > 0) {
    const qPath = resolve(REPO_ROOT, '.claude/docs/dedup-review-queue', `${p.book_id}.json`);
    mkdirSync(dirname(qPath), { recursive: true });
    writeFileSync(qPath, JSON.stringify({ book_id: p.book_id, slug: p.slug, items: ocrAmbiguous }, null, 2));
  }

  return { book_id: p.book_id, slug: p.slug, sha: shaDecisions.length, ocr_same: ocrAccepted.length, ocr_ambiguous: ocrAmbiguous.length };
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const files = readdirSync(IN_DIR).filter(f => f.endsWith('.json'));
console.log(`Processing ${files.length} proposal files`);

const summary = [];
for (const f of files) {
  const r = await processBook(db, resolve(IN_DIR, f));
  console.log(`${r.book_id} ${(r.slug || '').slice(0, 50).padEnd(50)} sha=${r.sha} ocr-same=${r.ocr_same} ocr-ambiguous=${r.ocr_ambiguous}${r.error ? ' ERR: ' + r.error : ''}`);
  summary.push(r);
}

const reportPath = resolve(REPO_ROOT, '.claude/docs/dedup-autoapply-report.json');
writeFileSync(reportPath, JSON.stringify({ ts: new Date().toISOString(), summary }, null, 2));
const totals = summary.reduce((a, r) => ({ sha: a.sha + (r.sha || 0), ocrSame: a.ocrSame + (r.ocr_same || 0), ocrAmb: a.ocrAmb + (r.ocr_ambiguous || 0) }), { sha: 0, ocrSame: 0, ocrAmb: 0 });
console.log(`\nTotals: SHA applied=${totals.sha}, OCR vision-confirmed=${totals.ocrSame}, OCR ambiguous (queued)=${totals.ocrAmb}`);
console.log(`Report: ${reportPath}`);

await client.close();
