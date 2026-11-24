/**
 * One-time, NON-DESTRUCTIVE sheet preparation (replaces setup() from Code.gs).
 *   npm run setup-sheet                      → check / migrate the spreadsheet in SHEET_ID
 *   npm run setup-sheet -- --admin-email you@gmail.com
 *                                            → also put that email on the "admin" user row (if its Email is empty),
 *                                              or create the admin user on a brand-new spreadsheet
 *
 * It only ever ADDS: missing sheets, missing header columns (e.g. Email on Users), the hidden _Locks sheet,
 * missing Settings keys and (for an empty spreadsheet) the default classes. Existing rows are never changed,
 * except filling the admin Email when --admin-email is given.
 */
import { APP, LOCK_HEADERS, LOCK_SHEET, NUMERIC_COLS, SCHEMA } from '../lib/config';
import { batchUpdate, colLetter, getValues, q, spreadsheetBatchUpdate, spreadsheetMeta, append } from '../lib/google';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const adminEmailIdx = args.indexOf('--admin-email');
const ADMIN_EMAIL = adminEmailIdx >= 0 ? String(args[adminEmailIdx + 1] || '').trim().toLowerCase() : '';

function fmtTs(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: APP.TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

async function main() {
  const meta = await spreadsheetMeta();
  console.log(`Spreadsheet: ${meta.properties.title}`);
  const sheets: Record<string, any> = {};
  for (const s of meta.sheets) sheets[s.properties.title] = s;

  // 1) missing sheets
  const want = [...Object.keys(SCHEMA), LOCK_SHEET];
  const add = want.filter((n) => !sheets[n]);
  if (add.length) {
    console.log('Adding sheets:', add.join(', '));
    await spreadsheetBatchUpdate(add.map((title) => ({ addSheet: { properties: { title, hidden: title === LOCK_SHEET, gridProperties: { frozenRowCount: 1 } } } })));
    for (const s of (await spreadsheetMeta()).sheets) sheets[s.properties.title] = s;
  }

  // 2) headers: write for empty sheets, append missing columns at the end for existing ones
  const headerUpdates: { range: string; values: any[][] }[] = [];
  const formatRequests: any[] = [];
  for (const name of want) {
    const expected = name === LOCK_SHEET ? LOCK_HEADERS : SCHEMA[name];
    const cur = ((await getValues(`${q(name)}!1:1`))[0] || []).map((x: any) => String(x ?? '').trim());
    const props = sheets[name].properties;
    if (!cur.some(Boolean)) {
      headerUpdates.push({ range: `${q(name)}!A1`, values: [expected] });
      console.log(`  ${name}: header written`);
      ensureCols(props, expected.length, formatRequests);
      textFormat(props, expected, 0, formatRequests);
      continue;
    }
    const missing = expected.filter((h) => cur.indexOf(h) < 0);
    if (missing.length) {
      const start = cur.length;
      headerUpdates.push({ range: `${q(name)}!${colLetter(start + 1)}1`, values: [missing] });
      ensureCols(props, start + missing.length, formatRequests);
      textFormat(props, missing, start, formatRequests);
      console.log(`  ${name}: added column(s) ${missing.join(', ')}`);
    } else {
      console.log(`  ${name}: OK`);
    }
  }
  if (formatRequests.length) await spreadsheetBatchUpdate(formatRequests);
  await batchUpdate(headerUpdates);

  // 3) Settings defaults (only missing keys)
  const settingsRows = await getValues(q('Settings'));
  const sh = (settingsRows[0] || []).map(String);
  const kI = sh.indexOf('Key');
  const existing = new Set(settingsRows.slice(1).map((r) => String(r[kI] ?? '')));
  const defaults: Record<string, string> = {
    school_name: 'វិទ្យាល័យ ហ៊ុន សែន កំពង់លាវ', ministry: 'ក្រសួងអប់រំ យុវជន និងកីឡា',
    province_office: 'មន្ទីរអប់រំ យុវជន និងកីឡាខេត្តព្រៃវែង', location: 'កំពង់លាវ', school_year: '២០២៦-២០២៧',
    months_json: JSON.stringify(APP.DEFAULT_MONTHS), general_fee: '50000', poor_fee: '25000', receipt_prefix: 'HSK2627-',
    receipt_seq: '0', expense_seq: '0', teacher_can_record: 'YES', last_backup_at: '',
  };
  const newSettings = Object.keys(defaults).filter((k) => !existing.has(k));
  if (newSettings.length) {
    await append(`${q('Settings')}!A${settingsRows.length + 1}`, newSettings.map((k) => sh.map((h: string) => (h === 'Key' ? k : h === 'Value' ? defaults[k] : ''))));
    console.log('Settings added:', newSettings.join(', '));
  }

  // 4) Classes (only if empty)
  const classRows = await getValues(q('Classes'));
  if (classRows.length <= 1) {
    const ch = (classRows[0] || SCHEMA.Classes).map(String);
    await append(`${q('Classes')}!A2`, APP.DEFAULT_CLASSES.map((c, i) => ch.map((h: string) => ({ ClassId: c, Grade: parseInt(c, 10), SortOrder: i + 1, Active: 'YES' } as any)[h] ?? '')));
    console.log('Default classes added');
  }

  // 5) admin email
  const userRows = await getValues(q('Users'));
  const uh = (userRows[0] || []).map(String);
  const iUser = uh.indexOf('Username'), iEmail = uh.indexOf('Email');
  if (ADMIN_EMAIL) {
    const idx = userRows.findIndex((r, i) => i > 0 && String(r[iUser] ?? '').toLowerCase() === 'admin');
    if (idx > 0) {
      const cur = String(userRows[idx][iEmail] ?? '');
      if (!cur) {
        await batchUpdate([{ range: `${q('Users')}!${colLetter(iEmail + 1)}${idx + 1}`, values: [[ADMIN_EMAIL]] }]);
        console.log(`admin Email set to ${ADMIN_EMAIL}`);
      } else console.log(`admin already has Email ${cur} (not changed)`);
    } else if (userRows.length <= 1) {
      const now = fmtTs(new Date());
      const rec: Record<string, any> = { Username: 'admin', DisplayName: 'អ្នកគ្រប់គ្រងប្រព័ន្ធ', Role: 'ADMIN', AllowedClasses: '*', Active: 'YES', Email: ADMIN_EMAIL, CreatedAt: now, UpdatedAt: now, MustChangePassword: 'NO', FailedAttempts: 0 };
      await append(`${q('Users')}!A2`, [uh.map((h: string) => rec[h] ?? '')]);
      console.log(`admin user created with Email ${ADMIN_EMAIL}`);
    }
  }
  const noEmail = userRows.slice(1).filter((r) => String(r[iUser] ?? '') && !String(r[iEmail] ?? '')).map((r) => r[iUser]);
  if (noEmail.length && !ADMIN_EMAIL) console.log(`⚠ Users without Email (cannot sign in yet): ${noEmail.join(', ')}`);

  // 6) audit chain genesis on an empty log
  const audit = await getValues(`${q('AuditLog')}!A1:H3`);
  if (audit.length <= 1) {
    const ah = (audit[0] || SCHEMA.AuditLog).map(String);
    const r: Record<string, any> = { Timestamp: fmtTs(new Date()), Actor: 'SYSTEM', Action: 'SETUP', Entity: 'System', EntityId: 'setup', Summary: 'Next.js setup', PrevHash: 'GENESIS' };
    r.Hash = createHash('sha256').update(['GENESIS', r.Timestamp, r.Actor, r.Action, r.Entity, r.EntityId, r.Summary].join('|'), 'utf8').digest('hex');
    await append(`${q('AuditLog')}!A2`, [ah.map((h: string) => r[h] ?? '')]);
  }

  // 7) protection check — the service account must be allowed to edit protected sheets
  const sa = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').toLowerCase();
  const blocked: string[] = [];
  for (const s of (await spreadsheetMeta()).sheets) {
    for (const p of s.protectedRanges || []) {
      if (p.warningOnly) continue;
      const users: string[] = (p.editors?.users || []).map((x: string) => x.toLowerCase());
      if (users.indexOf(sa) < 0) blocked.push(s.properties.title);
    }
  }
  if (blocked.length) {
    console.log(`\n⚠ These sheets are protected and the service account (${sa}) is not an allowed editor:\n   ${[...new Set(blocked)].join(', ')}`);
    console.log('   Run allowServiceAccount() from apps-script/Backup.gs once, or edit Data → Protect sheets and ranges.');
  }
  console.log('\nDone.');
}

function ensureCols(props: any, need: number, reqs: any[]) {
  const have = props.gridProperties?.columnCount || 26;
  if (need > have) reqs.push({ appendDimension: { sheetId: props.sheetId, dimension: 'COLUMNS', length: need - have } });
}

/** Text format '@' for non-numeric columns (as setup() did), '0.##' for numeric ones. */
function textFormat(props: any, headers: string[], startIdx: number, reqs: any[]) {
  headers.forEach((h, j) => {
    reqs.push({
      repeatCell: {
        range: { sheetId: props.sheetId, startColumnIndex: startIdx + j, endColumnIndex: startIdx + j + 1 },
        cell: { userEnteredFormat: { numberFormat: NUMERIC_COLS[h] ? { type: 'NUMBER', pattern: '0.##' } : { type: 'TEXT', pattern: '@' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
