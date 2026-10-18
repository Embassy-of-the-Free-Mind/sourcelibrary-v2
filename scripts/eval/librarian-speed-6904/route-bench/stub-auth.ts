// PRIOR ART: tests/integration/embassy-api.test.ts mocks the same three modules with vi.mock; route-bench.ts runs outside vitest, so these are plain module stubs.
// Anonymous visitor: the path that runs both rate limits.
export async function auth() { return null; }
