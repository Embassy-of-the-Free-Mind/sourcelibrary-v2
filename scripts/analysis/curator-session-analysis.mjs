import { MongoClient } from 'mongodb';

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  
  // 1. Sessions with actual book imports (real curator work)
  const sessions = await db.collection('curator_sessions').find(
    { 'books_imported.0': { $exists: true } },
    { projection: { id: 1, title: 1, curator_score: 1, session_type: 1, themes: 1, 
                    books_imported: 1, books_discussed: 1, date: 1, duration_minutes: 1,
                    word_count: 1, message_count: 1 } }
  ).sort({ date: 1 }).toArray();
  
  console.log('=== SESSIONS WITH IMPORTS: ' + sessions.length + ' ===\n');
  for (const s of sessions) {
    const d = s.date ? new Date(s.date).toISOString().slice(0, 10) : '?';
    console.log('--- ' + d + ' | score=' + s.curator_score + ' | ' + s.session_type + ' | ' + (s.books_imported||[]).length + ' imported | ' + (s.books_discussed||[]).length + ' discussed ---');
    console.log('Title: ' + (s.title || '').substring(0, 150));
    console.log('Themes: ' + (s.themes || []).join(', '));
    console.log('Books imported:');
    for (const b of (s.books_imported || []).slice(0, 15)) {
      console.log('  - ' + (b.title || '?').substring(0, 100) + (b.year ? ' (' + b.year + ')' : '') + (b.author ? ' by ' + b.author.substring(0, 50) : ''));
    }
    if ((s.books_imported || []).length > 15) console.log('  ... and ' + ((s.books_imported || []).length - 15) + ' more');
    console.log('');
  }
  
  // 2. All book IDs from sessions
  const sessionBookIds = new Set();
  for (const s of sessions) {
    for (const b of (s.books_imported || [])) if (b.book_id) sessionBookIds.add(b.book_id);
  }
  
  // 3. Books NOT in any session, grouped by import date
  const allBooks = await db.collection('books').find(
    { status: { $ne: 'deleted' } },
    { projection: { id: 1, title: 1, author: 1, year: 1, language: 1, categories: 1, created_at: 1 } }
  ).sort({ created_at: 1 }).toArray();
  
  const unlinked = allBooks.filter(b => !sessionBookIds.has(b.id));
  console.log('=== BOOKS NOT IN ANY SESSION: ' + unlinked.length + ' / ' + allBooks.length + ' ===\n');
  
  // Group unlinked books by import date
  const byDate = {};
  for (const b of unlinked) {
    const d = b.created_at ? new Date(b.created_at).toISOString().slice(0, 10) : 'unknown';
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(b);
  }
  
  console.log('=== LARGE IMPORT BATCHES (unlinked, 10+ books/day) ===');
  for (const [date, books] of Object.entries(byDate).sort()) {
    if (books.length >= 10) {
      const langs = {};
      const cats = {};
      for (const b of books) {
        const l = b.language || '?';
        langs[l] = (langs[l] || 0) + 1;
        for (const c of (b.categories || [])) cats[c] = (cats[c] || 0) + 1;
      }
      const topLangs = Object.entries(langs).sort((a,b) => b[1] - a[1]).slice(0, 5).map(([l,c]) => l + ':' + c).join(', ');
      const topCats = Object.entries(cats).sort((a,b) => b[1] - a[1]).slice(0, 5).map(([c,n]) => c + ':' + n).join(', ');
      console.log(date + ': ' + books.length + ' books | langs: ' + topLangs + ' | cats: ' + topCats);
      for (const b of books.slice(0, 3)) {
        console.log('  - ' + (b.title || '?').substring(0, 80) + (b.year ? ' (' + b.year + ')' : ''));
      }
      if (books.length > 3) console.log('  ...');
    }
  }
  
  // 4. Import waves — group ALL books by week
  console.log('\n=== IMPORT WAVES (by week) ===');
  const byWeek = {};
  for (const b of allBooks) {
    if (!b.created_at) continue;
    const d = new Date(b.created_at);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    if (!byWeek[key]) byWeek[key] = { total: 0, langs: {}, cats: {} };
    byWeek[key].total++;
    const l = b.language || '?';
    byWeek[key].langs[l] = (byWeek[key].langs[l] || 0) + 1;
    for (const c of (b.categories || [])) byWeek[key].cats[c] = (byWeek[key].cats[c] || 0) + 1;
  }
  for (const [week, data] of Object.entries(byWeek).sort()) {
    const topLangs = Object.entries(data.langs).sort((a,b) => b[1] - a[1]).slice(0, 4).map(([l,c]) => l + ':' + c).join(', ');
    const topCats = Object.entries(data.cats).sort((a,b) => b[1] - a[1]).slice(0, 4).map(([c,n]) => c + ':' + n).join(', ');
    console.log('Week ' + week + ': ' + data.total + ' books | ' + topLangs + ' | ' + topCats);
  }
  
  await client.close();
}
run().catch(e => { console.error(e); process.exit(1); });
