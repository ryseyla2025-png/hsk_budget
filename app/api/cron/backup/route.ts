import { NextResponse } from 'next/server';
import { runScheduledBackup } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Daily backup (vercel.json cron, 12:00 UTC = 19:00 Asia/Phnom_Penh). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const r = await runScheduledBackup();
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
