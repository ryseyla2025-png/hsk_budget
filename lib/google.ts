/**
 * Thin Google Sheets REST client using a service account.
 * Values are read UNFORMATTED (numbers stay numbers) and written RAW (never parsed as formulas,
 * which replaces the old cell_() apostrophe guard against formula injection).
 */
import { JWT } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

let jwt: JWT | null = null;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export function sheetId(): string {
  return env('SHEET_ID');
}

function client(): JWT {
  if (!jwt) {
    jwt = new JWT({
      email: env('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
      key: env('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n'),
      scopes: SCOPES,
    });
  }
  return jwt;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Authorized fetch with retry on 429 / 5xx (Sheets quota is per minute, so back off generously). */
async function gfetch(url: string, init: RequestInit = {}): Promise<any> {
  let lastErr = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const { token } = await client().getAccessToken();
    const res = await fetch(url, {
      ...init,
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    if (res.ok) return res.json();
    const text = await res.text();
    lastErr = `${res.status} ${text.slice(0, 500)}`;
    if (res.status === 429 || res.status >= 500) {
      await sleep(Math.min(8000, 500 * 2 ** attempt) + Math.random() * 300);
      continue;
    }
    break;
  }
  throw new Error(`Google Sheets API error: ${lastErr}`);
}

export const q = (sheet: string) => `'${sheet.replace(/'/g, "''")}'`;

export async function batchGet(ranges: string[]): Promise<any[][][]> {
  const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING', majorDimension: 'ROWS' });
  ranges.forEach((r) => params.append('ranges', r));
  const data = await gfetch(`${BASE}/${sheetId()}/values:batchGet?${params}`);
  return (data.valueRanges || []).map((vr: any) => vr.values || []);
}

export async function getValues(range: string): Promise<any[][]> {
  return (await batchGet([range]))[0];
}

export async function batchUpdate(data: { range: string; values: any[][] }[]): Promise<void> {
  if (!data.length) return;
  await gfetch(`${BASE}/${sheetId()}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });
}

/** Append rows; returns the first row number written (parsed from updatedRange). */
export async function append(range: string, values: any[][], insert: 'INSERT_ROWS' | 'OVERWRITE' = 'OVERWRITE'): Promise<number> {
  const params = new URLSearchParams({ valueInputOption: 'RAW', insertDataOption: insert, includeValuesInResponse: 'false' });
  const data = await gfetch(`${BASE}/${sheetId()}/values/${encodeURIComponent(range)}:append?${params}`, {
    method: 'POST',
    body: JSON.stringify({ values }),
  });
  const m = /![A-Z]+(\d+)/.exec(data?.updates?.updatedRange || '');
  return m ? parseInt(m[1], 10) : 0;
}

/** Spreadsheet structure requests (add sheet, hide, resize…) — used by scripts/setup.ts. */
export async function spreadsheetBatchUpdate(requests: any[]): Promise<any> {
  return gfetch(`${BASE}/${sheetId()}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
}

export async function spreadsheetMeta(): Promise<any> {
  return gfetch(`${BASE}/${sheetId()}?fields=properties.title,sheets(properties(sheetId,title,hidden,gridProperties),protectedRanges(protectedRangeId,editors,warningOnly))`);
}

export function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
