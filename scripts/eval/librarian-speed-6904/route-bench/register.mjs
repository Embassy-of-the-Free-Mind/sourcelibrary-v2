// PRIOR ART: tests/integration/embassy-api.test.ts mocks the same three modules with vi.mock; route-bench.ts runs outside vitest, so these are plain module stubs.
// Synchronous hooks (Node >= 22.15) so they apply to the require() calls tsx
// compiles the route into, not only to ESM imports.
import { registerHooks } from 'node:module';
import { resolve } from './hooks.mjs';
registerHooks({ resolve: (specifier, context, next) => resolve(specifier, context, next) });
