const { MongoClient } = require("mongodb");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db("bookstore");

  const providerOcr = await db.collection("books").aggregate([
    { $lookup: {
        from: "pages",
        let: { bookId: "$id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$book_id", "$$bookId"] } } },
          { $group: {
              _id: null,
              total: { $sum: 1 },
              has_ocr: { $sum: { $cond: [
                { $and: [
                  { $ne: ["$ocr.data", null] },
                  { $ne: ["$ocr.data", ""] },
                  { $ifNull: ["$ocr.data", false] }
                ]}, 1, 0
              ]}}
          }}
        ],
        as: "stats"
    }},
    { $addFields: {
        total_pages: { $ifNull: [{ $arrayElemAt: ["$stats.total", 0] }, 0] },
        ocr_pages: { $ifNull: [{ $arrayElemAt: ["$stats.has_ocr", 0] }, 0] },
    }},
    { $addFields: {
        ocr_pct: { $cond: {
          if: { $eq: ["$total_pages", 0] }, then: 0,
          else: { $divide: ["$ocr_pages", "$total_pages"] }
        }}
    }},
    { $group: {
        _id: {
          provider: { $ifNull: ["$image_source.provider", "no provider"] },
          ocr_tier: { $switch: {
            branches: [
              { case: { $eq: ["$total_pages", 0] }, then: "no pages" },
              { case: { $eq: ["$ocr_pct", 0] }, then: "0% OCR" },
              { case: { $lt: ["$ocr_pct", 1] }, then: "partial OCR" },
              { case: { $gte: ["$ocr_pct", 1] }, then: "100% OCR" },
            ],
            default: "0% OCR"
          }}
        },
        count: { $sum: 1 },
        total_pages: { $sum: "$total_pages" },
        ocr_pages: { $sum: "$ocr_pages" },
        missing_ocr_pages: { $sum: { $subtract: ["$total_pages", "$ocr_pages"] } }
    }},
    { $sort: { "_id.provider": 1, "_id.ocr_tier": 1 } }
  ]).toArray();

  console.log("=== OCR STATUS BY PROVIDER ===\n");
  let currentProv = "";
  for (const r of providerOcr) {
    const prov = r._id.provider;
    if (prov !== currentProv) {
      currentProv = prov;
      console.log(prov + ":");
    }
    console.log("  " + r._id.ocr_tier + ": " + r.count + " books (" + r.total_pages + " pages, " + r.ocr_pages + " OCR'd, " + r.missing_ocr_pages + " missing)");
  }

  // Also check what OCR models were used per provider
  console.log("\n=== OCR MODELS USED BY PROVIDER ===\n");
  const modelsByProvider = await db.collection("books").aggregate([
    { $lookup: {
        from: "pages",
        let: { bookId: "$id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$book_id", "$$bookId"] }, "ocr.data": { $exists: true, $ne: null, $ne: "" } } },
          { $group: { _id: "$ocr.model", count: { $sum: 1 } } }
        ],
        as: "models"
    }},
    { $unwind: "$models" },
    { $group: {
        _id: { provider: { $ifNull: ["$image_source.provider", "no provider"] }, model: "$models._id" },
        pages: { $sum: "$models.count" },
        books: { $addToSet: "$id" }
    }},
    { $project: { pages: 1, book_count: { $size: "$books" } } },
    { $sort: { "_id.provider": 1, pages: -1 } }
  ]).toArray();

  currentProv = "";
  for (const r of modelsByProvider) {
    const prov = r._id.provider;
    if (prov !== currentProv) {
      currentProv = prov;
      console.log(prov + ":");
    }
    console.log("  " + (r._id.model || "unknown") + ": " + r.pages + " pages across " + r.book_count + " books");
  }

  // Summary: what needs OCR
  console.log("\n=== SUMMARY: WHAT NEEDS OCR ===\n");

  // Non-English books needing OCR (0% or partial)
  const needsOcr = await db.collection("books").aggregate([
    { $match: { original_language: { $nin: ["English", "english"] } } },
    { $lookup: {
        from: "pages",
        let: { bookId: "$id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$book_id", "$$bookId"] } } },
          { $group: {
              _id: null,
              total: { $sum: 1 },
              has_ocr: { $sum: { $cond: [
                { $and: [
                  { $ne: ["$ocr.data", null] },
                  { $ne: ["$ocr.data", ""] },
                  { $ifNull: ["$ocr.data", false] }
                ]}, 1, 0
              ]}}
          }}
        ],
        as: "stats"
    }},
    { $addFields: {
        total_pages: { $ifNull: [{ $arrayElemAt: ["$stats.total", 0] }, 0] },
        ocr_pages: { $ifNull: [{ $arrayElemAt: ["$stats.has_ocr", 0] }, 0] },
    }},
    { $match: { total_pages: { $gt: 0 }, $expr: { $lt: ["$ocr_pages", "$total_pages"] } } },
    { $group: {
        _id: { $ifNull: ["$image_source.provider", "no provider"] },
        books: { $sum: 1 },
        total_pages: { $sum: "$total_pages" },
        already_ocr: { $sum: "$ocr_pages" },
        needs_ocr: { $sum: { $subtract: ["$total_pages", "$ocr_pages"] } }
    }},
    { $sort: { needs_ocr: -1 } }
  ]).toArray();

  let grandBooks = 0, grandPages = 0, grandNeeds = 0;
  for (const r of needsOcr) {
    console.log(r._id + ": " + r.books + " books, " + r.needs_ocr + " pages need OCR (of " + r.total_pages + " total, " + r.already_ocr + " done)");
    grandBooks += r.books;
    grandPages += r.total_pages;
    grandNeeds += r.needs_ocr;
  }
  console.log("\nTOTAL: " + grandBooks + " books, " + grandNeeds + " pages need OCR (of " + grandPages + " total)");

  await client.close();
}
main();
