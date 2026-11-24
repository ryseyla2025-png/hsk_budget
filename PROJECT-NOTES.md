# HSK Budget System — Project notes

Last updated: 2026-11-23. The full setup guide is in `README.md`; this file records where things stand and the day-to-day how-tos.

## Status

| Item | Status |
|---|---|
| Next.js app (v3) built | ✅ `D:\Web HSK Budget System` |
| Original Apps Script source (v2) | `D:\KampongLeav_Budget_System_2026_2027\New\hs-budget-app-v2\hs-budget-app\` |
| Google Cloud project `hsk-budget` | ✅ Sheets API enabled |
| Google Sign-In (OAuth client) | ✅ works on `http://localhost:3000` · consent screen in **Testing** mode |
| Service account | ✅ `hsk-budget@hsk-budget.iam.gserviceaccount.com` |
| Spreadsheet "HSK Budget DB 2026-2027" (test copy) | ✅ shared with service account (Editor), protections opened to it, `_Locks` sheet added, Users `Email` column added |
| Saving data | ✅ first student + receipt recorded |
| Backup (Apps Script `Backup.gs` + `BACKUP_*` / `CRON_SECRET`) | ⏳ not set up — "បម្រុងទុកឥឡូវនេះ" won't work yet |
| Deploy to Vercel | ⏳ not done |
| Retire old v2 web app + its `dailyBackup` trigger | ⏳ must be done before going live |
| Rename admin Username (has a space/capitals) | ⏳ change cell A2 in Users to e.g. `ryseyla` |

## Run locally
```bash
cd "D:\Web HSK Budget System"
npm run dev          # → http://localhost:3000
```
Settings and keys live in `.env.local` (never share or commit it).

## Add a user
1. In the app: **អ្នកប្រើប្រាស់ → + បន្ថែមអ្នកប្រើ** → username (a-z 0-9 . _ -), full name, **Google email**, role, classes (Teachers only, e.g. `7A,7B`) → **រក្សាទុក**.
2. While Google sign-in is in **Testing** mode: also add their Gmail in **Google Cloud → APIs & Services → OAuth consent screen → Audience → Test users** (or click **Publish app**).

| Role | Can do |
|---|---|
| ADMIN — អ្នកគ្រប់គ្រងប្រព័ន្ធ | everything (users, settings, classes, VOID, backup, audit log) |
| ACCOUNTANT — គណនេយ្យករ | students, payments, expenses, all reports |
| TEACHER — គ្រូបន្ទុកថ្នាក់ | only their own classes; record payments only if allowed in Settings |
| DIRECTOR — នាយក | view everything (incl. finance and audit log), change nothing |

To turn someone off: **កែ** → untick **គណនីសកម្ម**.

## Rules for the spreadsheet
- Don't rename or delete row-1 headers. Extra columns and blank rows are OK.
- Never edit `AuditLog` or `_Locks` by hand.
- Record money (receipts, expenses) in the app, not in the sheet: the app blocks overpayment and logs every change.
- Only **one** system may write to the sheet. Turn the old v2 Apps Script app off before going live.

## Problems we hit and their fixes
| Error | Cause → fix |
|---|---|
| `Missing required parameter: client_id` | `AUTH_GOOGLE_ID` empty in `.env.local` |
| `Google Sheets API has not been used in project … or it is disabled` | enable Sheets API in Google Cloud |
| `The caller does not have permission` | share the spreadsheet with the service account as Editor |
| `redirect_uri_mismatch` | add `http://localhost:3000/api/auth/callback/google` to the OAuth client's Authorized redirect URIs |
| Login → "access denied" | your Gmail isn't in the Users sheet `Email` column (or `Active` ≠ YES) |
| Can't save (`Unable to parse range: '_Locks'!A1`) | create the `_Locks` sheet (headers `Ticket, Ts, State`) |
| Can't save (protected cell) | Data → Protect sheets and ranges → allow the service account |

## Next steps
1. Rename the admin Username (no spaces, lowercase).
2. Set up backup: `apps-script/Backup.gs` (README step 4) and fill `BACKUP_WEBAPP_URL`, `BACKUP_SECRET`, `CRON_SECRET`.
3. Deploy to Vercel (README step 6) and add the production callback URL to the OAuth client.
4. Retire the old v2 app, then point `SHEET_ID` at the real spreadsheet (same preparation: share, protections, `_Locks`, Email column).
