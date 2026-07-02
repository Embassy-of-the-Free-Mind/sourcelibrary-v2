'use client';

import { useEffect, useState } from 'react';
import { MARCIANUS_BOOK_ID, type PairedEditionResponse } from '@/lib/marcianus-overlay.shared';

export type PairedEdition = NonNullable<PairedEditionResponse['paired']>;

/**
 * Fetch the aligned critical edition (Berthelot & Ruelle) for a Marcianus 299
 * folio, so the reader can render it as the text of record IN the normal
 * Original/Translation columns. Returns null for any other book or unaligned
 * folio. Reader navigation is client-side, so this re-fetches per page.
 *
 * See .claude/docs/edition-facsimile-pairing.md.
 */
export function usePairedEdition(
  bookId: string,
  pageId: string,
  pageNumber?: number | null,
): PairedEdition | null {
  const [paired, setPaired] = useState<PairedEdition | null>(null);

  useEffect(() => {
    // Only the registered manuscript has an overlay. book id is stable for the
    // life of a reader session, so no synchronous clear is needed here.
    if (bookId !== MARCIANUS_BOOK_ID) return;
    const ctrl = new AbortController();
    const params = new URLSearchParams();
    if (pageId) params.set('pageId', pageId);
    if (pageNumber != null) params.set('page', String(pageNumber));

    fetch(`/api/books/${encodeURIComponent(bookId)}/paired-edition?${params.toString()}`, {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : { paired: null }))
      .then((data: PairedEditionResponse) => setPaired(data.paired))
      .catch((err) => {
        if (err?.name !== 'AbortError') setPaired(null);
      });

    return () => ctrl.abort();
  }, [bookId, pageId, pageNumber]);

  return paired;
}
