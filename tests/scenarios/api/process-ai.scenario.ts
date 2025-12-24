import { APIScenario, TestContext } from '../../types';

export const processAIScenario: APIScenario = {
  name: 'AI Processing (OCR/Translation/Summary)',
  agent: 'api',
  tags: ['api', 'ai', 'gemini', 'slow', 'expensive'],

  setup: async (ctx) => {
    // Create a test book with a real image for OCR testing
    const book = await ctx.fixtures.createBook({
      title: 'TEST_AI_Processing',
      author: 'Test Author',
      language: 'Latin'
    });

    // Use a real manuscript image from Internet Archive for testing
    const page = await ctx.fixtures.createPage(book.id, {
      page_number: 1,
      photo: 'https://archive.org/download/bub_gb_EcAUAAAAQAAJ/page/n7/full/pct:50/0/default.jpg'
    });

    ctx.saved.testBook = book;
    ctx.saved.testPage = page;
  },

  steps: [
    {
      name: 'Run OCR on page',
      method: 'POST',
      path: '/api/process',
      body: (ctx: TestContext) => ({
        pageId: (ctx.saved.testPage as any).id,
        action: 'ocr',
        imageUrl: (ctx.saved.testPage as any).photo,
        language: 'Latin',
        autoSave: true,
        model: 'gemini-2.0-flash'
      }),
      timeout: 120000, // 2 minutes for AI processing
      expect: {
        status: 200,
        body: (data: any, ctx) => {
          if (!data.ocr) throw new Error('No OCR result returned');
          if (data.ocr.length < 50) {
            ctx.warnings.push('OCR output unusually short');
          }

          // Validate OCR structure - should have language tag
          const hasLanguageTag = /\[\[language:/i.test(data.ocr);
          if (!hasLanguageTag) {
            ctx.warnings.push('OCR missing [[language:]] tag');
          }

          // Store for next step
          ctx.saved.ocrOutput = data.ocr;
          return true;
        }
      },
      saveAs: 'ocrResult'
    },
    {
      name: 'Run Translation on OCR result',
      method: 'POST',
      path: '/api/process',
      body: (ctx: TestContext) => ({
        pageId: (ctx.saved.testPage as any).id,
        action: 'translation',
        ocrText: ctx.saved.ocrOutput as string,
        language: 'Latin',
        targetLanguage: 'English',
        autoSave: true,
        model: 'gemini-2.0-flash'
      }),
      timeout: 120000,
      expect: {
        status: 200,
        body: (data: any, ctx) => {
          if (!data.translation) throw new Error('No translation result returned');
          if (data.translation.length < 30) {
            ctx.warnings.push('Translation output unusually short');
          }

          // Translation should contain English words
          const englishPatterns = [/\bthe\b/i, /\band\b/i, /\bis\b/i, /\bof\b/i];
          const hasEnglish = englishPatterns.some(p => p.test(data.translation));
          if (!hasEnglish) {
            ctx.warnings.push('Translation may not be in English');
          }

          ctx.saved.translationOutput = data.translation;
          return true;
        }
      },
      saveAs: 'translationResult'
    },
    {
      name: 'Run Summary on translation',
      method: 'POST',
      path: '/api/process',
      body: (ctx: TestContext) => ({
        pageId: (ctx.saved.testPage as any).id,
        action: 'summary',
        translatedText: ctx.saved.translationOutput as string,
        autoSave: true,
        model: 'gemini-2.0-flash'
      }),
      timeout: 60000,
      expect: {
        status: 200,
        body: (data: any, ctx) => {
          if (!data.summary) throw new Error('No summary result returned');

          // Summary should be shorter than translation
          const translationLen = (ctx.saved.translationOutput as string).length;
          if (data.summary.length > translationLen) {
            ctx.warnings.push('Summary longer than translation');
          }

          return true;
        }
      }
    },
    {
      name: 'Verify page was updated with all results',
      method: 'GET',
      path: (ctx) => `/api/pages/${(ctx.saved.testPage as any).id}`,
      expect: {
        status: 200,
        body: (data: any) => {
          if (!data.ocr?.data) throw new Error('Page OCR not saved');
          if (!data.translation?.data) throw new Error('Page translation not saved');
          if (!data.summary?.data) throw new Error('Page summary not saved');

          // Verify model was recorded
          if (data.ocr.model !== 'gemini-2.0-flash') {
            throw new Error('OCR model not recorded');
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
