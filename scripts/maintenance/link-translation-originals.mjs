#!/usr/bin/env node
/**
 * Link each translation book (text_role: modern-translation | period-translation)
 * to the original-language edition we hold — or tag it `original_missing: true`
 * as an acquisition candidate. Phase 2 of issue #2395.
 *
 * Pipeline per book:
 *   1. Gemini extract: who is the original author, what language was the work
 *      written in, what is the original work title? (Translator-as-author
 *      records like "James Legge (trans.)" carry the real author in the title.)
 *   2. Catalog search: visible original-language books matching the original
 *      author (loose surname regex — precision restored in step 3).
 *   3. Gemini adjudication: which candidate (if any) is an edition of the SAME
 *      WORK in its original language?
 *
 * Writes (provenance: original_link_source: 'gemini-v1'):
 *   original_language    — backfilled if absent (from step 1)
 *   original_edition_id  — held original's book id, when matched
 *   original_missing     — true when no held original could be matched
 * Loeb/SBE facing-page books (original_in_scan: true) skip linkage — their
 * original is co-present in the scan — but still get original_language.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/link-translation-originals.mjs --dry-run --limit=10
 *   node scripts/maintenance/link-translation-originals.mjs
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

const MODEL = 'gemini-3.1-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const enLike = v => !v || /^(english|en)$/i.test(String(v).trim());
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gemini(prompt, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      return JSON.parse(text);
    } catch (err) {
      if (i === retries) { console.error(`    gemini failed: ${err.message}`); return null; }
      await sleep(800 * (i + 1));
    }
  }
  return null;
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Distinctive name tokens for a loose catalog search (longest first). */
function nameTokens(name) {
  return (name || '')
    .replace(/\(.*?\)/g, ' ')
    .split(/[\s,;/]+/)
    .filter(t => t.length >= 4 && !/^(pseudo|saint|attr|trans)/i.test(t))
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);

  for (const v of ['MONGODB_URI', 'GEMINI_API_KEY']) {
    if (!process.env[v]) { console.error(`${v} not set.`); process.exit(1); }
  }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const col = client.db('bookstore').collection('books');

  const translations = await col.find(
    { visible: true, text_role: { $in: ['modern-translation', 'period-translation'] } },
    { projection: { _id: 0, id: 1, slug: 1, title: 1, author: 1, year: 1, read_count: 1, original_language: 1, original_in_scan: 1, original_edition_id: 1, original_missing: 1 } },
  ).sort({ read_count: -1 }).toArray();

  const toProcess = limit ? translations.slice(0, limit) : translations;
  console.log(`${translations.length} translation books; processing ${toProcess.length}${dryRun ? ' (DRY RUN)' : ''}\n`);

  let linked = 0, missing = 0, inScan = 0, langBackfilled = 0, reclassified = 0;
  const report = [];

  for (let i = 0; i < toProcess.length; i++) {
    const b = toProcess[i];
    process.stdout.write(`[${i + 1}/${toProcess.length}] ${(b.title || '').slice(0, 50)}... `);

    // 1. Extract the original work's author + language + title — and verify the
    //    book actually IS a translation. The heuristic classifier has false
    //    positives (e.g. an English biography ABOUT Aquinas matches the
    //    classical-author regex); this gate self-heals them back to 'original'.
    const extract = await gemini(
      `This is a catalog record flagged as a possible TRANSLATION of an older work. ` +
      `The scanned text of this edition is in ENGLISH.\n` +
      `Title: ${b.title}\nAuthor field: ${b.author}\nYear of this edition: ${b.year || 'unknown'}\n\n` +
      `First decide: is this book actually an English TRANSLATION of a work originally written in another language? ` +
      `(A biography, study, or commentary ABOUT a classical figure written originally in English is NOT a translation. ` +
      `But an English rendering of a work that was first written in Latin/Greek/etc. IS a translation, even if it keeps the original title.)\n` +
      `Reply JSON: {"is_translation": <true|false>, ` +
      `"original_author": "<personal name of the original author, or null if anonymous/corpus>", ` +
      `"original_language": "<language the work was originally written in, English name e.g. Greek, Latin, Sanskrit>", ` +
      `"original_title": "<title of the work in its original language if known, else null>"}`,
    );
    if (!extract) { console.log('extract failed, skipped'); continue; }

    if (extract.is_translation === false) {
      // Heuristic false positive — reclassify as an English-native original.
      console.log('reclassified → original (not a translation)');
      report.push({ ...b, verdict: 'reclassified-original', orig: extract });
      if (!dryRun) {
        await col.updateOne({ id: b.id }, {
          $set: { text_role: 'original', text_role_source: 'gemini-v1' },
          $unset: { original_missing: '', original_edition_id: '' },
        });
      }
      reclassified++;
      continue;
    }

    const set = { original_link_source: 'gemini-v1' };
    const unset = {};
    if (extract.original_language && !b.original_language) { set.original_language = extract.original_language; langBackfilled++; }

    // Loeb/facing-page: original is in the same scan — no external link needed.
    if (b.original_in_scan) {
      inScan++;
      console.log(`in-scan (${extract.original_language || '?'})`);
      report.push({ ...b, verdict: 'in-scan', orig: extract });
      if (!dryRun) await col.updateOne({ id: b.id }, { $set: set });
      continue;
    }

    // 2. Candidate originals we hold. Author-field matches first (high signal);
    //    title matches only as a fallback — title tokens from the ENGLISH title
    //    (e.g. "Dialogues") pollute the cap and crowd out the real original.
    const candProj = { projection: { _id: 0, id: 1, title: 1, author: 1, language: 1, year: 1 } };
    const candBase = { visible: true, text_role: 'original', language: { $exists: true, $nin: [null, '', 'English', 'english', 'en'] } };
    const authorTokens = nameTokens(extract.original_author || '');
    let candidates = [];
    if (authorTokens.length) {
      const rx = authorTokens.map(t => new RegExp(escapeRegex(t), 'i'));
      // Tier 1: author-field matches (high precision — "Plato" the author, not
      // every book ABOUT Plato). Tier 2: title matches only to fill the pool.
      candidates = await col.find(
        { ...candBase, $or: rx.flatMap(r => [{ author: r }, { normalized_author: r }]) },
        candProj,
      ).limit(25).toArray();
      if (candidates.length < 15) {
        const seen = new Set(candidates.map(c => c.id));
        const more = await col.find({ ...candBase, $or: rx.map(r => ({ title: r })) }, candProj).limit(25).toArray();
        for (const m of more) if (!seen.has(m.id)) candidates.push(m);
      }
    }
    if (candidates.length < 5 && extract.original_title) {
      const rx = nameTokens(extract.original_title).map(t => new RegExp(escapeRegex(t), 'i'));
      if (rx.length) {
        const more = await col.find({ ...candBase, $or: rx.map(r => ({ title: r })) }, candProj).limit(20).toArray();
        const seen = new Set(candidates.map(c => c.id));
        for (const m of more) if (!seen.has(m.id)) candidates.push(m);
      }
    }

    // 3. Adjudicate the work match.
    let matchId = null;
    if (candidates.length) {
      // Return the candidate NUMBER, not the id — flash-lite mangles long
      // hex/UUID ids, and the id-equality validation then silently drops
      // correct matches (bit us on "Dialogues of Plato Vol. 5").
      const verdict = await gemini(
        `A reader is looking at this TRANSLATION:\n  "${b.title}" — ${b.author} (${b.year || '?'})\n` +
        `Original work: ${extract.original_title || '?'} by ${extract.original_author || 'unknown'} in ${extract.original_language || '?'}.\n\n` +
        `Which of these books in our library, if any, is an edition of the SAME WORK in its original language? ` +
        `A collected-works or multi-work edition that CONTAINS the work counts as a match. ` +
        `Same author but a different work is NOT a match.\n` +
        candidates.map((c, j) => `${j + 1}. "${c.title}" — ${c.author} (${c.language}, ${c.year || '?'})`).join('\n') +
        `\n\nIf several candidates contain the work, pick the single most complete match. ` +
        `Reply with ONE JSON object (not an array): {"match_number": <1-based number of the matching book, or null>, "reason": "<one line>"}`,
      );
      // Defensive: the model sometimes returns an array of all valid matches.
      const v = Array.isArray(verdict) ? verdict.find(x => Number(x?.match_number) >= 1) : verdict;
      const n = Number(v?.match_number);
      if (n >= 1 && n <= candidates.length) matchId = candidates[n - 1].id;
    }

    if (matchId) {
      linked++;
      set.original_edition_id = matchId;
      unset.original_missing = '';
      console.log(`LINKED → ${matchId}`);
    } else {
      missing++;
      set.original_missing = true;
      unset.original_edition_id = '';
      console.log(`missing (${candidates.length} candidates, no work match)`);
    }
    report.push({ ...b, verdict: matchId ? 'linked' : 'missing', match: matchId, orig: extract, nCand: candidates.length });

    if (!dryRun) {
      const update = { $set: set };
      if (Object.keys(unset).length) update.$unset = unset;
      await col.updateOne({ id: b.id }, update);
    }
    await sleep(120);
  }

  console.log(`\n--- Summary ---`);
  console.log(`linked to held original: ${linked}`);
  console.log(`original missing (acquisition candidates): ${missing}`);
  console.log(`in-scan (Loeb/SBE): ${inScan}`);
  console.log(`reclassified to original (false positives healed): ${reclassified}`);
  console.log(`original_language backfilled: ${langBackfilled}`);

  // Traffic-ranked report artifact.
  let md = `# Translation → original linkage (${new Date().toISOString().slice(0, 10)})\n\n` +
    `| reads | verdict | translation | original (extracted) | linked id |\n|--|--|--|--|--|\n`;
  for (const r of report) {
    md += `| ${r.read_count || 0} | ${r.verdict} | ${(r.title || '').replace(/\|/g, '/').slice(0, 55)} | ${r.orig?.original_author || '?'} (${r.orig?.original_language || '?'}) | ${r.match || ''} |\n`;
  }
  const out = '.claude/handoffs/2026-06-03-translation-original-linkage.md';
  fs.writeFileSync(out, md);
  console.log(`report: ${out}`);

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
