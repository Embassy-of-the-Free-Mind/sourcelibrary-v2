// PRIOR ART: tests/integration/embassy-api.test.ts mocks the same three modules with vi.mock; route-bench.ts runs outside vitest, so these are plain module stubs.
// Resolve hook for route-bench.ts: swap auth and the model for bench stubs
// everywhere, and inside the chat route (old and new copies) the rate-limit
// counter names.
const STUBS = {
  '@/lib/auth': new URL('./stub-auth.ts', import.meta.url).href,
  '@/lib/embassy/librarian': new URL('./stub-librarian.ts', import.meta.url).href,
  '@/lib/rate-limit': new URL('./stub-rate-limit.ts', import.meta.url).href,
};
export function resolve(specifier, context, next) {
  const routeOnly = specifier === '@/lib/rate-limit';
  if (STUBS[specifier] && (!routeOnly || /\/api\/embassy\/chat\/route/.test(context.parentURL ?? ''))) {
    return { url: STUBS[specifier], shortCircuit: true };
  }
  return next(specifier, context);
}
