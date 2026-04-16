import http from "http";

function embedBatch(texts) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ texts, prefix: "query: " });
    const req = http.request({
      hostname: "localhost", port: 3456, path: "/embed",
      method: "POST", headers: { "Content-Type": "application/json" }
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString()).embeddings));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function alignPair(srcWords, enWords, label) {
  console.log(`\n=== ${label} ===`);
  const srcEmbs = await embedBatch(srcWords);
  const enEmbs = await embedBatch(enWords);

  // For each English word, find best source match (argmax)
  const links = [];
  for (let ei = 0; ei < enWords.length; ei++) {
    let bestSi = -1, bestSim = -1;
    for (let si = 0; si < srcWords.length; si++) {
      const sim = cosine(srcEmbs[si], enEmbs[ei]);
      if (sim > bestSim) { bestSim = sim; bestSi = si; }
    }
    if (bestSim > 0.65 && enWords[ei].length > 2) {
      links.push({ src: srcWords[bestSi], en: enWords[ei], sim: bestSim });
    }
  }

  // Show unique links sorted by similarity
  const seen = new Set();
  const unique = links.filter(l => {
    const key = l.src + "|" + l.en;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.sim - a.sim);

  for (const l of unique) {
    console.log(`  ${l.src.padEnd(20)} → ${l.en.padEnd(15)} (${l.sim.toFixed(3)})`);
  }
  console.log(`  Total: ${unique.length} links (threshold > 0.65)`);
}

// === Compare: SimAlign (mBERT) vs e5 ===

console.log("========================================");
console.log("  e5 (multilingual-e5-base) alignment");
console.log("========================================");

// Latin - Ficino
await alignPair(
  "PLATO igitur ut ab eorum principe initium faciam cum animum in duas partes distribuisset mente scilicet ac sensum menti laeticiam gaudium attribuit sensibus voluptatem".split(" "),
  "Plato therefore to begin with him as the leader of these philosophers when he had divided the soul into two parts namely the mind and the senses attributed gladness and joy to the mind pleasure to the senses".split(" "),
  "Latin → English (Ficino)"
);

// Greek - Aratus
await alignPair(
  "Ek Διὸς ἀρχώμεσθα τὸν οὐδέποτ ἄνδρες ἐῶμεν ἀῤῥητον".split(" "),
  "From Zeus let us begin him let no man leave unspoken".split(" "),
  "Greek → English (Aratus)"
);

// Bonus: test sentence-level matching
console.log("\n========================================");
console.log("  Sentence-level similarity (e5)");
console.log("========================================");

const latinSentences = [
  "PLATO igitur ut ab eorum principe initium faciam cum animum in duas partes distribuisset",
  "Verum prima duo haec inter se differre putat",
  "Esse enim laeticiam in bonis alicuius possessione quandam mentis elationem",
  "Gaudium vero illam ipsam quae ex contemplatione aut alio quopiam virtutum usu suscipitur iocunditatem"
];
const englishSentences = [
  "Plato therefore when he had divided the soul into two parts attributed gladness and joy to the mind",
  "He considers these first two to differ from each other",
  "For he defines gladness as a certain elevation of the mind in the possession of good things",
  "Joy however is that very delight which is received from contemplation or from some other exercise of the virtues"
];

const srcSentEmbs = await embedBatch(latinSentences);
const enSentEmbs = await embedBatch(englishSentences);

console.log("\nSimilarity matrix (Latin rows × English cols):");
console.log("         " + englishSentences.map((_, i) => `  EN${i+1} `).join(""));
for (let si = 0; si < latinSentences.length; si++) {
  const row = [];
  for (let ei = 0; ei < englishSentences.length; ei++) {
    row.push(cosine(srcSentEmbs[si], enSentEmbs[ei]).toFixed(2));
  }
  console.log(`  LA${si+1}:  ${row.join("  ")}`);
}
