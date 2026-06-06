// Shared helpers for the universal works catalog ingests (#2453).
import pg from 'pg';

export function pgClient() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error('SUPABASE_DB_URL required (Hetzner-only — run there or tunnel)');
    process.exit(1);
  }
  return new pg.Client({ connectionString: url, statement_timeout: 0 });
}

// CJK variant-glyph normalization. Wikidata zh labels, Kanripo titles, and
// IA-CADAL titles disagree on variant forms (説/說, 録/錄, …) — raw string
// match had a 28% false-miss rate in the 2026-06-06 gap analysis. Extend as
// new variants surface; keep TARGET forms = the traditional forms Kanripo uses.
const CJK_VARIANTS = {
  '説': '說', '録': '錄', '黙': '默', '寳': '寶', '寶': '寶', '様': '樣',
  '歴': '歷', '厯': '歷', '戸': '戶', '畧': '略', '䟽': '疏', '㴑': '溯',
  '経': '經', '禅': '禪', '蔵': '藏', '徳': '德', '紀': '記', '叙': '敘',
  '温': '溫', '况': '況', '寛': '寬', '隷': '隸', '効': '效', '勅': '敕',
  '顔': '顏', '恵': '惠', '虚': '虛', '満': '滿', '単': '單', '専': '專',
};

export function normalizeCjk(s) {
  return [...(s || '')]
    .map(c => CJK_VARIANTS[c] || c)
    .join('')
    .replace(/[()（）\s]/g, '');
}

export async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function fetchRetry(url, opts = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.status >= 500 && i < tries - 1) { await sleep(3000 * (i + 1)); continue; }
      return res;
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(3000 * (i + 1));
    }
  }
}

// Batched upsert into works. Rows: array of objects with works columns.
// ON CONFLICT updates the mutable fields but never downgrades translation
// status fields that another ingest set (COALESCE keeps existing non-null).
export async function upsertWorks(client, rows, { batch = 500 } = {}) {
  let n = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const cols = ['id','tradition','original_language','title','title_normalized','title_romanized',
      'title_english','author','century','wikidata_qid','authority_ids','corpus_tags','source_catalog','extra'];
    const values = [];
    const params = [];
    chunk.forEach((r, j) => {
      const base = j * cols.length;
      values.push(`(${cols.map((_, k) => `$${base + k + 1}`).join(',')})`);
      params.push(r.id, r.tradition, r.original_language ?? null, r.title, r.title_normalized ?? null,
        r.title_romanized ?? null, r.title_english ?? null, r.author ?? null, r.century ?? null,
        r.wikidata_qid ?? null, JSON.stringify(r.authority_ids ?? {}), r.corpus_tags ?? [],
        r.source_catalog, JSON.stringify(r.extra ?? {}));
    });
    const res = await client.query(
      `insert into works (${cols.join(',')}) values ${values.join(',')}
       on conflict (id) do update set
         title_romanized = coalesce(excluded.title_romanized, works.title_romanized),
         title_english   = coalesce(excluded.title_english, works.title_english),
         author          = coalesce(excluded.author, works.author),
         century         = coalesce(excluded.century, works.century),
         wikidata_qid    = coalesce(excluded.wikidata_qid, works.wikidata_qid),
         authority_ids   = works.authority_ids || excluded.authority_ids,
         corpus_tags     = (select array(select distinct unnest(works.corpus_tags || excluded.corpus_tags))),
         extra           = works.extra || excluded.extra,
         updated_at      = now()`,
      params,
    );
    n += res.rowCount;
  }
  return n;
}

export async function upsertSources(client, rows, { batch = 500 } = {}) {
  let n = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const cols = ['work_id','source','source_id','kind','url','iiif','coverage','extra'];
    const values = [];
    const params = [];
    chunk.forEach((r, j) => {
      const base = j * cols.length;
      values.push(`(${cols.map((_, k) => `$${base + k + 1}`).join(',')})`);
      params.push(r.work_id, r.source, r.source_id, r.kind, r.url ?? null,
        r.iiif ?? false, r.coverage ?? null, JSON.stringify(r.extra ?? {}));
    });
    const res = await client.query(
      `insert into work_sources (${cols.join(',')}) values ${values.join(',')}
       on conflict (work_id, source, source_id) do update set
         url = coalesce(excluded.url, work_sources.url),
         coverage = coalesce(excluded.coverage, work_sources.coverage),
         extra = work_sources.extra || excluded.extra`,
      params,
    );
    n += res.rowCount;
  }
  return n;
}
