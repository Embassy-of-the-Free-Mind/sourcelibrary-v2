#!/usr/bin/env node
/**
 * Upgrade a passage link from "a page about this" to "the page he cited" — or admit it
 * is only the former.
 *
 * shwep-resolve-loci.mjs verified that a page DISCUSSES the cited subject. It never
 * checked that the page is the cited LOCUS. Those differ: the same subject can appear in
 * a preface, an index, a commentary, or a summary, and "Read the cited passage" claims
 * more than a subject match earns.
 *
 * Early modern and 19th-century editions carry their own structural markers in the scan —
 * running headers ("ODYSSEY. BOOK T."), chapter headings ("Chapter III"), Stephanus
 * numbers, marginal section numbers (<margin>5</margin>). Where those markers place the
 * page at the cited locus, the claim becomes checkable rather than inferred.
 *
 * Writes `locus: "confirmed" | "subject"` back onto each resolved locus. The render
 * downgrades its wording for "subject", so nothing on the page asserts a locus we did
 * not confirm.
 *
 * Usage: node scripts/enrichment/shwep-confirm-loci.mjs [--limit=N]
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local' });
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { stripEditorialWrappers } from '../lib/strip-editorial-wrappers.mjs';

const MODEL = 'gemini-3.1-flash-lite';
const KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
const ROOT = process.cwd();
const LIMIT = (() => { const a = process.argv.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1]) : null; })();
const sleep = ms => new Promise(r => setTimeout(r, ms));

function readTsData(file, marker) {
  const s = fs.readFileSync(path.join(ROOT, file), 'utf8');
  let body = s.slice(s.indexOf(marker) + marker.length).trim();
  if (body.endsWith(';')) body = body.slice(0, -1);
  return JSON.parse(body.replace(/^(\s*)(\d+):/gm, '$1"$2":').replace(/,(\s*[}\]])/g, '$1'));
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
      return JSON.parse((await res.json()).candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '');
    } catch { if (i === 2) return null; await sleep(3000 * (i + 1)); }
  }
  return null;
}

async function main() {
  const src = fs.readFileSync(path.join(ROOT, 'src/data/shwep-resolved-loci.ts'), 'utf8');
  const head = src.slice(0, src.indexOf('= {') + 2);
  const loci = JSON.parse(src.slice(src.indexOf('= {') + 2, src.lastIndexOf('};') + 1));
  const notes = readTsData('src/data/shwep-work-notes.ts', 'SHWEP_WORK_NOTES: Record<string, string> = ');

  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  const keys = Object.keys(loci).slice(0, LIMIT || undefined);
  let confirmed = 0, subject = 0;

  for (const [i, key] of keys.entries()) {
    const v = loci[key];
    const note = notes[key] || '';
    const page = await db.collection('pages').findOne(
      { id: v.pageId },
      { projection: { 'translation.data': 1, 'ocr.data': 1 } }
    );
    // Keep the raw text here: <margin>, <header> and <page-num> are REAL page marks, not
    // editorial wrappers, and they are exactly the evidence this check needs.
    const raw = String(page?.translation?.data || page?.ocr?.data || '');
    const text = raw.slice(0, 4000);
    if (!text) { loci[key] = { ...v, locus: 'subject' }; subject++; continue; }

    const verdict = await gemini(`A podcast cited a specific locus in a classical work. Decide whether THIS page of an edition we hold is at that locus.

The citation: "${note}"
Cited work: ${key.split('|').slice(1).join(', ')}

Page text, including its own structural marks (running headers, chapter headings,
marginal numbers, page numbers) exactly as scanned:
"""
${text}
"""

Answer "confirmed" ONLY if a structural mark ON THE PAGE places it at, or inside, the
cited locus — e.g. the citation is Book 19 and the running header reads "BOOK XIX" or
"BOOK T"; the citation is III.2 and the page heads "Chapter III"; the citation is a
Stephanus number that appears in the margin. Roman, Greek and Arabic numerals all count.
Answer "subject" if the page merely discusses the same matter, if the marks are absent,
or if you are unsure. Default to "subject".

Return JSON: {"verdict": "confirmed"|"subject", "mark": "<the mark you used, or ''>"}`);

    if (verdict?.verdict === 'confirmed') {
      loci[key] = { ...v, locus: 'confirmed', mark: String(verdict.mark || '').slice(0, 40) };
      confirmed++;
    } else {
      loci[key] = { ...v, locus: 'subject' };
      subject++;
    }
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${keys.length} — confirmed ${confirmed}, subject-only ${subject}`);
  }

  await mongo.close();
  const patchedHead = head
    .replace('  similarity: number;\n  why: string;', '  similarity: number;\n  why: string;\n  /** "confirmed" = a structural mark on the page places it at the cited locus. */\n  locus?: "confirmed" | "subject";\n  /** The mark used to confirm, e.g. a running header. */\n  mark?: string;');
  fs.writeFileSync(path.join(ROOT, 'src/data/shwep-resolved-loci.ts'), patchedHead + JSON.stringify(loci, null, 2) + ';\n');
  console.log(`\nconfirmed ${confirmed} | subject-only ${subject}`);
}

await main();
