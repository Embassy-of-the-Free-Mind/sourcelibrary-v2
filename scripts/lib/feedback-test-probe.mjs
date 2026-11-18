// PRIOR ART: scripts/analytics/feedback-triage.mjs CLASSIFIERS — those regexes sort reader text by topic; none recognises a canary or probe row, so 29 such rows sat among 200 open items on 2026-11-16. Searched scripts/lib, scripts/analytics and src/lib for feedback "probe"/"test" handling: none.
//
// Recognises rows in the feedback collection that are not reader feedback:
// canary/probe rows ("probe-ab12cd"), SSRF probes ("http://oob:9100/…"), fixture
// rows ("audit-fixture", "attacker-controlled"), rows named or paged "test", and
// blank posts. They are written from outside this repo, so they cannot be tagged
// where they are written; the triage report groups them and prints the command
// that clears them.
export function isTestProbe(r) {
  const m = String(r?.message || '').trim();
  if (!m) return true;
  if (r.page === 'test' || r.name === 'test') return true;
  if (/^(probe-[a-z0-9]{4,}|test|attacker-controlled|audit-fixture)$/i.test(m)) return true;
  // A message that is nothing but a URL at an out-of-band host.
  return /^\S*\boob:\d+\/\S*$/i.test(m);
}
