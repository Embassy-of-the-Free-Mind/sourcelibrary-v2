#!/usr/bin/env node
/**
 * Resolve a SHWEP citation to the PAGE it refers to, inside an edition we hold.
 *
 * A note reads "Cites Iamblichus on animating statues (de myst. 5.83)" and the page
 * then hands the reader a 500-page Latin folio to go find it in. This turns that into
 * a link to the page itself — the difference between a bibliography and a reading room.
 *
 * How: retrieve semantically over the book's own pages (match_pages_in_books, scoped to
 * one book so it scans hundreds of rows, not millions), then VERIFY the candidate page
 * against the real page text before writing a link.
 *
 * The verification step is the whole design. An unverified deep link that lands on the
 * wrong page is a fabricated citation wearing a different hat — the exact failure this
 * codebase is most scarred by (PR #2232). Two rules follow:
 *   1. Verify against Mongo's page text, run through stripEditorialWrappers — NOT the
 *      Supabase `translation` snippet column. That column was written by the old
 *      cleanText and has editorial prose baked in with its tags already gone, and that
 *      prose routinely describes ADJACENT pages ("the previous page focused on…").
 *      Verifying against it would confirm matches for pages that don't hold the passage.
 *   2. No confident answer, no link. The volume-level link stays; nothing is lost.
 *
 * Usage:
 *   node scripts/enrichment/shwep-resolve-loci.mjs [--limit=N] [--dry-run]
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local' });
import { MongoClient, ObjectId } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { stripEditorialWrappers } from '../lib/strip-editorial-wrappers.mjs';

const MODEL = 'gemini-3.1-flash-lite';
const EMBED_MODEL = 'gemini-embedding-2-preview';
const KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
const EMBED_KEY = process.env.GEMINI_API_KEY;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const LIMIT = (() => { const a = argv.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1]) : null; })();
const ROOT = process.cwd();
const sleep = ms => new Promise(r => setTimeout(r, ms));

function readTsData(file, marker) {
  const s = fs.readFileSync(path.join(ROOT, file), 'utf8');
  let body = s.slice(s.indexOf(marker) + marker.length).trim();
  if (body.endsWith(';')) body = body.slice(0, -1);
  return JSON.parse(body.replace(/^(\s*)(\d+):/gm, '$1"$2":').replace(/,(\s*[}\]])/g, '$1'));
}

/** A locus is what makes a note resolvable: a page, a book.chapter, a fragment, a Stephanus number. */
const LOCUS = /\b(p{1,2}\.\s?\w+|frr?\.\s?[\divxlIVXL]|\b[IVXL]+[.,]\s?\d|\b\d+\.\d+|\b\d+[a-e]\b|§|ch(ap)?\.\s?\d)/;

async function embed(text) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${EMBED_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ model: `models/${EMBED_MODEL}`, content: { parts: [{ text }] }, outputDimensionality: 768 }] }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()).embeddings?.[0]?.values || null;
    } catch (e) { if (i === 3) return null; await sleep(2000 * (i + 1)); }
  }
  return null;
}

async function gemini(prompt) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
        signal: AbortSignal.timeout(90000),
      });
      if (!res.ok) throw new Error(String(res.status));
      const txt = (await res.json()).candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
      return JSON.parse(txt);
    } catch (e) { if (i === 2) return null; await sleep(3000 * (i + 1)); }
  }
  return null;
}

/** The subject of the citation, with the locus itself removed — that is what to search for. */
function subjectOf(note) {
  return note
    .replace(/^Cite[sd]?\s+/i, '')
    .replace(/\([^)]*\d[^)]*\)/g, ' ')
    .replace(/\b(p{1,2}\.\s?\w+|frr?\.\s?[\divxlIVXL.,-]+|§\s?\d+)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Which edition should the reader land in? One they can actually read: a book with a
 * translation. Among those prefer a source-language witness (we show original + English
 * side by side), then the earliest.
 */
function pickEdition(held, workLanguage) {
  const readable = held.filter(h => h.translated);
  const pool = readable.length ? readable : held;
  const source = pool.filter(h => (h.language || '').toLowerCase().split(/[-/]/).map(s => s.trim()).includes((workLanguage || '').toLowerCase()));
  return (source.length ? source : pool)[0];
}

async function main() {
  const works = readTsData('src/data/shwep-cited-works.ts', 'SHWEP_CITED_WORKS: ShwepCitedWork[] = ');
  const notes = readTsData('src/data/shwep-work-notes.ts', 'SHWEP_WORK_NOTES: Record<string, string> = ');
  const langs = readTsData('src/data/shwep-work-languages.ts', 'SHWEP_WORK_LANGUAGES: Record<string, string> = ');
  const byKey = new Map(works.map(w => [`${w.author}|${w.work}`, w]));

  const jobs = [];
  for (const [key, note] of Object.entries(notes)) {
    if (!LOCUS.test(note)) continue;
    const [ep, ...rest] = key.split('|');
    const workKey = rest.join('|');
    const w = byKey.get(workKey);
    if (!w || !w.held?.length) continue;
    const edition = pickEdition(w.held, langs[workKey]);
    if (!edition?.id) continue;
    jobs.push({ key, ep, workKey, note, subject: subjectOf(note), edition, work: w });
  }
  console.log(`${jobs.length} notes carry a locus and point at a held work`);

  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  const out = {};
  const stats = { searched: 0, noCandidates: 0, verified: 0, rejected: 0, noText: 0 };
  const slice = LIMIT ? jobs.slice(0, LIMIT) : jobs;

  for (const [i, job] of slice.entries()) {
    stats.searched++;
    const vec = await embed(job.subject);
    if (!vec) { stats.noCandidates++; continue; }

    const { data: pages } = await supabase.rpc('match_pages_in_books', {
      query_embedding: JSON.stringify(vec),
      book_ids: [job.edition.id],
      match_threshold: 0.35,
      match_count: 4,
    });
    if (!pages?.length) { stats.noCandidates++; continue; }

    // Verify against the REAL page text (Mongo), wrapper-stripped — never the Supabase
    // snippet column, whose baked-in editorial prose describes adjacent pages.
    let linked = null;
    // Check several candidates: the verifier is the precision guard, so a wider window
    // buys recall without loosening what gets written.
    for (const cand of pages.slice(0, 3)) {
      const pageDoc = await db.collection('pages').findOne(
        { id: cand.page_id },
        { projection: { id: 1, page_number: 1, 'translation.data': 1, 'ocr.data': 1 } }
      );
      const raw = pageDoc?.translation?.data || pageDoc?.ocr?.data || '';
      if (!raw) { stats.noText++; continue; }
      const text = stripEditorialWrappers(String(raw)).slice(0, 6000);
      if (text.length < 200) { stats.noText++; continue; }

      const verdict = await gemini(`A podcast cited a passage. Decide whether THIS page of THIS edition contains it.

Cited work: ${job.work.author} — ${job.work.work}
What the podcast cites it for: "${job.note}"

Page text (verbatim, from our scan):
"""
${text}
"""

Answer strictly:
- "yes" ONLY if the page's own text visibly discusses that subject matter. The page must contain the passage, not merely be from the right work.
- "no" if it is the right book but the wrong passage, or if you cannot tell.
Default to "no" when uncertain. A wrong link fabricates a citation.

Return JSON: {"contains": true|false, "why": "<8 words>"}`);

      if (verdict?.contains === true) {
        linked = { pageId: cand.page_id, pageNumber: cand.page_number, similarity: Number(cand.similarity.toFixed(3)), why: String(verdict.why || '').slice(0, 60) };
        break;
      }
    }

    if (linked) {
      stats.verified++;
      out[job.key] = { bookId: job.edition.id, slug: job.edition.slug, title: job.edition.title, ...linked };
    } else {
      stats.rejected++;
    }
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${slice.length} — verified ${stats.verified}, rejected ${stats.rejected}`);
  }

  await mongo.close();
  console.log(`\nsearched ${stats.searched} | verified ${stats.verified} | rejected ${stats.rejected} | no candidates ${stats.noCandidates} | no text ${stats.noText}`);

  if (DRY) {
    for (const [k, v] of Object.entries(out).slice(0, 12)) console.log(`  ${k}\n     p.${v.pageNumber} sim=${v.similarity} — ${v.why} — ${v.title?.slice(0, 40)}`);
    return;
  }

  const file = `/**
 * The PAGE a SHWEP citation points at, inside an edition we hold — so a reader lands on
 * the passage instead of the front of a 500-page folio. Keyed "episode|author|work".
 *
 * Every entry was verified against the real page text (Mongo, wrapper-stripped) by a
 * second model pass that was told to default to "no": an unverified deep link is a
 * fabricated citation. Citations that could not be confirmed are simply absent here and
 * fall back to the volume-level link.
 * Generated by scripts/enrichment/shwep-resolve-loci.mjs (${MODEL}).
 */
export interface ShwepResolvedLocus {
  bookId: string;
  slug: string | null;
  title: string;
  pageId: string;
  pageNumber: number;
  similarity: number;
  why: string;
}
export const SHWEP_RESOLVED_LOCI: Record<string, ShwepResolvedLocus> = ${JSON.stringify(out, null, 2)};
`;
  fs.writeFileSync(path.join(ROOT, 'src/data/shwep-resolved-loci.ts'), file);
  console.log(`wrote ${Object.keys(out).length} resolved loci`);
}

await main();
