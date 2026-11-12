/**
 * Target guard for the Study Rooms sims: never production.
 * Used by the config (when BASE_URL is set) and by every fixture.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Throws unless BASE_URL is local, or a host named explicitly in SIMS_ALLOW_HOST. */
export function assertSafeTarget(raw = process.env.BASE_URL): URL {
  if (!raw) {
    throw new Error('Study Rooms sims: set BASE_URL to a local dev server, e.g. BASE_URL=http://localhost:3000');
  }
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (host === 'sourcelibrary.org' || host.endsWith('.sourcelibrary.org') || host === 'sourcelibrary-v2.vercel.app') {
    throw new Error(`Study Rooms sims refuse to run against production (${host}). They write chat, notes and reports.`);
  }
  const allowed = (process.env.SIMS_ALLOW_HOST || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  if (!LOCAL_HOSTS.has(host) && !allowed.includes(host)) {
    throw new Error(
      `Study Rooms sims: ${host} is not local. If it is a server on a non-production database, ` +
        `set SIMS_ALLOW_HOST=${host}.`,
    );
  }
  return url;
}

