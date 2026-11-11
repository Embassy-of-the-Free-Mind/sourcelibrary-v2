'use client';

// The leaf facing the one on screen, in a facing-page edition (a Loeb, #8321).
// An original leaf pairs with the next leaf, an English leaf with the previous
// one, under the rule in src/lib/facing-translation.ts. Nothing happens on an
// unflagged book. The partner usually comes from the reader's own prefetch
// cache (useReaderV2 fetches the pages either side); the server seeds the first
// one so the Loeb English is on screen in the first paint, not after a fetch.

import { useEffect, useState } from 'react';
import type { Book, Page } from '@/lib/types';
import { hasPublishedFacingTranslation, isFacingPair, leafRole, type FacingPartner } from '@/lib/facing-translation';

export function useFacingPartner(
  book: Book,
  currentPage: Page,
  pageList: Array<{ id: string; page_number: number }>,
  fetchPage: (id: string) => Promise<Page | null>,
  seed: Page | null | undefined,
): FacingPartner<Page> | null {
  const flagged = hasPublishedFacingTranslation(book);
  const role = flagged ? leafRole(currentPage.ocr?.data) : null;
  const wantedNumber = role ? currentPage.page_number + (role === 'original' ? 1 : -1) : null;
  const entry = wantedNumber == null ? undefined : pageList.find((p) => p.page_number === wantedNumber);
  const seeded = seed && entry && seed.id === entry.id ? seed : null;

  const [fetched, setFetched] = useState<{ forId: string; page: Page | null } | null>(null);
  useEffect(() => {
    if (!entry || seeded) return;
    let cancelled = false;
    fetchPage(entry.id).then((p) => { if (!cancelled) setFetched({ forId: entry.id, page: p }); });
    return () => { cancelled = true; };
  }, [entry, seeded, fetchPage]);

  if (!role || !entry) return null;
  const other = seeded ?? (fetched?.forId === entry.id ? fetched.page : null);
  if (!other) return null;
  const ok = role === 'original' ? isFacingPair(currentPage, other) : isFacingPair(other, currentPage);
  return ok ? { role, page: other } : null;
}
