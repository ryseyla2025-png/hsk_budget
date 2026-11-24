# CLAUDE.md

HSK Budget System v3: a Next.js 15 (App Router) port of a Google Apps Script web app for school fee and budget management (វិទ្យាល័យ ហ៊ុន សែន កំពង់លាវ). **The database is a Google Spreadsheet**, accessed with the Sheets REST API through a service account. Users sign in with Google (Auth.js v5). Deploy target: Vercel. Setup guide: `README.md`. Current status and how-tos: `PROJECT-NOTES.md`.

## Commands
```bash
npm run dev            # http://localhost:3000 (needs .env.local)
npm run typecheck      # tsc --noEmit
npm run build
npm run setup-sheet -- --admin-email x@gmail.com   # WRITES to the spreadsheet: ask the user first
```
There's no test suite in the repo. Logic was checked against an in-memory fake of the Sheets API that intercepts `fetch` and stubs `JWT.prototype.getAccessToken`. Rebuild that harness if you need to verify lock or action changes.

## Architecture
- `lib/actions.ts`: **line-by-line port of the original `Code.gs`** (v2 source: `D:\KampongLeav_Budget_System_2026_2027\New\hs-budget-app-v2\hs-budget-app\`). Keep business rules, Khmer messages and report maths identical to it unless the user asks for a change. Actions are synchronous over in-memory tables, like Apps Script.
- `lib/db.ts`: tables found by header name; a 4 s in-memory read snapshot shared per server instance; `withLock_()` = ticket lock on the hidden `_Locks` sheet, then a fresh re-read, then the action runs, then buffered writes are flushed (cell updates first, then appends), then the lock is released. Request context comes from AsyncLocalStorage.
- `lib/google.ts`: REST client. Reads use UNFORMATTED_VALUE; writes use **RAW** (this is the formula-injection guard, so don't switch to USER_ENTERED). Retries on 429/5xx.
- `lib/api.ts` + `app/api/rpc/route.ts`: a single `POST /api/rpc {action, payload}` returning `{ok, data}` or `{ok:false, error, code}` (codes: AUTH, FORBIDDEN, SERVER). Identity = session email → Users row (`Email`, `Active=YES`) → `Role` / `AllowedClasses`.
- `app/legacy-ui.js`: the original vanilla-JS UI from Index.html, started by `AppBoot.tsx`. `app/page.tsx` keeps the original element ids (`#view`, `#modal`, `#printArea`…) as direct children of `<body>`, because the print CSS depends on that. Live updates: the `version` action is polled every 5 s.
- Backup: Vercel Cron → `/api/cron/backup` → the `apps-script/Backup.gs` web app copies the file in the owner's Drive (service accounts have no Drive storage).

## Rules
- **Every write goes through `withLock_()`** and records an `audit_()` entry. Read counters (`receipt_seq`, `expense_seq`) inside the lock. The AuditLog is a SHA-256 hash chain (`auditHash_`), so never change its fields or format.
- Never delete or overwrite transactions: receipts and expenses are VOIDed (Admin only, reason ≥ 5 characters).
- Only one system may write to the sheet. The old v2 Apps Script app must be retired before going live.
- Writing to the user's spreadsheet (setup script, test data) needs the user's explicit OK. Read-only checks are fine.
- Never print or commit `.env.local` values (service account key, OAuth secret).
- Watch the Sheets API quota (~60 reads and ~60 writes per minute for the service account). Prefer one `batchGet` over many reads.
- Usernames must match `^[a-z0-9._-]{3,30}$`. Roles: ADMIN, ACCOUNTANT, TEACHER (limited to `AllowedClasses`), DIRECTOR (read-only).
- UI text is Khmer. Keep new UI strings in Khmer to match.
