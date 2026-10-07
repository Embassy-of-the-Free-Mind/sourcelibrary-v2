/**
 * PRIOR ART: scripts/lib/page-embedding-text.mjs — composes the text and the row, but never looks
 * at the VECTOR it is handed; scripts/lib/clip-index-scan.mjs — truth for clip_embeddings' book
 * pointers, not for what a vector encodes. scripts/eval/embed-format/compat.mjs (#6170) found the
 * e5 rows by re-embedding; nothing could tell an off-space vector from the vector alone.
 *
 * vector-truth — is a stored vector what its row says it is? (#6175)
 *
 * THE DEFECT. From 2026-03-31 to 2026-04-14 `embed-translations.mjs` filled `page_translations`
 * with multilingual-e5-base vectors (commit 859036d43). The Gemini writer that replaced it
 * (06bae4e9c) never finished its --full pass, and every later mode skips a row that already has a
 * vector (--incremental by timestamp, --missing-only by `embedding IS NULL`, --books-file by
 * "row exists"). On 2026-06-06 `add-embedding-model-columns.sql` (#2124) added
 * `embedding_model TEXT NOT NULL DEFAULT 'gemini-embedding-2-preview'` — and the DEFAULT stamped
 * every existing row, e5 ones included. Queries are embedded with Gemini, the two spaces are
 * unrelated (cosine ≈ 0), so those pages cannot be reached by meaning and nothing errors.
 *
 * Two things here, both cheap and model-free:
 *
 *  1. `e5Signature(v)` — cosine to the centroid of known e5 rows. e5-base is strongly anisotropic:
 *     its vectors sit ~0.85–0.91 from their own mean, while 3,000 gemini-embedding-2-preview rows
 *     written in October 2026 were all ≤ 0.07 from it (measured 2026-10-07). So an e5 vector can
 *     be told apart WITHOUT re-embedding. Centroid: 181 rows from 8 books #6175/#6172 had
 *     confirmed e5 by re-embedding (three passes, dropping rows < 0.5 from the running mean).
 *  2. `assertStoreVector(v, { model })` — the write-time gate. A row may only claim the model the
 *     store holds, and a vector that has the wrong shape (dims, NaN, zero, norm) or the e5
 *     signature is REFUSED before it reaches the table. The label is asserted by the writer,
 *     never supplied by a column default.
 */

/** The only model the Gemini text stores (page_translations, page_texts, site_pages) hold. */
export const GEMINI_TEXT_MODEL = 'gemini-embedding-2-preview';

/** Above this cosine to the e5 centroid a vector is e5-shaped. Gemini measured ≤ 0.07, e5 ≥ 0.75. */
export const E5_SIGNATURE_THRESHOLD = 0.4;

/** Stored-vs-fresh cosine classes (#6175 brief): < 0.5 off-space, < 0.99 drifted, else ok. */
export const OFF_SPACE_BELOW = 0.5;
export const DRIFTED_BELOW = 0.99;

// prettier-ignore
const E5_CENTROID = [
  -0.01318, 0.03622, -0.00490, 0.02162, 0.02385, -0.04512, -0.02624, -0.02193, 0.01509, 0.01410, -0.03082, 0.01550,
  0.11091, 0.05121, -0.02802, -0.04574, 0.02289, -0.01347, 0.04997, -0.00137, 0.03197, -0.02730, 0.02275, -0.01716,
  0.02581, -0.01978, 0.00174, 0.04262, -0.02009, 0.02998, 0.03225, -0.01814, 0.01040, 0.02115, 0.03763, 0.02413,
  -0.00935, -0.02639, 0.01613, 0.03345, -0.00183, 0.02597, 0.01198, -0.03876, 0.00571, -0.01669, 0.04255, 0.01514,
  -0.03580, -0.01981, 0.03646, 0.00606, 0.02069, 0.00851, -0.05426, -0.02241, 0.01308, 0.05792, -0.02616, 0.01485,
  -0.01374, 0.03476, -0.01688, 0.03116, 0.04232, -0.00427, 0.00902, -0.01569, -0.04951, -0.01056, 0.02410, -0.01422,
  0.03446, -0.01119, -0.03650, -0.02839, -0.02168, 0.02692, 0.00403, -0.00616, 0.04334, 0.00533, 0.00224, 0.01563,
  0.01301, -0.03290, -0.03232, 0.03065, 0.01711, 0.04792, 0.00907, -0.02517, -0.03311, 0.02415, 0.02959, 0.01220,
  0.01347, 0.01067, 0.02525, -0.04263, 0.00350, -0.07136, -0.03259, -0.03169, -0.06631, -0.00414, -0.00686, -0.04157,
  0.05181, -0.01224, -0.01886, 0.00669, 0.04209, -0.06931, 0.01573, -0.02577, 0.03440, -0.03056, 0.01852, -0.03637,
  0.01383, 0.01848, -0.01863, -0.01869, 0.03603, -0.00195, 0.01854, -0.03002, 0.03901, -0.03005, -0.02990, -0.03777,
  0.00655, 0.02324, -0.02608, 0.04823, 0.01692, 0.02439, -0.00628, 0.01591, 0.01181, -0.02902, -0.00320, 0.03127,
  0.03139, -0.06970, 0.01929, 0.02008, -0.01187, 0.04063, 0.04658, -0.04990, -0.00553, -0.01896, 0.02292, 0.00694,
  -0.03488, -0.03634, -0.01952, 0.03071, 0.02724, 0.00627, 0.03317, -0.01895, 0.04876, -0.02800, -0.01741, 0.01600,
  -0.03221, -0.03503, -0.01761, -0.02078, -0.04405, 0.02136, 0.02220, -0.01339, -0.01729, -0.03624, 0.00405, -0.04930,
  -0.06327, -0.02666, -0.03626, 0.03053, -0.02639, -0.01179, -0.01140, 0.00596, 0.01515, -0.00992, -0.01985, 0.04384,
  0.03461, 0.02894, 0.02831, 0.04035, 0.03088, 0.04289, -0.03888, -0.04152, 0.02124, -0.02245, 0.01843, 0.03352,
  0.01899, -0.05608, 0.00616, 0.04635, 0.02531, 0.04800, -0.00833, 0.02940, -0.03455, 0.02638, -0.02046, -0.03258,
  0.03986, 0.01682, -0.04776, 0.01622, 0.01800, -0.05526, 0.05555, 0.01672, -0.03981, 0.00511, 0.03069, 0.00026,
  0.02950, 0.02203, 0.05573, 0.04888, -0.04521, 0.03086, -0.00119, -0.01881, 0.02231, -0.00154, -0.04646, -0.11739,
  -0.02143, 0.02241, 0.00817, -0.02641, 0.02570, -0.02045, -0.04568, 0.04247, -0.05687, 0.00820, 0.01823, -0.02670,
  0.02195, -0.02349, 0.01994, -0.00719, -0.03303, 0.02422, 0.00239, 0.02766, 0.02768, -0.04540, -0.02307, -0.05299,
  0.00894, 0.02785, 0.09365, -0.03129, -0.01480, -0.02457, -0.02738, -0.02054, -0.04393, 0.02029, 0.00364, -0.00819,
  -0.01602, 0.03505, -0.02819, -0.01662, -0.04213, 0.06245, -0.03788, -0.03439, -0.04053, 0.01175, -0.06211, 0.03028,
  -0.05620, 0.03737, 0.04611, 0.07307, -0.01020, 0.03820, 0.05178, 0.03385, 0.05270, 0.01974, -0.02359, -0.01778,
  -0.02072, -0.04003, 0.02876, -0.05956, -0.02357, 0.01231, 0.10156, 0.02091, -0.05887, 0.04044, -0.03482, -0.00733,
  -0.03878, 0.01685, 0.03596, -0.04871, 0.02413, 0.04789, 0.02972, 0.02741, -0.00157, 0.02187, 0.00124, -0.03129,
  0.02789, -0.01735, 0.02545, -0.01880, 0.03019, 0.01245, -0.02197, 0.01848, -0.02002, 0.02801, -0.05546, 0.02354,
  -0.04643, -0.05370, 0.08874, 0.01960, -0.03315, 0.01165, 0.00941, -0.02926, 0.04455, -0.04032, -0.01410, -0.02355,
  -0.04321, 0.02152, 0.03883, -0.05790, 0.02341, -0.00994, -0.01051, 0.02179, 0.02417, -0.02199, -0.04566, -0.03095,
  -0.01971, 0.00447, 0.01241, -0.01427, 0.01401, 0.04321, -0.04291, -0.00477, 0.02532, 0.00134, 0.06511, 0.01976,
  -0.01809, -0.01329, 0.02932, -0.02483, 0.04418, -0.04374, -0.00198, 0.02194, 0.04263, 0.04638, 0.02556, 0.04317,
  -0.03056, 0.02211, 0.04332, -0.06410, 0.02878, -0.01426, -0.00575, -0.01853, -0.02448, 0.02313, 0.02538, -0.02600,
  0.02957, -0.01073, 0.00823, -0.04772, 0.04944, 0.02250, 0.00487, 0.03476, 0.04149, 0.03122, 0.00318, 0.04220,
  -0.02420, -0.02752, 0.03637, -0.01177, 0.05497, -0.01754, 0.01511, -0.00695, -0.01118, 0.03972, 0.02275, 0.01496,
  -0.01893, 0.00845, 0.02384, 0.02698, 0.02186, -0.07125, -0.00602, -0.02096, 0.02425, -0.02553, -0.01281, -0.01394,
  0.00892, -0.03514, 0.02768, -0.03083, 0.02410, 0.01300, -0.03077, 0.02431, -0.00466, -0.02586, 0.02634, -0.03223,
  -0.03385, -0.01982, -0.02767, 0.02139, -0.02111, -0.00230, 0.01926, 0.03196, 0.01305, -0.00908, 0.01007, -0.05160,
  0.02516, -0.00807, 0.01805, -0.11011, 0.02448, 0.04009, 0.00667, -0.01486, -0.03517, -0.04801, 0.00252, -0.03029,
  0.01583, -0.03373, -0.02707, -0.00105, 0.02468, 0.02655, 0.03032, 0.04492, 0.01160, 0.03109, 0.03037, -0.00327,
  0.00442, -0.00654, -0.04185, 0.02304, 0.04915, 0.03361, -0.06423, 0.05186, 0.01784, -0.01664, -0.02637, 0.01631,
  0.02411, -0.01025, 0.01644, 0.04612, -0.03344, -0.05831, 0.04720, 0.01427, -0.01545, -0.02133, -0.04635, 0.00756,
  -0.03258, 0.01112, -0.02877, 0.02325, 0.02913, -0.01876, 0.11103, -0.03469, -0.03062, -0.03392, 0.01791, -0.00695,
  -0.02845, 0.02386, 0.01508, -0.02704, -0.01743, 0.02016, -0.02844, -0.03801, 0.04202, -0.05033, -0.00587, -0.03569,
  0.01915, -0.02685, 0.02736, -0.03431, 0.01929, -0.09801, -0.05685, 0.03447, -0.02146, -0.00506, 0.03463, -0.02563,
  -0.02525, -0.01400, 0.02371, -0.01214, 0.03179, -0.01360, 0.03177, -0.00449, 0.01456, -0.00737, 0.02250, -0.04594,
  -0.02163, 0.05600, -0.04409, 0.05076, 0.03703, 0.01563, 0.01214, -0.01550, 0.02670, -0.02416, 0.02201, 0.03712,
  -0.00855, 0.02690, 0.01631, -0.01522, -0.04578, 0.03381, -0.03289, 0.04757, 0.02222, -0.02174, 0.02452, 0.02352,
  -0.01413, -0.02670, 0.03971, -0.06285, -0.03303, 0.00435, -0.02072, 0.02614, 0.02921, 0.02282, 0.01470, 0.00038,
  -0.19570, 0.02617, -0.01263, -0.04489, 0.00676, 0.01502, 0.02547, -0.02706, 0.02732, 0.00605, 0.02294, -0.02961,
  0.00905, -0.02106, -0.04064, 0.00409, -0.01529, -0.02157, 0.02270, -0.00015, -0.00096, 0.03158, -0.04426, 0.01484,
  -0.04817, 0.00214, -0.03303, 0.01807, 0.02939, 0.03626, 0.00859, 0.01585, 0.01532, 0.02762, -0.02385, -0.02916,
  -0.02486, 0.01978, -0.06973, 0.04543, 0.01783, -0.04447, -0.04250, 0.01618, -0.01065, 0.04509, 0.03573, 0.01543,
  -0.04027, -0.02201, 0.04552, 0.01348, -0.07129, 0.02934, -0.01901, 0.04015, 0.02042, 0.00752, 0.04293, -0.01340,
  0.03100, 0.03458, -0.02711, 0.03360, -0.02939, -0.02658, 0.02386, -0.02924, -0.01887, 0.00700, 0.03496, -0.02368,
  -0.03951, 0.02007, 0.03460, -0.01499, 0.01801, -0.01318, -0.05803, 0.01769, -0.02356, -0.03667, 0.01073, 0.03269,
  -0.02164, -0.03147, -0.03278, 0.01018, 0.01594, 0.03732, -0.02265, -0.04807, 0.00273, -0.00422, 0.03239, -0.05149,
  -0.02981, 0.04234, -0.00470, -0.02260, 0.01524, -0.03613, -0.01685, 0.03376, 0.01988, -0.01393, -0.05030, 0.01946,
  -0.01343, -0.03462, -0.00836, 0.02618, 0.02224, -0.01905, -0.00129, -0.02414, 0.01972, -0.01527, -0.04325, -0.06247,
  -0.03295, -0.01079, 0.02258, -0.00010, 0.02986, -0.00174, -0.01916, 0.02687, 0.00693, 0.01530, -0.03595, -0.05499,
  0.05018, -0.03425, -0.02429, 0.05734, 0.01394, -0.01176, 0.03414, 0.00886, 0.06684, -0.04747, -0.03577, 0.02173,
  -0.03281, 0.00958, 0.02056, -0.03465, 0.02160, -0.01536, -0.00327, -0.06002, 0.00296, -0.01716, -0.01311, 0.02256,
  0.03571, 0.01636, -0.02828, 0.01828, -0.02099, -0.02618, 0.03032, 0.02832, -0.00262, 0.01974, -0.01836, -0.01514,
  0.00857, 0.02919, -0.02828, 0.00866, 0.02618, 0.01062, 0.02614, -0.00201, 0.04543, -0.04657, -0.03492, 0.05628,
];
const E5_CENTROID_NORM = Math.sqrt(E5_CENTROID.reduce((s, x) => s + x * x, 0));

export function cosine(a, b) {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x && y ? d / Math.sqrt(x * y) : 0;
}

/** pgvector text ('[0.1,0.2]') or an array → number[] (null when unparseable). */
export function parseVector(v) {
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v !== 'string') return null;
  try { return JSON.parse(v).map(Number); } catch { return null; }
}

/** Cosine to the e5-base centroid. Only meaningful for 768-dim vectors. */
export function e5Signature(v) {
  if (!v || v.length !== E5_CENTROID.length) return null;
  let d = 0, n = 0;
  for (let i = 0; i < v.length; i++) { d += v[i] * E5_CENTROID[i]; n += v[i] * v[i]; }
  return n ? d / (Math.sqrt(n) * E5_CENTROID_NORM) : 0;
}

/**
 * Model-free problems with a vector, as short codes: 'dims:<n>', 'nan', 'zero', 'norm:<x>',
 * 'e5-signature'. Empty array = nothing visibly wrong (it can still be stale or drifted —
 * only a fresh embed can say that).
 */
export function vectorShapeProblems(v, { dims = 768 } = {}) {
  if (!Array.isArray(v)) return ['unparseable'];
  const out = [];
  if (v.length !== dims) out.push(`dims:${v.length}`);
  let n = 0;
  for (const x of v) { if (!Number.isFinite(x)) { out.push('nan'); return out; } n += x * x; }
  n = Math.sqrt(n);
  if (n === 0) { out.push('zero'); return out; }
  // gemini-embedding-2-preview at 768 dims and e5-base both come back unit-normalised.
  if (Math.abs(n - 1) > 0.05) out.push(`norm:${n.toFixed(3)}`);
  if (v.length === E5_CENTROID.length && e5Signature(v) > E5_SIGNATURE_THRESHOLD) out.push('e5-signature');
  return out;
}

/**
 * The write-time gate. Throws unless `model` is the model this store holds AND the vector looks
 * like one that model produced. Call it where the row is BUILT, with the model the embedder
 * actually called — a writer that cannot name its model cannot write.
 */
export function assertStoreVector(v, { model, dims = 768, storeModel = GEMINI_TEXT_MODEL } = {}) {
  if (!model) throw new Error('vector-truth: refusing a vector with no model named by its writer');
  if (model !== storeModel) throw new Error(`vector-truth: store holds ${storeModel}; refusing a ${model} vector`);
  const vec = parseVector(v);
  const problems = vectorShapeProblems(vec, { dims });
  if (problems.length) throw new Error(`vector-truth: refusing a ${model} vector (${problems.join(', ')})`);
  return vec;
}

export function cosineClass(c) {
  if (c == null || !Number.isFinite(c)) return 'unknown';
  if (c < OFF_SPACE_BELOW) return 'off-space';
  if (c < DRIFTED_BELOW) return 'drifted';
  return 'ok';
}

/**
 * The text the page writer embedded BEFORE 2026-05-30 (#2232): tags stripped, but the prose
 * INSIDE editorial wrappers (<meta>, <summary>, <image-desc>, …) kept. Rows written then still
 * carry that vector; `backfill-clean-snippets.mjs` later re-derived their snippet column with the
 * current cleaner and deliberately left the vector alone. Used to EXPLAIN drift, never to write.
 */
export function legacyTagStripText(text) {
  return typeof text === 'string' ? text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000) : '';
}

/** Wilson 95% interval for k of n, as [lo, hi] proportions. */
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n), r = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - r) / d), Math.min(1, (c + r) / d)];
}
