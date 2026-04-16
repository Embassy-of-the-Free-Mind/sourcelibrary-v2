/**
 * Voice agent client tools — called by ElevenLabs Conversational AI
 * in the user's browser. Each tool calls a Source Library API endpoint
 * and returns JSON for the agent to speak about.
 *
 * Search fallback chain:
 *   search_semantic → /api/search/semantic (Supabase, 8s timeout)
 *                   → /api/search (Atlas keyword fallback)
 *   search_library  → /api/search (Atlas keyword, 10s timeout)
 */

export interface SourceResult {
  bookId: string;
  title: string;
  author: string;
  slug?: string;
  pageNumber?: number;
  snippet?: string;
}

export interface Visual {
  type: 'image' | 'page';
  url: string;
  title: string;
  caption?: string;
  bookSlug?: string;
  pageNumber?: number;
}

interface ToolCallbacks {
  addSources: (s: SourceResult[]) => void;
  addVisual: (v: Visual) => void;
  baseUrl?: string; // for standalone app (cross-origin), empty string for same-origin
}

function log(tool: string, msg: string, ms?: number) {
  const timing = ms !== undefined ? ` (${Math.round(ms)}ms)` : '';
  console.log(`[voice-agent] ${tool}:${timing} ${msg}`);
}

export function buildClientTools({ addSources, addVisual, baseUrl = '' }: ToolCallbacks) {
  return {
    search_library: async ({ query }: { query: string }): Promise<string> => {
      const t0 = performance.now();
      log('search_library', `searching "${query}"`);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(query)}&limit=8&has_translation=true`, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) {
          log('search_library', `error ${res.status}`, performance.now() - t0);
          return JSON.stringify({ error: `${res.status}` });
        }
        const data = await res.json();
        const results = (data.results || []).slice(0, 6);
        addSources(results.map((r: any) => ({
          bookId: r.id || r.bookId, title: r.title || r.bookTitle, author: r.author || r.bookAuthor,
          slug: r.slug || r.bookSlug, pageNumber: r.pageNumber || r.page_number, snippet: r.snippet,
        })));
        log('search_library', `${results.length} results`, performance.now() - t0);
        return JSON.stringify({ found: results.length, results: results.map((r: any) => ({
          title: r.title || r.bookTitle, author: r.author || r.bookAuthor, year: r.year,
          bookId: r.id || r.bookId, slug: r.slug || r.bookSlug,
          pageNumber: r.pageNumber || r.page_number, snippet: (r.snippet || '').slice(0, 300),
        })) });
      } catch (e) {
        log('search_library', `failed: ${e}`, performance.now() - t0);
        return JSON.stringify({ error: String(e) });
      }
    },

    search_semantic: async ({ query }: { query: string }): Promise<string> => {
      const t0 = performance.now();
      log('search_semantic', `searching "${query}"`);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(`${baseUrl}/api/search/semantic?q=${encodeURIComponent(query)}&limit=8`, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        const results = (data.results || []).slice(0, 6);
        const sources: SourceResult[] = [];
        for (const r of results) for (const p of (r.pages || []).slice(0, 2))
          sources.push({ bookId: r.book_id, title: r.title, author: r.author, slug: r.slug, pageNumber: p.page_number, snippet: p.snippet });
        addSources(sources);
        log('search_semantic', `${results.length} results (semantic)`, performance.now() - t0);
        return JSON.stringify({ found: results.length, results: results.map((r: any) => ({
          title: r.title, author: r.author, bookId: r.book_id, slug: r.slug,
          topPage: r.pages?.[0]?.page_number, snippet: (r.pages?.[0]?.snippet || '').slice(0, 300),
        })) });
      } catch (e) {
        const reason = String(e).includes('abort') ? 'timeout' : String(e);
        log('search_semantic', `primary failed (${reason}), falling back to keyword`, performance.now() - t0);
        const t1 = performance.now();
        try {
          const res = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(query)}&limit=8&has_translation=true&search_content=true`);
          if (!res.ok) return JSON.stringify({ error: `${res.status}` });
          const data = await res.json();
          const results = (data.results || []).slice(0, 6);
          addSources(results.map((r: any) => ({
            bookId: r.id || r.bookId, title: r.title || r.bookTitle, author: r.author || r.bookAuthor,
            slug: r.slug || r.bookSlug, pageNumber: r.pageNumber || r.page_number, snippet: r.snippet,
          })));
          log('search_semantic', `${results.length} results (keyword fallback)`, performance.now() - t1);
          return JSON.stringify({ found: results.length, results: results.map((r: any) => ({
            title: r.title || r.bookTitle, author: r.author || r.bookAuthor,
            bookId: r.id || r.bookId, slug: r.slug || r.bookSlug,
            pageNumber: r.pageNumber || r.page_number, snippet: (r.snippet || '').slice(0, 300),
          })) });
        } catch (e2) {
          log('search_semantic', `both paths failed: ${e2}`, performance.now() - t1);
          return JSON.stringify({ error: String(e2) });
        }
      }
    },

    read_page: async ({ book_id, page_number }: { book_id: string; page_number: number }): Promise<string> => {
      const t0 = performance.now();
      log('read_page', `book=${book_id} page=${page_number}`);
      try {
        const res = await fetch(`${baseUrl}/api/books/${book_id}/pages?page=${page_number}`);
        if (!res.ok) {
          log('read_page', `error ${res.status}`, performance.now() - t0);
          return JSON.stringify({ error: `${res.status}` });
        }
        const data = await res.json();
        const page = data.pages?.[0] || data;
        const text = page.translation?.data || page.ocr?.data || '';
        const source = page.translation?.data ? 'translation' : 'ocr';
        const imageUrl = page.compressed_photo || page.archived_photo || page.photo;
        if (imageUrl) {
          addVisual({ type: 'page', url: imageUrl, title: `Page ${page.page_number || page_number}`,
            caption: text.slice(0, 120) + (text.length > 120 ? '...' : ''), pageNumber: page.page_number || page_number });
        }
        log('read_page', `${source} ${text.length} chars${imageUrl ? ' +image' : ''}`, performance.now() - t0);
        return JSON.stringify({ text: text.slice(0, 2000), pageNumber: page.page_number || page_number, hasTranslation: source === 'translation' });
      } catch (e) {
        log('read_page', `failed: ${e}`, performance.now() - t0);
        return JSON.stringify({ error: String(e) });
      }
    },

    search_images: async ({ query }: { query: string }): Promise<string> => {
      const t0 = performance.now();
      log('search_images', `searching "${query}"`);
      try {
        const res = await fetch(`${baseUrl}/api/search/visual?q=${encodeURIComponent(query)}&limit=6`);
        if (!res.ok) {
          log('search_images', `error ${res.status}`, performance.now() - t0);
          return JSON.stringify({ error: `${res.status}` });
        }
        const data = await res.json();
        const images = (data.results || data.images || []).slice(0, 6);
        let visualCount = 0;
        for (const img of images) {
          const url = img.imageUrl || img.fullImageUrl || img.image_url;
          if (url) {
            addVisual({ type: 'image', url, title: img.title || img.description || 'Illustration',
              caption: img.author, bookSlug: img.bookSlug || img.slug });
            visualCount++;
          }
        }
        log('search_images', `${images.length} results, ${visualCount} with images`, performance.now() - t0);
        return JSON.stringify({ found: images.length, images: images.map((img: any) => ({
          description: (img.title || img.description || '').slice(0, 200),
          bookTitle: img.book_title || img.title, subjects: img.subjects?.slice(0, 5),
        })) });
      } catch (e) {
        log('search_images', `failed: ${e}`, performance.now() - t0);
        return JSON.stringify({ error: String(e) });
      }
    },
  };
}
