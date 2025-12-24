import { APIScenario } from '../../types';

export const booksCrudScenario: APIScenario = {
  name: 'Books CRUD Operations',
  agent: 'api',
  tags: ['api', 'books', 'crud'],

  setup: async (ctx) => {
    // Clean up any existing test books from previous runs
    await ctx.db.collection('books').deleteMany({ title: /^TEST_/ });
  },

  steps: [
    {
      name: 'List all books',
      method: 'GET',
      path: '/api/books',
      expect: {
        status: 200,
        body: (data) => Array.isArray(data)
      }
    },
    {
      name: 'Create a new book',
      method: 'POST',
      path: '/api/books',
      body: {
        title: 'TEST_Fons Sapientiae',
        author: 'Anonymous Scholar',
        language: 'Latin',
        published: '1650',
        publisher: 'Test Press',
        place_of_publication: 'Amsterdam'
      },
      expect: {
        status: 201,
        body: (data: any) => {
          if (!data.id) throw new Error('Missing id');
          if (data.title !== 'TEST_Fons Sapientiae') throw new Error('Title mismatch');
          if (data.author !== 'Anonymous Scholar') throw new Error('Author mismatch');
          return true;
        }
      },
      saveAs: 'createdBook'
    },
    {
      name: 'Get book by ID',
      method: 'GET',
      path: (ctx) => `/api/books/${(ctx.saved.createdBook as any).id}`,
      expect: {
        status: 200,
        body: (data: any) => {
          if (data.title !== 'TEST_Fons Sapientiae') throw new Error('Title mismatch');
          return true;
        }
      }
    },
    {
      name: 'Get non-existent book (404)',
      method: 'GET',
      path: '/api/books/000000000000000000000000',
      expect: {
        status: 404
      }
    },
    {
      name: 'Create book without title (400)',
      method: 'POST',
      path: '/api/books',
      body: {
        author: 'Test Author'
        // Missing title
      },
      expect: {
        status: 400
      }
    },
    {
      name: 'Delete the created book',
      method: 'DELETE',
      path: (ctx) => `/api/books/${(ctx.saved.createdBook as any).id}`,
      expect: {
        status: 200,
        body: (data: any) => data.success === true || data.deletedCount > 0
      }
    },
    {
      name: 'Verify book is deleted',
      method: 'GET',
      path: (ctx) => `/api/books/${(ctx.saved.createdBook as any).id}`,
      expect: {
        status: 404
      }
    }
  ],

  teardown: async (ctx) => {
    // Ensure cleanup even if tests fail
    if (ctx.saved.createdBook) {
      const bookId = (ctx.saved.createdBook as any).id;
      await ctx.db.collection('pages').deleteMany({ book_id: bookId });
      await ctx.db.collection('books').deleteOne({ id: bookId });
    }
  }
};
