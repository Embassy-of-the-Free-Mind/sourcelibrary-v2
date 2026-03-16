import { initBotId } from 'botid/client/core';

// Protect high-value API routes from bot scraping.
// BotID runs an invisible client-side challenge and attaches headers
// to requests matching these paths. Basic mode (free) logs only;
// Deep Analysis ($1/1k calls) would actively classify.
initBotId({
  protect: [
    // Gallery browsing — primary scrape target
    { path: '/api/gallery', method: 'GET' },
    { path: '/api/gallery/*', method: 'GET' },
    // Image proxy — expensive Sharp processing
    { path: '/api/crop-image', method: 'GET' },
    { path: '/api/image', method: 'GET' },
    // Likes — was causing rate limit storms
    { path: '/api/likes', method: 'GET' },
    { path: '/api/likes', method: 'POST' },
    // Search
    { path: '/api/search', method: 'GET' },
    // Book data
    { path: '/api/books/*', method: 'GET' },
  ],
});
