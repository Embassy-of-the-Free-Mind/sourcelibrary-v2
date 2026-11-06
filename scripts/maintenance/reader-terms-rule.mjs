#!/usr/bin/env node
/**
 * The Cloudflare rule that asks a browser opening a deep book page cold to agree
 * to the terms once (#8286). The app half is src/lib/reader-terms.ts.
 *
 * PRIOR ART: none for managing a rule from the repo. Cloudflare rules are otherwise
 * edited by hand through the API (.claude/docs/invariants/crawler-access-gate.md,
 * .claude/docs/crawl-register.md), and I looked in scripts/maintenance/ for cf- and
 * waf- names. This one is scripted because the expression and the page have to stay
 * in step with the cookie names in reader-terms.ts, and because turning it off fast
 * must not depend on remembering them.
 *
 * It is a custom rule (phase http_request_firewall_custom), because the zone's
 * CF_API_TOKEN cannot write redirect rules, and that suits it: it runs before the
 * cache, sits after the skip rules so verified crawlers, link previews and assistant
 * fetchers pass, and shows the form on the URL the visitor asked for.
 *
 *   node --env-file=.env.production.local scripts/maintenance/reader-terms-rule.mjs --status
 *   ... --test   Only requests carrying the header x-sl-terms-test: 1 are asked.
 *   ... --on     Everyone the expression matches is asked.
 *   ... --off    Nobody is asked. This is the rollback.
 *
 * After any change, test with a known-good and a known-bad client, and judge it by
 * traffic: a rule can read "enabled" and never fire (crawler-access-gate.md).
 */

const REF = 'reader_terms_deep_page';
const DESCRIPTION = 'Ask once for terms: cold browser arrival on a deep book page (#8286)';
const TEST_GUARD = 'any(http.request.headers["x-sl-terms-test"][*] eq "1")';

const PATHS = ['', '/es', '/la', '/nl', '/zh']
  .map((prefix) => `http.request.uri.path wildcard "${prefix}/book/*/page/*"`)
  .join(' or ');

export const EXPRESSION = [
  'http.host eq "sourcelibrary.org"',
  'http.request.method eq "GET"',
  `(${PATHS})`,
  'not http.request.uri.path contains "opengraph-image"',
  // Cloudflare: a test on an absent header never matches, so test the names, in lower case.
  'not any(http.request.headers.names[*] eq "referer")',
  'not http.cookie contains "sl_terms="',
  'not http.cookie contains "sl_cite="',
  'not http.cookie contains "authjs.session-token"',
  'not http.user_agent contains "sourcelibrary-"',
].join(' and ');

// Cloudflare limits a custom response's size; check the length printed by --status.
export const PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Before you read - Source Library</title><style>body{font:18px/1.5 Georgia,serif;background:#faf8f3;color:#2c2620;margin:0;padding:48px 16px}main{max-width:520px;margin:auto}a{color:#8b4a2b}label{display:block;margin:24px 0}button{font:inherit;padding:10px 20px;background:#2c2620;color:#fff;border:0;border-radius:6px;cursor:pointer}small{display:block;margin-top:32px;color:#6b6258}</style><main><h1>Before you read</h1><p>Source Library is free to read, study, teach from and quote. You opened this page directly, so we ask once per browser that you agree to our <a href="/terms#reading-terms">terms of use</a>.</p><p>In short: copying the library or a large part of it by automated means needs our written permission.</p><form method="post" action="/api/terms/accept"><input type="hidden" name="next" id="n"><label><input type="checkbox" name="agree" required> I agree to the terms of use</label><button>Continue to the page</button></form><small>We record the date, the page, your browser's description of itself and a hash of your network address. Is something wrong? <a href="mailto:team@sourcelibrary.org">team@sourcelibrary.org</a></small></main><script>document.getElementById('n').value=location.pathname+location.search</script></html>`;

const zone = process.env.CLOUDFLARE_ZONE_ID || process.env.CF_ZONE_ID;
const token = process.env.CF_API_TOKEN;
const mode = process.argv[2];

async function cf(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const body = await res.json();
  if (!body.success) throw new Error(`${res.status} ${JSON.stringify(body.errors)}`);
  return body.result;
}

function ruleBody(enabled, expression) {
  return {
    ref: REF,
    description: DESCRIPTION,
    action: 'block',
    enabled,
    expression,
    action_parameters: { response: { status_code: 403, content_type: 'text/html', content: PAGE } },
  };
}

async function main() {
  if (!['--status', '--test', '--on', '--off'].includes(mode)) {
    throw new Error('Use --status, --test, --on or --off.');
  }
  if (!zone || !token) throw new Error('CF_API_TOKEN and a zone id are required; none were found.');

  const ruleset = await cf('/rulesets/phases/http_request_firewall_custom/entrypoint');
  const existing = ruleset.rules.find((rule) => rule.ref === REF);

  if (mode === '--status') {
    console.log(existing
      ? `enabled=${existing.enabled} guarded=${existing.expression.includes(TEST_GUARD)} position=${ruleset.rules.indexOf(existing) + 1}/${ruleset.rules.length}`
      : `not installed; ${ruleset.rules.length} rules in the zone`);
    console.log(`page length: ${PAGE.length}`);
    return;
  }

  const body = mode === '--off'
    ? ruleBody(false, EXPRESSION)
    : ruleBody(true, mode === '--test' ? `${TEST_GUARD} and ${EXPRESSION}` : EXPRESSION);

  await (existing
    ? cf(`/rulesets/${ruleset.id}/rules/${existing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
    : cf(`/rulesets/${ruleset.id}/rules`, { method: 'POST', body: JSON.stringify(body) }));

  const after = await cf('/rulesets/phases/http_request_firewall_custom/entrypoint');
  const saved = after.rules.find((rule) => rule.ref === REF);
  console.log(`saved: enabled=${saved.enabled} guarded=${saved.expression.includes(TEST_GUARD)} position=${after.rules.indexOf(saved) + 1}/${after.rules.length}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
