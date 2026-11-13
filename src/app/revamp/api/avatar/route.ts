import { NextResponse } from 'next/server';
import { readMakers, writeMakers } from '../../_lib/makers';

// Prototype only, local: saves a person's chosen avatar into _data/makers.json. No database.
export async function POST(req: Request) {
  const { person, src } = await req.json() as { person?: string; src?: string };
  const m = readMakers();
  if (!person || !m.people[person] || !src || !/^https:\/\/images\.sourcelibrary\.org\//.test(src)) return NextResponse.json({ ok: false }, { status: 400 });
  m.people[person].avatar = src;
  writeMakers(m);
  return NextResponse.json({ ok: true });
}
