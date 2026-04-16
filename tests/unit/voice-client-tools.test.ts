import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildClientTools, type SourceResult, type Visual } from '@/lib/voice/client-tools';

// ── Helpers ───────────────────────────────────────────────────────────

function mockFetch(response: { ok?: boolean; status?: number; json?: () => any }) {
  return vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: response.json ?? (() => ({})),
    text: () => Promise.resolve(''),
  });
}

function mockFetchSequence(responses: Array<{ ok?: boolean; status?: number; json?: () => any }>) {
  const fn = vi.fn();
  for (let i = 0; i < responses.length; i++) {
    fn.mockResolvedValueOnce({
      ok: responses[i].ok ?? true,
      status: responses[i].status ?? 200,
      json: responses[i].json ?? (() => ({})),
      text: () => Promise.resolve(''),
    });
  }
  return fn;
}

function setup() {
  const addSources = vi.fn();
  const addVisual = vi.fn();
  const tools = buildClientTools({ addSources, addVisual });
  return { tools, addSources, addVisual };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── search_library ────────────────────────────────────────────────────

describe('search_library', () => {
  it('returns results and calls addSources', async () => {
    const { tools, addSources } = setup();
    vi.stubGlobal('fetch', mockFetch({
      json: () => ({ results: [
        { id: 'b1', title: 'Alchemy Today', author: 'Paracelsus', slug: 'alchemy-today', page_number: 5, snippet: 'Gold from lead' },
        { id: 'b2', title: 'Hermetica', author: 'Hermes', slug: 'hermetica' },
      ] }),
    }));

    const result = JSON.parse(await tools.search_library({ query: 'alchemy' }));
    expect(result.found).toBe(2);
    expect(result.results[0].title).toBe('Alchemy Today');
    expect(addSources).toHaveBeenCalledOnce();
    expect(addSources.mock.calls[0][0]).toHaveLength(2);
  });

  it('returns error on 500', async () => {
    const { tools, addSources } = setup();
    vi.stubGlobal('fetch', mockFetch({ ok: false, status: 500 }));

    const result = JSON.parse(await tools.search_library({ query: 'alchemy' }));
    expect(result.error).toBe('500');
    expect(addSources).not.toHaveBeenCalled();
  });

  it('returns error on network failure', async () => {
    const { tools } = setup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = JSON.parse(await tools.search_library({ query: 'alchemy' }));
    expect(result.error).toContain('network down');
  });

  it('handles empty results', async () => {
    const { tools, addSources } = setup();
    vi.stubGlobal('fetch', mockFetch({ json: () => ({ results: [] }) }));

    const result = JSON.parse(await tools.search_library({ query: 'xyznonexistent' }));
    expect(result.found).toBe(0);
    expect(result.results).toHaveLength(0);
    expect(addSources).toHaveBeenCalledWith([]);
  });

  it('handles missing results field', async () => {
    const { tools } = setup();
    vi.stubGlobal('fetch', mockFetch({ json: () => ({}) }));

    const result = JSON.parse(await tools.search_library({ query: 'alchemy' }));
    expect(result.found).toBe(0);
  });

  it('truncates snippets to 300 chars', async () => {
    const { tools } = setup();
    const longSnippet = 'a'.repeat(500);
    vi.stubGlobal('fetch', mockFetch({
      json: () => ({ results: [{ id: 'b1', title: 'Test', author: 'Author', snippet: longSnippet }] }),
    }));

    const result = JSON.parse(await tools.search_library({ query: 'test' }));
    expect(result.results[0].snippet.length).toBe(300);
  });
});

// ── search_semantic ───────────────────────────────────────────────────

describe('search_semantic', () => {
  it('returns semantic results with nested pages', async () => {
    const { tools, addSources } = setup();
    vi.stubGlobal('fetch', mockFetch({
      json: () => ({ results: [{
        book_id: 'b1', title: 'Corpus Hermeticum', author: 'Hermes', slug: 'corpus',
        pages: [
          { page_number: 10, snippet: 'As above so below' },
          { page_number: 11, snippet: 'The mind of the father' },
        ],
      }] }),
    }));

    const result = JSON.parse(await tools.search_semantic({ query: 'microcosm macrocosm' }));
    expect(result.found).toBe(1);
    expect(addSources).toHaveBeenCalledOnce();
    // Should flatten pages into sources (max 2 per book)
    expect(addSources.mock.calls[0][0]).toHaveLength(2);
    expect(addSources.mock.calls[0][0][0].pageNumber).toBe(10);
  });

  it('falls back to keyword search on timeout', async () => {
    const { tools, addSources } = setup();
    vi.stubGlobal('fetch', mockFetchSequence([
      // First call (semantic) — throw abort error
      { ok: false, status: 500, json: () => { throw new Error('aborted'); } },
      // Second call (keyword fallback) — succeeds
      { json: () => ({ results: [{ id: 'b1', title: 'Fallback Book', author: 'Author', slug: 'fallback' }] }) },
    ]));
    // Make the first fetch reject
    const fn = vi.fn()
      .mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => ({ results: [{ id: 'b1', title: 'Fallback', author: 'A', slug: 's' }] }) });
    vi.stubGlobal('fetch', fn);

    const result = JSON.parse(await tools.search_semantic({ query: 'alchemy' }));
    expect(result.found).toBe(1);
    expect(result.results[0].title).toBe('Fallback');
    // First call was semantic, second was keyword
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[1][0]).toContain('/api/search?');
  });

  it('returns error when both paths fail', async () => {
    const { tools } = setup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('everything is down')));

    const result = JSON.parse(await tools.search_semantic({ query: 'alchemy' }));
    expect(result.error).toContain('everything is down');
  });

  it('falls back on non-ok status', async () => {
    const { tools } = setup();
    const fn = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => ({ results: [{ id: 'b1', title: 'FB', author: 'A' }] }) });
    vi.stubGlobal('fetch', fn);

    const result = JSON.parse(await tools.search_semantic({ query: 'test' }));
    expect(result.found).toBe(1);
  });
});

// ── read_page ─────────────────────────────────────────────────────────

describe('read_page', () => {
  it('returns translation text and adds visual', async () => {
    const { tools, addVisual } = setup();
    vi.stubGlobal('fetch', mockFetch({
      json: () => ({ pages: [{
        page_number: 42,
        translation: { data: 'The philosopher stone transforms all metals.' },
        compressed_photo: 'https://images.example.com/page42.jpg',
      }] }),
    }));

    const result = JSON.parse(await tools.read_page({ book_id: 'b1', page_number: 42 }));
    expect(result.text).toContain('philosopher stone');
    expect(result.hasTranslation).toBe(true);
    expect(result.pageNumber).toBe(42);
    expect(addVisual).toHaveBeenCalledOnce();
    expect(addVisual.mock.calls[0][0].url).toBe('https://images.example.com/page42.jpg');
    expect(addVisual.mock.calls[0][0].type).toBe('page');
  });

  it('falls back to OCR when no translation', async () => {
    const { tools } = setup();
    vi.stubGlobal('fetch', mockFetch({
      json: () => ({ pages: [{
        page_number: 10,
        ocr: { data: 'Lapis philosophorum est...' },
        archived_photo: 'https://images.example.com/p10.jpg',
      }] }),
    }));

    const result = JSON.parse(await tools.read_page({ book_id: 'b1', page_number: 10 }));
    expect(result.text).toContain('Lapis philosophorum');
    expect(result.hasTranslation).toBe(false);
  });

  it('does not add visual when no image URL', async () => {
    const { tools, addVisual } = setup();
    vi.stubGlobal('fetch', mockFetch({
      json: () => ({ pages: [{ page_number: 1, translation: { data: 'Text only' } }] }),
    }));

    await tools.read_page({ book_id: 'b1', page_number: 1 });
    expect(addVisual).not.toHaveBeenCalled();
  });

  it('returns error on 404', async () => {
    const { tools } = setup();
    vi.stubGlobal('fetch', mockFetch({ ok: false, status: 404 }));

    const result = JSON.parse(await tools.read_page({ book_id: 'nonexistent', page_number: 1 }));
    expect(result.error).toBe('404');
  });

  it('truncates text to 2000 chars', async () => {
    const { tools } = setup();
    vi.stubGlobal('fetch', mockFetch({
      json: () => ({ pages: [{ page_number: 1, translation: { data: 'x'.repeat(5000) } }] }),
    }));

    const result = JSON.parse(await tools.read_page({ book_id: 'b1', page_number: 1 }));
    expect(result.text.length).toBe(2000);
  });
});

// ── search_images ─────────────────────────────────────────────────────

describe('search_images', () => {
  it('returns images and adds visuals', async () => {
    const { tools, addVisual } = setup();
    vi.stubGlobal('fetch', mockFetch({
      json: () => ({ results: [
        { imageUrl: 'https://img.example.com/1.jpg', title: 'Alchemical furnace', author: 'Fludd', subjects: ['alchemy', 'furnace'] },
        { fullImageUrl: 'https://img.example.com/2.jpg', description: 'Tree of life', author: 'Kircher' },
      ] }),
    }));

    const result = JSON.parse(await tools.search_images({ query: 'furnace' }));
    expect(result.found).toBe(2);
    expect(addVisual).toHaveBeenCalledTimes(2);
    // First image uses imageUrl
    expect(addVisual.mock.calls[0][0].url).toBe('https://img.example.com/1.jpg');
    // Second uses fullImageUrl
    expect(addVisual.mock.calls[1][0].url).toBe('https://img.example.com/2.jpg');
  });

  it('skips images without any URL field', async () => {
    const { tools, addVisual } = setup();
    vi.stubGlobal('fetch', mockFetch({
      json: () => ({ results: [
        { title: 'No URL image', author: 'Unknown' },
        { imageUrl: 'https://img.example.com/valid.jpg', title: 'Valid' },
      ] }),
    }));

    await tools.search_images({ query: 'test' });
    expect(addVisual).toHaveBeenCalledOnce();
    expect(addVisual.mock.calls[0][0].url).toBe('https://img.example.com/valid.jpg');
  });

  it('handles empty results', async () => {
    const { tools, addVisual } = setup();
    vi.stubGlobal('fetch', mockFetch({ json: () => ({ results: [] }) }));

    const result = JSON.parse(await tools.search_images({ query: 'nothing' }));
    expect(result.found).toBe(0);
    expect(addVisual).not.toHaveBeenCalled();
  });

  it('returns error on API failure', async () => {
    const { tools } = setup();
    vi.stubGlobal('fetch', mockFetch({ ok: false, status: 503 }));

    const result = JSON.parse(await tools.search_images({ query: 'test' }));
    expect(result.error).toBe('503');
  });
});

// ── baseUrl support ───────────────────────────────────────────────────

describe('baseUrl (standalone app)', () => {
  it('prepends baseUrl to fetch calls', async () => {
    const addSources = vi.fn();
    const addVisual = vi.fn();
    const tools = buildClientTools({ addSources, addVisual, baseUrl: 'https://sourcelibrary.org' });
    const fn = mockFetch({ json: () => ({ results: [] }) });
    vi.stubGlobal('fetch', fn);

    await tools.search_library({ query: 'test' });
    expect(fn.mock.calls[0][0]).toContain('https://sourcelibrary.org/api/search');
  });
});
