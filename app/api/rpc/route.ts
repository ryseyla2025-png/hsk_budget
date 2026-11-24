import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { runApi } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Single RPC endpoint — same contract as the old google.script.run api(token, action, payload). */
export async function POST(req: Request) {
  // basic CSRF guard: only same-origin JSON requests
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) {
    return NextResponse.json({ ok: false, error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }
  let body: any = null;
  try { body = await req.json(); } catch { body = null; }
  if (!body || typeof body.action !== 'string') {
    return NextResponse.json({ ok: false, error: 'សំណើមិនត្រឹមត្រូវ', code: '' }, { status: 400 });
  }
  const session = await auth();
  const result = await runApi(session?.user?.email, body.action, body.payload);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
