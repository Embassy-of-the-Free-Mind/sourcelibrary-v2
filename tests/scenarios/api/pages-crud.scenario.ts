import { APIScenario } from '../../types';

export const pagesCrudScenario: APIScenario = {
  name: 'Pages CRUD Operations',
  agent: 'api',
  tags: ['api', 'pages', 'crud'],

  setup: async (ctx) => {
    // Create a test book for page operations
    const book = await ctx.fixtures.createBook({
      title: 'TEST_Pages_Book',
      author: 'Test Author',
      language: 'Latin'
    });
    ctx.saved.testBook = book;

    // Create initial pages
    const page1 = await ctx.fixtures.createPage(book.id, { page_number: 1 });
    const page2 = await ctx.fixtures.createPage(book.id, { page_number: 2 });
    ctx.saved.page1 = page1;
    ctx.saved.page2 = page2;
  },

  steps: [
    {
      name: 'Get book with pages',
      method: 'GET',
      path: (ctx) => `/api/books/${(ctx.saved.testBook as any).id}`,
      expect: {
        status: 200,
        body: (data: any) => {
          if (!data.pages || data.pages.length !== 2) {
            throw new Error(`Expected 2 pages, got ${data.pages?.length}`);
          }
          return true;
        }
      }
    },
    {
      name: 'Get single page',
      method: 'GET',
      path: (ctx) => `/api/pages/${(ctx.saved.page1 as any).id}`,
      expect: {
        status: 200,
        body: (data: any) => {
          if (data.page_number !== 1) throw new Error('Page number mismatch');
          return true;
        }
      }
    },
    {
      name: 'Update page OCR',
      method: 'PATCH',
      path: (ctx) => `/api/pages/${(ctx.saved.page1 as any).id}`,
      body: {
        ocr: {
          data: '[[language: Latin]]\nTest OCR content.\n[[vocabulary: test, content]]',
          language: 'Latin',
          model: 'gemini-2.0-flash'
        }
      },
      expect: {
        status: 200,
        body: (data: any) => {
          if (!data.ocr?.data?.includes('Test OCR content')) {
            throw new Error('OCR update failed');
          }
          return true;
        }
      }
    },
    {
      name: 'Update page translation',
      method: 'PATCH',
      path: (ctx) => `/api/pages/${(ctx.saved.page1 as any).id}`,
      body: {
        translation: {
          data: '[[summary: Test summary]]\nTest translation content.',
          language: 'English',
          model: 'gemini-2.0-flash'
        }
      },
      expect: {
        status: 200,
        body: (data: any) => {
          if (!data.translation?.data?.includes('Test translation')) {
            throw new Error('Translation update failed');
          }
          return true;
        }
      }
    },
    {
      name: 'Delete page and verify renumbering',
      method: 'DELETE',
      path: (ctx) => `/api/pages/${(ctx.saved.page1 as any).id}`,
      expect: {
        status: 200
      }
    },
    {
      name: 'Verify remaining page is renumbered',
      method: 'GET',
      path: (ctx) => `/api/pages/${(ctx.saved.page2 as any).id}`,
      expect: {
        status: 200,
        body: (data: any) => {
          // Page 2 should now be page 1 after deletion
          if (data.page_number !== 1) {
            throw new Error(`Expected page_number 1, got ${data.page_number}`);
          }
          return true;
        }
      }
    }
  ],

  teardown: async (ctx) => {
    if (ctx.saved.testBook) {
      const bookId = (ctx.saved.testBook as any).id;
      await ctx.db.collection('pages').deleteMany({ book_id: bookId });
      await ctx.db.collection('books').deleteOne({ id: bookId });
    }
  }
};
