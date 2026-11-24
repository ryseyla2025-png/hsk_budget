/** Small helpers ported from Code.gs (mk_, num_, clampMonth_, cleanText_, now_, today_, userErr_…). */
import { APP } from './config';

export class UserError extends Error {
  userFacing = true;
  constructor(message: string, public code = '') { super(message); }
}
export const userErr = (msg: string, code = '') => new UserError(msg, code);

/** yyyy-MM-dd HH:mm:ss in Asia/Phnom_Penh (Vercel servers run in UTC). */
export function fmtTs(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: APP.TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
export const now_ = () => fmtTs(new Date());
export const today_ = () => now_().slice(0, 10);

export function mk_(v: any): string {
  if (v === undefined || v === null || v === '') return '';
  const m = /^(\d{4})-(\d{1,2})/.exec(String(v));
  if (!m) return '';
  return m[1] + '-' + ('0' + m[2]).slice(-2);
}

export function clampMonth_(m: string, months: string[]): string {
  if (!m) return months[0];
  if (m < months[0]) return months[0];
  if (m > months[months.length - 1]) return months[months.length - 1];
  return m;
}

export function num_(v: any): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

export function sumRows_(rows: any[], keys: string[]): Record<string, number> {
  const t: Record<string, number> = {};
  keys.forEach((k) => { t[k] = 0; });
  rows.forEach((r) => keys.forEach((k) => { t[k] += num_(r[k]); }));
  return t;
}

export function cleanText_(v: any, max?: number): string {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 200);
}
