import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for the Embassy Librarian module.
 * Tests the search and response generation logic.
 * AI calls are mocked — integration is tested via E2E.
 */

// Per-collection mock registry
const collectionMocks: Record<string, { aggregate: ReturnType<typeof vi.fn>; find: ReturnType<typeof vi.fn> }> = {};

function getMock(name: string) {
  if (!collectionMocks[name]) {
    collectionMocks[name] = {
      aggregate: vi.fn().mockReturnValue({ toArray: () => Promise.resolve([]) }),
      find: vi.fn().mockReturnValue({
        project: () => ({ toArray: () => Promise.resolve([]) }),
        toArray: () => Promise.resolve([]),
      }),
    };
  }
  return collectionMocks[name];
}

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn().mockResolvedValue({
    collection: (name: string) => ({
      aggregate: (...args: any[]) => getMock(name).aggregate(...args),
      find: (...args: any[]) => getMock(name).find(...args),
    }),
  }),
}));

// Mock Gemini
const mockSendMessage = vi.fn();
vi.mock('@/lib/gemini-client', () => ({
  getGeminiClient: () => ({
    getGenerativeModel: () => ({
      startChat: () => ({
        sendMessage: mockSendMessage,
      }),
    }),
  }),
}));

// Mock Atlas Search (returns a simple $match stage for tests)
vi.mock('@/lib/atlas-search', () => ({
  buildPageSearchStage: (query: string) => ({ $match: { 'translation.data': { $regex: query } } }),
  buildBookSearchStage: (query: string) => ({ $match: { title: { $regex: query } } }),
}));

import { searchCorpus, searchBooks, generateLibrarianResponse } from '@/lib/embassy/librarian';

describe('Embassy Librarian', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset all collection mocks
    for (const key of Object.keys(collectionMocks)) {
      delete collectionMocks[key];
    }
  });

  describe('searchCorpus', () => {
    it('returns empty array for empty query', async () => {
      const result = await searchCorpus('');
      expect(result).toEqual([]);
    });

    it('returns empty array for whitespace query', async () => {
      const result = await searchCorpus('   ');
      expect(result).toEqual([]);
    });

    it('searches pages and enriches with book metadata', async () => {
      const mockPages = [
        { book_id: 'book-1', page_number: 42, translation: { data: 'The philosopher stone...' } },
        { book_id: 'book-2', page_number: 7, translation: { data: 'Mercury and sulfur...' } },
      ];
      const mockBooks = [
        { id: 'book-1', title: 'Alchemy Text', author: 'Paracelsus', slug: 'alchemy-text-paracelsus' },
        { id: 'book-2', title: 'Hermetica', display_title: 'The Hermetica', author: 'Hermes', slug: 'hermetica-hermes' },
      ];

      getMock('pages').aggregate.mockReturnValue({ toArray: () => Promise.resolve(mockPages) });
      getMock('books').find.mockReturnValue({
        project: () => ({ toArray: () => Promise.resolve(mockBooks) }),
      });

      const results = await searchCorpus('philosopher stone', 8);

      expect(results).toHaveLength(2);
      expect(results[0].bookTitle).toBe('Alchemy Text');
      expect(results[0].bookAuthor).toBe('Paracelsus');
      expect(results[0].page_number).toBe(42);
      expect(results[1].bookTitle).toBe('The Hermetica'); // display_title preferred
    });

    it('deduplicates pages — max 2 per book', async () => {
      const mockPages = [
        { book_id: 'book-1', page_number: 1, translation: { data: 'A' } },
        { book_id: 'book-1', page_number: 2, translation: { data: 'B' } },
        { book_id: 'book-1', page_number: 3, translation: { data: 'C' } },
        { book_id: 'book-2', page_number: 1, translation: { data: 'D' } },
      ];
      const mockBooks = [
        { id: 'book-1', title: 'Book 1', author: 'Author 1' },
        { id: 'book-2', title: 'Book 2', author: 'Author 2' },
      ];

      getMock('pages').aggregate.mockReturnValue({ toArray: () => Promise.resolve(mockPages) });
      getMock('books').find.mockReturnValue({
        project: () => ({ toArray: () => Promise.resolve(mockBooks) }),
      });

      const results = await searchCorpus('test', 8);

      const book1Pages = results.filter(r => r.book_id === 'book-1');
      expect(book1Pages).toHaveLength(2);
      expect(results).toHaveLength(3);
    });

    it('strips wiki-style markup from text', async () => {
      const mockPages = [
        { book_id: 'book-1', page_number: 1, translation: { data: '[[annotation]]Real text here' } },
      ];
      const mockBooks = [{ id: 'book-1', title: 'Test', author: 'Author' }];

      getMock('pages').aggregate.mockReturnValue({ toArray: () => Promise.resolve(mockPages) });
      getMock('books').find.mockReturnValue({
        project: () => ({ toArray: () => Promise.resolve(mockBooks) }),
      });

      const results = await searchCorpus('test');
      expect(results[0].text).toBe('Real text here');
      expect(results[0].text).not.toContain('[[');
    });
  });

  describe('searchBooks', () => {
    it('returns empty array for empty query', async () => {
      const result = await searchBooks('');
      expect(result).toEqual([]);
    });

    it('returns books with display_title preferred over title', async () => {
      const mockBooks = [
        { id: '1', title: 'Raw Title', display_title: 'Nice Title', author: 'Author', year: 1600, slug: 'nice-title' },
      ];

      getMock('books').aggregate.mockReturnValue({ toArray: () => Promise.resolve(mockBooks) });

      const results = await searchBooks('test');
      expect(results[0].title).toBe('Nice Title');
      expect(results[0].year).toBe(1600);
    });
  });

  describe('generateLibrarianResponse', () => {
    it('returns AI response with sources', async () => {
      const mockPages = [
        { book_id: 'book-1', page_number: 10, translation: { data: 'The emerald tablet teaches...' } },
      ];
      const mockBooks = [
        { id: 'book-1', title: 'Emerald Tablet', author: 'Hermes', slug: 'emerald-tablet' },
      ];

      // Pages search
      getMock('pages').aggregate.mockReturnValue({ toArray: () => Promise.resolve(mockPages) });
      // Books search + book enrichment
      getMock('books').aggregate.mockReturnValue({ toArray: () => Promise.resolve(mockBooks) });
      getMock('books').find.mockReturnValue({
        project: () => ({ toArray: () => Promise.resolve(mockBooks) }),
      });
      // Reading activity (returns empty — no activity)
      getMock('reading_history').aggregate.mockReturnValue({ toArray: () => Promise.resolve([]) });
      // Profiles (empty)
      getMock('embassy_profiles').find.mockReturnValue({
        project: () => ({ toArray: () => Promise.resolve([]) }),
      });

      mockSendMessage.mockResolvedValue({
        response: { text: () => 'The Emerald Tablet is a foundational text...' },
      });

      const result = await generateLibrarianResponse('What is the Emerald Tablet?');

      expect(result.content).toContain('Emerald Tablet');
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].bookTitle).toBe('Emerald Tablet');
    });

    it('includes conversation history in chat', async () => {
      // All empty — no search results, no activity
      getMock('pages').aggregate.mockReturnValue({ toArray: () => Promise.resolve([]) });
      getMock('books').aggregate.mockReturnValue({ toArray: () => Promise.resolve([]) });
      getMock('reading_history').aggregate.mockReturnValue({ toArray: () => Promise.resolve([]) });

      mockSendMessage.mockResolvedValue({
        response: { text: () => 'Continuing our discussion...' },
      });

      const history = [
        { role: 'user' as const, content: 'Tell me about Ficino' },
        { role: 'assistant' as const, content: 'Marsilio Ficino was...' },
      ];

      await generateLibrarianResponse('What did he translate?', history);

      expect(mockSendMessage).toHaveBeenCalledWith('What did he translate?');
    });
  });
});
