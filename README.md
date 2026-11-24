# HSK Budget System v3 — Next.js on Vercel, Google Sheets as the database

Port of the Apps Script web app (v2.0.0, `Code.gs` + `Index.html`) to Next.js.
The same spreadsheet stays the database; all business rules, Khmer messages, reports and the print layouts are unchanged.

| | v2 (Apps Script) | v3 (this project) |
|---|---|---|
| Hosting | `script.google.com` web app | Vercel |
| Sign-in | username + password (PBKDF2) | **Google Sign-In** — Users sheet `Email` column decides who may enter |
| Data access | SpreadsheetApp | Google Sheets API (service account) |
| Write lock | LockService | ticket lock on hidden `_Locks` sheet |
| Live updates | none (reload on navigation) | browser checks a data fingerprint every **5 s** and re-renders; manual edits in the sheet appear within ~5–10 s |
| Daily backup | Apps Script trigger | Vercel Cron 19:00 (Phnom Penh) → `apps-script/Backup.gs` copies the file in your Drive |

## Project layout
```
app/page.tsx              app shell (same element ids as Index.html)
app/legacy-ui.js          the original browser UI, ported (fetch instead of google.script.run, live polling)
app/login/page.tsx        Google sign-in page
app/api/rpc/route.ts      single API endpoint  { action, payload } → { ok, data } | { ok:false, error, code }
app/api/cron/backup       daily backup (Vercel Cron)
lib/actions.ts            all actions — line-by-line port of Code.gs
lib/db.ts                 sheet tables, 4-second shared read cache, buffered writes, _Locks lock
lib/google.ts             Sheets REST client (service account)
scripts/setup.ts          non-destructive sheet migration (adds Email column, _Locks sheet, defaults)
apps-script/Backup.gs     tiny Apps Script web app that copies the spreadsheet into Drive
```

## Setup

> Do a full test on a **copy** of the spreadsheet first (File → Make a copy), then point `SHEET_ID` to the real one.

### 1. Google Cloud (once)
1. <https://console.cloud.google.com> → create a project.
2. **APIs & Services → Library** → enable **Google Sheets API**.
3. **IAM & Admin → Service accounts** → create one → **Keys → Add key → JSON**. From the JSON you need `client_email` and `private_key`.
4. **APIs & Services → OAuth consent screen** → External → app name, your email → add scope `email`, `profile`, `openid`.
   While in *Testing* only listed test users can sign in — add your staff, or click **Publish app**.
5. **Credentials → Create credentials → OAuth client ID → Web application**. Authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://YOUR-APP.vercel.app/api/auth/callback/google` (add after the first deploy)

### 2. Spreadsheet access
1. Share the spreadsheet with the service account `client_email` as **Editor**.
2. v2 `setup()` protected every sheet so only the owner can edit. Let the service account through:
   create the backup script (step 4) and run `allowServiceAccount()` once — or add the service account under
   **Data → Protect sheets and ranges** for each sheet.

### 3. Local run + sheet migration
```bash
cp .env.example .env.local        # fill in the values
npm install
npm run setup-sheet -- --admin-email your.name@gmail.com
npm run dev                       # http://localhost:3000
```
`setup-sheet` only **adds** things: the `Email` column on Users, the hidden `_Locks` sheet, missing Settings keys.
It never edits existing rows (except filling the admin's empty Email when `--admin-email` is given) and warns about protected sheets.

Then fill the **Email** column for every user in the Users sheet (or, once you are signed in as admin, use **អ្នកប្រើប្រាស់ → កែ**).
Only users with `Active = YES` and a matching Google email can sign in. Password columns are ignored from now on.

### 4. Backup web app (Apps Script)
1. <https://script.google.com> → New project → paste `apps-script/Backup.gs`.
2. Project Settings → Script properties: `SHEET_ID`, `BACKUP_SECRET` (long random string), `SERVICE_ACCOUNT` (service account email).
3. Run `allowServiceAccount` once (authorize).
4. Deploy → New deployment → **Web app**, Execute as **Me**, Who has access **Anyone** → put the `/exec` URL in `BACKUP_WEBAPP_URL`.

### 5. Retire the old v2 app — important
In the old Apps Script project: **Triggers → delete `dailyBackup`**, and **Deploy → Manage deployments → archive** the web app.
Only one system may write to the sheet; two writers would break receipt numbering and the audit hash chain.

### 6. Deploy to Vercel
1. Push this folder to a GitHub repo → <https://vercel.com/new> → import it.
2. Settings → Environment Variables: everything from `.env.example`
   (`GOOGLE_PRIVATE_KEY` exactly as in the JSON, including `\n`; generate `AUTH_SECRET` with `npx auth secret`;
   `CRON_SECRET` any long random string).
3. Deploy, then add the production callback URL to the OAuth client (step 1.5).

## Editing the sheet by hand
Allowed and picked up automatically within ~5–10 s. Keep in mind:
- Don't rename or delete header cells (row 1). Extra columns and blank rows are fine.
- Prefer the app for money movements (Receipts / PaymentLines / Expenses): the app enforces no-overpayment, VOID-instead-of-delete and writes the audit log. Hand edits there bypass these checks.
- Never edit `AuditLog` or `_Locks`. (If `_Locks` grows large, you may clear rows 2+ at a quiet time.)

## Limits
- Google Sheets API quota: ~60 read and ~60 write requests per minute for the service account. A typical save uses ~3 reads + ~5 writes; reads for all viewers are shared through a 4-second cache. Fine for a school's staff; if you ever see "busy" errors, request a higher quota in Google Cloud → Sheets API → Quotas.
- Writes are serialised (one at a time); each takes ~1–2 s.

## Checks
```bash
npm run typecheck
npm run build
```
