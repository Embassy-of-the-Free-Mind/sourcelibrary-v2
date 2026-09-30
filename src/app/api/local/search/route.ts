/**
 * Search inside one book, offline. Local mode only — backs the desk reader's ⌘K drawer.
 *
 * A plain case- and accent-insensitive substring scan over the book's own page
 * file (`~/sl-corpus/books/<id>.jsonl`), in both the transcription and the
 * translation. A book is at most a few MB, so a scan is milliseconds and needs no
 * index. Whole-library questions are the librarian daemon's job (sl-ask on
 * 127.0.0.1:8766), which this build does not wire in; the drawer says so.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { isLocalMode, corpusDir, isSafeRef } from '@/lib/local-mode/config';
import { findLocalBook } from '@/lib/local-mode/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_HITS = 40;

/** Fold case and strip combining marks, so "aetna" finds "Ætna"-less "Aetna" and "é" finds "e". */
function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Tags out, whitespace collapsed — a snippet must read as text, not markup. */
function plain(s: string): string {
  return s
    .replace(/<(scan-quality|language|lang|script|page-type|sig|page-num|vocab|meta|summary|keywords|columns|image-desc|detected-images)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/->|<-/g, ' ')
    .replace(/<\/?[a-z-]+[^>]*>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function snippet(text: string, at: number, len: number): string {
  const start = Math.max(0, at - 70);
  const end = Math.min(text.length, at + len + 90);
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}

export async function GET(request: Request) {
  if (!isLocalMode()) return new NextResponse('Not found', { status: 404 });

  const url = new URL(request.url);
  const bookRef = url.searchParams.get('book') || '';
  const q = (url.searchParams.get('q') || '').trim();
  if (!isSafeRef(bookRef) || q.length < 2 || q.length > 200) {
    return NextResponse.json({ hits: [], total: 0 });
  }

  const book = findLocalBook(bookRef);
  if (!book) return NextResponse.json({ hits: [], total: 0 });

  let raw: string;
  try {
    raw = fs.readFileSync(path.join(corpusDir(), 'books', `${book.id}.jsonl`), 'utf8');
  } catch {
    return NextResponse.json({ hits: [], total: 0 });
  }

  const needle = fold(q);
  const hits: Array<{ page: number; field: 'original' | 'translation'; snippet: string }> = [];
  let total = 0;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let d: { p?: string | number; ocr?: string; tr?: string };
    try { d = JSON.parse(line); } catch { continue; }
    const page = typeof d.p === 'number' ? d.p : Number.parseInt(String(d.p ?? ''), 10);
    if (!Number.isFinite(page)) continue;
    // Translation first: most readers ask in English.
    for (const [field, value] of [['translation', d.tr], ['original', d.ocr]] as const) {
      if (!value) continue;
      const text = plain(value);
      // Folding can change length (NFD), so search the folded text and slice the
      // folded text too; a snippet with its accents stripped is an acceptable cost.
      const folded = fold(text);
      const at = folded.indexOf(needle);
      if (at === -1) continue;
      total++;
      if (hits.length < MAX_HITS) hits.push({ page, field, snippet: snippet(folded === text.toLowerCase() ? text : folded, at, needle.length) });
      break; // one hit per page is enough to send the reader there
    }
  }

  hits.sort((a, b) => a.page - b.page);
  return NextResponse.json({ hits, total });
}
