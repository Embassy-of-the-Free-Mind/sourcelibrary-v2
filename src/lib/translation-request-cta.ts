function isNonEmptyText(value?: string | null) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasExistingTranslationContent({
  translationText,
  translationData,
  translationUpdatedAt,
  modernizedText,
}: {
  translationText?: string | null;
  translationData?: string | null;
  translationUpdatedAt?: string | Date | null;
  modernizedText?: string | null;
}) {
  return (
    isNonEmptyText(translationText) ||
    isNonEmptyText(translationData) ||
    isNonEmptyText(modernizedText) ||
    Boolean(translationUpdatedAt)
  );
}

export function shouldShowTranslationRequestCta({
  ocrText,
  translationText,
  translationData,
  translationUpdatedAt,
  modernizedText,
  bookPagesTranslated,
  bookPagesCount,
  bookLanguage,
}: {
  ocrText?: string | null;
  translationText?: string | null;
  translationData?: string | null;
  translationUpdatedAt?: string | Date | null;
  modernizedText?: string | null;
  bookPagesTranslated?: number | null;
  bookPagesCount?: number | null;
  /** The book's own language. An English book has nothing to translate into. */
  bookLanguage?: string | null;
}) {
  if (!isNonEmptyText(ocrText)) return false;
  // 2,447 public books are already in English. Offering to translate one is
  // nonsense to the reader and a wasted queue slot if anyone takes it up.
  if ((bookLanguage || '').toLowerCase().startsWith('english')) return false;
  if (hasExistingTranslationContent({ translationText, translationData, translationUpdatedAt, modernizedText })) {
    return false;
  }

  const translatedPages = Number(bookPagesTranslated ?? 0);
  const totalPages = Number(bookPagesCount ?? 0);
  if (totalPages > 0 && translatedPages >= totalPages) return false;
  if (totalPages > 0 && translatedPages / totalPages >= 0.9) return false;

  return true;
}
