// PRIOR ART: tests/integration/embassy-api.test.ts mocks the same three modules with vi.mock; route-bench.ts runs outside vitest, so these are plain module stubs.
// The real shared limiter (same Mongo round trip), under bench-only counter
// names so the bench never touches the production per-IP or daily counters.
import * as real from '../../../../src/lib/rate-limit';
export const getClientIp = real.getClientIp;
export function checkRateLimitShared(config: { name: string; limit: number; windowSeconds: number }, ip: string) {
  return real.checkRateLimitShared({ ...config, name: `bench6904-${config.name}` }, ip);
}
