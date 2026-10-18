// PRIOR ART: tests/integration/embassy-api.test.ts mocks the same three modules with vi.mock; route-bench.ts runs outside vitest, so these are plain module stubs.
// No model: the bench measures the time to the threadId event only.
export async function* streamAgenticResponse() { /* nothing */ }
