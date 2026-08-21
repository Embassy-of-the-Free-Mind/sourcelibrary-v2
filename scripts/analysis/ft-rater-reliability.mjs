/**
 * Inter-rater reliability + validity instrument for the first-translation census
 * (#2780). The standing "convergence & accuracy dashboard" the steady-state
 * design needs: every batch, report how much the verification approaches AGREE
 * (chance-corrected, by family) and how ACCURATE they are against checkable
 * ground truth — plus the over-claims the catalog already disproves.
 *
 * Two distinct measurements, deliberately kept apart (they answer different
 * questions; high agreement under shared bias is the trap):
 *   1. RELIABILITY — Cohen's kappa between rater FAMILIES on books both rated.
 *      Independence is by family, not raw method (same model resampled shares
 *      its blind spot). Low kappa => the verdicts are noisy & approach-dependent
 *      => a single weak verdict can't be trusted; cross-family checking matters.
 *   2. VALIDITY — accuracy against a one-sided GOLD set: a prior translation
 *      *found with a resolvable URL* is checkable truth ("not first"). Absence is
 *      never ground truth (principle #1), so the gold set only labels not-first.
 *
 * Also surfaces the gap Derek flagged: books we badge "first" while we already
 * hold a checkable prior — the catalog-match that the badge-setting process
 * never performed.
 *
 * READ-ONLY. No writes. Free (no LLM).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/analysis/ft-rater-reliability.mjs           # report + artifacts
 */
import { withMongo } from '../lib/mongo.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const FAMS = ['claude_agent', 'gemini_grounded', 'catalog_legacy', 'model_legacy', 'structured_legacy'];
const FAM_DESC = {
  claude_agent: 'Claude agent (real web research) — independent model family',
  gemini_grounded: 'Gemini grounded search (real queries) — Gemini family',
  catalog_legacy: '3-catalog disposition (Open Library / Google Books / Internet Archive)',
  model_legacy: 'model training-knowledge / content read — weakest, correlated',
  structured_legacy: 'structured registry / reverify proposal',
};

/** Bucket an attempt into a rater "family" (independence by family, not method). */
function family(a) {
  const s = a.independence_score;
  if (s === 0.1) return 'model_legacy';
  if (s === 0.3) return 'catalog_legacy';
  if (s === 0.5) return 'structured_legacy';
  const m = (a.model || '').toLowerCase();
  if (m.includes('claude') || a.method === 'tier2_agent' || a.method === 'claude_subagent_verify') return 'claude_agent';
  if ((a.queries || []).length > 0) return 'gemini_grounded';
  return null; // gemini disposition with no trail — already covered by *_legacy buckets
}

/** Cohen's kappa for two raters over paired binary labels. */
function cohenKappa(pairs) {
  const n = pairs.length;
  if (!n) return { n, po: null, k: null };
  let agree = 0, a1 = 0, b1 = 0;
  for (const [a, b] of pairs) { if (a === b) agree++; a1 += a; b1 += b; }
  const po = agree / n;
  const pa1 = a1 / n, pb1 = b1 / n;
  const pe = pa1 * pb1 + (1 - pa1) * (1 - pb1);
  const k = pe === 1 ? 1 : (po - pe) / (1 - pe);
  return { n, po: +po.toFixed(3), k: +k.toFixed(3) };
}

const hasUrl = (p) => typeof p?.source_url === 'string' && /^https?:\/\//.test(p.source_url);

await withMongo(async (db) => {
  const att = db.collection('first_translation_attempts');
  // Per book: family -> { found, urlFound, prior } (the strongest url-backed prior)
  const byBook = new Map();
  const cur = att.find({}, { projection: { _id: 0, book_id: 1, method: 1, model: 1, independence_score: 1, result: 1, queries: 1, priors: 1 } });
  for await (const a of cur) {
    const fam = family(a);
    if (!fam) continue;
    const found = a.result === 'found';
    const urlPrior = (a.priors || []).find(hasUrl);
    let rec = byBook.get(a.book_id); if (!rec) { rec = {}; byBook.set(a.book_id, rec); }
    let f = rec[fam]; if (!f) { f = { found: false, urlFound: false, prior: null }; rec[fam] = f; }
    if (found) f.found = true;
    if (urlPrior) { f.urlFound = true; f.prior = f.prior || urlPrior; }
  }

  // ── 1. RELIABILITY: pairwise Cohen's kappa between families ───────────────
  const kappas = [];
  for (let i = 0; i < FAMS.length; i++) for (let j = i + 1; j < FAMS.length; j++) {
    const A = FAMS[i], B = FAMS[j], pairs = [];
    for (const rec of byBook.values()) if (rec[A] && rec[B]) pairs.push([rec[A].found ? 1 : 0, rec[B].found ? 1 : 0]);
    const r = cohenKappa(pairs);
    kappas.push({ A, B, ...r });
  }

  // ── 2. VALIDITY: gold = any family found a url-backed prior => truth not-first
  const gold = [...byBook.entries()].filter(([, rec]) => FAMS.some((f) => rec[f]?.urlFound));
  const goldIds = new Set(gold.map(([id]) => id));
  const recall = {};
  for (const F of FAMS) {
    let rated = 0, correct = 0;
    for (const [, rec] of gold) { const f = rec[F]; if (!f) continue; rated++; if (f.found) correct++; }
    recall[F] = { rated, correct, pct: rated ? +(correct / rated * 100).toFixed(0) : null };
  }

  // ── 3. OVER-CLAIMS: badged "first" yet a checkable prior is already held ───
  const books = db.collection('books');
  const badgedIds = await books.distinct('id', { is_first_translation: true, visible: true, pages_translated: { $gt: 0 } });
  const overIds = badgedIds.filter((id) => goldIds.has(id));
  const overDocs = await books.find({ id: { $in: overIds } },
    { projection: { _id: 0, id: 1, title: 1, author: 1, language: 1 } }).toArray();
  const RIGOROUS = new Set(['claude_agent', 'gemini_grounded']); // real research + URL
  const overByLang = {};
  let highConf = 0;
  const overclaims = overDocs.map((b) => {
    overByLang[b.language || '?'] = (overByLang[b.language || '?'] || 0) + 1;
    const rec = byBook.get(b.id);
    const found_by = FAMS.filter((f) => rec[f]?.urlFound);
    // Prefer the prior cited by a rigorous family (real research) when present.
    const rigFam = found_by.find((f) => RIGOROUS.has(f));
    const prior = (rigFam ? rec[rigFam].prior : null) || FAMS.map((f) => rec[f]?.prior).find(Boolean);
    const rigorous = !!rigFam;
    if (rigorous) highConf++;
    return {
      id: b.id, title: b.title, author: b.author, language: b.language,
      // A rigorous-family url-prior is high-confidence; a legacy-only one still
      // needs the evidence-quality guard (same-language/complete/not-anthology).
      confidence: rigorous ? 'high (real-research prior)' : 'needs-guard (legacy-cited prior)',
      prior: prior ? { english_title: prior.english_title, translator: prior.translator, pub_year: prior.pub_year, source_url: prior.source_url } : null,
      found_by,
    };
  });

  // ── Report ────────────────────────────────────────────────────────────────
  const L = (s) => lines.push(s); const lines = [];
  L('# First-translation rater reliability & validity\n');
  L(`Generated ${new Date().toISOString()}. Read-only. Books with ≥1 attempt: **${byBook.size.toLocaleString()}**.\n`);
  L('## 1. Reliability — Cohen\'s κ between rater families (label = "found a prior")\n');
  L('Landis–Koch: 0.0–0.2 slight · 0.2–0.4 fair · 0.4–0.6 moderate · 0.6–0.8 substantial.\n');
  L('| family A | family B | n | agreement | κ |');
  L('|---|---|---|---|---|');
  for (const k of kappas.filter((k) => k.n >= 20).sort((a, b) => b.k - a.k)) L(`| ${k.A} | ${k.B} | ${k.n} | ${k.po} | ${k.k} |`);
  const thin = kappas.filter((k) => k.n < 20);
  if (thin.length) L(`\n⚠ Too little overlap to score (n<20): ${thin.map((k) => `${k.A}×${k.B}`).join(', ')} — notably the two independent strong families. Run a shared-sample experiment to get their κ.`);
  L('\n## 2. Validity — accuracy vs checkable ground truth\n');
  L(`Gold set (a prior found **with a resolvable URL** ⇒ truth: NOT first): **${gold.length.toLocaleString()}** books.\n`);
  L('⚠ Selection caveat: the families that *found* the priors define the gold set, so their recall is inflated. The clean signal is a DIFFERENT family\'s recall on books it independently rated.\n');
  L('| family | rated of gold | called not-first | recall |');
  L('|---|---|---|---|');
  for (const F of FAMS) if (recall[F].rated >= 10) L(`| ${F} | ${recall[F].rated} | ${recall[F].correct} | ${recall[F].pct}% |`);
  L('\n## 3. Over-claims — badged "first" while we already hold a checkable prior\n');
  L(`**${overclaims.length}** books are badged "First Translation" yet a prior English translation with a resolvable URL sits in our own evidence — the catalog-match the badge-setting process never performed.\n`);
  L(`Confidence split (apply the evidence-quality guard before any demote — same-language / complete / not-anthology / person-disambiguated; the Arithmologia rule):`);
  L(`- **${highConf}** high-confidence — the prior was found by a real-research family (Claude/Gemini) with a URL.`);
  L(`- **${overclaims.length - highConf}** needs-guard — only a legacy tier cited the prior; verify before demoting.\n`);
  L(`By language: ${JSON.stringify(overByLang)}\n`);
  L('See `ft-overclaims-urlbacked-<date>.json` for the full list with the cited prior + URL.\n');
  L('## Family legend\n');
  for (const f of FAMS) L(`- **${f}** — ${FAM_DESC[f]}`);

  const stamp = new Date().toISOString().slice(0, 10);
  mkdirSync('scripts/output', { recursive: true });
  const md = `scripts/output/ft-rater-reliability-${stamp}.md`;
  const js = `scripts/output/ft-overclaims-urlbacked-${stamp}.json`;
  writeFileSync(md, lines.join('\n'));
  writeFileSync(js, JSON.stringify({ generated: new Date().toISOString(), count: overclaims.length, byLanguage: overByLang, overclaims }, null, 2));

  console.log(lines.join('\n'));
  console.log(`\nWrote ${md}`);
  console.log(`Wrote ${js} (${overclaims.length} URL-backed demote candidates)`);
});
