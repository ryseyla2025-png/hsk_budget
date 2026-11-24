import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { activeUser } from '@/lib/api';
import { exportXlsx } from '@/lib/google';
import { now_ } from '@/lib/util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Admin only: download the whole spreadsheet as .xlsx to the user's own computer. Read-only. */
export async function GET() {
  const session = await auth();
  const user = await activeUser(session?.user?.email).catch(() => null);
  if (!user) return NextResponse.json({ ok: false, error: 'សូមចូលប្រព័ន្ធម្ដងទៀត', code: 'AUTH' }, { status: 401 });
  if (user.Role !== 'ADMIN') return NextResponse.json({ ok: false, error: 'អ្នកគ្មានសិទ្ធិធ្វើសកម្មភាពនេះទេ', code: 'FORBIDDEN' }, { status: 403 });
  try {
    const file = await exportXlsx();
    const name = 'HSK-Backup-' + now_().slice(0, 16).replace(' ', '_').replace(':', '') + '.xlsx';
    console.info(`backup download by ${user.Username} (${file.length} bytes)`);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    console.error('backup download failed:', e?.stack || e);
    return NextResponse.json({ ok: false, error: 'មិនអាចទាញយកឯកសារបម្រុងទុកបានទេ។ សូមព្យាយាមម្ដងទៀត។', code: 'SERVER' }, { status: 500 });
  }
}
