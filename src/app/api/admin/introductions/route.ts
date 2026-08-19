import { NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';

/**
 * GET /api/admin/introductions
 *
 * What readers wrote about themselves on /welcome — name, what draws them here,
 * the language they'd rather read in, and whether they offered to help.
 *
 * The form has been collecting free text since 2026-07-29 and nothing in the
 * product could read it: /admin/users shows *whether* someone was welcomed but
 * not a word of what they said. Asking people to write to you and never opening
 * the letters is the failure this route exists to prevent.
 *
 * users.profile is the durable record and stays the source of truth for what a
 * reader WROTE. The `volunteers` collection is keyed by email and under-reports
 * the writing, but it is the only place that records two things profile cannot:
 * that someone explicitly volunteered, and whether we have written back
 * (`contacted`). So the two are joined here rather than one replacing the other.
 *
 * Why `contacted` matters enough to surface: measured 2026-08-05, 184 people had
 * volunteered and none had been contacted. That reads like months of neglect and
 * is not — 164 of them arrived in the previous SEVEN DAYS. The number that
 * matters operationally is therefore not a total but a backlog, and it moves
 * fast, which is exactly why it belongs in a view somebody opens.
 */
export const GET = withAdminAuth(async () => {
  const db = await getDb();
  const users = db.collection('users');

  const volunteersCol = db.collection('volunteers');
  const [rows, welcomedTotal, pending, volunteerRows] = await Promise.all([
    users
      .find(
        { 'profile.updatedAt': { $exists: true } },
        {
          projection: {
            name: 1,
            email: 1,
            createdAt: 1,
            'profile.aboutYou': 1,
            'profile.helpDescription': 1,
            'profile.preferredLanguage': 1,
            'profile.preferredLanguageKey': 1,
            'profile.updatedAt': 1,
          },
        },
      )
      .sort({ 'profile.updatedAt': -1 })
      .toArray(),
    users.countDocuments({ welcomedAt: { $ne: null, $exists: true } }),
    users.countDocuments({ welcomedAt: null }),
    volunteersCol.find({}, { projection: { email: 1, created_at: 1, contacted: 1 } }).toArray(),
  ]);

  const norm = (e: unknown) => String(e ?? '').trim().toLowerCase();
  const volunteerByEmail = new Map(
    volunteerRows.map(v => [norm(v.email), { at: v.created_at as Date | undefined, contacted: v.contacted === true }]),
  );

  const introductions = rows.map(u => {
    const p = (u.profile || {}) as Record<string, unknown>;
    return {
      id: String(u._id),
      name: (u.name as string) || null,
      email: (u.email as string) || null,
      about: (p.aboutYou as string) || '',
      help: (p.helpDescription as string) || '',
      language: (p.preferredLanguage as string) || '',
      language_key: (p.preferredLanguageKey as string) || '',
      created_at: u.createdAt ? new Date(u.createdAt as Date).toISOString() : null,
      updated_at: p.updatedAt ? new Date(p.updatedAt as Date).toISOString() : null,
      volunteered: volunteerByEmail.has(norm(u.email)),
      volunteered_at: volunteerByEmail.get(norm(u.email))?.at
        ? new Date(volunteerByEmail.get(norm(u.email))!.at as Date).toISOString()
        : null,
      contacted: volunteerByEmail.get(norm(u.email))?.contacted ?? false,
    };
  });

  // Language tally. Readers type free text ("English and Spanish", "español",
  // "Spanish-English"), deliberately — a dropdown can only offer the languages we
  // already thought of. So count a mention rather than an exact match: one reader
  // who reads two languages is evidence for both.
  const LANGUAGES: Record<string, RegExp> = {
    Spanish: /espa[nñ]ol|spanish|castellano/i,
    English: /engl[ií]sh|ingl[eé]s/i,
    Portuguese: /portugu[eê]s|portuguese/i,
    French: /fran[cç]ais|french|franc[eé]s/i,
    German: /deutsch|german|alem[aá]n/i,
    Italian: /italian[oa]?|italien/i,
    Latin: /\blat[ií]n\b|\blatin\b/i,
    Dutch: /nederlands|dutch|holand[eé]s/i,
    Chinese: /chinese|mandarin|chino|中文/i,
    Arabic: /arabic|[aá]rabe/i,
    Greek: /greek|griego|ελλην/i,
    Russian: /russian|ruso|русск/i,
  };

  const languageTally: { language: string; count: number }[] = [];
  const withLanguage = introductions.filter(i => i.language.trim());
  for (const [label, re] of Object.entries(LANGUAGES)) {
    const count = withLanguage.filter(i => re.test(i.language)).length;
    if (count > 0) languageTally.push({ language: label, count });
  }
  languageTally.sort((a, b) => b.count - a.count);

  // Anything nobody's regex matched — the whole point of free text is catching
  // the languages we did not predict, so surface them rather than dropping them.
  const unmatched = withLanguage
    .filter(i => !Object.values(LANGUAGES).some(re => re.test(i.language)))
    .map(i => i.language);

  return NextResponse.json({
    introductions,
    totals: {
      // Written a profile.
      wrote: introductions.length,
      // Pressed Save or Skip. wrote + skipped === welcomed.
      welcomed: welcomedTotal,
      skipped: Math.max(0, welcomedTotal - introductions.length),
      // Never seen it, or seen it and walked away without pressing anything.
      pending,
      offered_help: introductions.filter(i => i.help.trim()).length,
      gave_language: withLanguage.length,
      language_respondents: withLanguage.length,
      volunteered: introductions.filter(i => i.volunteered).length,
      // The actionable number: people who raised a hand and have had no reply.
      awaiting_reply: introductions.filter(i => i.volunteered && !i.contacted).length,
    },
    language_tally: languageTally,
    language_unmatched: unmatched,
  });
});

/**
 * PATCH /api/admin/introductions — mark a volunteer as contacted (or not).
 *
 * Body: { email, contacted }
 *
 * Deliberately a toggle rather than a one-way "mark done": the state this
 * tracks is "have we written back", and getting that wrong in the sticky
 * direction is how someone silently drops off the list without a reply.
 */
export const PATCH = withAdminAuth(async (request: Request) => {
  let body: { email?: string; contacted?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const db = await getDb();
  const res = await db.collection('volunteers').updateOne(
    { email },
    { $set: { contacted: body.contacted === true, contacted_at: body.contacted === true ? new Date() : null } },
  );
  if (!res.matchedCount) {
    return NextResponse.json({ error: 'no volunteer with that email' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, email, contacted: body.contacted === true });
});
