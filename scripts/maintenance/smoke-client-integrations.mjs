#!/usr/bin/env node

/**
 * Smoke-test client-requested integrations.
 *
 * Usage (minimal):
 *   node scripts/maintenance/smoke-client-integrations.mjs \
 *     --tenant-slug=bph \
 *     --tenant-id=<tenant-uuid> \
 *     --query=astrology
 *
 * Usage (with explicit book):
 *   node scripts/maintenance/smoke-client-integrations.mjs \
 *     --tenant-slug=bph \
 *     --tenant-id=<tenant-uuid> \
 *     --book-key=<book-id-or-slug> \
 *     --query=astrology
 *
 * Optional auth:
 *   --cron-secret=<secret>
 *   --admin-cookie="next-auth.session-token=..."
 *   --superadmin-cookie="next-auth.session-token=..."
 *
 * Optional options:
 *   --base-url=https://sourcelibrary.org
 *   --skip-global
 *
 * Env fallbacks (already exported in shell):
 *   BASE_URL, TENANT_SLUG, TENANT_ID, BOOK_KEY, SEARCH_QUERY,
 *   ADMIN_COOKIE, SUPERADMIN_COOKIE, CRON_SECRET
 *
 * Note: If --book-key is omitted, script auto-discovers one via search.
 */

function getArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function logPass(name, detail) {
  console.log(`PASS: ${name} - ${detail}`);
}

function logFail(name, detail) {
  console.log(`FAIL: ${name} - ${detail}`);
}

function logInfo(detail) {
  console.log(`INFO: ${detail}`);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function getConfig() {
  return {
    baseUrl: (getArg('base-url') || process.env.BASE_URL || 'https://sourcelibrary.org').replace(/\/+$/, ''),
    tenantSlug: getArg('tenant-slug') || process.env.TENANT_SLUG || '',
    tenantId: getArg('tenant-id') || process.env.TENANT_ID || '',
    bookKey: getArg('book-key') || process.env.BOOK_KEY || '',
    query: getArg('query') || process.env.SEARCH_QUERY || 'astrology',
    adminCookie: getArg('admin-cookie') || process.env.ADMIN_COOKIE || '',
    superadminCookie: getArg('superadmin-cookie') || process.env.SUPERADMIN_COOKIE || '',
    cronSecret: getArg('cron-secret') || process.env.CRON_SECRET || '',
    skipGlobal: hasFlag('skip-global'),
  };
}

function validateRequired(config) {
  const missing = [];
  if (!config.tenantSlug) missing.push('--tenant-slug or TENANT_SLUG');
  if (!config.tenantId) missing.push('--tenant-id or TENANT_ID');
  return missing;
}

async function requestJson(url, headers = {}) {
  const response = await fetch(url, { method: 'GET', headers, redirect: 'manual' });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

function getTenantHeaders(config) {
  return {
    'x-tenant-slug': config.tenantSlug,
    'x-tenant-id': config.tenantId,
  };
}

function getTenantAuthHeaders(config) {
  if (config.cronSecret) {
    return { Authorization: `Bearer ${config.cronSecret}` };
  }
  if (config.adminCookie) {
    return { Cookie: config.adminCookie };
  }
  return null;
}

function getGlobalAuthHeaders(config) {
  if (config.cronSecret) {
    return { Authorization: `Bearer ${config.cronSecret}` };
  }
  if (config.superadminCookie) {
    return { Cookie: config.superadminCookie };
  }
  return null;
}

async function discoverBookFromSearch(config) {
  try {
    const authHeaders = getTenantAuthHeaders(config);
    const url = `${config.baseUrl}/api/search?q=${encodeURIComponent(config.query)}&limit=1`;
    const headers = { ...getTenantHeaders(config) };
    if (authHeaders) Object.assign(headers, authHeaders);
    const r = await requestJson(url, headers);
    if (r.status === 200 && r.json?.results && r.json.results[0]) {
      return r.json.results[0].id;
    }
  } catch (err) {
    logInfo(`Auto-discover failed: ${err.message}`);
  }
  return null;
}

async function run() {
  const config = getConfig();
  const missing = validateRequired(config);

  if (missing.length > 0) {
    missing.forEach((item) => logFail('Config', `Missing ${item}`));
    process.exit(1);
  }

  logInfo(`Base URL: ${config.baseUrl}`);
  logInfo(`Tenant slug: ${config.tenantSlug}`);
  logInfo(`Tenant id: ${config.tenantId}`);
  logInfo(`Book key: ${config.bookKey}`);
  logInfo(`Search query: ${config.query}`);
  logInfo(`Tenant auth mode: ${config.cronSecret ? 'cron-secret' : (config.adminCookie ? 'admin-cookie' : 'none')}`);
  logInfo(`Global auth mode: ${config.cronSecret ? 'cron-secret' : (config.superadminCookie ? 'superadmin-cookie' : 'none')}`);
  console.log('');

  let pass = 0;
  let fail = 0;

  // 1) Tenant stats
  try {
    const authHeaders = getTenantAuthHeaders(config);
    if (!authHeaders) {
      throw new Error('Provide --admin-cookie/ADMIN_COOKIE or --cron-secret/CRON_SECRET');
    }

    const r = await requestJson(`${config.baseUrl}/api/platform/stats`, {
      ...getTenantHeaders(config),
      ...authHeaders,
    });

    const valid =
      r.status === 200
      && r.json
      && r.json.scope === 'tenant'
      && isFiniteNumber(r.json.totalItems)
      && isFiniteNumber(r.json.translatedTexts)
      && isFiniteNumber(r.json.languageCount);

    if (valid) {
      logPass('Tenant stats', `items=${r.json.totalItems}, translated=${r.json.translatedTexts}, languages=${r.json.languageCount}`);
      pass += 1;
    } else {
      logFail('Tenant stats', `Expected 200 + tenant numeric fields, got status=${r.status}`);
      fail += 1;
    }
  } catch (error) {
    logFail('Tenant stats', error.message || String(error));
    fail += 1;
  }

  // 2) Global stats
  if (!config.skipGlobal) {
    try {
      const authHeaders = getGlobalAuthHeaders(config);
      if (!authHeaders) {
        throw new Error('Provide --superadmin-cookie/SUPERADMIN_COOKIE or --cron-secret/CRON_SECRET');
      }

      const r = await requestJson(`${config.baseUrl}/api/platform/stats?global=true`, authHeaders);

      const valid =
        r.status === 200
        && r.json
        && r.json.scope === 'global'
        && Array.isArray(r.json.perTenant);

      if (valid) {
        logPass('Global stats', `tenants=${r.json.perTenant.length}`);
        pass += 1;
      } else {
        logFail('Global stats', `Expected 200 + global scope + perTenant array, got status=${r.status}`);
        fail += 1;
      }
    } catch (error) {
      logFail('Global stats', error.message || String(error));
      fail += 1;
    }
  } else {
    logInfo('Skipping global stats (--skip-global).');
  }

  // 3) Item lookup by ID or slug
  try {
    let bookKey = config.bookKey;
    if (!bookKey) {
      logInfo('Book key not provided, auto-discovering from search...');
      bookKey = await discoverBookFromSearch(config);
      if (!bookKey) {
        throw new Error('Could not auto-discover a book from search results');
      }
      logInfo(`Auto-discovered book: ${bookKey}`);
    }

    const r = await requestJson(`${config.baseUrl}/api/books/${encodeURIComponent(bookKey)}`, getTenantHeaders(config));

    const valid =
      r.status === 200
      && r.json
      && typeof r.json.title === 'string'
      && typeof r.json.author === 'string'
      && typeof r.json.language === 'string'
      && Array.isArray(r.json.pages);

    if (valid) {
      const bookLink = `/${config.tenantSlug}/book/${r.json.slug || r.json.id || bookKey}`;
      logPass('Item lookup', `title="${r.json.title}", pages=${r.json.pages.length}, link=${bookLink}`);
      pass += 1;
    } else {
      logFail('Item lookup', `Expected 200 + title/author/language/pages, got status=${r.status}`);
      fail += 1;
    }
  } catch (error) {
    logFail('Item lookup', error.message || String(error));
    fail += 1;
  }

  // 4) Collection areas
  try {
    const r = await requestJson(`${config.baseUrl}/api/collection-areas`, getTenantHeaders(config));

    const valid =
      r.status === 200
      && r.json
      && Array.isArray(r.json.areas)
      && r.json.areas.every((area) => typeof area.name === 'string' && isFiniteNumber(area.count));

    if (valid) {
      logPass('Collection areas', `areas=${r.json.areas.length}`);
      pass += 1;
    } else {
      logFail('Collection areas', `Expected 200 + areas[name,count], got status=${r.status}`);
      fail += 1;
    }
  } catch (error) {
    logFail('Collection areas', error.message || String(error));
    fail += 1;
  }

  // 5) Search URL query param check
  try {
    const url = `${config.baseUrl}/${config.tenantSlug}/search?q=${encodeURIComponent(config.query)}`;
    const r = await requestJson(url);

    if ([200, 307, 308].includes(r.status)) {
      logPass('Search query URL', `status=${r.status}, url=/${config.tenantSlug}/search?q=${encodeURIComponent(config.query)}`);
      pass += 1;
    } else {
      logFail('Search query URL', `Expected 200/307/308, got status=${r.status}`);
      fail += 1;
    }
  } catch (error) {
    logFail('Search query URL', error.message || String(error));
    fail += 1;
  }

  // 6) Catalogue URL informational check
  try {
    const url = `${config.baseUrl}/${config.tenantSlug}/catalogue?q=${encodeURIComponent(config.query)}`;
    const r = await requestJson(url);

    if (r.status === 200) {
      logInfo(`Catalogue URL is available: /${config.tenantSlug}/catalogue?q=${encodeURIComponent(config.query)}`);
    } else {
      logInfo(`Catalogue URL status=${r.status}; recommend /${config.tenantSlug}/search?q=${encodeURIComponent(config.query)}`);
    }
  } catch (error) {
    logInfo(`Catalogue URL check failed: ${error.message || String(error)}`);
  }

  console.log('');
  console.log(`Summary: PASS=${pass} FAIL=${fail}`);

  process.exit(fail > 0 ? 1 : 0);
}

run().catch((error) => {
  logFail('Fatal', error.message || String(error));
  process.exit(1);
});
