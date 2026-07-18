import { Db } from 'mongodb';
import { supabase } from './supabase';
import { getQueryEmbedding } from './semantic-search';
import { getNextApiKey } from './gemini-client';

// Two-stage identification (issue #3193): cheap retrieval channels propose
// candidates (CLIP crop-index + gallery-description text match), then a single
// multimodal Gemini call compares the visitor's photo against the candidate
// thumbnails and either confirms one match or honestly declines. Benchmarked
// 2026-07-18: rerank over the union of both channels resolved 23-24/24
// simulated wall photos vs 14-17/24 for any single retrieval path.

export interface IdentifyCandidate {
  /** clip_embeddings id ('gallery-<pageId>-<idx>', 'artwork-<bookId>', 'cover-<bookId>') or raw gallery id */
  id: string;
  source: 'clip' | 'text';
  sourceType: 'gallery_image' | 'artwork' | 'book_cover';
  bookId: string;
  galleryId?: string; // '<pageId>-<detectionIndex>' when sourceType is gallery_image
  thumbnailUrl: string;
  similarity: number;
  title?: string;
  author?: string;
}

export interface ConfirmedMatch {
  book_id: string;
  book_slug?: string;
  book_title?: string;
  book_author?: string;
  gallery_image_id?: string;
  page_id?: string;
  page_number?: number;
  description?: string;
  image_url: string;
  read_url: string;
  gallery_url?: string;
  source_type: string;
}

interface GalleryTextMatch {
  id: string;
  page_id: string;
  book_id: string;
  detection_index: number;
  similarity: number;
}

/**
 * Text-retrieval channel: embed a visual description of the photo and match it
 * against the museum descriptions in gallery_text_embeddings.
 */
export async function getGalleryCandidatesByText(queryText: string, limit = 10): Promise<IdentifyCandidate[]> {
  if (!queryText.trim()) return [];
  const embedding = await getQueryEmbedding(queryText);
  if (!embedding) return [];

  const { data, error } = await supabase.rpc('match_gallery_text', {
    query_embedding: JSON.stringify(embedding),
    match_threshold: 0.2,
    match_count: limit,
  }).abortSignal(AbortSignal.timeout(8000));
  if (error || !data) return [];

  return (data as GalleryTextMatch[]).map(m => ({
    id: `gallery-${m.id}`,
    source: 'text' as const,
    sourceType: 'gallery_image' as const,
    bookId: m.book_id,
    galleryId: m.id,
    thumbnailUrl: '', // filled from gallery_images by hydrateCandidates
    similarity: m.similarity,
  }));
}

/**
 * Fill thumbnails + provenance from gallery_images for gallery candidates and
 * drop candidates whose book is not publicly visible.
 */
export async function hydrateCandidates(db: Db, candidates: IdentifyCandidate[]): Promise<Map<string, {
  thumbnail_url?: string; page_id?: string; page_number?: number; description?: string;
  book_title?: string; book_author?: string; book_visible?: boolean;
}>> {
  const galleryIds = [...new Set(candidates.filter(c => c.galleryId).map(c => c.galleryId as string))];
  const docs = galleryIds.length
    ? await db.collection('gallery_images')
      .find(
        { id: { $in: galleryIds } },
        { projection: { id: 1, thumbnail_url: 1, extracted_url: 1, image_url: 1, page_id: 1, page_number: 1, description: 1, book_title: 1, book_author: 1, book_visible: 1 }, maxTimeMS: 5000 },
      )
      .toArray()
      .catch(() => [])
    : [];
  const map = new Map<string, { thumbnail_url?: string; page_id?: string; page_number?: number; description?: string; book_title?: string; book_author?: string; book_visible?: boolean }>();
  for (const d of docs) {
    map.set(d.id as string, {
      thumbnail_url: (d.thumbnail_url || d.extracted_url || d.image_url) as string | undefined,
      page_id: d.page_id as string | undefined,
      page_number: d.page_number as number | undefined,
      description: d.description as string | undefined,
      book_title: d.book_title as string | undefined,
      book_author: d.book_author as string | undefined,
      book_visible: d.book_visible as boolean | undefined,
    });
  }
  return map;
}

/**
 * Visual verification: one Gemini call comparing the visitor photo against
 * candidate thumbnails. Returns the confirmed candidate, or null when no
 * candidate is the same work (the model is instructed to decline rather than
 * guess — critical for museum use, where a confident wrong answer is worse
 * than none).
 */
export async function rerankByVisualComparison(
  photoBase64: string,
  photoMime: string,
  candidates: IdentifyCandidate[],
): Promise<{ picked: IdentifyCandidate | null; sure: boolean; error?: string; thumbsFetched?: number } | null> {
  if (candidates.length === 0) return { picked: null, sure: false, error: 'no_candidates' };

  // Fetch candidate thumbnails in parallel; skip any that fail.
  const thumbs = await Promise.all(candidates.map(async c => {
    if (!c.thumbnailUrl) return null;
    try {
      const res = await fetch(c.thumbnailUrl, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 3 * 1024 * 1024) return null; // keep the rerank request small
      return { candidate: c, base64: buf.toString('base64'), mime: res.headers.get('content-type') || 'image/jpeg' };
    } catch {
      return null;
    }
  }));
  const kept = thumbs.filter((t): t is NonNullable<typeof t> => t !== null);
  if (kept.length === 0) return { picked: null, sure: false, error: 'no_thumbnails_fetched' };

  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [
    {
      text: `The FIRST image is a visitor's photograph of an artwork, print, or book illustration (possibly on a wall, framed, at an angle, or a page in a physical book). The following ${kept.length} numbered images are candidate matches from a library catalog. Identify which candidate shows THE SAME work — the same plate, engraving, painting, or illustration — allowing for photo distortion, framing, cropping, and differences between print states or copies. A candidate that merely depicts a similar subject is NOT the same work. Return JSON only: {"best": <candidate number 1-${kept.length}, or null if no candidate is the same work>, "sure": true|false}`,
    },
    { inline_data: { mime_type: photoMime, data: photoBase64 } },
  ];
  kept.forEach((t, i) => {
    parts.push({ text: `Candidate ${i + 1}:` }, { inline_data: { mime_type: t.mime, data: t.base64 } });
  });

  try {
    const apiKey = getNextApiKey();
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.1 } }),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return { picked: null, sure: false, thumbsFetched: kept.length, error: `gemini_${resp.status}:${body.slice(0, 120)}` };
    }
    const data = await resp.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('');
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const parsed = JSON.parse((jsonMatch?.[1] || text).trim());
    const idx = typeof parsed.best === 'number' ? parsed.best - 1 : -1;
    const picked = idx >= 0 && idx < kept.length ? kept[idx].candidate : null;
    return { picked, sure: !!parsed.sure, thumbsFetched: kept.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[identify] rerank failed:', msg);
    return { picked: null, sure: false, thumbsFetched: kept.length, error: `rerank_call:${msg.slice(0, 120)}` };
  }
}
