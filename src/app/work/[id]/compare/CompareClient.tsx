'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Chapter {
  title: string;
  titleEn?: string;
  pageNumber: number;
  level: number;
}

interface Edition {
  id: string;
  slug: string;
  title: string;
  display_title?: string;
  author: string;
  published: string;
  language: string;
  pages_count: number;
  pages_translated: number;
  chapters: Chapter[];
}

interface PageText {
  page_number: number;
  ocr?: string;
  translation?: string;
}

interface CompareClientProps {
  editions: Edition[];
  allEditions: Edition[];
  workId: string;
}

export default function CompareClient({ editions, allEditions, workId }: CompareClientProps) {
  // Default: pick the first two translated editions
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    editions.slice(0, Math.min(2, editions.length)).map((e) => e.id)
  );
  const [showPicker, setShowPicker] = useState(false);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [pageTexts, setPageTexts] = useState<Record<string, PageText[]>>({});
  const [loading, setLoading] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  const selectedEditions = editions.filter((e) => selectedIds.includes(e.id));

  // Use the first selected edition's chapter list as the navigation source
  const primaryEdition = selectedEditions[0];
  const chapters = primaryEdition?.chapters || [];
  const currentChapter = chapters[chapterIndex];

  // Fetch chapter text for all selected editions
  const fetchTexts = useCallback(async () => {
    if (!currentChapter || selectedIds.length === 0) return;
    setLoading(true);

    const results: Record<string, PageText[]> = {};

    await Promise.all(
      selectedIds.map(async (bookId) => {
        const edition = editions.find((e) => e.id === bookId);
        if (!edition) return;

        // Find the matching chapter in this edition
        const matchIdx = findMatchingChapter(edition.chapters, currentChapter);
        const chapter = matchIdx >= 0 ? edition.chapters[matchIdx] : null;

        if (!chapter) {
          results[bookId] = [];
          return;
        }

        // Determine page range for this chapter
        const nextChapter = edition.chapters[matchIdx + 1];
        const fromPage = chapter.pageNumber;
        const toPage = nextChapter
          ? nextChapter.pageNumber - 1
          : Math.min(fromPage + 15, edition.pages_count); // cap at 15 pages

        try {
          const res = await fetch(
            `/api/books/${bookId}/text?content=both&from=${fromPage}&to=${toPage}&format=json`
          );
          if (res.ok) {
            const data = await res.json();
            results[bookId] = (data.pages || []).map((p: { page_number: number; ocr?: string; translation?: string }) => ({
              page_number: p.page_number,
              ocr: p.ocr,
              translation: p.translation,
            }));
          } else {
            results[bookId] = [];
          }
        } catch {
          results[bookId] = [];
        }
      })
    );

    setPageTexts(results);
    setLoading(false);
  }, [selectedIds, currentChapter, editions]);

  useEffect(() => {
    fetchTexts();
  }, [fetchTexts]);

  const toggleEdition = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.length > 1 ? prev.filter((x) => x !== id) : prev;
      }
      if (prev.length >= 4) return prev; // max 4
      return [...prev, id];
    });
  };

  return (
    <div className="prose-content max-w-none">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-4 mb-8">
        {/* Edition picker toggle */}
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="text-sm border border-stone-300 rounded-lg px-3 py-1.5 text-stone-600 hover:border-stone-400 transition-colors"
        >
          {selectedEditions.length} edition{selectedEditions.length !== 1 ? 's' : ''} selected
          <span className="ml-1 text-stone-400">{showPicker ? '▲' : '▼'}</span>
        </button>

        {/* Chapter navigator */}
        {chapters.length > 0 && (
          <select
            value={chapterIndex}
            onChange={(e) => setChapterIndex(Number(e.target.value))}
            className="text-sm border border-stone-300 rounded-lg px-3 py-1.5 text-stone-600 bg-white max-w-md truncate"
          >
            {chapters.map((ch, i) => (
              <option key={i} value={i}>
                {ch.titleEn || ch.title}
              </option>
            ))}
          </select>
        )}

        {/* Original toggle */}
        <button
          onClick={() => setShowOriginal(!showOriginal)}
          className="ml-auto text-xs text-stone-400 hover:text-stone-600 transition-colors border border-stone-200 rounded-full px-3 py-1"
        >
          {showOriginal ? 'Hide original' : 'Show original'}
        </button>

        {/* Back link */}
        <Link
          href={`/work/${workId}`}
          className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
        >
          Back to work
        </Link>
      </div>

      {/* Edition picker panel */}
      {showPicker && (
        <div className="mb-8 p-4 border border-stone-200 rounded-xl bg-white">
          <p className="text-xs text-stone-400 mb-3">
            Select up to 4 editions to compare (at least 1 required)
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {allEditions.map((edition) => {
              const isSelected = selectedIds.includes(edition.id);
              const hasTranslation = edition.pages_translated > 0;
              return (
                <button
                  key={edition.id}
                  onClick={() => hasTranslation && toggleEdition(edition.id)}
                  disabled={!hasTranslation}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    isSelected
                      ? 'border-amber-700/40 bg-amber-50/50'
                      : hasTranslation
                        ? 'border-stone-200 hover:border-stone-300'
                        : 'border-stone-100 opacity-40 cursor-not-allowed'
                  }`}
                >
                  <div className="text-sm font-medium text-stone-700 truncate">
                    {edition.display_title || edition.title}
                  </div>
                  <div className="text-xs text-stone-400 mt-0.5">
                    {edition.language} &middot; {edition.published}
                    {!hasTranslation && ' · not yet translated'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Chapter title */}
      {currentChapter && (
        <h2 className="text-lg font-medium text-stone-700 mb-6">
          {currentChapter.titleEn || currentChapter.title}
        </h2>
      )}

      {/* Loading state */}
      {loading && (
        <div className="text-center py-12 text-stone-400 text-sm">
          Loading passages...
        </div>
      )}

      {/* Comparison columns */}
      {!loading && (
        <div
          className={`grid gap-4 ${
            selectedEditions.length === 2
              ? 'md:grid-cols-2'
              : selectedEditions.length === 3
                ? 'lg:grid-cols-3'
                : selectedEditions.length === 4
                  ? 'lg:grid-cols-2 xl:grid-cols-4'
                  : ''
          }`}
        >
          {selectedEditions.map((edition) => {
            const pages = pageTexts[edition.id] || [];
            const combinedTranslation = pages
              .map((p) => p.translation)
              .filter(Boolean)
              .join('\n\n');
            const combinedOcr = pages
              .map((p) => p.ocr)
              .filter(Boolean)
              .join('\n\n');
            const cleanText = (text: string) =>
              text.replace(/<[^>]+>/g, '').replace(/^(Continuity from.*?\n)/gm, '').trim();
            const pageRange = pages.length > 0
              ? `pp. ${pages[0].page_number}–${pages[pages.length - 1].page_number}`
              : '';

            return (
              <div
                key={edition.id}
                className="border border-stone-200 rounded-xl p-5 bg-white"
              >
                {/* Edition header */}
                <div className="text-xs text-stone-400 uppercase tracking-wider mb-3 flex items-center justify-between">
                  <span>
                    {edition.language} ({edition.published})
                  </span>
                  {pageRange && (
                    <Link
                      href={`/book/${edition.slug}?page=${pages[0]?.page_number || 1}`}
                      className="text-amber-700/60 hover:text-amber-700 transition-colors normal-case tracking-normal"
                    >
                      {pageRange} &rarr;
                    </Link>
                  )}
                </div>

                {/* Edition title */}
                <div className="text-xs text-stone-500 mb-3 truncate">
                  {edition.display_title || edition.title}
                </div>

                {/* Original text */}
                {showOriginal && combinedOcr && (
                  <div className="mb-4 pb-4 border-b border-stone-100">
                    <p className="text-sm leading-relaxed text-stone-500 font-serif whitespace-pre-line max-h-96 overflow-y-auto">
                      {cleanText(combinedOcr).substring(0, 3000)}
                    </p>
                  </div>
                )}

                {/* Translation */}
                {combinedTranslation ? (
                  <p className="text-sm leading-relaxed text-stone-700 font-body whitespace-pre-line max-h-96 overflow-y-auto">
                    {cleanText(combinedTranslation).substring(0, 3000)}
                  </p>
                ) : (
                  <p className="text-sm text-stone-400 italic">
                    No matching chapter found in this edition
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Chapter navigation */}
      {chapters.length > 1 && (
        <div className="flex justify-between mt-8">
          <button
            onClick={() => setChapterIndex(Math.max(0, chapterIndex - 1))}
            disabled={chapterIndex === 0}
            className="text-sm text-stone-500 hover:text-stone-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            &larr; Previous chapter
          </button>
          <span className="text-xs text-stone-400">
            {chapterIndex + 1} / {chapters.length}
          </span>
          <button
            onClick={() => setChapterIndex(Math.min(chapters.length - 1, chapterIndex + 1))}
            disabled={chapterIndex === chapters.length - 1}
            className="text-sm text-stone-500 hover:text-stone-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Next chapter &rarr;
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Find the best-matching chapter in a target edition's chapter list.
 * Uses normalized title comparison (case-insensitive, ignoring numbering).
 */
function findMatchingChapter(targetChapters: Chapter[], sourceChapter: Chapter): number {
  if (targetChapters.length === 0) return -1;

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/^(chapter|tractate|tractatus|book|sermon|discourse)\s*[\divxlc.:]+\s*/i, '')
      .replace(/[^a-z\s]/g, '')
      .trim();

  const sourceTitle = normalize(sourceChapter.titleEn || sourceChapter.title);

  let bestIdx = -1;
  let bestScore = 0;

  for (let i = 0; i < targetChapters.length; i++) {
    const targetTitle = normalize(targetChapters[i].titleEn || targetChapters[i].title);
    const score = jaccardSimilarity(sourceTitle, targetTitle);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  // Require at least 0.3 similarity to count as a match
  return bestScore >= 0.3 ? bestIdx : -1;
}

/**
 * Jaccard similarity on word sets.
 */
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(/\s+/).filter(Boolean));
  const setB = new Set(b.split(/\s+/).filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}
